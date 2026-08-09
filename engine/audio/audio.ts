// Engine RTS — ÁUDIO: mixer de vozes sobre o namespace `rts:audio`.
//
// O runtime expõe só o essencial: abrir a saída e empurrar samples f32
// intercalados num ring buffer (`audio.write`). Não há "tocar arquivo", nem
// mixagem, nem vozes — é isso que este módulo constrói.
//
// O modelo é o clássico "o jogo enche, a thread de áudio drena": a cada frame
// `pump()` gera os samples que faltam para manter o ring cheio e os escreve. Se
// o jogo travar por um frame, o ring ainda tem folga e o som não pica.
//
// Uso (ver o componente AudioSource):
//   initAudio();
//   playTone(440.0, 0.25, 0.3);        // beep de 440 Hz, 0,25 s
//   ... por frame: pumpAudio();

import audio from "rts:audio";
import math from "rts:math";
import { panGains } from "./spatial";
import buffer from "rts:buffer";

/// Handle do stream de saída (0 = fechado/indisponível).
let dev: i64 = 0;
let devRate: f64 = 48000.0;
let devCh = 2;

/// Quantos frames tentamos manter enfileirados. Abaixo disso `pump` gera mais.
/// ~100 ms a 48 kHz: folga suficiente para aguentar um frame lento sem picotar,
/// e curto o bastante para um som disparado agora não atrasar de forma audível.
const TARGET_FRAMES = 4800;
/// Teto de frames gerados numa única chamada de `pump`. Sem ele, um primeiro
/// frame com o ring vazio geraria os 24000 de uma vez e engasgaria o frame.
const MAX_PUMP = 2400;

// ── VOZES ───────────────────────────────────────────────────────────────────
// Arrays paralelos (o layout que o motor percorre mais rápido). Uma voz é um
// oscilador com envelope; `vKind` escolhe a forma de onda.
const MAX_VOICES = 24;
const V_SINE = 0;
const V_SQUARE = 1;
const V_NOISE = 2;

let vActive: number[] = [];
let vKind: number[] = [];
let vFreq: f64[] = [];
let vPhase: f64[] = [];
let vGain: f64[] = [];
let vLeft: f64[] = [];      // segundos restantes
let vTotal: f64[] = [];     // duração total (para o envelope)
let vSeed: number[] = [];   // estado do ruído (por voz, determinístico)
// GANHO POR CANAL. Uma voz global (UI, música) tem 1/1 e passa pela mesma
// multiplicação do mixer; uma voz posicional tem os ganhos que `spatial`
// calculou a partir da posição. O laço quente não sabe a diferença.
let vGL: f64[] = [];
let vGR: f64[] = [];
/// 1 = a voz segue uma posição de mundo (vX/vY/vZ); 0 = global.
let vPos: number[] = [];
let vX: f64[] = []; let vY: f64[] = []; let vZ: f64[] = [];

/// Buffer de saída reaproveitado entre frames — alocar por frame no caminho do
/// áudio geraria pressão de GC no pior lugar possível.
let mixBuf: i64 = 0;
/// Buffer de SILÊNCIO pré-zerado. Com zero vozes ativas, o pump escrevia
/// ~800 amostras × 2 canais de zeros VIA FFI (write_f32 por amostra) todo
/// frame — 4 a 6 ms que custavam os 60 fps do jogo em silêncio. Este buffer é
/// zerado UMA vez e reenviado inteiro (uma chamada de FFI).
let silBuf: i64 = 0;
/// Saída de dois valores de `panGains` — o motor não devolve tuplas, e alocar
/// um array por voz por frame poria pressão de GC no caminho do áudio.
const gTmp: f64[] = [0.0, 0.0];

/// Abre o dispositivo. Devolve 1 se há áudio, 0 se não (o jogo segue mudo, sem
/// erro: uma máquina sem placa de som não deve derrubar o jogo).
export function initAudio(): number {
  if (dev !== 0) return 1;
  const h = audio.open_output(0, 0, 0);
  if (h === 0) return 0;
  dev = h;
  const sr = audio.sample_rate(h);
  if (sr > 0) devRate = sr * 1.0;
  const ch = audio.channels(h);
  if (ch > 0) devCh = ch;
  let i = 0;
  while (i < MAX_VOICES) {
    vActive.push(0); vKind.push(0); vFreq.push(440.0); vPhase.push(0.0);
    vGain.push(0.0); vLeft.push(0.0); vTotal.push(1.0); vSeed.push(12345 + i);
    vGL.push(1.0); vGR.push(1.0); vPos.push(0);
    vX.push(0.0); vY.push(0.0); vZ.push(0.0);
    i = i + 1;
  }
  // 4 bytes por sample f32, MAX_PUMP frames, devCh canais
  mixBuf = buffer.alloc(MAX_PUMP * devCh * 4);
  silBuf = buffer.alloc(MAX_PUMP * devCh * 4);
  let z = 0;
  const zn = MAX_PUMP * devCh;
  while (z < zn) { buffer.write_f32(silBuf, z * 4, 0.0); z = z + 1; }
  return 1;
}

/// Volume geral (0 = mudo). Aplicado na thread de áudio, sem custo aqui.
export function setMasterVolume(v: f64): void {
  if (dev !== 0) audio.master_volume(dev, v);
}

/// Dispara uma voz. `dur` em segundos, `gain` de 0 a 1. Devolve 0 se não havia
/// voz livre — roubar uma voz que está tocando produz um clique audível, então
/// o som novo é simplesmente descartado (é o que engines fazem sob pressão).
function voice(kind: number, freq: f64, dur: f64, gain: f64): number {
  if (dev === 0) return 0;
  let i = 0;
  while (i < MAX_VOICES) {
    if (vActive[i] === 0) {
      vActive[i] = 1; vKind[i] = kind; vFreq[i] = freq; vPhase[i] = 0.0;
      vGain[i] = gain; vLeft[i] = dur; vTotal[i] = dur;
      // GLOBAL: soa igual nos dois canais, sem posição. É o caminho de UI e
      // música, e ele não mudou — os ganhos 1/1 atravessam a mesma
      // multiplicação do mixer e saem idênticos ao que saíam antes.
      vPos[i] = 0; vGL[i] = 1.0; vGR[i] = 1.0;
      return 1;
    }
    i = i + 1;
  }
  return 0;
}

/// O mesmo, com uma posição de mundo. Devolve o índice + 1 (0 = sem voz livre),
/// porque 0 já significa "não tocou" no contrato de `voice`.
function voiceAt(kind: number, freq: f64, dur: f64, gain: f64,
                 x: f64, y: f64, z: f64): number {
  if (dev === 0) return 0;
  let i = 0;
  while (i < MAX_VOICES) {
    if (vActive[i] === 0) {
      vActive[i] = 1; vKind[i] = kind; vFreq[i] = freq; vPhase[i] = 0.0;
      vGain[i] = gain; vLeft[i] = dur; vTotal[i] = dur;
      vPos[i] = 1; vX[i] = x; vY[i] = y; vZ[i] = z;
      // Ganho correto JÁ no primeiro bloco: sem isto a voz soaria centrada e
      // em ganho cheio até o refresh do frame seguinte — um estalo de volume
      // exatamente no ataque, que é onde ele mais se ouve.
      panGains(x, y, z, gTmp);
      vGL[i] = gTmp[0]; vGR[i] = gTmp[1];
      return i + 1;
    }
    i = i + 1;
  }
  return 0;
}

/// Beep senoidal — o som "limpo" (clique de UI, confirmação).
export function playTone(freq: f64, dur: f64, gain: f64): number {
  return voice(V_SINE, freq, dur, gain);
}
/// Onda quadrada — timbre de 8 bits (tiro, alerta).
export function playSquare(freq: f64, dur: f64, gain: f64): number {
  return voice(V_SQUARE, freq, dur, gain);
}
/// Ruído branco — impacto, explosão, passo.
export function playNoise(dur: f64, gain: f64): number {
  return voice(V_NOISE, 440.0, dur, gain);
}

/// Recalcula os ganhos de canal das vozes POSICIONAIS — uma vez por frame.
///
/// Uma voz global não é tocada: seus ganhos nasceram 1/1 e não mudam. O laço do
/// mixer não pergunta qual é qual; a diferença vive nestes dois arrays.
function refreshVoiceGains(): void {
  let i = 0;
  while (i < MAX_VOICES) {
    if (vActive[i] !== 0 && vPos[i] !== 0) {
      panGains(vX[i], vY[i], vZ[i], gTmp);
      vGL[i] = gTmp[0];
      vGR[i] = gTmp[1];
    }
    i = i + 1;
  }
}

/// Dispara uma voz POSICIONAL, que soa a partir de um ponto do mundo.
/// Devolve o índice da voz + 1 (0 = não havia voz livre), que serve para
/// `moveVoice` enquanto ela ainda soa.
export function playToneAt(freq: f64, dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  return voiceAt(V_SINE, freq, dur, gain, x, y, z);
}
/// Onda quadrada num ponto do mundo (tiro, alerta de máquina).
export function playSquareAt(freq: f64, dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  return voiceAt(V_SQUARE, freq, dur, gain, x, y, z);
}
/// Ruído num ponto do mundo (impacto, explosão, passo).
export function playNoiseAt(dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  return voiceAt(V_NOISE, 440.0, dur, gain, x, y, z);
}

/// Move uma voz que ainda está soando. `id` é o que `play*At` devolveu.
/// Silenciosamente ignorado se a voz já terminou — um objeto destruído no meio
/// do som não deve passar a mover o som de outro que herdou o slot.
export function moveVoice(id: number, x: f64, y: f64, z: f64): void {
  const i = id - 1;
  if (i < 0 || i >= MAX_VOICES) return;
  if (vActive[i] === 0 || vPos[i] === 0) return;
  vX[i] = x; vY[i] = y; vZ[i] = z;
}

/// Ganho de canal de uma voz — para inspeção e para os testes, que asseram
/// número em vez de ouvir.
export function voiceGainL(i: number): f64 { return i >= 0 && i < MAX_VOICES ? vGL[i] : 0.0; }
export function voiceGainR(i: number): f64 { return i >= 0 && i < MAX_VOICES ? vGR[i] : 0.0; }
export function voiceIsPositional(i: number): number { return i >= 0 && i < MAX_VOICES ? vPos[i] : 0; }

/// Quantas vozes estão soando (inspeção/testes).
export function activeVoices(): number {
  let n = 0;
  let i = 0;
  while (i < MAX_VOICES) { if (vActive[i] !== 0) n = n + 1; i = i + 1; }
  return n;
}

export function audioReady(): number { return dev !== 0 ? 1 : 0; }
export function audioRate(): f64 { return devRate; }

/// Gera e envia os samples que faltam. Chamar UMA vez por frame.
export function pumpAudio(): number {
  if (dev === 0) return 0;
  const queued = audio.queued_frames(dev);
  if (queued < 0) return 0;
  let need = TARGET_FRAMES - queued;
  if (need <= 0) return 0;
  if (need > MAX_PUMP) need = MAX_PUMP;
  // ATALHO DE SILÊNCIO: sem voz ativa, manda o buffer pré-zerado — uma chamada
  // em vez de ~1600 write_f32 por frame (medido: 4-6 ms de frame recuperados)
  const ativas = activeVoices();
  if (ativas === 0) return audio.write(dev, silBuf, need * devCh);
  // Os arrays de voz vão por PARÂMETRO, e isso não é estilo: um array de MÓDULO
  // lido dentro de uma função custa ~260 ns por acesso contra ~20 ns quando
  // chega como parâmetro (medido em release, 100 mil iterações). O laço abaixo
  // faz até MAX_PUMP × MAX_VOICES acessos por frame — 57 600 — então a
  // diferença é de ~15 ms para ~1,2 ms de frame, que é a queda de 75 para 35
  // fps que aparecia sempre que um tiro tocava um som.
  //
  // `const arr = vActive` DENTRO da função não recupera nada: foi medido e
  // continua em 260 ns. Só o parâmetro resolve.
  // Posição vira GANHO aqui — uma vez por voz por frame, não por amostra. O
  // orçamento é o mesmo argumento do atalho de silêncio logo acima: 24 raízes
  // quadradas por frame contra 24 × `need` dentro do mixer.
  refreshVoiceGains();
  mixInto(mixBuf, need, devCh, devRate,
          vActive, vKind, vFreq, vPhase, vGain, vLeft, vTotal, vSeed,
          vGL, vGR, ativas);
  return audio.write(dev, mixBuf, need * devCh);
}

/// Mixa `frames` de todas as vozes ativas em `buf`.
///
/// # VOZ FORA, AMOSTRA DENTRO — e por que essa ordem
///
/// O laço anterior era amostra-fora/voz-dentro e relia os arrays da voz a CADA
/// amostra: 9 acessos × 20 ns = ~180 ns por amostra por voz. Medido com 24
/// vozes e 800 amostras: **3,19 ms por bloco**, contra um orçamento de 2 ms.
/// Ou seja, o mixer já estourava o frame com as vozes que ele mesmo permite —
/// antes de qualquer som posicional.
///
/// Invertido, o estado de cada voz é lido UMA vez por bloco para locais, o laço
/// de amostras roda só sobre locais (que o motor mantém em registradores) e é
/// escrito de volta uma vez. Mesma medição: **1,75 ms**, 1,82×.
///
/// O que sobrou como custo dominante é o ACUMULADOR: somar no buffer em vez de
/// escrever custa 4 chamadas nativas por amostra por voz (2 leituras + 2
/// escritas), ~40 ns — 44 % do custo restante. Um primitivo nativo que some os
/// dois canais numa chamada levaria de 24 para ~32-40 vozes; está anotado como
/// o próximo passo, não feito aqui.
///
/// FUNÇÃO LIVRE de parâmetros tipados: um array de módulo lido aqui dentro
/// custava 260 ns por acesso contra 20 ns por parâmetro (medido; corrigido no
/// motor em UrubuCode/rts#2105, e a passagem por parâmetro segue valendo).
function mixInto(buf: i64, frames: number, ch: number, rate: f64,
                 vActive: number[], vKind: number[], vFreq: f64[], vPhase: f64[],
                 vGain: f64[], vLeft: f64[], vTotal: f64[], vSeed: number[],
                 vGL: f64[], vGR: f64[], ativas: number): void {
  const dt: f64 = 1.0 / rate;
  // ZERA o acumulador: as vozes SOMAM nele, então ele precisa começar limpo.
  // É o preço da inversão, e é uma passada linear — barata perto do que a
  // inversão economiza.
  let zf = 0;
  while (zf < frames) {
    let zc = 0;
    while (zc < ch) { buffer.write_f32(buf, (zf * ch + zc) * 4, 0.0); zc = zc + 1; }
    zf = zf + 1;
  }

  let v = 0;
  let restam = ativas;
  while (v < MAX_VOICES && restam > 0) {
    if (vActive[v] === 0) { v = v + 1; continue; }
    restam = restam - 1;

    // ── o estado da voz, lido UMA vez ────────────────────────────────────────
    let t: f64 = vLeft[v];
    const tot: f64 = vTotal[v];
    const k = vKind[v];
    const g: f64 = vGain[v];
    let ph: f64 = vPhase[v];
    const passo: f64 = 6.28318530717959 * vFreq[v] * dt;
    let sd = vSeed[v];
    // Ganhos por canal. Uma voz GLOBAL (UI, música) tem 1/1 e atravessa a mesma
    // multiplicação — não há ramo "é posicional?" no laço quente. A diferença
    // entre global e 3D está nos DADOS, não no caminho.
    const gL: f64 = vGL[v];
    const gR: f64 = vGR[v];

    let f = 0;
    while (f < frames) {
      // ENVELOPE: ataque curto e queda até o fim. Sem ele, começar e cortar uma
      // onda no meio do ciclo estala — o clique é o que mais denuncia áudio mal
      // feito.
      let env: f64 = t / tot;
      const played: f64 = tot - t;
      if (played < 0.005) env = env * (played / 0.005);   // ataque de 5 ms

      let smp: f64 = 0.0;
      if (k === V_NOISE) {
        // LCG por voz: barato e determinístico (mesmo som toda vez)
        sd = (sd * 1103515245 + 12345) & 0x7FFFFFFF;
        smp = (sd % 2000) * 0.001 - 1.0;
      } else {
        if (k === V_SQUARE) smp = ph < 3.14159265358979 ? 1.0 : 0.0 - 1.0;
        else smp = math.sin(ph);
        ph = ph + passo;
        if (ph > 6.28318530717959) ph = ph - 6.28318530717959;
      }
      const val: f64 = smp * g * env;

      // ACUMULA (não escreve): as vozes se somam neste buffer.
      const i0 = (f * ch) * 4;
      buffer.write_f32(buf, i0, buffer.read_f32(buf, i0) + val * gL);
      if (ch > 1) {
        const i1 = (f * ch + 1) * 4;
        buffer.write_f32(buf, i1, buffer.read_f32(buf, i1) + val * gR);
        // Canais além do par estéreo recebem a média — uma placa 5.1 não deve
        // ficar muda nos surrounds nem receber o canal esquerdo por engano.
        let c = 2;
        while (c < ch) {
          const ic = (f * ch + c) * 4;
          buffer.write_f32(buf, ic, buffer.read_f32(buf, ic) + val * (gL + gR) * 0.5);
          c = c + 1;
        }
      }

      t = t - dt;
      if (t <= 0.0) { f = frames; }   // a voz acabou no meio do bloco
      f = f + 1;
    }

    // ── e devolvido UMA vez ──────────────────────────────────────────────────
    vPhase[v] = ph;
    vSeed[v] = sd;
    vLeft[v] = t;
    if (t <= 0.0) vActive[v] = 0;
    v = v + 1;
  }

  // CLAMP no fim: várias vozes somadas passam de 1.0 e distorcem feio. Aqui é
  // uma passada linear sobre o bloco, em vez de por-voz-por-amostra.
  let cf = 0;
  while (cf < frames * ch) {
    const at = cf * 4;
    let sv: f64 = buffer.read_f32(buf, at);
    if (sv > 1.0) { buffer.write_f32(buf, at, 1.0); }
    else if (sv < 0.0 - 1.0) { buffer.write_f32(buf, at, 0.0 - 1.0); }
    cf = cf + 1;
  }
}

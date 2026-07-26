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

/// Buffer de saída reaproveitado entre frames — alocar por frame no caminho do
/// áudio geraria pressão de GC no pior lugar possível.
let mixBuf: i64 = 0;
/// Buffer de SILÊNCIO pré-zerado. Com zero vozes ativas, o pump escrevia
/// ~800 amostras × 2 canais de zeros VIA FFI (write_f32 por amostra) todo
/// frame — 4 a 6 ms que custavam os 60 fps do jogo em silêncio. Este buffer é
/// zerado UMA vez e reenviado inteiro (uma chamada de FFI).
let silBuf: i64 = 0;

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
      return 1;
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
  if (activeVoices() === 0) return audio.write(dev, silBuf, need * devCh);
  mixInto(mixBuf, need, devCh, devRate);
  return audio.write(dev, mixBuf, need * devCh);
}

/// Mixa `frames` de todas as vozes ativas em `buf`. FUNÇÃO LIVRE de parâmetros
/// tipados: é o laço mais quente do áudio (48 mil iterações por segundo) e
/// dentro de um método cada acesso a campo cairia no caminho dinâmico.
function mixInto(buf: i64, frames: number, ch: number, rate: f64): void {
  const dt: f64 = 1.0 / rate;
  let f = 0;
  while (f < frames) {
    let s: f64 = 0.0;
    let v = 0;
    while (v < MAX_VOICES) {
      if (vActive[v] !== 0) {
        // ENVELOPE: ataque curto e queda até o fim. Sem ele, começar e cortar
        // uma onda no meio do ciclo estala — o clique é o que mais denuncia
        // áudio mal feito.
        const t: f64 = vLeft[v];
        const tot: f64 = vTotal[v];
        let env: f64 = t / tot;              // decai de 1 a 0
        const played: f64 = tot - t;
        if (played < 0.005) env = env * (played / 0.005);   // ataque de 5 ms
        const k = vKind[v];
        let smp: f64 = 0.0;
        if (k === V_NOISE) {
          // LCG por voz: barato e determinístico (mesmo som toda vez)
          let sd = vSeed[v];
          sd = (sd * 1103515245 + 12345) & 0x7FFFFFFF;
          vSeed[v] = sd;
          smp = (sd % 2000) * 0.001 - 1.0;
        } else {
          const ph = vPhase[v];
          if (k === V_SQUARE) smp = ph < 3.14159265358979 ? 1.0 : 0.0 - 1.0;
          else smp = math.sin(ph);
          let np = ph + 6.28318530717959 * vFreq[v] * dt;
          while (np > 6.28318530717959) np = np - 6.28318530717959;
          vPhase[v] = np;
        }
        s = s + smp * vGain[v] * env;
        const nt = t - dt;
        vLeft[v] = nt;
        if (nt <= 0.0) vActive[v] = 0;
      }
      v = v + 1;
    }
    // clamp: várias vozes somadas podem passar de 1.0 e distorcer feio
    if (s > 1.0) s = 1.0;
    if (s < 0.0 - 1.0) s = 0.0 - 1.0;
    let c = 0;
    while (c < ch) {
      buffer.write_f32(buf, (f * ch + c) * 4, s);
      c = c + 1;
    }
    f = f + 1;
  }
}

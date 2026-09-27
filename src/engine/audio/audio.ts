// Engine RTS — ÁUDIO: mixer de vozes de CLIPE sobre `rts:audio`.
//
// O runtime entrega o dispositivo (um anel que a thread de áudio drena) e o
// kernel `mix_add`. Aqui fica a política: a tabela de vozes, os ganhos-alvo
// por bloco (espacial e grupos), a voz virtual e a mixagem do bloco.
//
// O modelo continua "o jogo enche, a thread de áudio drena": a cada quadro
// `pumpAudio()` mixa o que falta para manter o alvo enfileirado. O alvo é
// ADAPTATIVO (100..250 ms): um quadro lento (contenção de CPU, GC, janela
// minimizada) drena o anel além dos 100 ms de partida e falta no
// dispositivo — a falta some no `stats` nativo (audível como chiado), sobe o
// alvo pra absorver o próximo quadro lento, e desce devagar quando some.
//
// Os tons de antes (`playTone`...) viram clipes gerados uma vez (`toneClip`) e
// passam pelo mesmo caminho: há UM mixer.
import audio, { AUDIO_REAL, AUDIO_NULO, STATS_FLOATS } from "@compat/audio.ts";
import { AudioClip, toneClip, definirTaxaDosClipes, clipPorId, FORMA_SENO, FORMA_QUADRADA, FORMA_RUIDO } from "./clip";
import { rolloffRef, rolloffMax, espGanhosVoz, ESP_GL, ESP_GR, ESP_LP, ESP_DIST, ESP_CORTE, ESP_FLOATS } from "./spatial";
import { ganhoGrupo, grupoPausado } from "./mixer_grupos";
import { D_POS, D_PASSO, D_CANAIS_SRC, D_CANAIS_DST, D_QUADROS, D_GL0, D_GR0, D_GL1, D_GR1, D_LP_COEF,
         D_LP_L, D_LP_R, D_LACO_INI, D_LACO_FIM, D_FIM, DESC_FLOATS, N_CANAIS, N_QUADROS, NIVEL_FLOATS } from "./mix_desc";
import { mixAddTs } from "./mix_ts";
import { MAX_VOZES, VOZ_FLOATS, V_ESTADO, V_CLIPE, V_POS, V_PASSO, V_LACO, V_GL, V_GR, V_ALVO_L, V_ALVO_R,
         V_LP_COEF, V_LP_L, V_LP_R, V_GRUPO, V_FONTE, V_FLAGS, V_VOLUME, V_X, V_Y, V_Z, V_BLEND, V_MIN, V_MAX,
         V_ROLLOFF, V_PITCH, V_CANAIS, V_CORTE, V_GERACAO, V_DIST, ESTADO_LIVRE, ESTADO_TOCANDO, ESTADO_PAUSADA,
         ESTADO_PARANDO, ESTADO_PAUSANDO,
         FLAG_VIRTUAL, FLAG_PREVIA, FLAG_3D, FLAG_ONESHOT, FLAG_CONGELADA, CORTE_ABERTO, PEDIDO_VOLUME, PEDIDO_PITCH,
         PEDIDO_LACO, PEDIDO_GRUPO, PEDIDO_FONTE, PEDIDO_FLAGS, PEDIDO_X, PEDIDO_Y, PEDIDO_Z, PEDIDO_BLEND,
         PEDIDO_MIN, PEDIDO_MAX, PEDIDO_ROLLOFF, PEDIDO_FLOATS, ROLLOFF_LOG, pedidoPadrao } from "./vozes";
import { entrarJogo, sairJogo, emJogo } from "@engine/core/modo_jogo";

export { AUDIO_REAL, AUDIO_NULO };
export const KERNEL_NATIVO: number = 0;
export const KERNEL_TS: number = 1;
/// ~100 ms a 48 kHz: o alvo de partida — curto o bastante para um som
/// disparado agora não atrasar de forma audível. Um quadro lento (contenção de
/// CPU, GC, janela minimizada) drena o anel além disso e falta no
/// dispositivo (chiado/silêncio); ver `AU_ALVO_QUADROS_MAX`.
const AU_ALVO_QUADROS_MIN: number = 4800;
/// ~250 ms: teto do alvo ADAPTATIVO depois de uma falta — mais folga para
/// absorver o próximo quadro lento sem faltar de novo, à custa de latência.
const AU_ALVO_QUADROS_MAX: number = 12000;
/// Quanto o alvo sobe de uma vez ao detectar falta desde o último `pumpAudio`
/// (dobra o mínimo — recupera rápido, sem ficar tentando aos pouquinhos
/// enquanto o quadro lento pode se repetir).
const AU_ALVO_PASSO_SOBE: number = 4800;
/// Quanto o alvo desce por quadro depois de ficar estável (devagar: 10 ms por
/// quadro a 48 kHz — encolhe sem sacrificar a folga que acabou de justificar
/// a subida).
const AU_ALVO_PASSO_DESCE: number = 480;
/// Quadros SEM falta nova antes de começar a encolher o alvo de volta ao
/// mínimo (2 s a 60 fps) — não desfaz a folga assim que a maré aperta.
const AU_ALVO_JANELA_ESTAVEL: number = 120;
/// Teto de quadros mixados NUMA chamada de `mixarBloco` (o primeiro quadro não
/// gera 250 ms de uma vez). `pumpAudio` chama `mixarBloco` várias vezes
/// (nunca mais que `AU_ALVO_QUADROS_MAX / AU_MAX_BOMBA` por quadro) para
/// cobrir a lacuna inteira depois de um quadro lento, em vez de recuperar 1
/// bloco por quadro e arriscar faltar de novo antes de reencher.
const AU_MAX_BOMBA: number = 2400;
/// Duração do fade-in (rampa linear 0→1) aplicado ao primeiro bloco mixado
/// depois de uma falta detectada: o nativo já sai do silêncio com zeros
/// (Ruling A8 no d0 do anel), então o degrau duro fica na volta — 5 ms aqui
/// suaviza essa borda sem atraso perceptível.
const AU_RAMPA_QUADROS: number = 240;
const AU_TAXA_PADRAO: f64 = 48000.0;
const AU_CANAIS_PADRAO: number = 2;
const AU_PITCH_MIN: f64 = 0.05;
const AU_PITCH_MAX: f64 = 4.0;

let auDev: number = 0;
let auTaxa: f64 = AU_TAXA_PADRAO;
let auCanais: number = AU_CANAIS_PADRAO;
let auNulo: number = 0;
let auKernel: number = KERNEL_NATIVO;
let auPreviaId: number = 0;
/// Alvo ADAPTATIVO de quadros enfileirados (ver `AU_ALVO_QUADROS_MIN/MAX`);
/// começa no mínimo e só sobe quando `pumpAudio` observa falta nova.
let auAlvoQuadros: number = AU_ALVO_QUADROS_MIN;
/// Quadros seguidos sem falta nova, para encolher `auAlvoQuadros` devagar.
let auQuadrosSemFalta: number = 0;
/// Última contagem de `faltas` lida do nativo (detecta falta NOVA por diferença).
let auFaltasAntes: f64 = 0.0;
/// Quadros restantes do fade-in em curso no próximo bloco escrito (ver `AU_RAMPA_QUADROS`).
let auRampaRestante: number = 0;
/// Buffer reaproveitado por `pumpAudio` pra ler `audio.stats` sem alocar por quadro.
const auStats = new Float64Array(STATS_FLOATS);
let auMix = new Float32Array(AU_MAX_BOMBA * AU_CANAIS_PADRAO);
const auVozes = new Float64Array(MAX_VOZES * VOZ_FLOATS);
const auVazio = new Float32Array(0);
/// As amostras do clipe de cada voz, por slot (vai ao mixer por parâmetro).
const auAmostras: Float32Array[] = [];
let auIni = 0;
while (auIni < MAX_VOZES) { auAmostras.push(auVazio); auIni = auIni + 1; }
const auDesc = new Float64Array(DESC_FLOATS);
auDesc[D_CANAIS_DST] = AU_CANAIS_PADRAO;
const auNivel = new Float64Array(NIVEL_FLOATS);
/// Saída de `espGanhosVoz` (o motor não devolve tuplas).
const auEsp = new Float64Array(ESP_FLOATS);
/// Pedido reaproveitado pelos tons de antes.
const auPedido = new Float64Array(PEDIDO_FLOATS);
/// Conta chamadas REAIS de `mix_add`/`mixAddTs` (não o caminho barato de
/// `avancarVirtual`) — só para teste/instrumentação (prova que o caminho
/// virtual é o que corre enquanto a causa do silêncio persiste).
let auContadorMix: number = 0;

/// Abre o dispositivo (`AUDIO_REAL` por padrão, `AUDIO_NULO` para testes).
/// 1 = há saída; 0 = mudo, sem erro (máquina sem placa de som).
export function initAudio(modoArg?: number): number {
  const modo = modoArg !== undefined ? modoArg : AUDIO_REAL;
  if (auDev !== 0) return 1;
  const h = audio.open_output(0, 0, modo);
  if (h === 0) { definirTaxaDosClipes(AU_TAXA_PADRAO); return 0; }
  auDev = h;
  auNulo = modo === AUDIO_NULO ? 1 : 0;
  const sr = audio.sample_rate(h);
  if (sr > 0) auTaxa = sr;
  const ch = audio.channels(h);
  if (ch > 0) auCanais = ch;
  auMix = new Float32Array(AU_MAX_BOMBA * auCanais);
  auDesc[D_CANAIS_DST] = auCanais;
  definirTaxaDosClipes(auTaxa);
  auAlvoQuadros = AU_ALVO_QUADROS_MIN; auQuadrosSemFalta = 0; auFaltasAntes = 0.0; auRampaRestante = 0;
  return 1;
}

export function closeAudio(): void {
  if (auDev === 0) return;
  pararTodas();
  audio.close(auDev);
  auDev = 0; auNulo = 0;
}

export function audioReady(): number { return auDev !== 0 ? 1 : 0; }
export function audioRate(): f64 { return auTaxa; }
export function audioCanais(): number { return auCanais; }
export function audioNulo(): number { return auNulo; }
export function setMasterVolume(v: f64): void { if (auDev !== 0) audio.master_volume(auDev, v); }
export function definirKernelMix(k: number): void { auKernel = k === KERNEL_TS ? KERNEL_TS : KERNEL_NATIVO; }
export function vozesTabela(): Float64Array { return auVozes; }
export function audioUltimoBloco(): Float32Array { return auMix; }
export function audioNivel(out: Float64Array): void { let i = 0; while (i < NIVEL_FLOATS) { out[i] = auNivel[i]; i = i + 1; } }
/// `stats(dev, out)` do dispositivo nativo (consumidos, faltas, enfileirados,
/// taxa, canais, nulo) — para a IA/WS conferir chiado por número (faltas) sem
/// escuta. 0 sem dispositivo (out não tocado).
export function audioStats(out: Float64Array): number { return auDev !== 0 ? audio.stats(auDev, out) : 0; }
/// Quantas vezes `mix_add`/`mixAddTs` rodou de fato desde o último
/// `audioZerarContadorMix` — prova (em teste) que uma voz virtual/congelada
/// usa o caminho barato e não mixa mais enquanto a causa do silêncio persiste.
export function audioContadorMix(): number { return auContadorMix; }
export function audioZerarContadorMix(): void { auContadorMix = 0; }
/// Só teste/instrumentação: o alvo adaptativo atual (prova que uma falta o
/// sobe e que ele encolhe devagar depois de ficar estável — ver `auAtualizarAlvo`).
export function audioAlvoQuadros(): number { return auAlvoQuadros; }
/// Só teste/instrumentação: força quantos quadros de fade-in restam, sem
/// esperar uma falta de verdade — prova que `pumpAudio` consome a rampa
/// certo (ver `auRampaEntrada`) num bloco determinístico.
export function audioForcarRampaTeste(q: number): void { auRampaRestante = q; }
/// Só teste/instrumentação: quantos quadros de fade-in ainda faltam consumir.
export function audioRampaRestanteTeste(): number { return auRampaRestante; }

// ── ids de voz ───────────────────────────────────────────────────────────────
// id = geração × MAX_VOZES + slot + 1. Um objeto que guardou o id de uma voz
// que acabou não mexe na voz nova que herdou o slot.
export function vozIndice(id: number): number {
  if (id <= 0) return 0 - 1;
  const v = (id - 1) % MAX_VOZES;
  const g = Math.floor((id - 1) / MAX_VOZES);
  const b = v * VOZ_FLOATS;
  if (auVozes[b + V_GERACAO] !== g || auVozes[b + V_ESTADO] === ESTADO_LIVRE) return 0 - 1;
  return v;
}
function auBase(id: number): number { const v = vozIndice(id); return v < 0 ? 0 - 1 : v * VOZ_FLOATS; }

/// Slot livre; sem livre, uma voz VIRTUAL cede o lugar (é inaudível); sem
/// nenhuma, −1 — roubar uma voz audível estala, então o som novo é descartado.
function auAlocar(vz: Float64Array): number {
  let v = 0;
  while (v < MAX_VOZES) { if (vz[v * VOZ_FLOATS + V_ESTADO] === ESTADO_LIVRE) return v; v = v + 1; }
  v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    if ((vz[b + V_FLAGS] & FLAG_VIRTUAL) !== 0 && (vz[b + V_FLAGS] & FLAG_PREVIA) === 0) return v;
    v = v + 1;
  }
  return 0 - 1;
}

function auPasso(pitch: f64, taxaClipe: f64): f64 {
  let p = pitch;
  if (!(p >= AU_PITCH_MIN)) p = p > 0.0 ? AU_PITCH_MIN : 1.0;
  if (p > AU_PITCH_MAX) p = AU_PITCH_MAX;
  return p * taxaClipe / auTaxa;
}

/// Toca `clip` com o `pedido` (ver PEDIDO_*). Devolve o id (≥ 1) ou 0.
export function tocarClipe(clip: AudioClip, pedido: Float64Array): number {
  if (auDev === 0 || clip.quadros === 0) return 0;
  const vz = auVozes;
  const v = auAlocar(vz);
  if (v < 0) return 0;
  const b = v * VOZ_FLOATS;
  const geracao = vz[b + V_GERACAO] + 1.0;
  let k = 0;
  while (k < VOZ_FLOATS) { vz[b + k] = 0.0; k = k + 1; }
  vz[b + V_GERACAO] = geracao;
  vz[b + V_ESTADO] = ESTADO_TOCANDO;
  vz[b + V_CLIPE] = clip.id; vz[b + V_CANAIS] = clip.canais;
  vz[b + V_VOLUME] = pedido[PEDIDO_VOLUME]; vz[b + V_PITCH] = pedido[PEDIDO_PITCH];
  vz[b + V_PASSO] = auPasso(pedido[PEDIDO_PITCH], clip.taxa);
  vz[b + V_LACO] = pedido[PEDIDO_LACO]; vz[b + V_GRUPO] = pedido[PEDIDO_GRUPO];
  vz[b + V_FONTE] = pedido[PEDIDO_FONTE]; vz[b + V_FLAGS] = pedido[PEDIDO_FLAGS];
  vz[b + V_X] = pedido[PEDIDO_X]; vz[b + V_Y] = pedido[PEDIDO_Y]; vz[b + V_Z] = pedido[PEDIDO_Z];
  vz[b + V_BLEND] = pedido[PEDIDO_BLEND]; vz[b + V_MIN] = pedido[PEDIDO_MIN]; vz[b + V_MAX] = pedido[PEDIDO_MAX];
  vz[b + V_ROLLOFF] = pedido[PEDIDO_ROLLOFF];
  vz[b + V_LP_COEF] = 1.0; vz[b + V_CORTE] = CORTE_ABERTO;
  auAmostras[v] = clip.amostras;
  atualizarAlvoVoz(vz, b);
  // Ganho certo JÁ no primeiro bloco: rampar de 0 seria um fade-in que ninguém pediu.
  vz[b + V_GL] = vz[b + V_ALVO_L]; vz[b + V_GR] = vz[b + V_ALVO_R];
  // Nasce silenciosa (fora de alcance, volume 0, grupo mudo/pausado): o ganho
  // corrente já bate com o alvo (os dois são zero) — sem rampa a fazer, então
  // marca VIRTUAL/CONGELADA na hora (mesma regra que `mixInto` usa depois de
  // cada rampa, via `auCausaSilencio`).
  auMarcarSilencio(vz, b);
  return geracao * MAX_VOZES + v + 1;
}

/// Pede o fim da voz sem clique: o ganho-alvo vira zero e a rampa por amostra
/// do bloco (já existente) leva `V_GL/V_GR` a zero antes do slot ser liberado
/// (fase A6). Paranda a meio de outra rampa: só troca o destino final.
export function pararVoz(id: number): void {
  const b = auBase(id);
  if (b < 0) return;
  const estado = auVozes[b + V_ESTADO];
  if (estado === ESTADO_TOCANDO || estado === ESTADO_PAUSANDO) auVozes[b + V_ESTADO] = ESTADO_PARANDO;
  else if (estado === ESTADO_PAUSADA) auVozes[b + V_ESTADO] = ESTADO_LIVRE; // já em ganho zero: sem clique
}
/// Pausar: mesma rampa a zero, depois o slot CONGELA (não libera). Despausar
/// retoma de onde a rampa parou — se o ganho ainda não chegou a zero, o alvo
/// normal do próximo bloco rampa de volta, também sem clique.
export function pausarVoz(id: number, pausa: number): void {
  const b = auBase(id);
  if (b < 0) return;
  const estado = auVozes[b + V_ESTADO];
  if (pausa !== 0) {
    if (estado === ESTADO_TOCANDO) auVozes[b + V_ESTADO] = ESTADO_PAUSANDO;
  } else if (estado === ESTADO_PAUSADA || estado === ESTADO_PAUSANDO) {
    auVozes[b + V_ESTADO] = ESTADO_TOCANDO;
  }
}
export function vozTocando(id: number): number { const b = auBase(id); return b >= 0 && auVozes[b + V_ESTADO] === ESTADO_TOCANDO ? 1 : 0; }
export function vozSegundos(id: number): f64 { const b = auBase(id); return b >= 0 ? auVozes[b + V_POS] / auTaxa : 0.0; }
export function moverVoz(id: number, pos: Float64Array): void {
  const b = auBase(id);
  if (b < 0) return;
  auVozes[b + V_X] = pos[0]; auVozes[b + V_Y] = pos[1]; auVozes[b + V_Z] = pos[2];
}
export function definirVolumeVoz(id: number, v: f64): void { const b = auBase(id); if (b >= 0) auVozes[b + V_VOLUME] = v; }
export function definirGrupoVoz(id: number, grupo: number): void { const b = auBase(id); if (b >= 0) auVozes[b + V_GRUPO] = grupo; }
/// A mistura 2D/3D de uma voz (o AudioSource muda `spatialBlend` em jogo).
export function definirMisturaVoz(id: number, blend: f64): void {
  const b = auBase(id);
  if (b < 0) return;
  auVozes[b + V_BLEND] = blend;
  const f = auVozes[b + V_FLAGS] | 0;
  auVozes[b + V_FLAGS] = blend > 0.0 ? (f | FLAG_3D) : (f & (0 - 1 - FLAG_3D));
}

/// Unity PlayClipAtPoint: um disparo 3D (blend 1, log, 1..500) no Master.
export function tocarNoPonto(clip: AudioClip, pos: Float64Array, volume: f64): number {
  pedidoPadrao(auPedido);
  auPedido[PEDIDO_VOLUME] = volume; auPedido[PEDIDO_FLAGS] = FLAG_3D + FLAG_ONESHOT; auPedido[PEDIDO_BLEND] = 1.0;
  auPedido[PEDIDO_X] = pos[0]; auPedido[PEDIDO_Y] = pos[1]; auPedido[PEDIDO_Z] = pos[2];
  return tocarClipe(clip, auPedido);
}

/// Pico ESTIMADO de um grupo no último bloco: max(ganho-alvo × pico do clipe)
/// das vozes do grupo que tocam e não são virtuais. Barato e sem mixar por
/// grupo; `audioNivel` mede o bloco real (a soma de todos os grupos).
export function audioPicoGrupo(i: number): f64 {
  let pico: f64 = 0.0; let v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    if (auVozes[b + V_ESTADO] === ESTADO_TOCANDO && (auVozes[b + V_GRUPO] | 0) === i && ((auVozes[b + V_FLAGS] | 0) & FLAG_VIRTUAL) === 0) {
      const c = clipPorId(auVozes[b + V_CLIPE] | 0);
      const g: f64 = auVozes[b + V_ALVO_L] > auVozes[b + V_ALVO_R] ? auVozes[b + V_ALVO_L] : auVozes[b + V_ALVO_R];
      const p: f64 = c !== null ? g * c.pico : 0.0;
      if (p > pico) pico = p;
    }
    v = v + 1;
  }
  return pico;
}
export function definirPitchVoz(id: number, p: f64): void {
  const b = auBase(id);
  if (b < 0) return;
  auVozes[b + V_PITCH] = p;
  auVozes[b + V_PASSO] = auPasso(p, auTaxa);
}
export function pararTodas(): void {
  let v = 0;
  while (v < MAX_VOZES) { auVozes[v * VOZ_FLOATS + V_ESTADO] = ESTADO_LIVRE; v = v + 1; }
  auPreviaId = 0;
}
/// Como `pararTodas`, mas sem clique (Ruling A6/A8): cada voz ativa pede o fim
/// pela MESMA regra de `pararVoz` (tocando/pausando → PARANDO, rampa em
/// `mixInto`; pausada, já em ganho zero, → livre na hora). Vozes já
/// VIRTUAL/CONGELADA (silenciosas) seguem essa mesma regra e caem livres já no
/// primeiro `mixInto` seguinte, sem precisar de tratamento à parte — inclui a
/// voz de prévia, que é só mais uma voz nesta tabela. Use para os caminhos do
/// jogador (Play→Stop, `audio stop tudo`); `pararTodas` (imediata) continua
/// só para `closeAudio`/teardown do dispositivo.
export function pararTodasSuave(): void {
  let v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    const estado = auVozes[b + V_ESTADO];
    if (estado === ESTADO_TOCANDO || estado === ESTADO_PAUSANDO) auVozes[b + V_ESTADO] = ESTADO_PARANDO;
    else if (estado === ESTADO_PAUSADA) auVozes[b + V_ESTADO] = ESTADO_LIVRE;
    v = v + 1;
  }
  auPreviaId = 0;
}
export function activeVoices(): number {
  let n = 0; let v = 0;
  while (v < MAX_VOZES) { if (auVozes[v * VOZ_FLOATS + V_ESTADO] !== ESTADO_LIVRE) n = n + 1; v = v + 1; }
  return n;
}

// ── jogo e prévia ────────────────────────────────────────────────────────────
// O flag "em jogo" em si mora em `engine/core/modo_jogo.ts` (compartilhado com
// qualquer outro componente `playOnAwake`, como `ParticleSystem`) — aqui só os
// efeitos colaterais PRÓPRIOS do áudio (parar prévia / parar tudo) continuam.
/// O Play (ou o jogo) começou: `playOnAwake` vale a partir daqui. A prévia do editor para.
export function audioEntrarJogo(): void { pararPrevia(); entrarJogo(); }
/// O Play parou: tudo o que tocava para (spec §3.6, "Ciclo do Play").
export function audioSairJogo(): void { pararTodasSuave(); sairJogo(); }
export function audioEmJogo(): number { return emJogo(); }

/// Prévia 2D do Inspector: uma por vez, ignora o laço, sem mexer na cena.
export function tocarPrevia(clip: AudioClip, volume: f64, pitch: f64): number {
  pararPrevia();
  pedidoPadrao(auPedido);
  auPedido[PEDIDO_VOLUME] = volume; auPedido[PEDIDO_PITCH] = pitch; auPedido[PEDIDO_FLAGS] = FLAG_PREVIA;
  auPreviaId = tocarClipe(clip, auPedido);
  return auPreviaId;
}
export function pararPrevia(): void { if (auPreviaId !== 0) pararVoz(auPreviaId); auPreviaId = 0; }
export function previaTocando(): number { return auPreviaId !== 0 ? vozTocando(auPreviaId) : 0; }

// ── ganhos-alvo por bloco ────────────────────────────────────────────────────
/// Ganho-alvo L/R de uma voz para o próximo bloco. 3D: `panGains` (atenuação e
/// panorâmica); 2D: 1/1; multiplicado pelo ganho do GRUPO; pausa do grupo força
/// zero. NÃO decide VIRTUAL/CONGELADA aqui — é sempre `mixInto` (ou, ao nascer,
/// `auMarcarSilencio`) quem marca essas bandeiras, e só depois que o ganho
/// corrente já bate com o alvo (zero), qualquer que seja a causa (volume da
/// voz, 3D fora de alcance, mudo ou pausa do grupo). Ruling A8: nenhuma causa
/// de silêncio pode cortar o ganho na hora — todas passam pela mesma rampa por
/// amostra (já existente em `mix_add`) antes de marcar a bandeira.
function atualizarAlvoVoz(vz: Float64Array, b: number): void {
  // Parando/pausando (fase A6): alvo zero, sem recalcular 3D/volume — é só a
  // rampa de saída; o estado transiciona em `mixInto` quando ela chegar a zero.
  if (vz[b + V_ESTADO] !== ESTADO_TOCANDO) { vz[b + V_ALVO_L] = 0.0; vz[b + V_ALVO_R] = 0.0; return; }
  let gl: f64 = 1.0; let gr: f64 = 1.0;
  const flags = vz[b + V_FLAGS] | 0;
  if ((flags & FLAG_3D) !== 0) {
    espGanhosVoz(vz, b, auTaxa, auEsp);
    gl = auEsp[ESP_GL]; gr = auEsp[ESP_GR];
    vz[b + V_LP_COEF] = auEsp[ESP_LP]; vz[b + V_DIST] = auEsp[ESP_DIST]; vz[b + V_CORTE] = auEsp[ESP_CORTE];
  }
  const grupo = vz[b + V_GRUPO] | 0;
  const vol = vz[b + V_VOLUME] * ganhoGrupo(grupo);
  gl = gl * vol; gr = gr * vol;
  if (grupoPausado(grupo) !== 0) { gl = 0.0; gr = 0.0; }
  vz[b + V_ALVO_L] = gl; vz[b + V_ALVO_R] = gr;
}

function atualizarAlvos(vz: Float64Array): void {
  let v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    const estado = vz[b + V_ESTADO];
    if (estado === ESTADO_TOCANDO || estado === ESTADO_PARANDO || estado === ESTADO_PAUSANDO) atualizarAlvoVoz(vz, b);
    v = v + 1;
  }
}

/// Voz virtual: a posição anda (custo de uma soma) sem mixar, para retomar do
/// ponto certo quando voltar a ser audível.
function avancarVirtual(vz: Float64Array, b: number, quadros: number, total: number): void {
  let pos = vz[b + V_POS] + vz[b + V_PASSO] * quadros;
  if (pos >= total) {
    if (vz[b + V_LACO] !== 0.0) pos = pos % total;
    else { vz[b + V_ESTADO] = ESTADO_LIVRE; return; }
  }
  vz[b + V_POS] = pos; vz[b + V_GL] = 0.0; vz[b + V_GR] = 0.0;
}

/// 0 = audível (nada a marcar); 1 = deveria estar/ficar VIRTUAL; 2 = deveria
/// estar/ficar CONGELADA — só quando o ganho CORRENTE já é o alvo (zero); com
/// a rampa ainda em andamento devolve 0 (não há nada pra marcar ainda, senão
/// o próximo bloco corta o resto da rampa). Pausa do grupo tem prioridade
/// sobre virtual: o tempo para de vez, não só o som.
function auCausaSilencio(vz: Float64Array, b: number, grupo: number): number {
  const flags = vz[b + V_FLAGS] | 0;
  const silencioso = vz[b + V_ALVO_L] <= 0.0 && vz[b + V_ALVO_R] <= 0.0 && (flags & FLAG_PREVIA) === 0;
  if (!silencioso || vz[b + V_GL] !== 0.0 || vz[b + V_GR] !== 0.0) return 0;
  return grupoPausado(grupo) !== 0 ? 2 : 1;
}
/// Usado ao NASCER (fora do bloco de `mixInto`): o ganho corrente acabou de
/// ser zerado junto com o resto da voz, então se o alvo já é silêncio não há
/// rampa nenhuma a fazer — marca na hora.
function auMarcarSilencio(vz: Float64Array, b: number): void {
  const causa = auCausaSilencio(vz, b, vz[b + V_GRUPO] | 0);
  if (causa === 1) vz[b + V_FLAGS] = (vz[b + V_FLAGS] | 0) | FLAG_VIRTUAL;
  else if (causa === 2) vz[b + V_FLAGS] = (vz[b + V_FLAGS] | 0) | FLAG_CONGELADA;
}

/// Mixa `quadros` de todas as vozes em `buf`. 4 parâmetros: a tabela de vozes e
/// as amostras chegam POR PARÂMETRO (o acesso barato). Devolve as vozes ativas.
function mixInto(buf: Float32Array, quadros: number, vozes: Float64Array, amostras: Float32Array[]): number {
  const d = auDesc;
  const nativo = auKernel === KERNEL_NATIVO;
  buf.fill(0.0, 0, quadros * d[D_CANAIS_DST]);
  let ativas = 0;
  let v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    const estado = vozes[b + V_ESTADO];
    if (estado === ESTADO_TOCANDO || estado === ESTADO_PARANDO || estado === ESTADO_PAUSANDO) {
      ativas = ativas + 1;
      const src = amostras[v];
      const canais = vozes[b + V_CANAIS];
      const grupo = vozes[b + V_GRUPO] | 0;
      let flags = vozes[b + V_FLAGS] | 0;
      if ((flags & FLAG_CONGELADA) !== 0) {
        if (grupoPausado(grupo) !== 0) { v = v + 1; continue; } // ainda em pausa: nem mixa nem anda
        flags = flags & (0 - 1 - FLAG_CONGELADA);
        vozes[b + V_FLAGS] = flags; // despausou o GRUPO
        if (estado !== ESTADO_TOCANDO) {
          // A pausa/parada é da VOZ (pausarVoz/pararVoz), não do grupo: sem
          // alvo audível pra rampear de volta — só assenta no estado final da
          // voz, sem mixar nem andar (mesma regra de "voz virtual" de sempre).
          if (estado === ESTADO_PARANDO) vozes[b + V_ESTADO] = ESTADO_LIVRE;
          else if (estado === ESTADO_PAUSANDO) vozes[b + V_ESTADO] = ESTADO_PAUSADA;
          v = v + 1; continue;
        }
        // TOCANDO: cai no caminho normal abaixo e rampeia de volta a partir
        // de zero (V_GL já está em zero, congelado desde a pausa do grupo).
      }
      const silenciosoAgora = vozes[b + V_ALVO_L] <= 0.0 && vozes[b + V_ALVO_R] <= 0.0 && (flags & FLAG_PREVIA) === 0;
      if ((flags & FLAG_VIRTUAL) !== 0) {
        if (silenciosoAgora) {
          // A causa continua (mudo, volume da voz, fora de alcance...): fica
          // virtual — a posição anda sem mixar (retomada no ponto certo).
          avancarVirtual(vozes, b, quadros, src.length / canais);
          if (estado === ESTADO_PARANDO) vozes[b + V_ESTADO] = ESTADO_LIVRE;
          else if (estado === ESTADO_PAUSANDO) vozes[b + V_ESTADO] = ESTADO_PAUSADA;
          v = v + 1; continue;
        }
        // A causa acabou: cai no caminho normal abaixo e rampeia de volta a
        // partir de zero (V_GL já está em zero, congelado desde que ficou virtual).
        flags = flags & (0 - 1 - FLAG_VIRTUAL);
        vozes[b + V_FLAGS] = flags;
      }
      d[D_POS] = vozes[b + V_POS]; d[D_PASSO] = vozes[b + V_PASSO]; d[D_CANAIS_SRC] = canais; d[D_QUADROS] = quadros;
      d[D_GL0] = vozes[b + V_GL]; d[D_GR0] = vozes[b + V_GR]; d[D_GL1] = vozes[b + V_ALVO_L]; d[D_GR1] = vozes[b + V_ALVO_R];
      d[D_LP_COEF] = vozes[b + V_LP_COEF]; d[D_LP_L] = vozes[b + V_LP_L]; d[D_LP_R] = vozes[b + V_LP_R];
      d[D_LACO_INI] = 0.0;
      d[D_LACO_FIM] = vozes[b + V_LACO] !== 0.0 && (flags & FLAG_PREVIA) === 0 ? src.length / canais : 0.0 - 1.0;
      auContadorMix = auContadorMix + 1;
      if (nativo) audio.mix_add(buf, src, d); else mixAddTs(buf, src, d);
      vozes[b + V_POS] = d[D_POS]; vozes[b + V_LP_L] = d[D_LP_L]; vozes[b + V_LP_R] = d[D_LP_R];
      vozes[b + V_GL] = vozes[b + V_ALVO_L]; vozes[b + V_GR] = vozes[b + V_ALVO_R];
      // O ganho chegou no alvo deste bloco (rampa completa, sem clique,
      // qualquer que seja a causa). Marca VIRTUAL (barato: mudo, volume da
      // voz, fora de alcance) ou CONGELADA (pausa do grupo: nem mixa, nem
      // anda) — persiste enquanto a causa continuar (ver os `if` acima).
      const causa = auCausaSilencio(vozes, b, grupo);
      if (causa === 1) vozes[b + V_FLAGS] = (vozes[b + V_FLAGS] | 0) | FLAG_VIRTUAL;
      else if (causa === 2) vozes[b + V_FLAGS] = (vozes[b + V_FLAGS] | 0) | FLAG_CONGELADA;
      if (d[D_FIM] !== 0.0) vozes[b + V_ESTADO] = ESTADO_LIVRE;
      else if (estado === ESTADO_PARANDO) vozes[b + V_ESTADO] = ESTADO_LIVRE;
      else if (estado === ESTADO_PAUSANDO) vozes[b + V_ESTADO] = ESTADO_PAUSADA;
    }
    v = v + 1;
  }
  return ativas;
}

/// Um bloco: alvos, mixagem e medição (corta em ±1). Sem escrever no
/// dispositivo — é o que `pumpAudio` chama e o que os testes chamam direto.
export function mixarBloco(quadros: number): number {
  let n = quadros;
  if (n > AU_MAX_BOMBA) n = AU_MAX_BOMBA;
  if (n <= 0) return 0;
  atualizarAlvos(auVozes);
  const ativas = mixInto(auMix, n, auVozes, auAmostras);
  auNivel[N_CANAIS] = auCanais; auNivel[N_QUADROS] = n;
  audio.mix_level(auMix, auNivel);
  return ativas;
}

/// Lê `faltas` do nativo e ajusta `auAlvoQuadros`: uma falta NOVA desde o
/// último quadro (o dispositivo achou o anel curto) sobe o alvo de uma vez
/// (`AU_ALVO_PASSO_SOBE`) e agenda o fade-in do próximo bloco; sem falta nova
/// por `AU_ALVO_JANELA_ESTAVEL` quadros seguidos, encolhe devagar de volta ao
/// mínimo. Ruling A8 estendido: a folga cresce pela EVIDÊNCIA de que o quadro
/// está lento (não um palpite fixo), e desce devagar pra não reabrir a mesma
/// falta na primeira oscilação seguinte.
function auAtualizarAlvo(): void {
  if (audio.stats(auDev, auStats) === 0) return;
  const faltasAgora = auStats[1];
  if (faltasAgora !== auFaltasAntes) {
    auFaltasAntes = faltasAgora;
    auQuadrosSemFalta = 0;
    auAlvoQuadros = auAlvoQuadros + AU_ALVO_PASSO_SOBE;
    if (auAlvoQuadros > AU_ALVO_QUADROS_MAX) auAlvoQuadros = AU_ALVO_QUADROS_MAX;
    auRampaRestante = AU_RAMPA_QUADROS;
  } else {
    auQuadrosSemFalta = auQuadrosSemFalta + 1;
    if (auQuadrosSemFalta >= AU_ALVO_JANELA_ESTAVEL && auAlvoQuadros > AU_ALVO_QUADROS_MIN) {
      auQuadrosSemFalta = 0;
      auAlvoQuadros = auAlvoQuadros - AU_ALVO_PASSO_DESCE;
      if (auAlvoQuadros < AU_ALVO_QUADROS_MIN) auAlvoQuadros = AU_ALVO_QUADROS_MIN;
    }
  }
}

/// Fade-in linear (0→1) dos primeiros `auRampaRestante` quadros de `buf`,
/// consumindo a rampa conforme os quadros passam (pode terminar no meio de um
/// bloco, ou continuar no próximo `write` do mesmo `pumpAudio`). Só corre
/// depois de uma falta nova (ver `auAtualizarAlvo`) — o resto do tempo
/// `auRampaRestante` é 0 e a função não toca o buffer.
function auRampaEntrada(buf: Float32Array, quadros: number): void {
  if (auRampaRestante <= 0) return;
  const canais = auCanais;
  let f = 0;
  while (f < quadros && auRampaRestante > 0) {
    const t: f64 = 1.0 - auRampaRestante / AU_RAMPA_QUADROS;
    let c = 0;
    while (c < canais) { buf[f * canais + c] = buf[f * canais + c] * t; c = c + 1; }
    auRampaRestante = auRampaRestante - 1;
    f = f + 1;
  }
}

/// Mixa e envia o que falta para o alvo ENFILEIRADO (adaptativo, ver
/// `auAtualizarAlvo`). Uma vez por quadro. Depois de um quadro lento (o anel
/// drenou abaixo do alvo mínimo) cobre a lacuna INTEIRA aqui — várias
/// chamadas de `mixarBloco`/`write`, cada uma até `AU_MAX_BOMBA` — em vez de
/// só 1 bloco por quadro, que levaria vários quadros pra reencher e arriscava
/// faltar de novo antes de completar.
export function pumpAudio(): number {
  if (auDev === 0) return 0;
  const q = audio.queued_frames(auDev);
  if (q < 0) return 0;
  auAtualizarAlvo();
  let need = auAlvoQuadros - q;
  if (need <= 0) return 0;
  let escritos = 0;
  while (need > 0) {
    let n = need;
    if (n > AU_MAX_BOMBA) n = AU_MAX_BOMBA;
    mixarBloco(n);
    auRampaEntrada(auMix, n);
    const w = audio.write(auDev, auMix, n * auCanais);
    escritos = escritos + w;
    if (w < n * auCanais) break; // anel cheio (não deveria com o alvo ≤ AU_ALVO_QUADROS_MAX): para sem laço infinito
    need = need - n;
  }
  return escritos;
}

// ── a API de tons de antes ───────────────────────────────────────────────────
function auTom(forma: number, freq: f64, dur: f64, gain: f64): number {
  pedidoPadrao(auPedido);
  auPedido[PEDIDO_VOLUME] = gain;
  return tocarClipe(toneClip(freq, dur, forma), auPedido) !== 0 ? 1 : 0;
}
/// Rolloff global de antes (`setRolloff`) para os tons posicionais.
function auPedido3DLegado(gain: f64): void {
  pedidoPadrao(auPedido);
  auPedido[PEDIDO_VOLUME] = gain; auPedido[PEDIDO_FLAGS] = FLAG_3D; auPedido[PEDIDO_BLEND] = 1.0;
  auPedido[PEDIDO_MIN] = rolloffRef(); auPedido[PEDIDO_MAX] = rolloffMax(); auPedido[PEDIDO_ROLLOFF] = ROLLOFF_LOG;
}
export function playTone(freq: f64, dur: f64, gain: f64): number { return auTom(FORMA_SENO, freq, dur, gain); }
export function playSquare(freq: f64, dur: f64, gain: f64): number { return auTom(FORMA_QUADRADA, freq, dur, gain); }
export function playNoise(dur: f64, gain: f64): number { return auTom(FORMA_RUIDO, 440.0, dur, gain); }
export function playToneAt(freq: f64, dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  auPedido3DLegado(gain); auPedido[PEDIDO_X] = x; auPedido[PEDIDO_Y] = y; auPedido[PEDIDO_Z] = z;
  return tocarClipe(toneClip(freq, dur, FORMA_SENO), auPedido);
}
export function playSquareAt(freq: f64, dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  auPedido3DLegado(gain); auPedido[PEDIDO_X] = x; auPedido[PEDIDO_Y] = y; auPedido[PEDIDO_Z] = z;
  return tocarClipe(toneClip(freq, dur, FORMA_QUADRADA), auPedido);
}
export function playNoiseAt(dur: f64, gain: f64, x: f64, y: f64, z: f64): number {
  auPedido3DLegado(gain); auPedido[PEDIDO_X] = x; auPedido[PEDIDO_Y] = y; auPedido[PEDIDO_Z] = z;
  return tocarClipe(toneClip(440.0, dur, FORMA_RUIDO), auPedido);
}
/// Move uma voz posicional ainda soando; id de voz acabada é ignorado.
export function moveVoice(id: number, x: f64, y: f64, z: f64): void {
  const b = auBase(id);
  if (b < 0 || ((auVozes[b + V_FLAGS] | 0) & FLAG_3D) === 0) return;
  auVozes[b + V_X] = x; auVozes[b + V_Y] = y; auVozes[b + V_Z] = z;
}
export function voiceGainL(i: number): f64 { return i >= 0 && i < MAX_VOZES ? auVozes[i * VOZ_FLOATS + V_ALVO_L] : 0.0; }
export function voiceGainR(i: number): f64 { return i >= 0 && i < MAX_VOZES ? auVozes[i * VOZ_FLOATS + V_ALVO_R] : 0.0; }
export function voiceIsPositional(i: number): number {
  return i >= 0 && i < MAX_VOZES && ((auVozes[i * VOZ_FLOATS + V_FLAGS] | 0) & FLAG_3D) !== 0 ? 1 : 0;
}

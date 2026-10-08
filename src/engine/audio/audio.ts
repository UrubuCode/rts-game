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
import time from "@compat/time.ts";
import { ResourceLease } from "@engine/core/resources";
import { AudioClip, retainAudioClip, toneClip, definirTaxaDosClipes, clipPorId, FORMA_SENO, FORMA_QUADRADA, FORMA_RUIDO } from "./clip";
import { rolloffRef, rolloffMax, espGanhosVoz, ESP_GL, ESP_GR, ESP_LP, ESP_DIST, ESP_CORTE, ESP_FLOATS } from "./spatial";
import { ganhoGrupo, grupoPausado } from "./mixer_grupos";
import { D_POS, D_PASSO, D_CANAIS_SRC, D_CANAIS_DST, D_QUADROS, D_GL0, D_GR0, D_GL1, D_GR1, D_LP_COEF,
         D_LP_L, D_LP_R, D_LACO_INI, D_LACO_FIM, D_FIM, DESC_FLOATS, N_CANAIS, N_QUADROS, NIVEL_FLOATS } from "./mix_desc";
import { mixAddTs } from "./mix_ts";
import { MAX_VOZES, VOZ_FLOATS, V_ESTADO, V_CLIPE, V_POS, V_PASSO, V_LACO, V_GL, V_GR, V_ALVO_L, V_ALVO_R,
         V_LP_COEF, V_LP_L, V_LP_R, V_GRUPO, V_FONTE, V_FLAGS, V_VOLUME, V_X, V_Y, V_Z, V_BLEND, V_MIN, V_MAX,
         V_ROLLOFF, V_PITCH, V_CANAIS, V_CORTE, V_GERACAO, V_DIST, V_ATRASO, V_INICIO_MIX, V_BASE_TEMPO,
         ESTADO_LIVRE, ESTADO_TOCANDO, ESTADO_PAUSADA,
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
const voiceLeases: (ResourceLease<AudioClip> | null)[] = [];
let auIni = 0;
while (auIni < MAX_VOZES) { auAmostras.push(auVazio); voiceLeases.push(null); auIni = auIni + 1; }
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

// ── relógio DSP (ritmo) ──────────────────────────────────────────────────────
// Problema: `AudioSource.time`/`vozSegundos` leem `V_POS`, a posição MIXADA —
// o mixer roda `auAlvoQuadros` (100..250 ms, ADAPTATIVO) à FRENTE do que o
// alto-falante está tocando agora, e essa folga muda com o tempo (fase A8).
// Pra ritmo (spec deste brief) o jogo precisa da posição AUDÍVEL: quantos
// quadros o CALLBACK do dispositivo já puxou de verdade (`audio.stats`
// consumidos), menos a latência do dispositivo até o alto-falante, menos a
// calibração do usuário.
//
// `consumidos` é um contador nativo CUMULATIVO que só anda em degraus do
// tamanho do callback do dispositivo (tipicamente ~10 ms) — direto ele seria
// audível como "soquinhos" pra quem lê a cada quadro (60+ Hz). Suaviza-se
// assim (`auAtualizarRelogio`, chamado 1x por `pumpAudio`, com o `audio.stats`
// que `auAtualizarAlvo` já leu — sem 2ª chamada nativa por quadro):
//   1. Quando o valor bruto MUDA, guarda-o e o instante real (`time.now_ms`)
//      dessa mudança.
//   2. Entre mudanças, EXTRAPOLA pelo relógio de quadro: bruto + (tempo real
//      decorrido desde a mudança) × taxa — preenche o degrau com uma reta.
//   3. O suavizado nunca REGRIDE (mesmo se o bruto oscilar por reabertura de
///     dispositivo ou o relógio de quadro ficar momentaneamente atrás do
//      último bruto lido): guarda o `max` do que já mostrou.
// Um travamento de quadro (GC, janela minimizada) não anda o bruto nem o
// relógio de quadro enquanto dura — ao voltar, o suavizado só RETOMA a
// extrapolar a partir de onde parou (sem salto pra trás, sem inventar tempo
// que não passou de verdade no relógio de quadro).
/// `consumidos` (nativo) NÃO garante começar em 0 num `initAudio` fresco —
/// medido: reabrir o dispositivo (mesmo NULO) pode herdar contagem de uma
/// `Saida` anterior ainda sendo derrubada (o `Drop`/join da thread é
/// assíncrono; o handle novo pode ler a `Compartilhado` antiga por uma
/// leitura ou duas). `rlBaseConsumidos` normaliza: a 1ª leitura depois de
/// abrir vira a ORIGEM (relativo = bruto − base) — sem isso `amostrasDsp()`
/// nasceria com um salto (o quanto sobrou da contagem antiga).
let rlBaseConsumidos: f64 = 0.0;
let rlBaseDefinida: number = 0; // 0 até a 1ª leitura depois do `initAudio` corrente
let rlConsumidosUltimo: f64 = 0.0;       // último RELATIVO (bruto − base) visto
let rlConsumidosUltimoEm: f64 = 0.0;     // `time.now_ms()` de quando o relativo mudou
let rlSuaveAmostras: f64 = 0.0;          // amostras audíveis suavizadas, monotônicas
/// Estimativa de latência do DISPOSITIVO (buffer do SO/hardware depois do
/// callback, antes do alto-falante), em quadros. `rts:audio`/cpal não expõem
/// essa métrica hoje (nem tamanho de buffer) — fica em 0 e a calibração do
/// usuário (`rlCalibracaoMs`) absorve o valor real medido a ouvido.
let rlLatenciaDispositivoQuadros: f64 = 0.0;
/// Offset de calibração do usuário (Janela/Calibrar latência de áudio, ou
/// `audio calibrar <ms>`), em ms. Positivo = o som chega DEPOIS do que o
/// relógio acha (o áudio "atrasa"); ver `latenciaCalibradaMs`.
let rlCalibracaoMs: f64 = 0.0;
/// Total de quadros já MIXADOS (não confundir com `consumidos`, do
/// dispositivo): a régua usada por `agendarEm` e por `V_INICIO_MIX` — a mesma
/// escala de `amostrasDsp()` (frames de saída desde a abertura do
/// dispositivo), mas sem a latência/calibração (é onde os quadros SAEM do
/// mixer, não onde ficam audíveis).
let auTotalMixado: f64 = 0.0;
/// Atraso (quadros) que a PRÓXIMA `tocarClipe` deve gravar em `V_ATRASO`
/// (setter de módulo — `agendarEm`/`mixarBloco` combinam, sem 5º parâmetro em
/// `tocarClipe`; ver "Custo por quadro" no CLAUDE.md).
let auAtrasoProximaVoz: number = 0;

/// Agendamentos pendentes de `agendarEm` (PlayScheduled): `Float64Array`
/// paralelo. Clipes gerenciados adquirem uma referencia ao agendar. `AGENDA_MAX` cabe folgado pro uso de
/// ritmo (uma trilha inteira agendada com antecedência) sem crescer.
const AGENDA_MAX: number = 64;
const agClipe: (AudioClip | null)[] = []; { let i = 0; while (i < AGENDA_MAX) { agClipe.push(null); i = i + 1; } }
const scheduledLeases: (ResourceLease<AudioClip> | null)[] = [];
{ let i = 0; while (i < AGENDA_MAX) { scheduledLeases.push(null); i = i + 1; } }
const agAlvoQuadro = new Float64Array(AGENDA_MAX); // alvo em amostras DSP (mesma régua de `amostrasDsp()`)
const agPedido = new Float64Array(AGENDA_MAX * PEDIDO_FLOATS);
/// Id ESTÁVEL de cada agendamento pendente (ver `agendarEm`/`cancelarAgendado`
/// — não é id de voz: nasce ANTES de existir voz nenhuma).
const agId = new Float64Array(AGENDA_MAX);
let agN: number = 0; // agendamentos ocupados (0..agN-1, sem buracos: remoção troca com o último)
/// Agendamentos que JÁ viraram voz (o clique disparou): o mesmo id de
/// `agendarEm` continua válido pra `cancelarAgendado` — mapeia pro id de voz
/// REAL. `Float64Array` paralelo (não `Map`: nada aqui itera por chave, só
/// busca linear/poda — mesmo estilo do resto do arquivo), também
/// `AGENDA_MAX` (o teto de agendamentos "vivos" de uma vez, agendados ou já
/// tocando, é o mesmo).
const agResId = new Float64Array(AGENDA_MAX);
const agResVoz = new Float64Array(AGENDA_MAX);
let agResN: number = 0;
/// Próximo id de agendamento (nunca 0 — 0 é "sem agendamento"/falha, como o
/// resto da API de áudio). Cresce sempre; não recicla (o teto prático é o
/// mesmo de qualquer id de 53 bits num f64 — não estoura numa sessão real).
let agProximoId: f64 = 1.0;

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
  rlBaseDefinida = 0; rlBaseConsumidos = 0.0; rlConsumidosUltimo = 0.0; rlConsumidosUltimoEm = 0.0;
  rlSuaveAmostras = 0.0; auTotalMixado = 0.0;
  agN = 0; agResN = 0; agProximoId = 1.0; auAtrasoProximaVoz = 0;
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
  if (auDev === 0 || clip.quadros === 0 || (clip.resourceKey !== "" && clipPorId(clip.id) !== clip)) return 0;
  const vz = auVozes;
  const v = auAlocar(vz);
  if (v < 0) return 0;
  const b = v * VOZ_FLOATS;
  // Adquirir antes de substituir: a voz roubada pode ser o ultimo dono deste clipe.
  const lease = retainAudioClip(clip);
  releaseVoiceResource(v); voiceLeases[v] = lease;
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
  // Relógio DSP (agendarEm/tempoAudivel): a voz nasce com atraso 0, salvo um
  // `agendarEm` pendente que caiu neste bloco (setter de módulo — ver a nota
  // "custo por quadro" onde `auAtrasoProximaVoz` é declarado). A âncora
  // (V_INICIO_MIX) é o quadro MIXADO em que a amostra 0 do clipe sai do
  // mixer — `auTotalMixado` ainda não inclui o bloco corrente, então somar o
  // atraso dá o quadro exato dentro dele.
  vz[b + V_ATRASO] = auAtrasoProximaVoz;
  vz[b + V_INICIO_MIX] = auTotalMixado + auAtrasoProximaVoz;
  vz[b + V_BASE_TEMPO] = 0.0;
  auAtrasoProximaVoz = 0;
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

// ── relógio DSP: leitura e reancoragem por voz ──────────────────────────────
/// Posição audível ATUAL, em amostras (mesma régua que `V_INICIO_MIX`/
/// `auTotalMixado`): o suavizado (`rlSuaveAmostras`, ver `auAtualizarRelogio`)
/// menos a latência do dispositivo e a calibração do usuário. Nunca negativo
/// (satura em 0 — antes do dispositivo abrir/consumir a 1ª amostra).
export function amostrasDsp(): f64 {
  const a = rlSuaveAmostras - rlLatenciaDispositivoQuadros - rlCalibracaoMs * auTaxa / 1000.0;
  return a > 0.0 ? a : 0.0;
}
/// `Audio.tempoDsp()`: segundos desde a abertura do dispositivo, AUDÍVEL,
/// monotônico. Ver a nota "relógio DSP (ritmo)" onde `rlSuaveAmostras` é
/// declarado — é o Unity `AudioSettings.dspTime` (posição real no
/// alto-falante), não `vozSegundos`/`AudioSource.time` (posição no mixer).
export function tempoDsp(): f64 { return amostrasDsp() / auTaxa; }
/// Offset de calibração do usuário, em ms (`Audio.latenciaCalibrada`, painel
/// Janela/Calibrar latência de áudio, comando `audio calibrar`). Positivo =
/// o som mostrado pelo relógio chega DEPOIS na prática — soma-se à latência
/// pra atrasar `amostrasDsp()` até bater com o que a pessoa ouve de verdade.
export function latenciaCalibradaMs(): f64 { return rlCalibracaoMs; }
export function definirLatenciaCalibradaMs(ms: f64): void { rlCalibracaoMs = ms; }
/// Estimativa de latência do DISPOSITIVO (não a calibração do usuário), em
/// ms — 0 hoje (ver a nota onde `rlLatenciaDispositivoQuadros` é declarado).
export function latenciaDispositivoMs(): f64 { return rlLatenciaDispositivoQuadros * 1000.0 / auTaxa; }
/// Só teste/instrumentação: total de quadros já MIXADOS (régua de
/// `agendarEm`/`V_INICIO_MIX`) — não confundir com `amostrasDsp()` (audível).
export function framesMixadosTotais(): f64 { return auTotalMixado; }

/// `Audio.agendarEm` (Unity PlayScheduled): agenda `clip` pra tocar com a 1ª
/// amostra audível exatamente em `tempoDspAlvo` (segundos, régua de
/// `Audio.tempoDsp()`) — sample-accurate dentro do bloco (ver `V_ATRASO` em
/// `mixInto`), essencial pra ritmo/música sincronizada. `pedido` opcional
/// (`pedidoPadrao` senão). Alvo já passado: toca no próximo bloco, já sem
/// atraso (melhor esforço — não existe voltar no tempo).
///
/// Devolve um id (≥ 1) que serve pra `cancelarAgendado` tanto ANTES do
/// disparo (some da fila) quanto DEPOIS (a voz real para com a rampa normal
/// — o mesmo id continua válido, só muda o que ele aponta por baixo). 0 =
/// não agendou: sem dispositivo, clipe vazio, ou fila cheia (`AGENDA_MAX`).
///
/// Quando o alvo dispara (`auProcessarAgenda`) mas as 32 vozes já estão
/// ocupadas por som AUDÍVEL (não virtual), a política é a MESMA de
/// `tocarClipe`/`auAlocar`: rouba uma voz VIRTUAL se houver; sem nenhuma,
/// DESCARTA o clique (nunca rouba uma voz audível — estalaria). Um clique
/// descartado assim não deixa rastro pra cancelar (o id some da fila e não
/// tem voz nenhuma pra mapear).
export function agendarEm(clip: AudioClip, tempoDspAlvo: f64, pedido?: Float64Array): number {
  if (auDev === 0 || clip.quadros === 0 || agN >= AGENDA_MAX || (clip.resourceKey !== "" && clipPorId(clip.id) !== clip)) return 0;
  // Converte o alvo AUDÍVEL (pós latência/calibração) pra régua MIXADA (a de
  // `auTotalMixado`/`rlSuaveAmostras`, ANTES de subtrair latência/calibração)
  // — o inverso de `amostrasDsp()`.
  const alvoQuadroMixado = tempoDspAlvo * auTaxa + rlLatenciaDispositivoQuadros + rlCalibracaoMs * auTaxa / 1000.0;
  const i = agN;
  const id = agProximoId;
  agProximoId = agProximoId + 1.0;
  agId[i] = id;
  agClipe[i] = clip; scheduledLeases[i] = retainAudioClip(clip);
  agAlvoQuadro[i] = alvoQuadroMixado;
  const pb = i * PEDIDO_FLOATS;
  if (pedido !== undefined) { let k = 0; while (k < PEDIDO_FLOATS) { agPedido[pb + k] = pedido[k]; k = k + 1; } }
  else pedidoPadrao(agPedido.subarray(pb, pb + PEDIDO_FLOATS));
  agN = agN + 1;
  return id;
}
/// Remove o agendamento `i` da fila PENDENTE (troca com o último — sem
/// buraco, sem alocar). Usado por `cancelarAgendado` e por
/// `auProcessarAgenda` quando o alvo dispara.
function agRemoverPendente(i: number): void {
  const lease = scheduledLeases[i]; if (lease !== null) lease.release();
  agN = agN - 1;
  scheduledLeases[i] = scheduledLeases[agN]; scheduledLeases[agN] = null;
  agClipe[i] = agClipe[agN]; agClipe[agN] = null;
  agAlvoQuadro[i] = agAlvoQuadro[agN];
  agId[i] = agId[agN];
  const pb = i * PEDIDO_FLOATS; const ub = agN * PEDIDO_FLOATS;
  let k = 0; while (k < PEDIDO_FLOATS) { agPedido[pb + k] = agPedido[ub + k]; k = k + 1; }
}
/// Poda `agRes*` (agendamentos já disparados) das entradas cuja voz já
/// acabou de vez (`vozIndice` não resolve mais essa geração) — sem isso a
/// tabela cresce sem limite numa sessão longa. Barato (laço ≤ `AGENDA_MAX`,
/// sem alocar); chamado no topo de `auProcessarAgenda`, mesmo com `agN = 0`.
function agPodarResolvidos(): void {
  let i = 0;
  while (i < agResN) {
    if (vozIndice(agResVoz[i]) < 0) {
      agResN = agResN - 1;
      agResId[i] = agResId[agResN]; agResVoz[i] = agResVoz[agResN];
      continue; // o que veio da troca ainda não foi conferido
    }
    i = i + 1;
  }
}
/// `Audio.cancelarAgendado`: antes do disparo, some da fila (a voz nunca
/// chega a existir); depois, para a voz REAL com a rampa normal
/// (`pararVoz` — sem clique, ver a fase A6). Devolve 1 se cancelou alguma
/// coisa, 0 se o id é desconhecido (nunca existiu, já tocou e acabou
/// sozinho, ou foi DESCARTADO ao disparar — ver a nota em `agendarEm` sobre
/// as 32 vozes ocupadas).
export function cancelarAgendado(id: number): number {
  let i = 0;
  while (i < agN) {
    if (agId[i] === id) { agRemoverPendente(i); return 1; }
    i = i + 1;
  }
  i = 0;
  while (i < agResN) {
    if (agResId[i] === id) {
      pararVoz(agResVoz[i]);
      agResN = agResN - 1;
      agResId[i] = agResId[agResN]; agResVoz[i] = agResVoz[agResN];
      return 1;
    }
    i = i + 1;
  }
  return 0;
}

/// Quadros de SAÍDA decorridos desde a âncora da voz (nunca negativo — uma
/// voz agendada pro futuro, ou cuja âncora ainda não ficou audível, dá 0).
function auElapsedQuadros(b: number): f64 {
  const e = amostrasDsp() - auVozes[b + V_INICIO_MIX];
  return e > 0.0 ? e : 0.0;
}
/// Crava o tempo de clipe decorrido ATÉ AGORA em `V_BASE_TEMPO` (na taxa/pitch
/// CORRENTE, antes de mudar) e reancora em cima do relógio audível atual — uso:
/// antes de pausar e antes de mudar o pitch, senão o trecho já tocado seria
/// recalculado com a taxa NOVA.
function auReancorar(b: number): void {
  auVozes[b + V_BASE_TEMPO] = auVozes[b + V_BASE_TEMPO] + auElapsedQuadros(b) / auTaxa * auVozes[b + V_PITCH];
  auVozes[b + V_INICIO_MIX] = amostrasDsp();
}
/// Só reancora o RELÓGIO (sem somar elapsed): uso ao despausar — o tempo
/// congelado em `V_BASE_TEMPO` (fase A6: o pause já congelou via
/// `auReancorar`) não deve ganhar o intervalo em que a voz ficou parada.
function auReancoraSemElapsed(b: number): void { auVozes[b + V_INICIO_MIX] = amostrasDsp(); }
/// Segundos de clipe audíveis AGORA (`AudioSource.tempoAudivel`): congelado em
/// `V_BASE_TEMPO` enquanto `ESTADO_PAUSADA` (a rampa de `ESTADO_PAUSANDO`
/// ainda soa — tolerância de um bloco, como o resto do relógio); tocando,
/// soma o elapsed desde a âncora, na taxa/pitch corrente.
function auTempoAudivelBase(b: number): f64 {
  if (auVozes[b + V_ESTADO] === ESTADO_PAUSADA) return auVozes[b + V_BASE_TEMPO];
  return auVozes[b + V_BASE_TEMPO] + auElapsedQuadros(b) / auTaxa * auVozes[b + V_PITCH];
}
/// `AudioSource.tempoAudivel`: segundos de clipe realmente audíveis agora
/// (ao contrário de `vozSegundos`, que é a posição MIXADA — à frente).
export function vozTempoAudivel(id: number): f64 { const b = auBase(id); return b >= 0 ? auTempoAudivelBase(b) : 0.0; }
/// `AudioSource.timeSamples`: o mesmo, em quadros NA TAXA DO CLIPE (Unity).
export function vozAmostrasAudiveis(id: number): f64 {
  const b = auBase(id);
  if (b < 0) return 0.0;
  const c = clipPorId(auVozes[b + V_CLIPE] | 0);
  const taxaClipe: f64 = c !== null ? c.taxa : auTaxa;
  return auTempoAudivelBase(b) * taxaClipe;
}

/// Pede o fim da voz sem clique: o ganho-alvo vira zero e a rampa por amostra
/// do bloco (já existente) leva `V_GL/V_GR` a zero antes do slot ser liberado
/// (fase A6). Paranda a meio de outra rampa: só troca o destino final.
export function pararVoz(id: number): void {
  const b = auBase(id);
  if (b < 0) return;
  const estado = auVozes[b + V_ESTADO];
  if (estado === ESTADO_TOCANDO || estado === ESTADO_PAUSANDO) auVozes[b + V_ESTADO] = ESTADO_PARANDO;
  else if (estado === ESTADO_PAUSADA) { auVozes[b + V_ESTADO] = ESTADO_LIVRE; releaseVoiceResource(b / VOZ_FLOATS); } // ja silenciosa
}
/// Pausar: mesma rampa a zero, depois o slot CONGELA (não libera). Despausar
/// retoma de onde a rampa parou — se o ganho ainda não chegou a zero, o alvo
/// normal do próximo bloco rampa de volta, também sem clique.
export function pausarVoz(id: number, pausa: number): void {
  const b = auBase(id);
  if (b < 0) return;
  const estado = auVozes[b + V_ESTADO];
  if (pausa !== 0) {
    if (estado === ESTADO_TOCANDO) { auReancorar(b); auVozes[b + V_ESTADO] = ESTADO_PAUSANDO; }
  } else if (estado === ESTADO_PAUSADA || estado === ESTADO_PAUSANDO) {
    auReancoraSemElapsed(b);
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
  // Reancora ANTES de trocar o pitch (só enquanto toca de verdade: elapsed
  // parado — pausada/parando — não deve mexer na base). Sem isso o trecho já
  // tocado na taxa ANTIGA seria recontado com o pitch NOVO em `tempoAudivel`.
  if (auVozes[b + V_ESTADO] === ESTADO_TOCANDO) auReancorar(b);
  auVozes[b + V_PITCH] = p;
  auVozes[b + V_PASSO] = auPasso(p, auTaxa);
}
function releaseVoiceResource(slot: number): void {
  auAmostras[slot] = auVazio;
  const lease = voiceLeases[slot];
  if (lease !== null) { voiceLeases[slot] = null; lease.release(); }
}
function releaseFinishedVoiceResources(): void {
  for (let v = 0; v < MAX_VOZES; v++) {
    if (auVozes[v * VOZ_FLOATS + V_ESTADO] === ESTADO_LIVRE && auAmostras[v] !== auVazio) releaseVoiceResource(v);
  }
}
function clearScheduledResources(): void {
  while (agN > 0) agRemoverPendente(agN - 1);
  agResN = 0; auAtrasoProximaVoz = 0;
}
export function pararTodas(): void {
  let v = 0;
  while (v < MAX_VOZES) { auVozes[v * VOZ_FLOATS + V_ESTADO] = ESTADO_LIVRE; releaseVoiceResource(v); v = v + 1; }
  clearScheduledResources();
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
  clearScheduledResources();
  let v = 0;
  while (v < MAX_VOZES) {
    const b = v * VOZ_FLOATS;
    const estado = auVozes[b + V_ESTADO];
    if (estado === ESTADO_TOCANDO || estado === ESTADO_PAUSANDO) auVozes[b + V_ESTADO] = ESTADO_PARANDO;
    else if (estado === ESTADO_PAUSADA) { auVozes[b + V_ESTADO] = ESTADO_LIVRE; releaseVoiceResource(v); }
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
        if (grupoPausado(grupo) !== 0) {
          if (estado === ESTADO_PARANDO) vozes[b + V_ESTADO] = ESTADO_LIVRE;
          else if (estado === ESTADO_PAUSANDO) vozes[b + V_ESTADO] = ESTADO_PAUSADA;
          v = v + 1; continue;
        } // ja silenciosa: parar pode liberar mesmo com grupo pausado
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
      // `agendarEm` (PlayScheduled): a voz nasceu com `V_ATRASO` quadros de
      // silêncio no COMEÇO deste bloco — a amostra 0 do clipe só entra no
      // buffer a partir do quadro `atraso` (offset em `buf`, visão via
      // `subarray` — soma no MESMO array, sem copiar). Sample-accurate: o
      // resto do quadro (antes do offset) já saiu zerado do `buf.fill` do
      // topo da função, ninguém escreve lá por esta voz. Só o 1º bloco tem
      // atraso > 0 (consumido aqui, uma vez).
      let atraso = vozes[b + V_ATRASO] | 0;
      if (atraso > quadros) atraso = quadros; // defensivo: agendamento sempre cai DENTRO do bloco corrente
      const quadrosVoz = quadros - atraso;
      if (atraso > 0) vozes[b + V_ATRASO] = 0.0;
      if (quadrosVoz <= 0) { v = v + 1; continue; } // atraso cobre o bloco inteiro: nada a mixar ainda
      const bufVoz = atraso > 0 ? buf.subarray(atraso * (d[D_CANAIS_DST] | 0)) : buf;
      d[D_POS] = vozes[b + V_POS]; d[D_PASSO] = vozes[b + V_PASSO]; d[D_CANAIS_SRC] = canais; d[D_QUADROS] = quadrosVoz;
      d[D_GL0] = vozes[b + V_GL]; d[D_GR0] = vozes[b + V_GR]; d[D_GL1] = vozes[b + V_ALVO_L]; d[D_GR1] = vozes[b + V_ALVO_R];
      d[D_LP_COEF] = vozes[b + V_LP_COEF]; d[D_LP_L] = vozes[b + V_LP_L]; d[D_LP_R] = vozes[b + V_LP_R];
      d[D_LACO_INI] = 0.0;
      d[D_LACO_FIM] = vozes[b + V_LACO] !== 0.0 && (flags & FLAG_PREVIA) === 0 ? src.length / canais : 0.0 - 1.0;
      auContadorMix = auContadorMix + 1;
      if (nativo) audio.mix_add(bufVoz, src, d); else mixAddTs(bufVoz, src, d);
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

/// `agendarEm`/`Audio.agendarEm` (Unity PlayScheduled): dispara os
/// agendamentos cujo alvo cai DENTRO do bloco que está prestes a ser mixado
/// (`[auTotalMixado, auTotalMixado + n)`), com o atraso exato dentro do bloco
/// (ver o `V_ATRASO` em `mixInto`). Chamado no TOPO de `mixarBloco`, antes de
/// `auTotalMixado` avançar — é o único lugar que sabe "o que vai ser mixado
/// agora" sem duplicar o laço de `pumpAudio`.
function auProcessarAgenda(n: number): void {
  // Poda SEMPRE (mesmo `agN = 0`): um agendamento que já virou voz e essa voz
  // já acabou sozinha (não cancelada) precisa sair de `agRes*` também sem
  // agendamento novo nenhum pendente.
  agPodarResolvidos();
  if (agN === 0) return;
  const inicioBloco = auTotalMixado;
  const fimBloco = inicioBloco + n;
  let i = 0;
  while (i < agN) {
    if (agAlvoQuadro[i] >= fimBloco) { i = i + 1; continue; }
    let atraso = agAlvoQuadro[i] - inicioBloco;
    if (atraso < 0.0) atraso = 0.0; // alvo já passou: toca já (melhor esforço)
    auAtrasoProximaVoz = atraso | 0;
    const clip = agClipe[i];
    const idAgendado = agId[i];
    const pb = i * PEDIDO_FLOATS;
    const vozId = clip !== null ? tocarClipe(clip, agPedido.subarray(pb, pb + PEDIDO_FLOATS)) : 0;
    auAtrasoProximaVoz = 0;
    // Remove o slot i da fila PENDENTE (troca com o último — sem buraco, sem
    // alocar); não avança `i`, o que veio da troca ainda não foi conferido.
    agRemoverPendente(i);
    // A voz nasceu de verdade (não descartada por falta de slot — ver a nota
    // em `agendarEm`): o MESMO id continua válido pra `cancelarAgendado`,
    // agora apontando pra voz real.
    if (vozId !== 0 && agResN < AGENDA_MAX) { agResId[agResN] = idAgendado; agResVoz[agResN] = vozId; agResN = agResN + 1; }
  }
}

/// Um bloco: alvos, mixagem e medição (corta em ±1). Sem escrever no
/// dispositivo — é o que `pumpAudio` chama e o que os testes chamam direto.
export function mixarBloco(quadros: number): number {
  let n = quadros;
  if (n > AU_MAX_BOMBA) n = AU_MAX_BOMBA;
  if (n <= 0) return 0;
  auProcessarAgenda(n);
  atualizarAlvos(auVozes);
  const ativas = mixInto(auMix, n, auVozes, auAmostras);
  releaseFinishedVoiceResources();
  auNivel[N_CANAIS] = auCanais; auNivel[N_QUADROS] = n;
  audio.mix_level(auMix, auNivel);
  auTotalMixado = auTotalMixado + n; // depois de mixar: a régua de agendarEm/V_INICIO_MIX conta o que JÁ mixou
  return ativas;
}

/// Suaviza `consumidos` (bruto, cumulativo, anda em degraus do tamanho do
/// callback do dispositivo — ver a nota "relógio DSP (ritmo)" onde
/// `rlSuaveAmostras` é declarado): quando o bruto MUDA, guarda-o e o instante
/// real; entre mudanças, extrapola pelo relógio de QUADRO (tempo real
/// decorrido × taxa) — e nunca deixa o suavizado regredir.
function auAtualizarRelogio(consumidosBrutos: f64, taxa: f64): void {
  const agoraMs: f64 = time.now_ms();
  if (rlBaseDefinida === 0) { rlBaseConsumidos = consumidosBrutos; rlBaseDefinida = 1; rlConsumidosUltimoEm = agoraMs; }
  const relativo = consumidosBrutos - rlBaseConsumidos; // ver a nota em `rlBaseConsumidos`: a origem é a 1ª leitura, não 0 absoluto
  if (relativo !== rlConsumidosUltimo) { rlConsumidosUltimo = relativo; rlConsumidosUltimoEm = agoraMs; }
  const dtMs = agoraMs - rlConsumidosUltimoEm;
  const extrapolado = rlConsumidosUltimo + (dtMs > 0.0 ? dtMs * taxa / 1000.0 : 0.0);
  if (extrapolado > rlSuaveAmostras) rlSuaveAmostras = extrapolado;
  else if (rlConsumidosUltimo > rlSuaveAmostras) rlSuaveAmostras = rlConsumidosUltimo; // regressão do relativo: nunca regride
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
  // Relógio audível: mesma leitura de `audio.stats` (sem 2ª chamada nativa
  // por quadro) — `auStats[0]` é `consumidos`, `auStats[3]` a taxa efetiva.
  auAtualizarRelogio(auStats[0], auStats[3] > 0.0 ? auStats[3] : auTaxa);
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

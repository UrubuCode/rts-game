/** @editorOnly */
// Pacote áudio (editor): o comando `audio` do WebSocket — tocar, parar e
// INSPECIONAR o som por número (ganhos, distância, corte, estado, nível e
// mixer), porque a IA não ouve (spec §5). Consultas não empilham Desfazer.
//
// `escuta`/`escuta resultado` (Ruling A7): a IA confere sozinha se o som
// SAIU DE VERDADE pelo alto-falante, sem perguntar ao humano e sem travar o
// motor híbrido (agente + humano na mesma janela) — a captura por loopback
// roda numa thread de guarda do `rts.exe` (`escuta_iniciar`/`escuta_ler`,
// nunca a `escutar` bloqueante), e o comando só faz o polling barato em
// `resultado`.
import { Editor, registerCommand } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import { AudioSource } from "@scripts/audiosource";
import { AudioClip, clipPorId, clipInfo } from "@engine/audio/clip";
import { audioReady, audioRate, audioCanais, audioNulo, audioNivel, vozesTabela, vozIndice, pararTodasSuave,
         activeVoices, audioPicoGrupo, playTone, audioStats } from "@engine/audio/audio";
import { STATS_FLOATS } from "@compat/audio.ts";
import time from "@compat/time.ts";
import { MAX_VOZES, VOZ_FLOATS, V_ESTADO, V_CLIPE, V_POS, V_PITCH, V_DIST, V_ALVO_L, V_ALVO_R, V_CORTE, V_GRUPO,
         V_FONTE, V_FLAGS, ESTADO_LIVRE, FLAG_VIRTUAL, FLAG_CONGELADA } from "@engine/audio/vozes";
import { mixerNGrupos, grupoNome, grupoVolume, grupoMudo, grupoPausa, grupoIndex, ganhoGrupo, mixerSetVolume,
         mixerSetMudo, mixerSetPausa, mixerAlterado, salvarMixer, carregarMixer, MIXER_ARQUIVO } from "@engine/audio/mixer_grupos";
import { origemOuvinte, donoOuvinte, poseOuvinte, OUVINTE_ORIGENS } from "@engine/audio/audio_system";
import { N_PICO_L, N_PICO_R, N_RMS_L, N_RMS_R, N_CORTADAS, NIVEL_FLOATS } from "@engine/audio/mix_desc";
import { escutaDisponivel, escutaIniciar, escutaLer, ESCUTA_CONTINUA_FLOATS } from "@compat/audio.ts";

const AJUDA_AUDIO: string = "audio play <obj> [clip] | stop [<obj>|tudo] | list | mixer [<grupo> <volume>|<grupo> mudo|pausa|salvar|reverter] | listener | clip <caminho> | nivel | escuta [ms] [sonda] | escuta resultado :: toca e inspeciona o som por número (ganhos, corte, estado, nível, mixer e um microfone por loopback), sem depender do humano ouvir :: audio list";
const USO_AUDIO: string = "[erro] audio: uso audio play <obj> [clip] | stop [<obj>|tudo] | list | mixer [...] | listener | clip <caminho> | nivel | escuta [ms] [sonda] | escuta resultado";
const ESTADOS_VOZ: string[] = ["livre", "tocando", "pausada"];
const TIPOS_DISPOSITIVO: string[] = ["real", "nulo"];
const nivelCmd = new Float64Array(NIVEL_FLOATS);
const poseCmd = new Float64Array(8);
const statsCmd = new Float64Array(STATS_FLOATS);
/// Última leitura de `faltas` (underruns totais do nativo) e quando, pra
/// estimar a taxa "no último segundo" em `cmdNivel` sem guardar uma janela
/// deslizante — a IA confere chiado por número sem escutar (CLAUDE.md, Áudio).
let nivelFaltasAntes: f64 = 0.0 - 1.0; // -1: ainda não leu (primeira chamada não estima taxa)
let nivelFaltasAntesTs: number = 0;

/// Frequência da sonda (Ruling A7): 997 Hz, longe de harmônicos comuns de
/// zumbido de rede elétrica (50/60 Hz e múltiplos), mesma escolha do teste
/// real de `rts-audio` (task-A4).
const ESCUTA_SONDA_HZ: f64 = 997.0;
const ESCUTA_SONDA_AMPLITUDE: f64 = 0.05;
const ESCUTA_MS_PADRAO: number = 500;
/// Acima disto a energia da sonda conta como "ouvida" (task-A4: piso de ruído
/// bem abaixo, ~0,3 para uma sonda real de amplitude 0,05 — ver o relatório).
const ESCUTA_LIMIAR_ENERGIA: f64 = 0.01;

function n3(v: f64): string { return v.toFixed(3); }
function n2(v: f64): string { return v.toFixed(2); }

function fonteDe(o: GameObject): AudioSource | null {
  let i = 0;
  while (i < o.behaviors.length) { const b = o.behaviors[i]; if (b instanceof AudioSource) return b as AudioSource; i = i + 1; }
  return null;
}
function nomeDoId(id: number): string {
  const sc = Editor.scene();
  if (sc === null || id < 0) return "-";
  let i = 0;
  while (i < sc.objects.length) { if (sc.objects[i].id === id) return sc.objects[i].name; i = i + 1; }
  return "-";
}
function linhaVoz(vz: Float64Array, v: number): string {
  const b = v * VOZ_FLOATS;
  const c: AudioClip | null = clipPorId(vz[b + V_CLIPE] | 0);
  const flags = vz[b + V_FLAGS] | 0;
  let estado = ESTADOS_VOZ[vz[b + V_ESTADO] | 0];
  if ((flags & FLAG_CONGELADA) !== 0) estado = "congelada";
  else if ((flags & FLAG_VIRTUAL) !== 0) estado = "virtual";
  const taxa: f64 = c !== null ? c.taxa : audioRate();
  return "#" + v + " fonte=" + nomeDoId(vz[b + V_FONTE] | 0) + " clip=" + (c !== null ? c.nome : "-") +
         " grupo=" + grupoNome(vz[b + V_GRUPO] | 0) + " pos=" + n2(vz[b + V_POS] / taxa) + "/" + n2(c !== null ? c.duracao : 0.0) +
         "s pitch=" + n2(vz[b + V_PITCH]) + " dist=" + n2(vz[b + V_DIST]) + " gL=" + n3(vz[b + V_ALVO_L]) +
         " gR=" + n3(vz[b + V_ALVO_R]) + " corte=" + Math.round(vz[b + V_CORTE]) + " estado=" + estado;
}
function linhaGrupo(g: number): string {
  return grupoNome(g) + " vol=" + n2(grupoVolume(g)) + " efetivo=" + n3(ganhoGrupo(g)) + " mudo=" + grupoMudo(g) +
         " pausa=" + grupoPausa(g) + " pico=" + n3(audioPicoGrupo(g));
}
/// "real"/"nulo"/"mudo" — o mesmo trio do `audio listener`, reaproveitado no
/// veredito da escuta (Ruling A7: o loopback não ouve o motor num device nulo).
function tipoDispositivo(): string {
  return audioReady() === 0 ? "mudo" : TIPOS_DISPOSITIVO[audioNulo()];
}

function cmdPlay(p: string[]): string {
  if (p.length < 3) return USO_AUDIO;
  if (audioReady() === 0) return "[erro] audio: sem dispositivo de áudio (o editor está mudo)";
  const o = Editor.object(p[2]);
  if (o === null) return "[erro] audio: objeto '" + p[2] + "' não encontrado";
  const s = fonteDe(o);
  if (s === null) return "[erro] audio: '" + o.name + "' não tem AudioSource";
  if (p.length > 3) { Editor.snapshot("audio clip"); s.clip = p[3]; s.modo = "arquivo"; }
  s.play();
  const v = vozIndice(s.vozPrincipal());
  if (v < 0) return "[erro] audio: não tocou (sem voz livre, ou o clipe não carregou — ver o Console)";
  return "[ok] " + linhaVoz(vozesTabela(), v);
}
function cmdStop(p: string[]): string {
  if (p.length < 3 || p[2] === "tudo") { const n = activeVoices(); pararTodasSuave(); return "[ok] paradas " + n; }
  const o = Editor.object(p[2]);
  if (o === null) return "[erro] audio: objeto '" + p[2] + "' não encontrado";
  const s = fonteDe(o);
  if (s === null) return "[erro] audio: '" + o.name + "' não tem AudioSource";
  s.stop();
  return "[ok] parada a fonte de '" + o.name + "'";
}
function cmdList(): string {
  const vz = vozesTabela();
  let r = "[audio] " + activeVoices() + " vozes";
  let v = 0;
  while (v < MAX_VOZES) { if (vz[v * VOZ_FLOATS + V_ESTADO] !== ESTADO_LIVRE) r = r + "\n" + linhaVoz(vz, v); v = v + 1; }
  return r;
}
function cmdMixer(p: string[]): string {
  if (p.length === 2) {
    let r = "[audio] mixer " + mixerNGrupos() + " grupos" + (mixerAlterado() !== 0 ? " (não salvo)" : "");
    let g = 0;
    while (g < mixerNGrupos()) { r = r + "\n" + linhaGrupo(g); g = g + 1; }
    return r;
  }
  if (p[2] === "salvar") { const e = salvarMixer(MIXER_ARQUIVO); return e === "" ? "[ok] mixer salvo em " + MIXER_ARQUIVO : "[erro] " + e; }
  if (p[2] === "reverter") { const e = carregarMixer(MIXER_ARQUIVO); return e === "" ? "[ok] mixer relido de " + MIXER_ARQUIVO : "[erro] " + e; }
  const g = grupoIndex(p[2]);
  if (g < 0) return "[erro] audio: grupo '" + p[2] + "' não existe";
  if (p.length < 4) return USO_AUDIO;
  if (p[3] === "mudo") { mixerSetMudo(g, grupoMudo(g) !== 0 ? 0 : 1); return "[ok] " + linhaGrupo(g); }
  if (p[3] === "pausa") { mixerSetPausa(g, grupoPausa(g) !== 0 ? 0 : 1); return "[ok] " + linhaGrupo(g); }
  const v = parseFloat(p[3]);
  if (!(v >= 0.0 && v <= 1.0)) return "[erro] audio: volume entre 0 e 1";
  mixerSetVolume(g, v);
  return "[ok] " + linhaGrupo(g);
}
function cmdListener(): string {
  poseOuvinte(poseCmd);
  const dono = donoOuvinte();
  return "[audio] ouvinte origem=" + OUVINTE_ORIGENS[origemOuvinte()] + " dono=" + (dono !== null ? dono.name : "-") +
         " pos=(" + n2(poseCmd[0]) + "," + n2(poseCmd[1]) + "," + n2(poseCmd[2]) + ") yaw=" + n3(poseCmd[3]) +
         " pitch=" + n3(poseCmd[4]) + " vel=(" + n2(poseCmd[5]) + "," + n2(poseCmd[6]) + "," + n2(poseCmd[7]) +
         ") | dispositivo tipo=" + tipoDispositivo() + " taxa=" + audioRate() + " canais=" + audioCanais();
}
function cmdClip(p: string[]): string {
  if (p.length < 3) return USO_AUDIO;
  const c = AudioClip.load(p[2]);
  if (c === null) return "[erro] audio: '" + p[2] + "' não carregou (ver o Console)";
  let s = 0.0; let i = 0;
  while (i < c.amostras.length) { s = s + c.amostras[i] * c.amostras[i]; i = i + 1; }
  const rms: f64 = c.amostras.length > 0 ? Math.sqrt(s / c.amostras.length) : 0.0;
  return "[audio] clip " + c.nome + ": " + clipInfo(c) + " pico=" + n3(c.pico) + " rms=" + n3(rms);
}
/// Taxa de faltas (underruns) por segundo desde a última chamada a `nivel`
/// (aproxima "no último segundo" sem guardar uma janela deslizante).
function faltasPorSegundo(faltasAgora: f64, agoraMs: number): f64 {
  if (nivelFaltasAntes < 0.0 || agoraMs <= nivelFaltasAntesTs) return 0.0;
  const dt = agoraMs - nivelFaltasAntesTs;
  return (faltasAgora - nivelFaltasAntes) * 1000.0 / dt;
}
function cmdNivel(): string {
  audioNivel(nivelCmd);
  const temStats = audioStats(statsCmd) !== 0;
  const faltasAgora: f64 = temStats ? statsCmd[1] : 0.0;
  const agoraMs = time.now_ms();
  const faltasSeg = temStats ? faltasPorSegundo(faltasAgora, agoraMs) : 0.0;
  nivelFaltasAntes = faltasAgora; nivelFaltasAntesTs = agoraMs;
  return "[audio] nivel picoL=" + n3(nivelCmd[N_PICO_L]) + " picoR=" + n3(nivelCmd[N_PICO_R]) + " rmsL=" + n3(nivelCmd[N_RMS_L]) +
         " rmsR=" + n3(nivelCmd[N_RMS_R]) + " cortadas=" + nivelCmd[N_CORTADAS] + " vozes=" + activeVoices() +
         " faltas=" + (temStats ? faltasAgora : "-") + " faltas1s=" + (temStats ? n2(faltasSeg) : "-");
}

// ── escuta (Ruling A7): loopback não bloqueante + sonda opcional ───────────
const escutaOut = new Float64Array(ESCUTA_CONTINUA_FLOATS);
/// 1 entre `escuta_iniciar` e o primeiro `escuta_ler` que devolve 1.
let escutaRodando: number = 0;
/// 1 quando `escutaOut` já tem um resultado pronto (repetir `resultado` devolve o mesmo).
let escutaTemResultado: number = 0;
let escutaComSonda: number = 0;
/// Tipo do dispositivo do MOTOR no instante em que a escuta começou — decide
/// o `sem-dispositivo` no resultado, mesmo que o mixer mude de estado depois.
let escutaTipoNaPartida: string = "";

function cmdEscutaIniciar(p: string[]): string {
  if (!escutaDisponivel()) return "[erro] audio: escuta indisponível (o binário do rts não tem escuta_iniciar/escuta_ler)";
  let ms = ESCUTA_MS_PADRAO;
  let sonda = 0;
  let i = 2;
  if (i < p.length && p[i] !== "sonda") {
    const v = parseFloat(p[i]);
    if (v !== v || v <= 0.0) return "[erro] audio: ms inválido";
    ms = v;
    i = i + 1;
  }
  if (i < p.length && p[i] === "sonda") { sonda = 1; i = i + 1; }
  if (i < p.length) return USO_AUDIO;
  if (sonda !== 0 && audioReady() === 0) return "[erro] audio: sem dispositivo de áudio para tocar a sonda";
  const freqHz: f64 = sonda !== 0 ? ESCUTA_SONDA_HZ : 0.0;
  const ok = escutaIniciar(ms, freqHz);
  if (ok === 0) return "[erro] audio: escuta ocupada (já rodando) ou o dispositivo/plataforma recusou";
  if (sonda !== 0) playTone(ESCUTA_SONDA_HZ, ms / 1000.0, ESCUTA_SONDA_AMPLITUDE);
  escutaComSonda = sonda;
  escutaTipoNaPartida = tipoDispositivo();
  escutaRodando = 1;
  escutaTemResultado = 0;
  return "[ok] escuta iniciada ms=" + ms + " sonda=" + sonda;
}
/// "som"/"silencio" sem sonda; "sonda-ok"/"sonda-ausente" com sonda; e
/// "sem-dispositivo" se o motor tocou a sonda num device nulo/mudo — o
/// loopback ouve a SAÍDA REAL da máquina, não o buffer interno do motor, então
/// uma sonda num device nulo nunca chega ao microfone (task-A4).
function veredictoEscuta(sonda: number, energia: f64, silencio: number): string {
  if (sonda !== 0 && escutaTipoNaPartida !== "real") return "sem-dispositivo";
  if (sonda !== 0) return energia > ESCUTA_LIMIAR_ENERGIA ? "sonda-ok" : "sonda-ausente";
  return silencio !== 0 ? "silencio" : "som";
}
function formatarEscutaResultado(): string {
  const rms = escutaOut[0]; const pico = escutaOut[1]; const silencio = escutaOut[2] | 0;
  const quadros = escutaOut[3] | 0; const taxa = escutaOut[4] | 0; const canais = escutaOut[5] | 0;
  const energia = escutaOut[6]; const underruns = escutaOut[7] | 0;
  const sondaTxt = escutaComSonda !== 0 ? n3(energia) : "-";
  return "[audio] escuta rms=" + n3(rms) + " pico=" + n3(pico) + " silencio=" + silencio + " quadros=" + quadros +
         " taxa=" + taxa + " canais=" + canais + " sonda=" + sondaTxt + " underruns=" + underruns +
         " veredito=" + veredictoEscuta(escutaComSonda, energia, silencio);
}
function cmdEscutaResultado(): string {
  if (!escutaDisponivel()) return "[audio] escuta indisponível (o binário do rts não tem escuta_iniciar/escuta_ler)";
  if (escutaTemResultado === 0) {
    if (escutaRodando === 0) return "[audio] escuta pendente";
    if (escutaLer(escutaOut) === 0) return "[audio] escuta pendente";
    escutaRodando = 0;
    escutaTemResultado = 1;
  }
  return formatarEscutaResultado();
}
function cmdEscuta(p: string[]): string {
  if (p.length > 2 && p[2] === "resultado") return cmdEscutaResultado();
  return cmdEscutaIniciar(p);
}

export function cmdAudio(p: string[]): string {
  const sub = p.length > 1 ? p[1] : "";
  if (sub === "play") return cmdPlay(p);
  if (sub === "stop") return cmdStop(p);
  if (sub === "list") return cmdList();
  if (sub === "mixer") return cmdMixer(p);
  if (sub === "listener") return cmdListener();
  if (sub === "clip") return cmdClip(p);
  if (sub === "nivel") return cmdNivel();
  if (sub === "escuta") return cmdEscuta(p);
  return USO_AUDIO;
}

registerCommand("audio", AJUDA_AUDIO, false, cmdAudio);

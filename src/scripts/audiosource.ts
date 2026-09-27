// AudioSource: o emissor de som preso a um GameObject, no modelo da Unity
// (spec §3.6). Toca um clipe (.wav/.ogg) ou, com `clip` vazio, um tom gerado
// (seno, quadrada, ruído). 2D, 3D ou a mistura (`spatialBlend`), com rolloff por
// fonte e o grupo do mixer.
//
// O SOM vem do mixer (`engine/audio/audio.ts`); a fonte guarda o id da voz e,
// uma vez por quadro (`audioSincronizar`, chamado pelo sistema de áudio),
// empurra a pose, o volume, o pitch e o grupo para ela.
//
// Ciclo: fora do Play as fontes não tocam sozinhas (o editor não chama
// `update`, e `playOnAwake` só vale com a bandeira de jogo ligada); no Play e no
// jogo, `playOnAwake` toca no `mount`.
import { Behavior, KIND_AUDIO, AUDIO_PAPEL_FONTE, FIELD_HINT_ENUM } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { AudioClip, toneClip, clipInfo, FORMAS_TOM } from "@engine/audio/clip";
import { tocarClipe, pararVoz, pausarVoz, vozTocando, vozSegundos, moverVoz, definirVolumeVoz, definirPitchVoz,
         definirGrupoVoz, definirMisturaVoz, audioEmJogo, tocarPrevia, pararPrevia, tocarNoPonto } from "@engine/audio/audio";
import { pedidoPadrao, PEDIDO_VOLUME, PEDIDO_PITCH, PEDIDO_LACO, PEDIDO_GRUPO, PEDIDO_FONTE, PEDIDO_FLAGS,
         PEDIDO_X, PEDIDO_Y, PEDIDO_Z, PEDIDO_BLEND, PEDIDO_MIN, PEDIDO_MAX, PEDIDO_ROLLOFF, PEDIDO_FLOATS,
         FLAG_3D, FLAG_ONESHOT, ROLLOFF_LOG, ROLLOFF_LINEAR } from "@engine/audio/vozes";
import { grupoIndex, mixerVersao, GRUPO_MASTER } from "@engine/audio/mixer_grupos";

export const ROLLOFFS: string[] = ["log", "linear"];
/// Modos do AudioSource (item 1 do brief de áudio-arquivos): "arquivo" toca
/// `clip`; "gerador" é o tom antigo (forma/freq/dur).
export const AS_MODO_ARQUIVO: string = "arquivo";
export const AS_MODO_GERADOR: string = "gerador";
export const MODOS: string[] = [AS_MODO_ARQUIVO, AS_MODO_GERADOR];
const MODOS_ROTULOS: string[] = ["Arquivo", "Gerador (ondas)"];
const AS_DIST_MIN: f64 = 0.01;
const AS_PITCH_MIN: f64 = 0.1;
const AS_PITCH_MAX: f64 = 3.0;
const AS_ROTULO_MODO: string = "Modo";
const AS_ROTULO_ROLLOFF: string = "Rolloff";
const AS_ROTULO_FORMA: string = "Forma do tom";
const AS_ROTULO_TOCAR: string = "Tocar";
const AS_ROTULO_PARAR: string = "Parar";
const AS_SEM_CLIPE: string = "Sem clipe: toca o tom gerado.";
const AS_CLIPE_FALHOU: string = "O clipe não carregou (ver o Console).";
/// ObjectField do campo `clip` (item 2 do brief de áudio-arquivos): tipo
/// mostrado na caixa ("<nome> (AudioClip)"), extensões aceitas e ícone do
/// editor. Constantes de módulo — nada disso é recriado por quadro.
const AS_TIPO_CLIP: string = "AudioClip";
const AS_CLIP_EXTS: string[] = [".wav", ".ogg"];
const AS_CLIP_ICON: string = "audio-fonte";

/// Rascunhos de módulo: nenhuma fonte aloca por quadro nem por disparo.
const asPedido = new Float64Array(PEDIDO_FLOATS);
const asPos = new Float64Array(3);

/**
 * @componentCategory Áudio
 * @componentDescription Toca um clipe (WAV/OGG) ou um tom a partir do objeto, em 2D ou 3D.
 * @componentKeywords audio som fonte musica efeito wav ogg beep
 */
export class AudioSource extends Behavior {
  /**
   * "arquivo" (toca `clip`) ou "gerador" (toca o tom: forma/freq/dur).
   * Padrão "arquivo": atribuir `clip` direto no código (sem passar pelo
   * Inspector) continua tocando esse clipe, como sempre tocou. Quem quer o
   * tom gerado sem um clipe (menu Criar/Áudio/Fonte, os testes do gerador)
   * marca `modo = "gerador"` explicitamente.
   */
  modo: string = AS_MODO_ARQUIVO;
  /** Caminho do .wav/.ogg; vazio = o tom gerado (forma, freq, dur). */
  clip: string = "";
  /** @range 0 1 */
  volume: number = 1.0;
  /** @range 0.1 3 */
  pitch: number = 1.0;
  loop: boolean = false;
  /** @label Tocar ao iniciar */
  playOnAwake: boolean = true;
  mudo: boolean = false;
  /**
   * 0 = 2D (sem posição), 1 = 3D.
   * @label Mistura espacial
   * @range 0 1
   */
  spatialBlend: number = 0.0;
  /** "log" ou "linear". */
  rolloff: string = "log";
  /** @range 0.01 10000 */
  minDistance: number = 1.0;
  /** @range 0.01 10000 */
  maxDistance: number = 500.0;
  /** Grupo do mixer; vazio = Master. */
  grupo: string = "";
  /** Tom gerado quando `clip` está vazio: "seno", "quadrada" ou "ruido". */
  forma: string = "seno";
  /** @range 20 20000 */
  freq: number = 440.0;
  /** @range 0.01 10 */
  dur: number = 0.15;
  /** Repete a cada N segundos (0 = só por play()/playOnAwake). */
  every: number = 0.0;

  /** @nonSerialized */
  private vozId: number = 0;
  /** @nonSerialized */
  private pausada: boolean = false;
  /** @nonSerialized */
  private acumulado: f64 = 0.0;
  /** @nonSerialized */
  private grupoIdx: number = 0;
  /** @nonSerialized */
  private grupoDe: string = "";
  /** @nonSerialized */
  private grupoVersao: number = 0 - 1;
  /** @nonSerialized */
  private infoDe: string = "\u0000";
  /** @nonSerialized */
  private infoRotulo: string = "";

  constructor() { super(); }
  kind(): number { return KIND_AUDIO; }
  audioPapel(): number { return AUDIO_PAPEL_FONTE; }
  fieldHint(i: number): string {
    const n = this.fieldName(i);
    return n === "rolloff" || n === "forma" || n === "modo" ? FIELD_HINT_ENUM : "";
  }
  fieldOptions(i: number): string[] {
    const n = this.fieldName(i);
    if (n === "rolloff") return ROLLOFFS;
    if (n === "forma") return FORMAS_TOM;
    if (n === "modo") return MODOS;
    return super.fieldOptions(i);
  }
  onValidate(field: string): void {
    if (!(this.volume >= 0.0)) this.volume = 0.0;
    if (this.volume > 1.0) this.volume = 1.0;
    if (!(this.pitch >= AS_PITCH_MIN)) this.pitch = AS_PITCH_MIN;
    if (this.pitch > AS_PITCH_MAX) this.pitch = AS_PITCH_MAX;
    if (!(this.spatialBlend >= 0.0)) this.spatialBlend = 0.0;
    if (this.spatialBlend > 1.0) this.spatialBlend = 1.0;
    if (!(this.minDistance >= AS_DIST_MIN)) this.minDistance = AS_DIST_MIN;
    if (!(this.maxDistance > this.minDistance)) this.maxDistance = this.minDistance + 1.0;
    if (ROLLOFFS.indexOf(this.rolloff) < 0) this.rolloff = "log";
    if (FORMAS_TOM.indexOf(this.forma) < 0) this.forma = "seno";
    if (MODOS.indexOf(this.modo) < 0) this.modo = this.clip !== "" ? AS_MODO_ARQUIVO : AS_MODO_GERADOR;
    // ObjectField/soltura (item 2 do brief de áudio-arquivos): escolher um
    // clipe (seletor, arraste de um tile do Project ou atribuição direta)
    // sempre liga o modo Arquivo — como a Unity, escolher o clipe é o que
    // importa; ninguém espera continuar ouvindo o tom gerado depois disso.
    if (field === "clip" && this.clip !== "") this.modo = AS_MODO_ARQUIVO;
  }

  /// Cenas salvas sem `modo` (antes do item 1 do brief de áudio-arquivos):
  /// arquivo se `clip` não vazio, senão gerador. Só entra quando o JSON não
  /// trazia `modo` — não sobrescreve o que já foi restaurado/gravado.
  migrarModo(sd: any): void {
    if (sd.modo !== undefined) return;
    this.modo = this.clip !== "" ? AS_MODO_ARQUIVO : AS_MODO_GERADOR;
  }

  /// O clipe a tocar: o arquivo (da cache) ou o tom gerado (da cache), conforme `modo`.
  private clipAtual(): AudioClip | null {
    if (this.modo === AS_MODO_ARQUIVO) return this.clip !== "" ? AudioClip.load(this.clip) : null;
    const f = FORMAS_TOM.indexOf(this.forma);
    return toneClip(this.freq, this.dur, f >= 0 ? f : 0);
  }
  private resolverGrupo(): number {
    const v = mixerVersao();
    if (this.grupo !== this.grupoDe || v !== this.grupoVersao) {
      const i = this.grupo === "" ? GRUPO_MASTER : grupoIndex(this.grupo);
      this.grupoIdx = i >= 0 ? i : GRUPO_MASTER;
      this.grupoDe = this.grupo; this.grupoVersao = v;
    }
    return this.grupoIdx;
  }
  /// Preenche o pedido de módulo com a pose e os campos desta fonte.
  private preencher(p: Float64Array, volume: f64, laco: boolean): void {
    pedidoPadrao(p);
    p[PEDIDO_VOLUME] = this.mudo ? 0.0 : volume;
    p[PEDIDO_PITCH] = this.pitch;
    p[PEDIDO_LACO] = laco ? 1.0 : 0.0;
    p[PEDIDO_GRUPO] = this.resolverGrupo();
    p[PEDIDO_FONTE] = this.owner !== null ? this.owner.id : 0 - 1;
    p[PEDIDO_FLAGS] = this.spatialBlend > 0.0 ? FLAG_3D : 0;
    p[PEDIDO_X] = this.host.wx; p[PEDIDO_Y] = this.host.wy; p[PEDIDO_Z] = this.host.wz;
    p[PEDIDO_BLEND] = this.spatialBlend; p[PEDIDO_MIN] = this.minDistance; p[PEDIDO_MAX] = this.maxDistance;
    p[PEDIDO_ROLLOFF] = this.rolloff === "linear" ? ROLLOFF_LINEAR : ROLLOFF_LOG;
  }

  play(): void {
    this.stop();
    const c = this.clipAtual();
    if (c === null) return;
    this.preencher(asPedido, this.volume, this.loop);
    this.vozId = tocarClipe(c, asPedido);
    this.pausada = false;
  }
  stop(): void { if (this.vozId !== 0) pararVoz(this.vozId); this.vozId = 0; this.pausada = false; }
  pause(): void { if (this.vozId !== 0) { pausarVoz(this.vozId, 1); this.pausada = true; } }
  unPause(): void { if (this.vozId !== 0) { pausarVoz(this.vozId, 0); this.pausada = false; } }
  isPlaying(): boolean { return this.vozId !== 0 && vozTocando(this.vozId) === 1; }
  get time(): f64 { return this.vozId !== 0 ? vozSegundos(this.vozId) : 0.0; }
  vozPrincipal(): number { return this.vozId; }

  /// Uma voz nova com a pose atual da fonte, sem laço, que não interrompe a principal.
  playOneShot(clip: AudioClip, escala: f64): number {
    this.preencher(asPedido, this.volume * escala, false);
    asPedido[PEDIDO_FLAGS] = asPedido[PEDIDO_FLAGS] + FLAG_ONESHOT;
    return tocarClipe(clip, asPedido);
  }
  /// Um disparo 3D num ponto do mundo, sem fonte (Unity: PlayClipAtPoint).
  static playClipAtPoint(clip: AudioClip, pos: Float64Array, volume: f64): number { return tocarNoPonto(clip, pos, volume); }

  /// Prévia do Inspector: fora do Play, 2D pela voz de prévia; no Play, a própria fonte.
  previa(): number {
    if (audioEmJogo() !== 0) { this.play(); return this.vozId; }
    const c = this.clipAtual();
    return c !== null ? tocarPrevia(c, this.mudo ? 0.0 : this.volume, this.pitch) : 0;
  }

  mount(): void {
    if (this.playOnAwake && audioEmJogo() !== 0) this.play();
  }
  update(dt: f64): void {
    if (this.every <= 0.0) return;
    this.acumulado = this.acumulado + dt;
    if (this.acumulado >= this.every) { this.acumulado = 0.0; this.play(); }
  }

  /// Uma vez por quadro, pelo sistema de áudio.
  audioSincronizar(ativo: number): void {
    if (this.vozId === 0) return;
    if (ativo === 0) { this.stop(); return; }
    if (!this.pausada && vozTocando(this.vozId) === 0) { this.vozId = 0; return; }
    asPos[0] = this.host.wx; asPos[1] = this.host.wy; asPos[2] = this.host.wz;
    moverVoz(this.vozId, asPos);
    definirVolumeVoz(this.vozId, this.mudo ? 0.0 : this.volume);
    definirPitchVoz(this.vozId, this.pitch);
    definirGrupoVoz(this.vozId, this.resolverGrupo());
    definirMisturaVoz(this.vozId, this.spatialBlend);
  }

  /// Campos, o dropdown do rolloff/forma, Tocar/Parar e a linha do clipe.
  onInspectorGUI(ui: InspectorUI): void {
    const m = Math.max(0, MODOS.indexOf(this.modo));
    const nm = ui.dropdown(AS_ROTULO_MODO, MODOS_ROTULOS, m);
    if (nm !== m) this.modo = MODOS[nm];
    const arquivo = this.modo === AS_MODO_ARQUIVO;
    if (arquivo) ui.objectField("clip", AS_TIPO_CLIP, AS_CLIP_EXTS, AS_CLIP_ICON);
    ui.label(this.rotuloInfo());
    ui.field("volume"); ui.field("pitch"); ui.field("loop"); ui.field("playOnAwake"); ui.field("mudo");
    ui.field("spatialBlend");
    if (this.spatialBlend > 0.0) {
      const r = Math.max(0, ROLLOFFS.indexOf(this.rolloff));
      const nr = ui.dropdown(AS_ROTULO_ROLLOFF, ROLLOFFS, r);
      if (nr !== r) this.rolloff = ROLLOFFS[nr];
      ui.field("minDistance"); ui.field("maxDistance");
    }
    ui.field("grupo");
    if (!arquivo) {
      const f = Math.max(0, FORMAS_TOM.indexOf(this.forma));
      const nf = ui.dropdown(AS_ROTULO_FORMA, FORMAS_TOM, f);
      if (nf !== f) this.forma = FORMAS_TOM[nf];
      ui.field("freq"); ui.field("dur");
    }
    ui.field("every");
    if (ui.button(AS_ROTULO_TOCAR)) this.previa();
    if (ui.button(AS_ROTULO_PARAR)) { pararPrevia(); if (audioEmJogo() !== 0) this.stop(); }
  }
  /// "48000 Hz, estéreo, 1,00 s, 375 KB" em modo arquivo (refeito só quando
  /// `clip` muda); em modo gerador é sempre a mensagem do tom, mesmo com um
  /// `clip` guardado (ele fica salvo, mas não tocando — item 1 do brief).
  private rotuloInfo(): string {
    const chave = this.modo === AS_MODO_ARQUIVO ? this.clip : "\u0001";
    if (this.infoDe !== chave) {
      this.infoDe = chave;
      if (this.modo !== AS_MODO_ARQUIVO || this.clip === "") this.infoRotulo = AS_SEM_CLIPE;
      else { const c = AudioClip.load(this.clip); this.infoRotulo = c !== null ? clipInfo(c) : AS_CLIPE_FALHOU; }
    }
    return this.infoRotulo;
  }
}

/// O formato salvo antigo `{type:"audiosource", kind, freq, dur, gain, every}`:
/// `kind` 0/1/2 vira `forma`, `gain` vira `volume`, e `playOnAwake` fica
/// desligado (o antigo só tocava por `play()` ou `every`).
export function audioSourceLegado(sd: any): AudioSource {
  const a = new AudioSource();
  const k = sd.kind !== undefined ? (sd.kind | 0) : 0;
  a.forma = k >= 0 && k < FORMAS_TOM.length ? FORMAS_TOM[k] : "seno";
  if (sd.freq !== undefined) a.freq = sd.freq;
  if (sd.dur !== undefined) a.dur = sd.dur;
  if (sd.gain !== undefined) a.volume = sd.gain;
  if (sd.every !== undefined) a.every = sd.every;
  a.playOnAwake = false;
  a.modo = AS_MODO_GERADOR;
  a.onValidate("");
  return a;
}

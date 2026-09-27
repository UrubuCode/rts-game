// Sistema de áudio por quadro (spec §3.5): resolve o ouvinte da cena,
// sincroniza as fontes e enche o dispositivo. Chamado UMA vez por quadro pelo
// editor (main.ts) e pelo jogo (game.ts), depois do `computeWorld`.
//
// Ordem do ouvinte: AudioListener ativo → Camera.main → pose empurrada
// (`Audio.setListenerPose`, o caso do rts-fps) → pose do editor.
import type { Scene } from "@engine/core/scene";
import { GameObject, activeInScene } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { Camera } from "@engine/core/camera";
import { AUDIO_PAPEL_OUVINTE, AUDIO_PAPEL_FONTE } from "@engine/core/behavior";
import { logWarn } from "@engine/core/logger";
import { setListener } from "./spatial";
import { pumpAudio, tocarClipe, tocarNoPonto, tempoDsp as auTempoDsp, amostrasDsp as auAmostrasDsp,
         agendarEm as auAgendarEm, latenciaCalibradaMs as auLatenciaCalibradaMs,
         definirLatenciaCalibradaMs as auDefinirLatenciaCalibradaMs } from "./audio";
import { AudioClip } from "./clip";

export const OUVINTE_NENHUM: number = 0;
export const OUVINTE_COMPONENTE: number = 1;
export const OUVINTE_CAMERA: number = 2;
export const OUVINTE_EMPURRADO: number = 3;
export const OUVINTE_EDITOR: number = 4;
export const OUVINTE_ORIGENS: string[] = ["nenhum", "componente", "Camera.main", "pose empurrada", "editor"];
export const AVISO_DOIS_OUVINTES: string = "Áudio: há mais de um AudioListener ativo na cena; vale o primeiro (como na Unity).";
const AUS_POSE_FLOATS: number = 8;
const AUS_POSE_BASICA: number = 5;

const ausPose = new Float64Array(AUS_POSE_FLOATS);
const ausAntes = new Float64Array(3);
let ausTemAntes: number = 0;
let ausOrigemAntes: number = 0;
const ausEmpurrada = new Float64Array(AUS_POSE_BASICA);
let ausTemEmpurrada: number = 0;
const ausEditor = new Float64Array(AUS_POSE_BASICA);
let ausTemEditor: number = 0;
let ausOrigem: number = 0;
let ausAvisou: number = 0;
let ausDono: GameObject | null = null;

/// `[x, y, z, yaw, pitch]` de quem desenha sem componente Camera (rts-fps).
export function definirPoseEmpurrada(pose: Float64Array): void {
  let i = 0; while (i < AUS_POSE_BASICA) { ausEmpurrada[i] = pose[i]; i = i + 1; }
  ausTemEmpurrada = 1;
}
/// A vista do editor (e a câmera livre do jogo sem câmera): o último recurso.
export function definirPoseEditor(pose: Float64Array): void {
  let i = 0; while (i < AUS_POSE_BASICA) { ausEditor[i] = pose[i]; i = i + 1; }
  ausTemEditor = 1;
}
/// Zera TODO o estado de módulo do ouvinte: as poses empurrada/editor, a
/// velocidade derivada (`ausTemAntes`/`ausOrigemAntes`), o aviso de "dois
/// ouvintes" (`ausAvisou`) e quem é o dono resolvido (`ausDono`) — usado entre
/// cenas de teste para um `resolverOuvinte` não herdar nada da cena anterior.
export function limparPosesAudio(): void {
  ausTemEmpurrada = 0; ausTemEditor = 0; ausTemAntes = 0; ausOrigemAntes = 0; ausAvisou = 0; ausDono = null;
}
export function origemOuvinte(): number { return ausOrigem; }
export function donoOuvinte(): GameObject | null { return ausDono; }
export function poseOuvinte(out: Float64Array): void { let i = 0; while (i < AUS_POSE_FLOATS) { out[i] = ausPose[i]; i = i + 1; } }

function ausDeTransform(t: Transform): void {
  ausPose[0] = t.wx; ausPose[1] = t.wy; ausPose[2] = t.wz; ausPose[3] = t.wry; ausPose[4] = t.wrx;
}
function ausDe(p: Float64Array): void {
  let i = 0; while (i < AUS_POSE_BASICA) { ausPose[i] = p[i]; i = i + 1; }
}

function ausAcharOuvinte(sc: Scene): GameObject | null {
  let achado: GameObject | null = null;
  let n = 0;
  const objs: GameObject[] = sc.audioObjs;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (activeInScene(sc.objects, o)) {
      let k = 0;
      while (k < o.behaviors.length) {
        const b = o.behaviors[k];
        if (b.enabled !== 0 && b.audioPapel() === AUDIO_PAPEL_OUVINTE) { n = n + 1; if (achado === null) achado = o; break; }
        k = k + 1;
      }
    }
    i = i + 1;
  }
  if (n > 1) { if (ausAvisou === 0) { logWarn(AVISO_DOIS_OUVINTES); ausAvisou = 1; } }
  else ausAvisou = 0;
  return achado;
}

/// Resolve o ouvinte do quadro, deriva a velocidade e chama `setListener`.
export function resolverOuvinte(sc: Scene, dts: f64): number {
  let origem = OUVINTE_NENHUM;
  const o = ausAcharOuvinte(sc);
  ausDono = o;
  if (o !== null) { ausDeTransform(o.transform); origem = OUVINTE_COMPONENTE; }
  else {
    const cam = Camera.main();
    if (cam !== null && cam.owner !== null) { ausDeTransform(cam.owner.transform); ausDono = cam.owner; origem = OUVINTE_CAMERA; }
    else if (ausTemEmpurrada !== 0) { ausDe(ausEmpurrada); origem = OUVINTE_EMPURRADO; }
    else if (ausTemEditor !== 0) { ausDe(ausEditor); origem = OUVINTE_EDITOR; }
    else { let i = 0; while (i < AUS_POSE_BASICA) { ausPose[i] = 0.0; i = i + 1; } }
  }
  if (ausTemAntes !== 0 && origem === ausOrigemAntes && dts > 0.0) {
    ausPose[5] = (ausPose[0] - ausAntes[0]) / dts; ausPose[6] = (ausPose[1] - ausAntes[1]) / dts; ausPose[7] = (ausPose[2] - ausAntes[2]) / dts;
  } else { ausPose[5] = 0.0; ausPose[6] = 0.0; ausPose[7] = 0.0; }
  ausAntes[0] = ausPose[0]; ausAntes[1] = ausPose[1]; ausAntes[2] = ausPose[2];
  ausTemAntes = 1; ausOrigemAntes = origem; ausOrigem = origem;
  setListener(ausPose);
  return origem;
}

/// Cada fonte empurra a pose para as próprias vozes (ou para, se desligada).
export function sincronizarFontes(sc: Scene): void {
  const objs: GameObject[] = sc.audioObjs;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    const ativo = activeInScene(sc.objects, o) ? 1 : 0;
    let k = 0;
    while (k < o.behaviors.length) {
      const b = o.behaviors[k];
      if (b.audioPapel() === AUDIO_PAPEL_FONTE) b.audioSincronizar(ativo !== 0 && b.enabled !== 0 ? 1 : 0);
      k = k + 1;
    }
    i = i + 1;
  }
}

/// O quadro de áudio: ouvinte, fontes, pump.
export function audioQuadro(sc: Scene, dts: f64): number {
  resolverOuvinte(sc, dts);
  sincronizarFontes(sc);
  return pumpAudio();
}

/// Fachada no molde da Unity para quem não usa componentes (rts-fps).
export class Audio {
  static setListenerPose(pose: Float64Array): void { definirPoseEmpurrada(pose); }
  static play(clip: AudioClip, pedido: Float64Array): number { return tocarClipe(clip, pedido); }
  static playClipAtPoint(clip: AudioClip, pos: Float64Array, volume: f64): number { return tocarNoPonto(clip, pos, volume); }
  /// Equivalente a `AudioSettings.dspTime` da Unity: segundos desde a
  /// abertura do dispositivo, AUDÍVEIS (o que sai no alto-falante agora), não
  /// a posição mixada de `AudioSource.time`/`vozSegundos` — ver a nota
  /// "relógio DSP (ritmo)" em `engine/audio/audio.ts`. Sincronize ritmo/música
  /// nisto, nunca no tempo de quadro (`dt`/`update`).
  static tempoDsp(): f64 { return auTempoDsp(); }
  /// O mesmo, em quadros (amostras) na taxa do dispositivo.
  static amostrasDsp(): f64 { return auAmostrasDsp(); }
  /// Unity `AudioSource.PlayScheduled`: agenda `clip` pra tocar com a 1ª
  /// amostra audível exatamente em `alvo` (segundos, régua de
  /// `Audio.tempoDsp()`), sample-accurate. `pedido` opcional (`tocarClipe`
  /// padrão senão).
  static agendarEm(clip: AudioClip, alvo: f64, pedido?: Float64Array): number { return auAgendarEm(clip, alvo, pedido); }
  /// Offset de calibração do usuário (ms) — ver `latenciaCalibradaMs`/
  /// `definirLatenciaCalibradaMs` em `engine/audio/audio.ts`.
  static get latenciaCalibrada(): f64 { return auLatenciaCalibradaMs(); }
  static set latenciaCalibrada(ms: f64) { auDefinirLatenciaCalibradaMs(ms); }
}

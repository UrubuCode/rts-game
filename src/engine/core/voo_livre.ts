// Voo livre do JOGO exportado (game.ts): WASD anda pelo eixo da vista, setas e
// botão direito giram, espaço sobe — os mesmos controles da viewport do editor.
// Move o transform da câmera Main ou, sem câmera na cena, a pose da sessão.
// Uma câmera com um controle por script (`Behavior.controlaCamera()`, p.ex. o
// pacote camera/) fica só com esse controle: os dois juntos dobram o movimento.
import math from "@compat/math.ts";
import { GameObject } from "./gameobject";
import { TECLA_W, TECLA_S, TECLA_A, TECLA_D, TECLA_ESPACO, TECLA_CIMA, TECLA_BAIXO,
         TECLA_ESQUERDA, TECLA_DIREITA, BOTAO_DIREITO, teclaSegurada, mouseSegurado,
         mouseDX, mouseDY } from "./entrada";

/// Unidades de mundo por segundo.
export const VOO_VELOCIDADE: number = 6.0;
/// Radianos por segundo com as setas.
export const VOO_GIRO_TECLAS: number = 1.6;
/// Radianos por pixel de mouse (botão direito).
export const VOO_SENSIBILIDADE_MOUSE: number = 0.005;
/// Pitch máximo, em radianos (±80°).
export const VOO_PITCH_LIMITE: number = 1.4;
/// Índices de `pose` = [x, y, z, yaw, pitch].
export const VOO_POSE_FLOATS: number = 5;

/// 1 se algum componente ativo do objeto controla a câmera por script.
export function cameraControladaPorScript(go: GameObject): boolean {
  const bs = go.behaviors;
  let i = 0;
  while (i < bs.length) {
    const b = bs[i];
    if (b.enabled !== 0 && b.controlaCamera() !== 0) return true;
    i = i + 1;
  }
  return false;
}

/// Aplica a entrada do quadro a `pose` = [x, y, z, yaw, pitch].
export function vooLivre(pose: Float64Array, dts: f64): void {
  let yaw = pose[3]; let pitch = pose[4];
  const giro = VOO_GIRO_TECLAS * dts;
  if (teclaSegurada(TECLA_ESQUERDA)) yaw = yaw - giro;
  if (teclaSegurada(TECLA_DIREITA)) yaw = yaw + giro;
  if (teclaSegurada(TECLA_CIMA)) pitch = pitch - giro;
  if (teclaSegurada(TECLA_BAIXO)) pitch = pitch + giro;
  if (mouseSegurado(BOTAO_DIREITO)) {
    yaw = yaw + mouseDX() * VOO_SENSIBILIDADE_MOUSE;
    pitch = pitch - mouseDY() * VOO_SENSIBILIDADE_MOUSE;
  }
  if (pitch > VOO_PITCH_LIMITE) pitch = VOO_PITCH_LIMITE;
  if (pitch < 0.0 - VOO_PITCH_LIMITE) pitch = 0.0 - VOO_PITCH_LIMITE;
  const cyw = math.cos(yaw); const syw = math.sin(yaw);
  const cp = math.cos(pitch); const sp = math.sin(pitch);
  const passo = VOO_VELOCIDADE * dts;
  const fx = syw * cp; const fy = sp; const fz = cyw * cp;
  const rx = cyw; const rz = 0.0 - syw;
  let x = pose[0]; let y = pose[1]; let z = pose[2];
  if (teclaSegurada(TECLA_W)) { x = x + fx * passo; y = y + fy * passo; z = z + fz * passo; }
  if (teclaSegurada(TECLA_S)) { x = x - fx * passo; y = y - fy * passo; z = z - fz * passo; }
  if (teclaSegurada(TECLA_D)) { x = x + rx * passo; z = z + rz * passo; }
  if (teclaSegurada(TECLA_A)) { x = x - rx * passo; z = z - rz * passo; }
  if (teclaSegurada(TECLA_ESPACO)) y = y + passo;
  pose[0] = x; pose[1] = y; pose[2] = z; pose[3] = yaw; pose[4] = pitch;
}

/// O voo do quadro: no transform de `camGo` (a Main), a menos que um script já
/// a controle; sem câmera (`camGo` null), em `poseSessao`. Chamar antes de
/// `scene.update`, como o game.ts.
export function vooDoJogo(camGo: GameObject | null, poseSessao: Float64Array, dts: f64): void {
  if (camGo === null) { vooLivre(poseSessao, dts); return; }
  if (cameraControladaPorScript(camGo)) return;
  const t = camGo.transform;
  const p = poseCamera;
  p[0] = t.px; p[1] = t.py; p[2] = t.pz; p[3] = t.ry; p[4] = t.rx;
  vooLivre(p, dts);
  t.px = p[0]; t.py = p[1]; t.pz = p[2]; t.ry = p[3]; t.rx = p[4];
}
const poseCamera = new Float64Array(VOO_POSE_FLOATS);

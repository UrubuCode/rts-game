// Matemática pura dos controles de câmera (testável sem janela). Convenção do
// renderer: fwd = (sin yaw·cos p, sin p, cos yaw·cos p), pitch > 0 olha para cima.
import math from "@compat/math.ts";
export const PITCH_LIMITE_FPS: number = 1.5533430342749532;   // 89°
/// Tempo de suavização mínimo aceito (evita divisão por zero).
const TEMPO_MIN: number = 0.0001;
/// ang = [yaw, pitch]; dx/dy em pixels; sens em radianos por pixel. Pitch preso em ±89°.
export function olharFps(ang: Float64Array, dx: number, dy: number, sens: number): void {
  ang[0] = ang[0] + dx * sens;
  const p = ang[1] - dy * sens;
  ang[1] = p > PITCH_LIMITE_FPS ? PITCH_LIMITE_FPS : (p < 0.0 - PITCH_LIMITE_FPS ? 0.0 - PITCH_LIMITE_FPS : p);
}
/// alvo = [x, y, z]; ang = [yaw, pitch, distância] → out = [x, y, z, yaw, pitch] da câmera mirando o alvo.
export function orbitaPose(alvo: Float64Array, ang: Float64Array, out: Float64Array): void {
  const cy = math.cos(ang[0]); const sy = math.sin(ang[0]); const cp = math.cos(ang[1]); const sp = math.sin(ang[1]);
  out[0] = alvo[0] - sy * cp * ang[2]; out[1] = alvo[1] - sp * ang[2]; out[2] = alvo[2] - cy * cp * ang[2];
  out[3] = ang[0]; out[4] = ang[1];
}
/// Amortecimento crítico (SmoothDamp) do eixo i: est = [pos0, vel0, pos1, vel1, pos2, vel2],
/// cfg = [tempo de suavização, dt]. Nunca ultrapassa o alvo.
export function amortecerCritico(est: Float64Array, i: number, alvo: number, cfg: Float64Array): void {
  const tempo = cfg[0] > TEMPO_MIN ? cfg[0] : TEMPO_MIN;
  const dt = cfg[1];
  const omega = 2.0 / tempo; const x = omega * dt;
  const fator = 1.0 / (1.0 + x + 0.48 * x * x + 0.235 * x * x * x);
  const atual = est[i * 2]; const vel = est[i * 2 + 1];
  const mudanca = atual - alvo;
  const temp = (vel + omega * mudanca) * dt;
  let novaVel = (vel - omega * temp) * fator;
  let saida = alvo + (mudanca + temp) * fator;
  if ((alvo - atual > 0.0) === (saida > alvo)) { saida = alvo; novaVel = 0.0; }
  est[i * 2] = saida; est[i * 2 + 1] = novaVel;
}
/// Soma `delta` e prende em [min, max]; limites trocados são aceitos.
export function limitarZoom(atual: number, delta: number, min: number, max: number): number {
  const lo = min < max ? min : max; const hi = min < max ? max : min;
  const z = atual + delta;
  return z < lo ? lo : (z > hi ? hi : z);
}

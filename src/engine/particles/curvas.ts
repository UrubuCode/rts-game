// Gradiente de cor (2-4 chaves, RGBA) e curva de tamanho (2-4 chaves) sobre o
// tempo de vida normalizado [0,1] — interpolação LINEAR entre chaves
// vizinhas, sem tangente Bézier (fora de escopo, spec §8). Sem alocação: os
// buffers de chaves (Float64Array) são do chamador, o `out` do gradiente
// também.
import { PoolParticulas } from "./sim";
import { P_VX, P_VY, P_VZ, P_VIDA, P_FLOATS } from "./desc";

/// Amostra o gradiente de cor em `t` (tempo de vida normalizado) e escreve
/// RGBA em `out`. `chaves`: [tempo0,r0,g0,b0,a0, tempo1,r1,g1,b1,a1, …], até
/// 4 chaves. 4 parâmetros (limite do RTS por quadro).
export function avaliarGradiente(chaves: Float64Array, nChaves: number, t: f64, out: Float64Array): void {
  if (nChaves <= 1) { out[0] = chaves[1]; out[1] = chaves[2]; out[2] = chaves[3]; out[3] = chaves[4]; return; }
  let i = 0;
  while (i < nChaves - 1 && chaves[(i + 1) * 5] < t) i = i + 1;
  if (i >= nChaves - 1) i = nChaves - 2;
  const t0 = chaves[i * 5]; const t1 = chaves[(i + 1) * 5];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  let c = 0;
  while (c < 4) { out[c] = chaves[i * 5 + 1 + c] + (chaves[(i + 1) * 5 + 1 + c] - chaves[i * 5 + 1 + c]) * f; c = c + 1; }
}

/// Amostra a curva escalar (tamanho, etc.) em `t`. `chaves`:
/// [tempo0,valor0, tempo1,valor1, …], até 4 chaves. 3 parâmetros.
export function avaliarCurva(chaves: Float64Array, nChaves: number, t: f64): f64 {
  if (nChaves <= 1) return chaves[1];
  let i = 0;
  while (i < nChaves - 1 && chaves[(i + 1) * 2] < t) i = i + 1;
  if (i >= nChaves - 1) i = nChaves - 2;
  const t0 = chaves[i * 2]; const t1 = chaves[(i + 1) * 2];
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0.0;
  return chaves[i * 2 + 1] + (chaves[(i + 1) * 2 + 1] - chaves[i * 2 + 1]) * f;
}

/// Soma o vento constante e aplica o arrasto exponencial a TODAS as
/// partículas vivas do pool. 4 parâmetros (pool, vento, arrasto, dt).
export function aplicarVelocidade(pool: PoolParticulas, ventoXYZ: Float64Array, arrasto: f64, dt: f64): void {
  const fArrasto = 1.0 - arrasto * dt;
  let slot = 0;
  while (slot < pool.max) {
    const k = slot * P_FLOATS;
    if (pool.dados[k + P_VIDA] > 0.0) {
      pool.dados[k + P_VX] = (pool.dados[k + P_VX] + ventoXYZ[0] * dt) * fArrasto;
      pool.dados[k + P_VY] = (pool.dados[k + P_VY] + ventoXYZ[1] * dt) * fArrasto;
      pool.dados[k + P_VZ] = (pool.dados[k + P_VZ] + ventoXYZ[2] * dt) * fArrasto;
    }
    slot = slot + 1;
  }
}

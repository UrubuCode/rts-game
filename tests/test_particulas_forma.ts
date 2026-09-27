// Testa as formas do emissor (esfera, cone, caixa) e o determinismo do
// gerador aleatório: 10 000 amostras de cada forma via emitirN, checando os
// limites geométricos, e duas rodadas com a mesma semente fixada produzindo
// exatamente a mesma sequência de posições/velocidades no pool.
import { criarPool, emitirN } from "@engine/particles/sim";
import { FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA,
         D_FORMA, D_RAIO, D_ANGULO, D_CAIXA_X, D_CAIXA_Y, D_CAIXA_Z, D_VEL_MIN, D_VEL_MAX, D_VIDA_MIN, D_VIDA_MAX,
         P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_FLOATS } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import process from "@compat/process.ts";

const N = 10000;

function falhar(msg: string): void { console.log("[FALHOU] " + msg); process.exit(1); }

// ── esfera: todo ponto tem |p| <= raio + 1e-9 ───────────────────────────────
{
  fixarSementeAleatorio(1);
  const raio = 5.0;
  const pool = criarPool(N);
  const desc = new Float64Array(16);
  desc[D_FORMA] = FORMA_ESFERA; desc[D_RAIO] = raio;
  desc[D_VEL_MIN] = 1.0; desc[D_VEL_MAX] = 2.0;
  desc[D_VIDA_MIN] = 1.0; desc[D_VIDA_MAX] = 1.0;
  emitirN(pool, desc, N);
  let slot = 0;
  while (slot < N) {
    const k = slot * P_FLOATS;
    const x = pool.dados[k + P_X]; const y = pool.dados[k + P_Y]; const z = pool.dados[k + P_Z];
    const dist = Math.sqrt(x * x + y * y + z * z);
    if (dist > raio + 1e-9) { falhar("esfera: ponto fora do raio, dist=" + dist); }
    slot = slot + 1;
  }
}

// ── cone: toda velocidade tem ângulo com +Y <= angulo/2 + 1e-6 ─────────────
{
  fixarSementeAleatorio(2);
  const anguloGraus = 30.0;
  const meiaAnguloRad = anguloGraus * 0.5 * 0.017453292519943295;
  const pool = criarPool(N);
  const desc = new Float64Array(16);
  desc[D_FORMA] = FORMA_CONE; desc[D_ANGULO] = anguloGraus;
  desc[D_VEL_MIN] = 3.0; desc[D_VEL_MAX] = 3.0;
  desc[D_VIDA_MIN] = 1.0; desc[D_VIDA_MAX] = 1.0;
  emitirN(pool, desc, N);
  let slot = 0;
  while (slot < N) {
    const k = slot * P_FLOATS;
    const vx = pool.dados[k + P_VX]; const vy = pool.dados[k + P_VY]; const vz = pool.dados[k + P_VZ];
    const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const cosTheta = vy / mag;
    const theta = Math.acos(Math.min(1.0, Math.max(-1.0, cosTheta)));
    if (theta > meiaAnguloRad + 1e-6) { falhar("cone: ângulo fora do limite, theta=" + theta); }
    slot = slot + 1;
  }
}

// ── caixa: todo ponto tem |x|<=largura/2, |y|<=altura/2, |z|<=profund/2 ────
{
  fixarSementeAleatorio(3);
  const lx = 4.0; const ly = 2.0; const lz = 6.0;
  const pool = criarPool(N);
  const desc = new Float64Array(16);
  desc[D_FORMA] = FORMA_CAIXA; desc[D_CAIXA_X] = lx; desc[D_CAIXA_Y] = ly; desc[D_CAIXA_Z] = lz;
  desc[D_VEL_MIN] = 1.0; desc[D_VEL_MAX] = 2.0;
  desc[D_VIDA_MIN] = 1.0; desc[D_VIDA_MAX] = 1.0;
  emitirN(pool, desc, N);
  let slot = 0;
  while (slot < N) {
    const k = slot * P_FLOATS;
    const x = pool.dados[k + P_X]; const y = pool.dados[k + P_Y]; const z = pool.dados[k + P_Z];
    if (Math.abs(x) > lx * 0.5 + 1e-9) { falhar("caixa: x fora do limite, x=" + x); }
    if (Math.abs(y) > ly * 0.5 + 1e-9) { falhar("caixa: y fora do limite, y=" + y); }
    if (Math.abs(z) > lz * 0.5 + 1e-9) { falhar("caixa: z fora do limite, z=" + z); }
    slot = slot + 1;
  }
}

// ── determinismo: mesma semente fixada, duas rodadas, mesma sequência ─────
{
  const desc = new Float64Array(16);
  desc[D_FORMA] = FORMA_ESFERA; desc[D_RAIO] = 3.0;
  desc[D_VEL_MIN] = 1.0; desc[D_VEL_MAX] = 5.0;
  desc[D_VIDA_MIN] = 1.0; desc[D_VIDA_MAX] = 1.0;

  fixarSementeAleatorio(777);
  const poolA = criarPool(N);
  emitirN(poolA, desc, N);

  fixarSementeAleatorio(777);
  const poolB = criarPool(N);
  emitirN(poolB, desc, N);

  const total = N * P_FLOATS;
  let idx = 0;
  while (idx < total) {
    if (poolA.dados[idx] !== poolB.dados[idx]) {
      falhar("determinismo: pools divergem no índice " + idx + " (" + poolA.dados[idx] + " != " + poolB.dados[idx] + ")");
    }
    idx = idx + 1;
  }
}

console.log("[PASSOU] test_particulas_forma");

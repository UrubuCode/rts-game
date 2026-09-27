import { avaliarGradiente, avaliarCurva, aplicarVelocidade } from "@engine/particles/curvas";
import { criarPool, emitirN } from "@engine/particles/sim";
import { FORMA_PONTO, D_VEL_MIN, D_VEL_MAX, D_VIDA_MIN, D_VIDA_MAX, P_VX, P_VY, P_VZ, P_FLOATS } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import process from "@compat/process.ts";

function assertClose(msg: string, a: f64, b: f64): void {
  if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); }
}

// gradiente com 2 chaves: branco opaco em t=0, vermelho transparente em t=1.
const grad = new Float64Array([0.0, 1.0, 1.0, 1.0, 1.0,  1.0, 1.0, 0.0, 0.0, 0.0]);
const out = new Float64Array(4);
avaliarGradiente(grad, 2, 0.0, out); assertClose("r em t=0", out[0], 1.0); assertClose("a em t=0", out[3], 1.0);
avaliarGradiente(grad, 2, 1.0, out); assertClose("g em t=1", out[1], 0.0); assertClose("a em t=1", out[3], 0.0);
avaliarGradiente(grad, 2, 0.5, out); assertClose("a no meio", out[3], 0.5);

// curva de tamanho com 3 chaves: cresce até o meio, encolhe até o fim.
const tam = new Float64Array([0.0, 0.0,  0.5, 1.0,  1.0, 0.0]);
assertClose("tamanho em t=0.25 (meio de 0→1)", avaliarCurva(tam, 3, 0.25), 0.5);
assertClose("tamanho no pico", avaliarCurva(tam, 3, 0.5), 1.0);
assertClose("tamanho no fim", avaliarCurva(tam, 3, 1.0), 0.0);

// gradiente/curva com 1 chave: retorna a chave, sem NaN.
const grad1 = new Float64Array([0.3, 0.2, 0.4, 0.6, 0.8]);
avaliarGradiente(grad1, 1, 0.9, out);
assertClose("gradiente 1 chave: r", out[0], 0.2); assertClose("gradiente 1 chave: a", out[3], 0.8);
const tam1 = new Float64Array([0.5, 2.0]);
assertClose("curva 1 chave", avaliarCurva(tam1, 1, 0.1), 2.0);

// chaves com tempo duplicado: sem NaN, cai na chave da esquerda (f=0 no ramo ternário).
const gradDup = new Float64Array([0.0, 1.0, 0.0, 0.0, 1.0,  0.5, 1.0, 0.0, 0.0, 1.0,  0.5, 0.0, 1.0, 0.0, 0.5]);
avaliarGradiente(gradDup, 3, 0.6, out); // t>0.5 força cair no segmento duplicado (chave1→chave2, ambas t=0.5)
if (out[0] !== out[0] || out[1] !== out[1] || out[2] !== out[2] || out[3] !== out[3]) { console.log("[FALHOU] gradiente com tempos duplicados gerou NaN"); process.exit(1); }
const tamDup = new Float64Array([0.0, 0.0,  0.5, 1.0,  0.5, 2.0]);
const vDup = avaliarCurva(tamDup, 3, 0.6); // mesmo raciocínio
if (vDup !== vDup) { console.log("[FALHOU] curva com tempos duplicados gerou NaN"); process.exit(1); }

// aplicarVelocidade com dt grande (Fix round 1, ruling P2): arrasto=5, dt=1 —
// `1 - arrasto*dt` daria -4 (inverteria o sinal); exp(-arrasto*dt) só decai
// em direção a 0, sem cruzar zero.
{
  fixarSementeAleatorio(99);
  const pool = criarPool(10);
  const desc = new Float64Array(16);
  desc[0] = FORMA_PONTO; desc[D_VEL_MIN] = 3.0; desc[D_VEL_MAX] = 3.0; desc[D_VIDA_MIN] = 100.0; desc[D_VIDA_MAX] = 100.0;
  emitirN(pool, desc, 10);
  const semVento = new Float64Array([0.0, 0.0, 0.0]);
  let slot = 0;
  while (slot < 10) {
    const k = slot * P_FLOATS;
    const vxAntes = pool.dados[k + P_VX]; const vyAntes = pool.dados[k + P_VY]; const vzAntes = pool.dados[k + P_VZ];
    aplicarVelocidade(pool, semVento, 5.0, 1.0);
    const vxDepois = pool.dados[k + P_VX];
    // decai em direção a 0 sem inverter o sinal (mesmo sinal ou zero, e |depois| < |antes|).
    if (vxAntes !== 0.0 && Math.sign(vxDepois) !== 0.0 && Math.sign(vxDepois) !== Math.sign(vxAntes)) {
      console.log("[FALHOU] arrasto com dt grande inverteu o sinal da velocidade: antes=" + vxAntes + " depois=" + vxDepois);
      process.exit(1);
    }
    if (Math.abs(vxDepois) >= Math.abs(vxAntes) + 1e-9 && vxAntes !== 0.0) {
      console.log("[FALHOU] arrasto com dt grande não reduziu a velocidade: antes=" + vxAntes + " depois=" + vxDepois);
      process.exit(1);
    }
    slot = slot + 1;
  }
  // arrasto muito grande por vários quadros: velocidade tende a 0, nunca oscila.
  let v = 0;
  while (v < 20) { aplicarVelocidade(pool, semVento, 5.0, 1.0); v = v + 1; }
  assertClose("arrasto extremo converge para 0", pool.dados[0 * P_FLOATS + P_VX], 0.0);
}

console.log("[PASSOU] test_particulas_curvas");

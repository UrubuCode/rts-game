import { avaliarGradiente, avaliarCurva } from "@engine/particles/curvas";
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

console.log("[PASSOU] test_particulas_curvas");

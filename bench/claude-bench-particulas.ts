// Bench do caminho por quadro do ParticleSystem: `update(dt)` + `drawSelf`
// (sem o tempo de GPU — sem `drawParticles` nativo neste binário, o desenho
// vira só o preenchimento do buffer de instância + o corte de frustum, que é
// exatamente o trabalho de CPU que o portão mede) para 1 000, 5 000 e 10 000
// partículas vivas, e também `sort=1` (modo alfa, back-to-front) a 1 000 e
// 10 000 — pedido extra do controlador da Task 11, além do brief original.
// Portão (spec/plano): 10 000 partículas, sort=0, ≤ 1 ms por quadro.
//
//   node --expose-gc bench/claude-bench-particulas.ts
//   $RTS run bench/claude-bench-particulas.ts   (roda igual, sem --expose-gc)
import io from "@compat/io.ts";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { temParticlesStep, aguardarParticlesStep } from "@compat/particles";

const AQUECE = 200;
const REPS = 200;
const pos = new Float64Array([0.0, 0.0, 0.0]);
const META_MS_10K: f64 = 1.0;

function construir(max: number, sort: number, modo: number): ParticleSystem {
  const ps = new ParticleSystem();
  ps.maxParticles = max;
  ps.forma = FORMA_ESFERA; ps.raio = 5.0;
  // rateOverTime bem acima do que os slots comportam por segundo: satura o
  // pool (vivas≈max) já no aquecimento — o pior caso real de um efeito
  // "sempre cheio", não uma rampa de enchimento medida por acidente.
  ps.rateOverTime = max * 20.0;
  ps.startLifetimeMin = 0.5; ps.startLifetimeMax = 1.5;
  ps.startSpeedMin = 0.5; ps.startSpeedMax = 2.0;
  ps.startSizeMin = 0.05; ps.startSizeMax = 0.15;
  ps.ventoX = 0.2; ps.ventoY = 0.1; ps.ventoZ = -0.1; ps.arrasto = 0.3;
  ps.sort = sort; ps.modo = modo;
  ps.play();
  let w = 0;
  while (w < AQUECE) { ps.update(1.0 / 60.0); w = w + 1; }
  return ps;
}
/// ms/quadro médio de `REPS` chamadas de `update`+`drawSelf`, depois de mais
/// um aquecimento curto (JIT/caches, à parte do aquecimento que enche o pool).
function medir(ps: ParticleSystem): f64 {
  let k = 0;
  while (k < 20) { ps.update(1.0 / 60.0); ps.drawSelf(0, pos, 0.0 - 1.0); k = k + 1; }
  const t0 = Date.now();
  let r = 0;
  while (r < REPS) { ps.update(1.0 / 60.0); ps.drawSelf(0, pos, 0.0 - 1.0); r = r + 1; }
  return (Date.now() - t0) / REPS;
}

async function main(): Promise<void> {
// `temParticlesStep()` depende de um `import()` dinâmico assíncrono
// (`rts:particles` pode não existir em binários sem o PR #2831 — ver
// `compat/particles.ts`). Este bench roda como UM script síncrono do início
// ao fim (sem nenhuma volta ao host entre chamadas), então sem este `await`
// explícito no topo a promise nunca teria a chance de resolver e o caminho
// nativo nunca engataria, mesmo estando disponível.
await aguardarParticlesStep();
io.print("nativo (rts:particles.particlesStep) = " + (temParticlesStep() ? "SIM" : "não — caminho TS puro"));

fixarSementeAleatorio(13);

// ── sort=0 (aditivo, ordem não importa): 1000/5000/10000 ───────────────────
const tamanhos = [1000, 5000, 10000];
let i = 0;
let ms10k: f64 = 0.0;
let vivas10k = 0;
while (i < tamanhos.length) {
  const ps = construir(tamanhos[i], 0, 1); // modo=1 (aditivo) — o caso comum de fogo/faíscas
  const ms = medir(ps);
  io.print("n=" + tamanhos[i] + " sort=0 modo=aditivo ms/quadro=" + ms.toFixed(4) + " us/quadro=" + (ms * 1000.0).toFixed(1) + " vivas=" + ps.particleCount);
  if (tamanhos[i] === 10000) { ms10k = ms; vivas10k = ps.particleCount; }
  i = i + 1;
}

// ── sort=1 (alfa, back-to-front — só faz sentido em modo alfa): 1000/10000 ─
// Pedido extra do controlador: provar se a ordenação por inserção O(n²) de
// `ordenarPorDistancia` (Task 5) ainda cabe no orçamento a 1000 e a 10000, ou
// se precisa de um algoritmo O(n log n) sem alocar (ver claude-bench-particulas-sort.ts).
const tamanhosSort = [1000, 10000];
let j = 0;
while (j < tamanhosSort.length) {
  const ps = construir(tamanhosSort[j], 1, 0); // modo=0 (alfa)
  const ms = medir(ps);
  io.print("n=" + tamanhosSort[j] + " sort=1 modo=alfa ms/quadro=" + ms.toFixed(4) + " us/quadro=" + (ms * 1000.0).toFixed(1) + " vivas=" + ps.particleCount);
  j = j + 1;
}

if (ms10k <= META_MS_10K) {
  io.print("[PASSOU] 10000 partículas (sort=0) em " + ms10k.toFixed(4) + " ms (meta " + META_MS_10K.toFixed(1) + ", vivas=" + vivas10k + ")");
} else {
  throw new Error("[FALHOU] 10000 partículas (sort=0) em " + ms10k.toFixed(4) + " ms (meta " + META_MS_10K.toFixed(1) + ", vivas=" + vivas10k + ")");
}
}
main();

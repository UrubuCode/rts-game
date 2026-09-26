// §18 de claude-test-consultas.ts em arquivo próprio: o teste inteiro rodava no
// teto de 64 MiB do heap e a §18 (duas cenas novas com índice espacial) era a
// que estourava, dependendo do lixo acumulado pelas seções anteriores
// (Task 10.5, fix round 1). Separada, a §18 roda com o heap só dela.
// Teste de aceitação do Lote B: Consultas Espaciais (§5 e §7)
// Verifica:
//   1. Raycast contra esfera, caixa e casca
//   2. raycastNonAlloc com parâmetros escalares e buffer reutilizado
//   3. overlapSphere e overlapBox com ordenação estrita por bodyId crescente
//   4. Filtro simétrico de layer/mask
//   5. includeTriggers (ignorado por padrão; depth = 0 em overlap quando true)
//   6. Carimbo de stepId (CPU/Rust = stepCount, GPU = pbGpuLastReadbackStep)
//   7. Zero alocações no caminho quente e estabilidade de RSS / tempo

import io from "@compat/io.ts";
import math from "@compat/math.ts";
import time from "../src/compat/time";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { boxCollider, sphereCollider, Collider, SHAPE_BOX, SHAPE_SPHERE, shapeOf } from "../src/engine/core/collider";
import { stepCount, stepsFor, stepMore, FIXED_DT } from "../src/engine/core/fixedstep";
import { pbActiveBackend, pbGpuLastReadbackStep, rigidSetMode, rigidInvalidate, rigidStep, rigidFlush } from "../src/engine/core/physics_backend";
import {
  setSpatialScene,
  spatialRebuildIndex,
  getSpatialStepId,
  createRaycastHit,
  createOverlapHit,
  raycast,
  raycastNonAlloc,
  overlapSphere,
  overlapSphereNonAlloc,
  overlapBox,
  overlapBoxNonAlloc,
  spatialGridRebuildCost,
  RaycastHit,
  OverlapHit,
} from "../src/engine/core/spatial_queries";
import { buildObject } from "../src/editor/sceneio";

let falhas = 0;

function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome + (detalhe ? " - " + detalhe : ""));
    falhas = falhas + 1;
  }
}

io.print("=== Teste de Aceite: Lote B (Consultas Espaciais) — §18 ===");

// ── 18. SpatialIndex por cena: isolamento e custo zero de alternância (§8 e §8.3 item 4) ──
const scA = new Scene("SceneA");
const scB = new Scene("SceneB");

// Popula Scene A com 25 estáticos e 25 dinâmicos em Z = [ -20, 20 ]
for (let i = 0; i < 25; i++) {
  const o = new GameObject("a_stat_" + i);
  o.stationary = 1;
  o.setMesh(1, 1, 1, 1);
  const px = (i % 5) * 4.0 - 8.0;
  const pz = (((i / 5) | 0) * 4.0) - 8.0;
  o.transform.setPosition(px, 1.0, pz);
  scA.add(o);
}
for (let i = 0; i < 25; i++) {
  const o = new GameObject("a_dyn_" + i);
  o.stationary = 0;
  o.setMesh(1, 1, 1, 1);
  const px = (i % 5) * 4.0 - 8.0;
  const pz = (((i / 5) | 0) * 4.0) - 8.0;
  o.transform.setPosition(px, 1.0, pz);
  scA.add(o);
}
scA.computeWorld();

// Popula Scene B com 25 estáticos e 25 dinâmicos em Z = [ 490, 510 ]
for (let i = 0; i < 25; i++) {
  const o = new GameObject("b_stat_" + i);
  o.stationary = 1;
  o.setMesh(1, 1, 1, 1);
  const px = (i % 5) * 4.0 - 8.0;
  const pz = 500.0 + (((i / 5) | 0) * 4.0) - 8.0;
  o.transform.setPosition(px, 1.0, pz);
  scB.add(o);
}
for (let i = 0; i < 25; i++) {
  const o = new GameObject("b_dyn_" + i);
  o.stationary = 0;
  o.setMesh(1, 1, 1, 1);
  const px = (i % 5) * 4.0 - 8.0;
  const pz = 500.0 + (((i / 5) | 0) * 4.0) - 8.0;
  o.transform.setPosition(px, 1.0, pz);
  scB.add(o);
}
scB.computeWorld();

spatialRebuildIndex(scA);
spatialRebuildIndex(scB);

// 100 consultas alternadas entre scA e scB
let crossPollutionA = 0;
let crossPollutionB = 0;
const hitA = createRaycastHit();
const hitB = createRaycastHit();
const bufA: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];
const bufB: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];

for (let round = 0; round < 100; round++) {
  // Query em A
  const rA = raycastNonAlloc(0.0, 1.0, -50.0, 0.0, 0.0, 1.0, 100.0, hitA, 0xFFFFFFFF, 1, false, scA);
  if (!rA || hitA.point[2] > 100.0) crossPollutionA++;
  const ovA = overlapSphereNonAlloc(0.0, 1.0, 0.0, 5.0, bufA, 4, 0xFFFFFFFF, 1, false, scA);
  if (ovA === 0) crossPollutionA++;
  // Overlap em A no local da cena B deve retornar 0
  const ovAatB = overlapSphereNonAlloc(0.0, 1.0, 500.0, 10.0, bufA, 4, 0xFFFFFFFF, 1, false, scA);
  if (ovAatB !== 0) crossPollutionA++;

  // Query em B
  const rB = raycastNonAlloc(0.0, 1.0, 450.0, 0.0, 0.0, 1.0, 100.0, hitB, 0xFFFFFFFF, 1, false, scB);
  if (!rB || hitB.point[2] < 400.0) crossPollutionB++;
  const ovB = overlapSphereNonAlloc(0.0, 1.0, 500.0, 5.0, bufB, 4, 0xFFFFFFFF, 1, false, scB);
  if (ovB === 0) crossPollutionB++;
  // Overlap em B no local da cena A deve retornar 0
  const ovBatA = overlapSphereNonAlloc(0.0, 1.0, 0.0, 10.0, bufB, 4, 0xFFFFFFFF, 1, false, scB);
  if (ovBatA !== 0) crossPollutionB++;
}

check("SpatialIndex §18: consultas alternadas em Scene A sem poluição de Scene B", crossPollutionA === 0, "erros=" + crossPollutionA);
check("SpatialIndex §18: consultas alternadas em Scene B sem poluição de Scene A", crossPollutionB === 0, "erros=" + crossPollutionB);

// Custo de alternância: mover dinâmicos em A e B alternadamente não deve causar rebuild estático
for (let step = 0; step < 5; step++) {
  for (let i = 25; i < 50; i++) {
    const oA = scA.objects[i];
    oA.transform.setPosition(oA.transform.wx + 0.1, oA.transform.wy, oA.transform.wz);
    const oB = scB.objects[i];
    oB.transform.setPosition(oB.transform.wx + 0.1, oB.transform.wy, oB.transform.wz);
  }
  scA.computeWorld();
  scB.computeWorld();
  spatialGridRebuildCost(scA);
  spatialGridRebuildCost(scB);
}

const costA = spatialGridRebuildCost(scA);
const costB = spatialGridRebuildCost(scB);
check("SpatialIndex §18: rebuild de Scene A alternada mantém estáticos intocados (tempo <= 0.35 ms)", costA.timeMs <= 0.35, "tempo=" + costA.timeMs.toFixed(3) + " ms");
check("SpatialIndex §18: rebuild de Scene B alternada mantém estáticos intocados (tempo <= 0.35 ms)", costB.timeMs <= 0.35, "tempo=" + costB.timeMs.toFixed(3) + " ms");

if (falhas === 0) {
  io.print("[PASSOU] Consultas espaciais §18 (SpatialIndex por cena) passaram!");
} else {
  io.print("[FALHA] Total de falhas: " + falhas);
}

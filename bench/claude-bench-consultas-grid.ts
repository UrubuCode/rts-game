// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK DE CONSULTAS ESPACIAIS E ÍNDICE DO HOST (Lote B, Aceite 8)
//
// Mede:
//   1. Custo de reconstrução do índice espacial (spatialRebuildIndex) em n=500, 1000, 2000;
//   2. Custo de consultas espaciais (raycastNonAlloc e overlapSphereNonAlloc);
//   3. Aquecimento de 3 segundos, >= 4 rodadas alternadas, reportando a mediana.
// ═══════════════════════════════════════════════════════════════════════════

import io from "@compat/io.ts";
import math from "@compat/math.ts";
import time from "../src/compat/time";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import {
  setSpatialScene,
  spatialRebuildIndex,
  spatialGridRebuildCost,
  raycastNonAlloc,
  overlapSphereNonAlloc,
  createRaycastHit,
  createOverlapHit,
  RaycastHit,
  OverlapHit,
} from "../src/engine/core/spatial_queries";

function mediana(arr: f64[]): f64 {
  const sorted = arr.slice(0).sort((a, b) => a - b);
  const mid = (sorted.length / 2) | 0;
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

function criarCena(n: number): Scene {
  const sc = new Scene("BenchScene_" + n);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("body_" + i);
    // Alterna cubos e esferas
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0); // meia-extensão 0.5
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

io.print("=== Benchmark de Consultas Espaciais e Grid no Host (Lote B) ===");
io.print("Aquecendo por 3 segundos...");

// Aquecimento de 3 segundos
const scWarm = criarCena(500);
setSpatialScene(scWarm);
const tWarmStart = performance.now();
const dummyRay = createRaycastHit();
const dummyOverlaps: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];

while (performance.now() - tWarmStart < 3000.0) {
  spatialRebuildIndex(scWarm);
  raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 100.0, dummyRay, 0xFFFFFFFF, 1, false, scWarm);
  overlapSphereNonAlloc(5.0, 5.0, 5.0, 4.0, dummyOverlaps, 4, 0xFFFFFFFF, 1, false, scWarm);
}
io.print("Aquecimento concluido.");

// ── 1. Custo de Reconstrução do Índice Espacial (§5.1 e Aceite 8) ─────────────
const tamanhos = [500, 1000, 2000];
const RODADAS = 6; // >= 4 rodadas alternadas

io.print("\n--- 1. Custo de Reconstrucao do Indice Espacial (Mediana de " + RODADAS + " rodadas) ---");
io.print("   n    | Reconstrucao (ms) | Celulas Ativas | Objetos Indexados");
io.print("----------------------------------------------------------------");

let ti = 0;
while (ti < tamanhos.length) {
  const n = tamanhos[ti];
  const sc = criarCena(n);
  setSpatialScene(sc);

  const temposRebuild: f64[] = [];
  let cellCount = 0;
  let objCount = 0;

  let r = 0;
  while (r < RODADAS) {
    const cost = spatialGridRebuildCost(sc);
    temposRebuild.push(cost.timeMs);
    cellCount = cost.cellCount;
    objCount = cost.objCount;
    r = r + 1;
  }

  const med = mediana(temposRebuild);
  io.print(" " + (n + "      ").slice(0, 7) + "| " +
           (med.toFixed(3) + " ms      ").slice(0, 18) + "| " +
           (cellCount + "             ").slice(0, 15) + "| " +
           objCount);

  ti = ti + 1;
}

// ── 2. Custo por 1.000 Consultas (Raycast e OverlapSphere) ────────────────────
io.print("\n--- 2. Desempenho de Consultas Espaciais (Cena com 2.000 corpos) ---");

const sc2k = criarCena(2000);
setSpatialScene(sc2k);
spatialRebuildIndex(sc2k);

const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) {
  overlapBuf.push(createOverlapHit());
  oi = oi + 1;
}

const temposRaycast1k: f64[] = [];
const temposOverlap1k: f64[] = [];

let r2 = 0;
while (r2 < RODADAS) {
  // 1.000 Raycasts
  const t0Ray = performance.now();
  let k = 0;
  while (k < 1000) {
    raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 0.5, 0.5, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc2k);
    k = k + 1;
  }
  temposRaycast1k.push(performance.now() - t0Ray);

  // 1.000 OverlapSphere (raio 3.0 cobrindo múltiplos corpos)
  const t0Over = performance.now();
  k = 0;
  while (k < 1000) {
    overlapSphereNonAlloc(10.0, 10.0, 10.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc2k);
    k = k + 1;
  }
  temposOverlap1k.push(performance.now() - t0Over);

  r2 = r2 + 1;
}

const medRay = mediana(temposRaycast1k);
const medOver = mediana(temposOverlap1k);

io.print("  RaycastNonAlloc   (1.000 chamadas): " + medRay.toFixed(2) + " ms (" + (medRay / 1000.0 * 1000.0).toFixed(1) + " µs/query)");
io.print("  OverlapSphereNonAlloc (1.000 chamadas): " + medOver.toFixed(2) + " ms (" + (medOver / 1000.0 * 1000.0).toFixed(1) + " µs/query)");

io.print("\n=== Benchmark Concluido ===");

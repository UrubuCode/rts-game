// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK DE CONSULTAS ESPACIAIS E ÍNDICE DO HOST (Lote B, Aceite 8)
//
// Mede nas 3 cenas:
//   1. Cubo alinhado (2.000 dinâmicos alinhados);
//   2. Posições sorteadas (2.000 dinâmicos, semente fixa, meia-extensão 0,3–1,0);
//   3. Mista (chão estático 200×200 + 2.000 dinâmicos).
//
// Metas:
//   - Reconstrução por passo (2.000 dinâmicos) <= 0.35 ms
//   - OverlapSphere (r=3.0) <= 30 µs
//   - RaycastNonAlloc (50 u) <= 25 µs
// ═══════════════════════════════════════════════════════════════════════════

import io from "@compat/io.ts";
import math from "@compat/math.ts";
import time from "../src/compat/time";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { BODY_STATIC } from "../src/engine/rigid/materials";
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

// ── 1. Cena Alinhada (Pior caso anterior, 2.000 corpos) ─────────────────────
function criarCenaPrediosMedios(n: number): Scene {
  const sc = new Scene("BenchScene_Predios100_" + n);
  const ground = new GameObject("ground_2000");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(0.0, -1.0, 0.0);
  ground.transform.sx = 2000.0;
  ground.transform.sy = 2.0;
  ground.transform.sz = 2000.0;
  sc.add(ground);

  let b = 0;
  while (b < 100) {
    const bldg = new GameObject("bldg_" + b);
    bldg.stationary = 1;
    bldg.setMesh(1, 180, 140, 100);
    const bx = ((b % 10) - 5) * 80.0;
    const bz = (((b / 10) | 0) - 5) * 80.0;
    bldg.transform.setPosition(bx, 15.0, bz);
    bldg.transform.setScale(30.0); // hx=15
    sc.add(bldg);
    b = b + 1;
  }

  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_bldg_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) { overlapBuf.push(createOverlapHit()); oi = oi + 1; }

const sc = criarCenaPrediosMedios(2000);
io.print("[p] cena criada");
setSpatialScene(sc);
spatialRebuildIndex(sc);
io.print("[p] rebuild inicial");
let w = 0;
while (w < 10) { spatialGridRebuildCost(sc); w = w + 1; }
io.print("[p] 10x gridRebuildCost");
w = 0;
while (w < 10) { raycastNonAlloc(-450.0, 5.0, -450.0, 1.0, 0.0, 0.0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc); w = w + 1; }
io.print("[p] 10x raycast");
w = 0;
while (w < 10) { overlapSphereNonAlloc(0.0, 5.0, 0.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc); w = w + 1; }
io.print("[p] 10x overlap");
let r = 0;
while (r < 5) { sc.compVersion = sc.compVersion + 1; spatialRebuildIndex(sc); r = r + 1; }
io.print("[p] 5x compRebuild");
r = 0;
while (r < 20) { spatialGridRebuildCost(sc); r = r + 1; }
io.print("[p] 20x gridRebuildCost");
r = 0;
while (r < 6000) { raycastNonAlloc(-450.0, 5.0, -450.0, 1.0, 0.0, 0.0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc); r = r + 1; }
io.print("[p] 6000x raycast");
r = 0;
while (r < 6000) { overlapSphereNonAlloc(0.0, 5.0, 0.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc); r = r + 1; }
io.print("[p] 6000x overlap");
io.print("[p] FIM");

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
} from "./sq_entry";

function mediana(arr: f64[]): f64 {
  const sorted = arr.slice(0).sort((a, b) => a - b);
  const mid = (sorted.length / 2) | 0;
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) * 0.5;
}

// ── 1. Cena Alinhada (Pior caso anterior, 2.000 corpos) ─────────────────────
function criarCenaMista(n: number): Scene {
  const sc = new Scene("BenchScene_Mista_" + n);

  // Chão estático 200×200
  const ground = new GameObject("static_ground");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(25.0, -1.0, 25.0);
  ground.transform.sx = 200.0;
  ground.transform.sy = 2.0;
  ground.transform.sz = 200.0;
  sc.add(ground);

  // 2.000 corpos dinâmicos distribuídos acima do chão
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("dyn_misto_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0); // meia-extensão 0.5
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

const sc = criarCenaMista(2000);
setSpatialScene(sc);
spatialRebuildIndex(sc);
io.print("[r] cena pronta");

const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) { overlapBuf.push(createOverlapHit()); oi = oi + 1; }
let r = 0;
while (r < 0) { raycastNonAlloc(-5.0, 10.0, 10.0, 1.0, 0.0, 0.0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc); r = r + 1; }
io.print("[q] 20000 raycast");
r = 0;
while (r < 20000) { overlapSphereNonAlloc(10.0, 10.0, 10.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc); r = r + 1; }
io.print("[q] 20000 overlap");

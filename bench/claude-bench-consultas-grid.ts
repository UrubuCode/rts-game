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
function criarCenaAlinhada(n: number): Scene {
  const sc = new Scene("BenchScene_Alinhada_" + n);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("dyn_" + i);
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

// ── 2. Cena com Posições Sorteadas (Semente fixa, meia-extensão 0,3–1,0) ────
function criarCenaSorteada(n: number): Scene {
  const sc = new Scene("BenchScene_Sorteada_" + n);
  let seed = 123456789;
  function lcg(): f64 {
    seed = ((seed * 1664525 + 1013904223) | 0);
    return ((seed >>> 0) / 4294967296.0);
  }

  let i = 0;
  while (i < n) {
    const px = lcg() * 50.0;
    const py = lcg() * 50.0;
    const pz = lcg() * 50.0;
    const halfExtent = 0.3 + lcg() * 0.7; // 0.3 a 1.0

    const g = new GameObject("dyn_rand_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(px, py, pz);
    g.transform.setScale(halfExtent * 2.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

// ── 3. Cena Mista (Chão estático 200×200 + 2.000 dinâmicos) ─────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// EXECUÇÃO DO BENCHMARK
// ═══════════════════════════════════════════════════════════════════════════

io.print("=== Benchmark de Consultas Espaciais e Grid no Host (Lote B, Revisao 4) ===");
io.print("Aquecendo por 3 segundos...");

const scWarm = criarCenaAlinhada(500);
setSpatialScene(scWarm);
const tWarmStart = performance.now();
const dummyRay = createRaycastHit();
const dummyOverlaps: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];

while (performance.now() - tWarmStart < 3000.0) {
  spatialRebuildIndex(scWarm);
  raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 100.0, dummyRay, 0xFFFFFFFF, 1, false, scWarm);
  overlapSphereNonAlloc(5.0, 5.0, 5.0, 4.0, dummyOverlaps, 4, 0xFFFFFFFF, 1, false, scWarm);
}
io.print("Aquecimento concluido.\n");

const RODADAS = 6;
const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) {
  overlapBuf.push(createOverlapHit());
  oi = oi + 1;
}

interface SceneBenchResult {
  nome: string;
  n: number;
  rebuildMs: f64;
  raycastUs: f64;
  rayHitDist: f64;
  rayHitBodyId: number;
  overlapUs: f64;
}

function executarBenchCena(
  nome: string,
  sc: Scene,
  n: number,
  rayOx: f64, rayOy: f64, rayOz: f64,
  rayDx: f64, rayDy: f64, rayDz: f64,
  overlapX: f64, overlapY: f64, overlapZ: f64,
): SceneBenchResult {
  setSpatialScene(sc);
  spatialRebuildIndex(sc); // Primeiro passo indexa estáticos e dinâmicos

  // Aquecimento local para estabilização de caches e JIT
  let w = 0;
  while (w < 10) {
    spatialGridRebuildCost(sc);
    raycastNonAlloc(rayOx, rayOy, rayOz, rayDx, rayDy, rayDz, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    overlapSphereNonAlloc(overlapX, overlapY, overlapZ, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
    w = w + 1;
  }

  const temposRebuild: f64[] = [];
  const temposRaycast: f64[] = [];
  const temposOverlap: f64[] = [];

  // 1. Custo de reconstrução do passo (dinâmicos) medido em RODADAS dedicadas
  let r = 0;
  while (r < RODADAS) {
    const cost = spatialGridRebuildCost(sc);
    temposRebuild.push(cost.timeMs);
    r = r + 1;
  }

  // 2. 1.000 Raycasts (50 u) por rodada
  r = 0;
  while (r < RODADAS) {
    const t0Ray = performance.now();
    let k = 0;
    while (k < 1000) {
      raycastNonAlloc(rayOx, rayOy, rayOz, rayDx, rayDy, rayDz, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    temposRaycast.push((performance.now() - t0Ray) / 1000.0 * 1000.0); // µs por query
    r = r + 1;
  }

  // 3. 1.000 Overlaps (esfera r=3) por rodada
  r = 0;
  while (r < RODADAS) {
    const t0Over = performance.now();
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(overlapX, overlapY, overlapZ, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    temposOverlap.push((performance.now() - t0Over) / 1000.0 * 1000.0); // µs por query
    r = r + 1;
  }

  // Captura distância e bodyId de impacto para verificação de fidelidade
  raycastNonAlloc(rayOx, rayOy, rayOz, rayDx, rayDy, rayDz, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);

  return {
    nome: nome,
    n: n,
    rebuildMs: mediana(temposRebuild),
    raycastUs: mediana(temposRaycast),
    rayHitDist: rayHit.hit ? rayHit.distance : -1.0,
    rayHitBodyId: rayHit.hit ? rayHit.bodyId : -1,
    overlapUs: mediana(temposOverlap),
  };
}

// Executa os benchmarks nas 3 cenas com 2.000 corpos
// 1. Cubo: raio inicia fora em (-5, 10, 10) e atravessa células do cubo ao longo de +X
const resAlinhada = executarBenchCena(
  "1. Cubo Alinhado (2.000 dyn)", criarCenaAlinhada(2000), 2000,
  -5.0, 10.0, 10.0,  1.0, 0.0, 0.0,
  10.0, 10.0, 10.0,
);

// 2. Posições Sorteadas: raio inicia em (-5, 25, 25) e entra na nuvem aleatória
const resSorteada = executarBenchCena(
  "2. Posicoes Sorteadas (2.000 dyn)", criarCenaSorteada(2000), 2000,
  -5.0, 25.0, 25.0,  1.0, 0.2, 0.2,
  25.0, 25.0, 25.0,
);

// 3. Mista: raio inicia no alto (-5, 15, -5) disparando para baixo através dos dinâmicos em direção ao chão estático
const resMista = executarBenchCena(
  "3. Mista (Chao 200x200 + 2k dyn)", criarCenaMista(2000), 2000,
  -5.0, 15.0, -5.0,  1.0, -0.5, 1.0,
  10.0, 2.0, 10.0,
);

const resultados = [resAlinhada, resSorteada, resMista];

io.print("┌───────────────────────────────────┬───────────────────┬───────────────────┬───────────────────────────────┐");
io.print("│ Cena                              │ Rebuild / passo   │ Overlap (r=3)     │ Raycast (50 u)                │");
io.print("│                                   │ (meta <= 0,35 ms) │ (meta <= 30 µs)   │ (meta <= 25 µs)               │");
io.print("├───────────────────────────────────┼───────────────────┼───────────────────┼───────────────────────────────┤");

let ri = 0;
while (ri < resultados.length) {
  const res = resultados[ri];
  const rebOk = res.rebuildMs <= 0.35 ? "OK" : "ALTO";
  const overOk = res.overlapUs <= 30.0 ? "OK" : "ALTO";
  const rayOk = res.raycastUs <= 25.0 ? "OK" : "ALTO";

  const colNome = (res.nome + "                                   ").slice(0, 35);
  const colReb = ((res.rebuildMs.toFixed(3) + " ms [" + rebOk + "]") + "                   ").slice(0, 19);
  const colOver = ((res.overlapUs.toFixed(1) + " µs [" + overOk + "]") + "                   ").slice(0, 19);
  const rayInfo = res.raycastUs.toFixed(1) + " µs [" + rayOk + "] (d=" + res.rayHitDist.toFixed(1) + "u)";
  const colRay = (rayInfo + "                               ").slice(0, 29);

  io.print("│ " + colNome + " │ " + colReb + " │ " + colOver + " │ " + colRay + " │");
  ri = ri + 1;
}
io.print("└───────────────────────────────────┴───────────────────┴───────────────────┴───────────────────────────────┘");

io.print("\n=== Benchmark Concluido ===");

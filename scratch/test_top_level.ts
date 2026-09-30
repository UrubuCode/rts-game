import io from "@compat/io.ts";
import math from "@compat/math.ts";
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
  OverlapHit,
  getSpatialIndex,
} from "../src/engine/core/spatial_queries";

function criarCenaAlinhada(n: number): Scene {
  const sc = new Scene("BenchScene_Alinhada_" + n);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaSorteada(n: number): Scene {
  const sc = new Scene("BenchScene_Sorteada_" + n);
  let seed = 123456789;
  function lcg(): f64 {
    seed = ((seed * 1664525 + 1013904223) | 0);
    return ((seed >>> 0) / 4294967296.0);
  }
  const dim = 26.0;
  let i = 0;
  while (i < n) {
    const px = lcg() * dim;
    const py = lcg() * dim;
    const pz = lcg() * dim;
    const halfExtent = 0.3 + lcg() * 0.7;
    const g = new GameObject("dyn_rand_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(px, py, pz);
    g.transform.setScale(halfExtent * 2.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaMista(n: number): Scene {
  const sc = new Scene("BenchScene_Mista_" + n);
  const ground = new GameObject("static_ground");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(25.0, -1.0, 25.0);
  ground.transform.sx = 200.0;
  ground.transform.sy = 2.0;
  ground.transform.sz = 200.0;
  sc.add(ground);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_misto_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChao2000(n: number): Scene {
  const sc = new Scene("BenchScene_Chao2000_" + n);
  const ground = new GameObject("ground_2000");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(0.0, -1.0, 0.0);
  ground.transform.sx = 2000.0;
  ground.transform.sy = 2.0;
  ground.transform.sz = 2000.0;
  sc.add(ground);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_chao_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

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
    bldg.transform.setScale(30.0);
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

function criarCenaBlocosTerreno(n: number): Scene {
  const sc = new Scene("BenchScene_Blocos300_" + n);
  let b = 0;
  while (b < 300) {
    const blk = new GameObject("terrain_blk_" + b);
    blk.stationary = 1;
    blk.setMesh(1, 100, 120, 100);
    const bx = ((b % 20) - 10) * 55.0;
    const bz = (((b / 20) | 0) - 7) * 55.0;
    blk.transform.setPosition(bx, -2.5, bz);
    blk.transform.sx = 50.0;
    blk.transform.sy = 5.0;
    blk.transform.sz = 50.0;
    sc.add(blk);
    b = b + 1;
  }
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_blk_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChefeColossal(n: number): Scene {
  const sc = new Scene("BenchScene_ChefeColossal_" + n);
  const ground = new GameObject("ground_2000");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(0.0, -1.0, 0.0);
  ground.transform.sx = 2000.0;
  ground.transform.sy = 2.0;
  ground.transform.sz = 2000.0;
  sc.add(ground);
  const boss = new GameObject("boss_colossal");
  boss.setMesh(1, 255, 0, 255);
  boss.transform.setPosition(100.0, 25.0, 100.0);
  boss.transform.setScale(50.0);
  sc.add(boss);
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_boss_scene_" + i);
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
while (oi < 16) {
  overlapBuf.push(createOverlapHit());
  oi = oi + 1;
}

interface SceneBenchResult {
  nome: string;
}

function executarBenchCena(
  nome: string,
  sc: Scene,
): SceneBenchResult {
  io.print("Starting " + nome);
  setSpatialScene(sc);
  spatialRebuildIndex(sc);

  let w = 0;
  while (w < 10) {
    spatialGridRebuildCost(sc);
    raycastNonAlloc(0, 0, 0, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    overlapSphereNonAlloc(0, 0, 0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
    w = w + 1;
  }

  let r = 0;
  while (r < 5) {
    sc.compVersion = sc.compVersion + 1;
    spatialRebuildIndex(sc);
    r = r + 1;
  }

  r = 0;
  while (r < 20) {
    spatialGridRebuildCost(sc);
    r = r + 1;
  }

  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      raycastNonAlloc(0, 0, 0, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }

  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(0, 0, 0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  io.print("Finished " + nome);
  return { nome: nome };
}

// Warmup
io.print("Warmup...");
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
io.print("Warmup done!");

const resAlinhada = executarBenchCena("1. Alinhada", criarCenaAlinhada(2000));
const resSorteada = executarBenchCena("2. Sorteada", criarCenaSorteada(2000));
const resMista = executarBenchCena("3. Mista", criarCenaMista(2000));
const resChao2000 = executarBenchCena("4. Chao2000", criarCenaChao2000(2000));
const resPredios = executarBenchCena("5. Predios", criarCenaPrediosMedios(2000));
const resBlocos = executarBenchCena("6. Blocos", criarCenaBlocosTerreno(2000));
const resChefe = executarBenchCena("7. Chefe", criarCenaChefeColossal(2000));

io.print("ALL 7 SCENES DONE!");

function criarCenaCargaCompleta(n: number): Scene {
  const sc = new Scene("BenchScene_CargaCompleta_" + n);
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
    bldg.setMesh(1, 100, 100, 100);
    const bx = ((b % 10) - 5) * 80.0;
    const bz = (((b / 10) | 0) - 5) * 80.0;
    bldg.transform.setPosition(bx, 15.0, bz);
    bldg.transform.setScale(30.0);
    sc.add(bldg);
    b = b + 1;
  }

  io.print("scInc: bldgs added");
  let p = 0;
  while (p < 2000) {
    const prop = new GameObject("prop_" + p);
    prop.stationary = 1;
    prop.setMesh(1, 120, 120, 120);
    const px = ((p % 50) - 25) * 10.0;
    const pz = (((p / 50) | 0) - 20) * 10.0;
    prop.transform.setPosition(px, 1.0, pz);
    prop.transform.setScale(2.0);
    sc.add(prop);
    p = p + 1;
  }
  io.print("scInc: props added");

  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_carga_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 1.0 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  io.print("scInc: dyns added");
  sc.computeWorld();
  io.print("scInc: computeWorld done");
  return sc;
}

io.print("Starting scInc...");
const scInc = criarCenaCargaCompleta(2000);
io.print("scInc created!");
setSpatialScene(scInc);
io.print("setSpatialScene done!");
const idx = getSpatialIndex(scInc);
io.print("getSpatialIndex done! cap=" + idx.objCap);
idx.rebuild();
io.print("scInc rebuilt!");


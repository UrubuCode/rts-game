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
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
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

function criarCenaMista(n: number): Scene {
  const sc = new Scene("BenchScene_Mista_" + n);
  const ground = new GameObject("static_ground");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(25.0, -1.0, 25.0);
  ground.transform.setScale(100.0, 1.0, 100.0);
  sc.add(ground);

  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("dyn_mista_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 0.5 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChao2000(n: number): Scene {
  const sc = new Scene("BenchScene_Chao2000_" + n);
  const ground = new GameObject("static_ground_colossal");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(0.0, -1.0, 0.0);
  ground.transform.setScale(1000.0, 1.0, 1000.0);
  sc.add(ground);

  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;

    const g = new GameObject("dyn_chao2k_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 0.5 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaPrediosMedios(n: number): Scene {
  const sc = new Scene("BenchScene_Predios_" + n);
  let p = 0;
  while (p < 100) {
    const b = new GameObject("bldg_" + p);
    b.stationary = 1;
    b.setMesh(1, 120, 120, 120);
    const bx = ((p % 10) - 5) * 50.0;
    const bz = (((p / 10) | 0) - 5) * 50.0;
    b.transform.setPosition(bx, 15.0, bz);
    b.transform.setScale(30.0);
    sc.add(b);
    p = p + 1;
  }
  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_pred_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0 - 15.0, 0.5 + gy * 2.0, gz * 2.0 - 15.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaBlocosTerreno(n: number): Scene {
  const sc = new Scene("BenchScene_Blocos_" + n);
  let b = 0;
  while (b < 300) {
    const blk = new GameObject("block_" + b);
    blk.stationary = 1;
    blk.setMesh(1, 80, 140, 80);
    const bx = ((b % 20) - 10) * 60.0;
    const bz = (((b / 20) | 0) - 7) * 60.0;
    blk.transform.setPosition(bx, 0.0, bz);
    blk.transform.setScale(50.0, 2.0, 50.0);
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
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0 - 15.0, 2.5 + gy * 2.0, gz * 2.0 - 15.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChefeColossal(n: number): Scene {
  const sc = new Scene("BenchScene_Chefe_" + n);
  const boss = new GameObject("boss_colossal");
  boss.stationary = 0;
  boss.setMesh(1, 255, 50, 50);
  boss.transform.setPosition(100.0, 25.0, 100.0);
  boss.transform.setScale(50.0);
  sc.add(boss);

  const lado = math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0;
  let i = 0;
  while (i < n) {
    const gx = i % lado;
    const gy = ((i / lado) | 0) % lado;
    const gz = (i / (lado * lado)) | 0;
    const g = new GameObject("dyn_chefe_" + i);
    const shape = (i % 2 === 0) ? 1 : 4;
    g.setMesh(shape, 180, 180, 180);
    g.transform.setPosition(gx * 2.0, 0.5 + gy * 2.0, gz * 2.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

const scWarm = criarCenaAlinhada(500);
setSpatialScene(scWarm);
const tWarmStart = performance.now();
const dummyRay = createRaycastHit();
const dummyOverlaps: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];

io.print("Starting 3s warmup...");
while (performance.now() - tWarmStart < 3000.0) {
  spatialRebuildIndex(scWarm);
  raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 100.0, dummyRay, 0xFFFFFFFF, 1, false, scWarm);
  overlapSphereNonAlloc(5.0, 5.0, 5.0, 4.0, dummyOverlaps, 4, 0xFFFFFFFF, 1, false, scWarm);
}
io.print("Warmup finished!");

const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) {
  overlapBuf.push(createOverlapHit());
  oi = oi + 1;
}

function runScene(nome: string, sc: Scene) {
  io.print("Start: " + nome);
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
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
      raycastNonAlloc(0, 10, 10, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(10, 10, 10, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  io.print("Done: " + nome);
}

runScene("1. Alinhada", criarCenaAlinhada(2000));
runScene("2. Sorteada", criarCenaSorteada(2000));
runScene("3. Mista", criarCenaMista(2000));
runScene("4. Chao2000", criarCenaChao2000(2000));
runScene("5. Predios", criarCenaPrediosMedios(2000));
runScene("6. Blocos", criarCenaBlocosTerreno(2000));
runScene("7. Chefe", criarCenaChefeColossal(2000));
io.print("All 7 scenes passed!");

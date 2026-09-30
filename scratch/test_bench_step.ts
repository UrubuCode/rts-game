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
  OverlapHit
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
    g.setMesh((i % 2 === 0) ? 1 : 4, 255, 255, 255);
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
  let seed = 12345;
  function rnd(): f64 {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed * 1.0) / 2147483648.0;
  }
  let i = 0;
  while (i < n) {
    const g = new GameObject("dyn_rnd_" + i);
    g.setMesh((i % 2 === 0) ? 1 : 4, 200, 200, 200);
    g.transform.setPosition(rnd() * 26.0, rnd() * 26.0, rnd() * 26.0);
    g.transform.setScale(1.0);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaMista(n: number): Scene {
  const sc = new Scene("BenchScene_Mista_" + n);
  const ground = new GameObject("ground");
  ground.stationary = 1;
  ground.setMesh(1, 100, 100, 100);
  ground.transform.setPosition(0.0, -1.0, 0.0);
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
    const g = new GameObject("dyn_mista_" + i);
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
    const g = new GameObject("dyn_c2k_" + i);
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

function runScene(name: string, sc: Scene) {
  io.print(name + " starting...");
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
  io.print(name + " indexed!");

  const rayHit = createRaycastHit();
  const overlapBuf: OverlapHit[] = [];
  let oi = 0;
  while (oi < 16) {
    overlapBuf.push(createOverlapHit());
    oi = oi + 1;
  }

  let w = 0;
  while (w < 10) {
    spatialGridRebuildCost(sc);
    raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    overlapSphereNonAlloc(10.0, 10.0, 10.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
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
      raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }

  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(10.0, 10.0, 10.0, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  io.print(name + " completed successfully!");
}

function runSceneById(id: number) {
  let sc: Scene | null = null;
  let name = "";
  if (id === 1) { name = "1. Alinhada"; sc = criarCenaAlinhada(2000); }
  else if (id === 2) { name = "2. Sorteada"; sc = criarCenaSorteada(2000); }
  else if (id === 3) { name = "3. Mista"; sc = criarCenaMista(2000); }
  else if (id === 4) { name = "4. Chao2000"; sc = criarCenaChao2000(2000); }
  else if (id === 5) { name = "5. Predios"; sc = criarCenaPrediosMedios(2000); }
  else if (id === 6) { name = "6. Blocos"; sc = criarCenaBlocosTerreno(2000); }
  else if (id === 7) { name = "7. Chefe"; sc = criarCenaChefeColossal(2000); }
  runScene(name, sc!);
  sc = null;
  setSpatialScene(null);
}

io.print("=== Executing all 7 benchmark scenes via runSceneById ===");
let i = 1;
while (i <= 7) {
  runSceneById(i);
  i = i + 1;
}
io.print("=== All 7 benchmark scenes passed! ===");

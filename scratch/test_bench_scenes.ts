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
  io.print("Done: " + nome);
}

runScene("1. Alinhada", criarCenaAlinhada(2000));
runScene("2. Sorteada", criarCenaSorteada(2000));
runScene("3. Mista", criarCenaMista(2000));
runScene("4. Chao2000", criarCenaChao2000(2000));
io.print("All 4 passed!");

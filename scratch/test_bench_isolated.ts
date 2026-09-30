import io from "@compat/io.ts";
import { Scene, Transform } from '../src/engine/core/scene';
import { GameObject } from '../src/engine/core/gameobject';
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
} from '../src/engine/core/spatial_queries';

function criarCenaAlinhada(n: number): Scene {
  const sc = new Scene();
  let i = 0;
  while (i < n) {
    const o = new GameObject("dyn_" + i);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    const gx = i % 13;
    const gy = ((i / 13) | 0) % 13;
    const gz = ((i / 169) | 0);
    o.transform.setPosition(gx * 2.0, gy * 2.0, gz * 2.0);
    sc.add(o);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaSorteada(n: number): Scene {
  const sc = new Scene();
  let seed = 123456789;
  let i = 0;
  while (i < n) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const rx = ((seed >>> 16) % 520) / 10.0;
    seed = (seed * 1664525 + 1013904223) | 0;
    const ry = ((seed >>> 16) % 520) / 10.0;
    seed = (seed * 1664525 + 1013904223) | 0;
    const rz = ((seed >>> 16) % 520) / 10.0;
    const o = new GameObject("dyn_" + i);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition(rx, ry, rz);
    sc.add(o);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaMista(nDinamicos: number): Scene {
  const sc = new Scene();
  let i = 0;
  while (i < 100) {
    const chao = new GameObject("chao_" + i);
    chao.stationary = 1;
    chao.setMesh(1, 0, 255, 0);
    chao.transform.setPosition((i % 10) * 20.0, 0.0, (((i / 10) | 0)) * 20.0);
    chao.transform.setScale(10.0, 0.5, 10.0);
    sc.add(chao);
    i = i + 1;
  }
  let d = 0;
  while (d < nDinamicos) {
    const o = new GameObject("dyn_" + d);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition((d % 20) * 2.0, 1.0 + ((d / 400) | 0) * 2.0, (((d / 20) | 0) % 20) * 2.0);
    sc.add(o);
    d = d + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChao2000(nDinamicos: number): Scene {
  const sc = new Scene();
  const chao = new GameObject("chao_colossal");
  chao.stationary = 1;
  chao.setMesh(1, 0, 255, 0);
  chao.transform.setPosition(1000.0, 0.0, 1000.0);
  chao.transform.setScale(1000.0, 1.0, 1000.0);
  sc.add(chao);
  let d = 0;
  while (d < nDinamicos) {
    const o = new GameObject("dyn_" + d);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition((d % 20) * 2.0, 2.0, (((d / 20) | 0)) * 2.0);
    sc.add(o);
    d = d + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaPrediosMedios(nDinamicos: number): Scene {
  const sc = new Scene();
  let p = 0;
  while (p < 100) {
    const predio = new GameObject("predio_" + p);
    predio.stationary = 1;
    predio.setMesh(1, 100, 100, 100);
    predio.transform.setPosition((p % 10) * 60.0, 15.0, (((p / 10) | 0)) * 60.0);
    predio.transform.setScale(15.0, 15.0, 15.0);
    sc.add(predio);
    p = p + 1;
  }
  let d = 0;
  while (d < nDinamicos) {
    const o = new GameObject("dyn_" + d);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition((d % 20) * 2.0, 1.0, (((d / 20) | 0)) * 2.0);
    sc.add(o);
    d = d + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaBlocosTerreno(nDinamicos: number): Scene {
  const sc = new Scene();
  let b = 0;
  while (b < 300) {
    const bloco = new GameObject("bloco_" + b);
    bloco.stationary = 1;
    bloco.setMesh(1, 0, 180, 0);
    bloco.transform.setPosition((b % 15) * 50.0, 0.0, (((b / 15) | 0)) * 50.0);
    bloco.transform.setScale(25.0, 1.0, 25.0);
    sc.add(bloco);
    b = b + 1;
  }
  let d = 0;
  while (d < nDinamicos) {
    const o = new GameObject("dyn_" + d);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition((d % 20) * 2.0, 2.0, (((d / 20) | 0)) * 2.0);
    sc.add(o);
    d = d + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaChefeColossal(nDinamicos: number): Scene {
  const sc = new Scene();
  const chefe = new GameObject("chefe_colossal");
  chefe.stationary = 0;
  chefe.setMesh(1, 255, 50, 50);
  chefe.transform.setPosition(100.0, 25.0, 100.0);
  chefe.transform.setScale(25.0, 25.0, 25.0);
  sc.add(chefe);
  let d = 0;
  while (d < nDinamicos) {
    const o = new GameObject("dyn_" + d);
    o.stationary = 0;
    o.setMesh(1, 255, 0, 0);
    o.transform.setPosition((d % 20) * 2.0, 1.0, (((d / 20) | 0)) * 2.0);
    sc.add(o);
    d = d + 1;
  }
  sc.computeWorld();
  return sc;
}

function criarCenaCargaCompleta(nDinamicos: number): Scene {
  const sc = new Scene();
  let b = 0;
  while (b < 100) {
    const predio = new GameObject("predio_" + b);
    predio.stationary = 1;
    predio.setMesh(1, 100, 100, 100);
    predio.transform.setPosition((b % 10) * 50.0, 15.0, (((b / 10) | 0)) * 50.0);
    predio.transform.setScale(15.0, 15.0, 15.0);
    sc.add(predio);
    b = b + 1;
  }
  let p = 0;
  while (p < 2000) {
    const prop = new GameObject("prop_" + p);
    prop.stationary = 1;
    prop.setMesh(0, 50, 50, 50);
    prop.transform.setPosition((p % 40) * 12.0 + 2.0, 0.5, (((p / 40) | 0)) * 12.0 + 2.0);
    prop.transform.setScale(0.5, 0.5, 0.5);
    sc.add(prop);
    p = p + 1;
  }
  const chao = new GameObject("terreno_colossal");
  chao.stationary = 1;
  chao.setMesh(1, 0, 128, 0);
  chao.transform.setPosition(1000.0, 0.0, 1000.0);
  chao.transform.setScale(1000.0, 1.0, 1000.0);
  sc.add(chao);
  let d = 0;
  while (d < nDinamicos) {
    const dyn = new GameObject("dyn_" + d);
    dyn.stationary = 0;
    dyn.setMesh(1, 200, 50, 50);
    dyn.transform.setPosition((d % 30) * 4.0, 1.0, (((d / 30) | 0)) * 4.0);
    sc.add(dyn);
    d = d + 1;
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

function executarBenchCena(
  nome: string,
  sc: Scene,
  n: number,
  rayOx: f64, rayOy: f64, rayOz: f64,
  rayDx: f64, rayDy: f64, rayDz: f64,
  overlapX: f64, overlapY: f64, overlapZ: f64,
): void {
  io.print("Start bench: " + nome);
  setSpatialScene(sc);
  spatialRebuildIndex(sc);

  let w = 0;
  while (w < 10) {
    spatialRebuildIndex(sc);
    raycastNonAlloc(rayOx, rayOy, rayOz, rayDx, rayDy, rayDz, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    overlapSphereNonAlloc(overlapX, overlapY, overlapZ, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
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
      raycastNonAlloc(rayOx, rayOy, rayOz, rayDx, rayDy, rayDz, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }

  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(overlapX, overlapY, overlapZ, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }

  io.print("Done bench: " + nome);
}

io.print("=== Testing All 7 Scenes + scInc ===");
executarBenchCena("1. Cubo", criarCenaAlinhada(2000), 2000, -5.0, 10.0, 10.0, 1.0, 0.0, 0.0, 10.0, 10.0, 10.0);
executarBenchCena("2. Sorteada", criarCenaSorteada(2000), 2000, -5.0, 13.0, 13.0, 1.0, 0.0, 0.0, 13.0, 13.0, 13.0);
executarBenchCena("3. Mista", criarCenaMista(2000), 2000, 1.0, 30.0, 1.0, 0.0, -1.0, 0.0, 10.0, 2.0, 10.0);
executarBenchCena("4. Chao2000", criarCenaChao2000(2000), 2000, 1.0, 30.0, 1.0, 0.0, -1.0, 0.0, 10.0, 2.0, 10.0);
executarBenchCena("5. Predios", criarCenaPrediosMedios(2000), 2000, 0.0, 50.0, 0.0, 0.0, -1.0, 0.0, 0.0, 15.0, 0.0);
executarBenchCena("6. Blocos", criarCenaBlocosTerreno(2000), 2000, 0.0, 30.0, 0.0, 0.0, -1.0, 0.0, 0.0, 2.0, 0.0);
executarBenchCena("7. Chefe", criarCenaChefeColossal(2000), 2000, 100.0, 70.0, 100.0, 0.0, -1.0, 0.0, 100.0, 25.0, 100.0);

io.print("Now creating scInc...");
const scInc = criarCenaCargaCompleta(2000);
io.print("scInc created!");
spatialRebuildIndex(scInc);
io.print("scInc indexed!");

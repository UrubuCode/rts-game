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

const rayHit = createRaycastHit();
const overlapBuf: OverlapHit[] = [];
let oi = 0;
while (oi < 16) {
  overlapBuf.push(createOverlapHit());
  oi = oi + 1;
}

function runScene(nome: string, sc: Scene) {
  setSpatialScene(sc);
  spatialRebuildIndex(sc);

  // Test A: compVersion
  let r = 0;
  while (r < 5) {
    sc.compVersion = sc.compVersion + 1;
    spatialRebuildIndex(sc);
    r = r + 1;
  }

  // Test B: spatialGridRebuildCost
  r = 0;
  while (r < 20) {
    spatialGridRebuildCost(sc);
    r = r + 1;
  }

  // Test C: raycast
  r = 0;
  while (r < 100) {
    raycastNonAlloc(0, 10, 10, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    r = r + 1;
  }

  // Test D: overlap
  r = 0;
  while (r < 100) {
    overlapSphereNonAlloc(10, 10, 10, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
    r = r + 1;
  }

  io.print("Done: " + nome);
}

runScene("1", criarCenaAlinhada(2000));
runScene("2", criarCenaAlinhada(2000));
runScene("3", criarCenaAlinhada(2000));
runScene("4", criarCenaAlinhada(2000));
runScene("5", criarCenaAlinhada(2000));
runScene("6", criarCenaAlinhada(2000));
runScene("7", criarCenaAlinhada(2000));
runScene("8", criarCenaAlinhada(2000));
runScene("9", criarCenaAlinhada(2000));
runScene("10", criarCenaAlinhada(2000));
io.print("Finished 10 scenes with A, B, C, D!");

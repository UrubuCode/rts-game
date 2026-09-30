import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { setSpatialScene, spatialRebuildIndex, spatialGridRebuildCost, raycastNonAlloc, overlapSphereNonAlloc, createRaycastHit, createOverlapHit, OverlapHit } from "../src/engine/core/spatial_queries";

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
const overlapBuf: OverlapHit[] = [createOverlapHit()];

for (let s = 0; s < 10; s++) {
  io.print("Start scene " + s);
  const sc = criarCenaAlinhada(2000);
  setSpatialScene(sc);
  spatialRebuildIndex(sc);
  for (let r = 0; r < 20; r++) {
    spatialGridRebuildCost(sc);
    raycastNonAlloc(0, 0, 0, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
    overlapSphereNonAlloc(10, 10, 10, 3.0, overlapBuf, 1, 0xFFFFFFFF, 1, false, sc);
  }
  io.print("End scene " + s);
}

io.print("ALL SCENES PASSED!");

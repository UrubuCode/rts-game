import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { setSpatialScene, spatialRebuildIndex, raycastNonAlloc, overlapSphereNonAlloc, createRaycastHit, createOverlapHit, OverlapHit } from "../src/engine/core/spatial_queries";

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

const scWarm = criarCenaAlinhada(500);
setSpatialScene(scWarm);
const dummyRay = createRaycastHit();
const dummyOverlaps: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit(), createOverlapHit()];

io.print("Starting 100,000 iterations...");
for (let iter = 0; iter < 100000; iter++) {
  spatialRebuildIndex(scWarm);
  raycastNonAlloc(0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 100.0, dummyRay, 0xFFFFFFFF, 1, false, scWarm);
  overlapSphereNonAlloc(5.0, 5.0, 5.0, 4.0, dummyOverlaps, 4, 0xFFFFFFFF, 1, false, scWarm);
}
io.print("Done 100,000 iterations with zero heap exhaustion!");

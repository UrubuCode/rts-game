import io from "@compat/io.ts";
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
  let i = 0;
  while (i < n) {
    const g = new GameObject("dyn_" + i);
    g.setMesh(1, 180, 180, 180);
    g.transform.setPosition(i % 10, 0, (i / 10) | 0);
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

  // 1. compVersion rebuild 5 times
  let r = 0;
  while (r < 5) {
    sc.compVersion = sc.compVersion + 1;
    spatialRebuildIndex(sc);
    r = r + 1;
  }
  io.print("After compVersion: " + nome);

  // 2. 20 rebuilds
  r = 0;
  while (r < 20) {
    spatialGridRebuildCost(sc);
    r = r + 1;
  }
  io.print("After rebuildCost: " + nome);

  // 3. 6000 raycasts
  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      raycastNonAlloc(0, 10, 10, 1, 0, 0, 50.0, rayHit, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  io.print("After raycasts: " + nome);

  // 4. 6000 overlaps
  r = 0;
  while (r < 6) {
    let k = 0;
    while (k < 1000) {
      overlapSphereNonAlloc(10, 10, 10, 3.0, overlapBuf, 16, 0xFFFFFFFF, 1, false, sc);
      k = k + 1;
    }
    r = r + 1;
  }
  io.print("After overlaps: " + nome);

  io.print("Done: " + nome);
}

runScene("1", criarCenaAlinhada(2000));
runScene("2", criarCenaAlinhada(2000));
runScene("3", criarCenaAlinhada(2000));
runScene("4", criarCenaAlinhada(2000));
runScene("5", criarCenaAlinhada(2000));
runScene("6", criarCenaAlinhada(2000));
runScene("7", criarCenaAlinhada(2000));
io.print("All 7 finished!");

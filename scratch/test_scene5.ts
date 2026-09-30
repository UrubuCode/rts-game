import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { setSpatialScene, spatialRebuildIndex, spatialGridRebuildCost, raycastNonAlloc, overlapSphereNonAlloc, createRaycastHit, createOverlapHit, OverlapHit } from "../src/engine/core/spatial_queries";

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
    bldg.transform.setScale(30.0); // hx=15
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

io.print("Creating Predios scene...");
const sc = criarCenaPrediosMedios(2000);
io.print("Scene created. Rebuilding...");
setSpatialScene(sc);
spatialRebuildIndex(sc);
io.print("First rebuild done!");

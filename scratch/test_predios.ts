import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { setSpatialScene, spatialRebuildIndex } from "../src/engine/core/spatial_queries";

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

io.print("Creating Predios...");
const sc = criarCenaPrediosMedios(2000);
io.print("Predios created. Rebuilding...");
setSpatialScene(sc);
spatialRebuildIndex(sc);
io.print("Predios rebuild finished!");

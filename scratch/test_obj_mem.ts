import io from "@compat/io.ts";
import { GameObject } from "../src/engine/core/gameobject";
import { Scene } from "../src/engine/core/scene";

const sc = new Scene("Test");
let i = 0;
while (i < 18500) {
  const g = new GameObject("obj_" + i);
  g.setMesh(1, 100, 100, 100);
  sc.add(g);
  i = i + 1;
}
sc.computeWorld();
io.print("18,500 objects created and computeWorld done!");

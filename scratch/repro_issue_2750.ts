import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
for (let s = 0; s < 7; s++) {
  const sc = new Scene("Cena_" + s);
  for (let i = 0; i < 2000; i++) {
    const go = new GameObject("obj_" + i);
    sc.add(go);
  }
  sc.computeWorld();
  console.log("cena " + s + " ok");
}
console.log("FIM");

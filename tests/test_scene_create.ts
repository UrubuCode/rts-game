import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";

const sc = new Scene("factory");
const root = sc.createGameObject("Root");
const child = sc.createGameObject("Child", 1, 120, 160, 200, 0);

if (sc.count() !== 2 || sc.objects[0] !== root || sc.objects[1] !== child ||
    sc.trs[1] !== child.transform || child.parent !== 0 || child.meshKind !== 1) {
  throw new Error("Scene.createGameObject nao adicionou/configurou os objetos");
}
io.print("[PASSOU] Scene.createGameObject");

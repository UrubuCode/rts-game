import io from "@compat/io.ts";
import { GameObject } from "../src/engine/core/gameobject";
import { halfLocalX, triggerOf } from "../src/engine/core/collider";
const g = new GameObject("x");
g.setMesh(1, 1, 1, 1);
let acc = 0.0;
let i = 0;
while (i < 200000) { acc = acc + halfLocalX(g); i = i + 1; }
io.print("[h] halfLocalX: " + acc);
i = 0;
while (i < 200000) { acc = acc + triggerOf(g); i = i + 1; }
io.print("[h] triggerOf: " + acc);

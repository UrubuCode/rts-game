// Pose de MUNDO → transform LOCAL, invertendo Scene.applyParentTo: o filho
// herda a posição do pai girada só pelo yaw e soma os ângulos.
import math from "@compat/math.ts";
import type { Scene } from "./scene";
import type { GameObject } from "./gameobject";
/// `pose` = [x, y, z, yaw, pitch] de mundo.
export function definirPoseDeMundo(sc: Scene, o: GameObject, pose: Float64Array): void {
  const t = o.transform;
  const p = o.parent;
  if (p < 0 || p >= sc.objects.length) {
    t.px = pose[0]; t.py = pose[1]; t.pz = pose[2]; t.ry = pose[3]; t.rx = pose[4];
  } else {
    const pt = sc.objects[p].transform;
    const c = math.cos(pt.wry); const s = math.sin(pt.wry);
    const dx = pose[0] - pt.wx; const dz = pose[2] - pt.wz;
    t.px = dx * c - dz * s; t.py = pose[1] - pt.wy; t.pz = dx * s + dz * c;
    t.ry = pose[3] - pt.wry; t.rx = pose[4] - pt.wrx;
  }
}

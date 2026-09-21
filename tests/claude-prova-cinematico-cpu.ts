// PROVA (revisão do Claude): o mesmo cinemático (mass = 0, vx = 3) nos três modos.
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { rigidStep, rigidSetMode, rigidBackendName } from "@engine/core/physics_backend";
import { FIXED_DT } from "@engine/core/fixedstep";

function roda(modo: number): void {
  scene.clear();
  rigidSetMode(modo);
  const plat = new GameObject("Plat");
  plat.setMesh(1, 100, 100, 100);
  plat.transform.setPosition(0.0, 5.0, 0.0);
  plat.transform.sx = 10.0; plat.transform.sz = 10.0;
  plat.transform.mass = 0.0; plat.transform.vx = 3.0;
  plat.stationary = 0; plat.collideFlag = 1;
  scene.add(plat);
  scene.computeWorld();
  let s = 0;
  while (s < 120) {
    const tomou = rigidStep(scene, 0);
    if (tomou === 0) scene.update(FIXED_DT);
    s = s + 1;
  }
  io.print("  modo=" + modo + " backend=" + rigidBackendName() + "  x=" + plat.transform.px + "  y=" + plat.transform.py + "  vx=" + plat.transform.vx);
}
roda(0); roda(2); roda(1);

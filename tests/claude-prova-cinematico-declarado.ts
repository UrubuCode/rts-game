// PROVA (revisão do Claude): cinemático DECLARADO pelo dono do dado
// (Rigidbody.bodyType = KINEMATIC, massa default 1) movido por POSIÇÃO pelo
// script, com a velocidade que ele comunica a quem está em cima.
// `pbEmpurraTeleportes` decide "é cinemático?" por `t.mass > 0`, não por
// `bodyTypeOf` — então este corpo é tratado como dinâmico teleportado e a
// velocidade é zerada.
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { BODY_KINEMATIC } from "@engine/rigid/materials";
import { rigidStep, rigidSetMode, rigidBackendName } from "@engine/core/physics_backend";
import { FIXED_DT } from "@engine/core/fixedstep";

function roda(modo: number): void {
  scene.clear();
  rigidSetMode(modo);
  const plat = new GameObject("Plat");
  plat.setMesh(1, 100, 100, 100);
  plat.transform.setPosition(0.0, 5.0, 0.0);
  plat.stationary = 0; plat.collideFlag = 1;
  const rb = new Rigidbody(-9.8, 0.0);
  rb.bodyType = BODY_KINEMATIC;
  plat.addBehavior(rb);
  scene.add(plat);
  scene.computeWorld();
  let s = 0;
  let vxVisto: f64 = 0.0;
  while (s < 120) {
    // script de navegação: dirige por posição e informa a velocidade equivalente
    plat.transform.px = plat.transform.px + 3.0 * FIXED_DT;
    plat.transform.vx = 3.0;
    const tomou = rigidStep(scene, 0);
    if (tomou === 0) scene.update(FIXED_DT);
    vxVisto = plat.transform.vx;
    s = s + 1;
  }
  io.print("  backend=" + rigidBackendName() + "  massa=" + plat.transform.mass + "  vx apos o passo=" + vxVisto +
           " (esperado 3)  y=" + plat.transform.py + " (esperado 5)");
}
roda(0); roda(2); roda(1);

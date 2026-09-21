// PROVA (revisão do Claude): um cinemático que COMEÇA PARADO e só depois recebe
// velocidade do script — elevador esperando, unidade aguardando ordem.
// A: tipo inferido (mass = 0, sem bodyType).  B: tipo declarado (bodyType = 2).
// Nos dois casos o corpo tem de ficar em y = 5 enquanto parado e andar 3 u/s depois.
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { rigidStep, rigidSetMode, rigidBackendName } from "@engine/core/physics_backend";
import { FIXED_DT } from "@engine/core/fixedstep";

function roda(modo: number, declarado: number): void {
  scene.clear();
  rigidSetMode(modo);
  const plat = new GameObject("Plat");
  plat.setMesh(1, 100, 100, 100);
  plat.transform.setPosition(0.0, 5.0, 0.0);
  plat.transform.mass = 0.0;
  plat.stationary = 0; plat.collideFlag = 1;
  if (declarado !== 0) { plat.bodyType = 2; plat.transform.bodyType = 2; }
  scene.add(plat);
  scene.computeWorld();
  let s = 0;
  while (s < 180) {
    if (s === 60) plat.transform.vx = 3.0;      // o script dá a ordem no passo 60
    const tomou = rigidStep(scene, 0);
    if (tomou === 0) scene.update(FIXED_DT);
    s = s + 1;
  }
  io.print("  " + (declarado !== 0 ? "declarado" : "inferido ") + " backend=" + rigidBackendName() +
           "  x=" + plat.transform.px + " (esperado ~6)  y=" + plat.transform.py + " (esperado 5)");
}
roda(0, 0); roda(2, 0); roda(1, 0);
roda(0, 1); roda(2, 1); roda(1, 1);

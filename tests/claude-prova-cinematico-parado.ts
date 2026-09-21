// Teste: um cinemático que COMEÇA PARADO e só depois recebe
// velocidade do script — elevador esperando, unidade aguardando ordem.
// A: tipo inferido (mass = 0, sem bodyType).  B: tipo declarado (Rigidbody.bodyType = 2).
// Nos dois casos o corpo tem de ficar em y = 5 enquanto parado e andar 3 u/s depois (~6.0 u).
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { BODY_KINEMATIC } from "@engine/rigid/materials";
import { rigidStep, rigidSetMode, rigidBackendName, rigidFlush } from "@engine/core/physics_backend";
import { FIXED_DT } from "@engine/core/fixedstep";

let falhas = 0;
let totalChecks = 0;

function check(nome: string, cond: boolean, detalhe?: string): void {
  totalChecks = totalChecks + 1;
  if (cond) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome + (detalhe ? " - " + detalhe : ""));
    falhas = falhas + 1;
  }
}

function roda(modo: number, declarado: number): void {
  scene.clear();
  rigidSetMode(modo);
  const plat = new GameObject("Plat");
  plat.setMesh(1, 100, 100, 100);
  plat.transform.setPosition(0.0, 5.0, 0.0);
  plat.transform.mass = 0.0;
  plat.stationary = 0; plat.collideFlag = 1;
  if (declarado !== 0) {
    const rb = new Rigidbody(0, 0);
    rb.bodyType = BODY_KINEMATIC;
    plat.addBehavior(rb);
  }
  scene.add(plat);
  scene.computeWorld();
  let s = 0;
  while (s < 180) {
    if (s === 60) plat.transform.vx = 3.0;      // o script dá a ordem no passo 60
    const tomou = rigidStep(scene, 0);
    if (tomou === 0) scene.update(FIXED_DT);
    s = s + 1;
  }
  rigidFlush();
  const desc = (declarado !== 0 ? "declarado" : "inferido") + " " + rigidBackendName();
  io.print("  " + desc + "  x=" + plat.transform.px + "  y=" + plat.transform.py);
  check(desc + ": x avancou ~6.0 apos ordem", Math.abs(plat.transform.px - 6.0) < 0.25);
  check(desc + ": y mantido em 5.0", Math.abs(plat.transform.py - 5.0) < 0.01);
  check(desc + ": vx mantido em 3.0", Math.abs(plat.transform.vx - 3.0) < 0.01);
}

io.print("=== Teste de Cinemático que Começa Parado (Inferido e Declarado) ===");
roda(0, 0); roda(2, 0); roda(1, 0);
roda(0, 1); roda(2, 1); roda(1, 1);

if (falhas === 0) {
  io.print("[PASSOU] Cinemático que começa parado anda após receber velocidade (" + totalChecks + "/" + totalChecks + ")");
} else {
  io.print("[FALHA] Total de falhas: " + falhas + "/" + totalChecks);
}

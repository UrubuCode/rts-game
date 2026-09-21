// Teste: cinemático DECLARADO pelo dono do dado
// (Rigidbody.bodyType = KINEMATIC, massa default 1) movido por POSIÇÃO pelo
// script, com a velocidade que ele comunica a quem está em cima.
// Valida que pbEmpurraTeleportes e pbSoltar usam bodyTypeOf e preservam vx = 3.0
// em CPU, Rust e GPU.
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { BODY_KINEMATIC } from "@engine/rigid/materials";
import { rigidStep, rigidSetMode, rigidBackendName } from "@engine/core/physics_backend";
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
  const nome = rigidBackendName();
  io.print("  backend=" + nome + "  massa=" + plat.transform.mass + "  vx=" + vxVisto +
           "  x=" + plat.transform.px + "  y=" + plat.transform.py);
  check(nome + ": vx preservado apos o passo (3.0)", Math.abs(vxVisto - 3.0) < 0.01);
  check(nome + ": y mantido em 5.0", Math.abs(plat.transform.py - 5.0) < 0.01);
  check(nome + ": x avancou", plat.transform.px > 5.0);
}

io.print("=== Teste de Cinemático Declarado (Rigidbody.bodyType = KINEMATIC, massa default 1) ===");
roda(0); roda(2); roda(1);

if (falhas === 0) {
  io.print("[PASSOU] Cinemático declarado preserva velocidade em CPU, Rust e GPU (" + totalChecks + "/" + totalChecks + ")");
} else {
  io.print("[FALHA] Total de falhas: " + falhas + "/" + totalChecks);
}

// Teste: o mesmo cinemático (mass = 0, vx = 3) nos três modos (CPU, Rust, GPU).
import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
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
  const nome = rigidBackendName();
  io.print("  modo=" + modo + " backend=" + nome + "  x=" + plat.transform.px + "  y=" + plat.transform.py + "  vx=" + plat.transform.vx);
  check(nome + ": x avancou ~6.0", Math.abs(plat.transform.px - 6.0) < 0.30);
  check(nome + ": y mantido em 5.0", Math.abs(plat.transform.py - 5.0) < 0.01);
  check(nome + ": vx mantido em 3.0", Math.abs(plat.transform.vx - 3.0) < 0.01);
}

io.print("=== Teste de Cinemático na CPU, Rust e GPU ===");
roda(0); roda(2); roda(1);

if (falhas === 0) {
  io.print("[PASSOU] Cinemático avança com paridade nos três backends (" + totalChecks + "/" + totalChecks + ")");
} else {
  io.print("[FALHA] Total de falhas: " + falhas + "/" + totalChecks);
}

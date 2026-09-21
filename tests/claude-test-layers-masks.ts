// Teste de paridade de filtragem por Layer e Mask na CPU, Rust e GPU (Lote A).
// Verifica se corpos com máscaras incompatíveis passam através uns dos outros
// e se máscaras compatíveis colidem normalmente.

import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { Rigidbody } from "@scripts/rigidbody";
import { crInit, crSetBody, crSetMaterial, crSyncStatics, crStep, crY, crAvailable } from "@engine/rigid/cpurigid";
import { rbInit, rbSetBody, rbSetMaterial, rbSyncStatics, rbUpload, rbStep, rbY, rbAvailable } from "@engine/rigid/gpurigid";

let falhas = 0;
let totalChecks = 0;
function check(nome: string, cond: boolean): void {
  totalChecks = totalChecks + 1;
  if (cond) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome);
    falhas = falhas + 1;
  }
}

io.print("=== Teste de Filtragem por Layer/Mask ===");

// ── 1. CPU (Scene.resolveCollisions) ──
{
  const sc = new Scene();

  // Chão estático: layer = 1, mask = 1 (em y = 0, topo em y = 0.5)
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0, 0, 0);
  chao.transform.sx = 10; chao.transform.sy = 1; chao.transform.sz = 10;
  chao.stationary = 1; chao.collideFlag = 1;
  chao.layer = 1; chao.mask = 1;
  sc.add(chao);

  // C1: layer = 1, mask = 1 (compatível com chão). Deve parar sobre o chão (y ~ 1.0).
  const c1 = new GameObject("C1_Colide");
  c1.setMesh(1, 100, 100, 100);
  c1.transform.setPosition(-2, 3, 0);
  c1.transform.sx = 1; c1.transform.sy = 1; c1.transform.sz = 1;
  c1.transform.mass = 1; c1.collideFlag = 1;
  c1.layer = 1; c1.mask = 1;
  c1.addBehavior(new Rigidbody(-9.8, 0.0));
  sc.add(c1);

  // C2: layer = 2, mask = 2 (incompatível com chão layer 1). Deve atravessar o chão (y < 0).
  const c2 = new GameObject("C2_Ignora");
  c2.setMesh(1, 100, 100, 100);
  c2.transform.setPosition(2, 3, 0);
  c2.transform.sx = 1; c2.transform.sy = 1; c2.transform.sz = 1;
  c2.transform.mass = 1; c2.collideFlag = 1;
  c2.layer = 2; c2.mask = 2;
  c2.addBehavior(new Rigidbody(-9.8, 0.0));
  sc.add(c2);

  sc.computeWorld();

  for (let s = 0; s < 120; s = s + 1) {
    c1.transform.vy = c1.transform.vy - 9.8 * (1.0 / 60.0);
    c1.transform.py = c1.transform.py + c1.transform.vy * (1.0 / 60.0);
    c2.transform.vy = c2.transform.vy - 9.8 * (1.0 / 60.0);
    c2.transform.py = c2.transform.py + c2.transform.vy * (1.0 / 60.0);
    sc.computeWorld();
    sc.resolveCollisions();
  }

  io.print("  CPU: c1.py = " + c1.transform.py + ", c2.py = " + c2.transform.py);
  check("CPU: C1 colide e assenta no chão (y ~ 1.0)", Math.abs(c1.transform.py - 1.0) < 0.2);
  check("CPU: C2 ignora chão e cai através dele (y < 0)", c2.transform.py < 0.0);
}

// ── 2. RUST (cpurigid) ──
if (crAvailable() !== 0) {
  const sc = new Scene();
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0, 0, 0);
  chao.transform.sx = 10; chao.transform.sy = 1; chao.transform.sz = 10;
  chao.stationary = 1; chao.collideFlag = 1;
  chao.layer = 1; chao.mask = 1;
  sc.add(chao);

  const c1 = new GameObject("C1");
  c1.setMesh(1, 100, 100, 100);
  c1.transform.setPosition(-2, 3, 0);
  c1.layer = 1; c1.mask = 1;
  const rb1 = new Rigidbody(-9.8, 0.0);
  rb1.floorY = -100.0;
  c1.addBehavior(rb1);

  const c2 = new GameObject("C2");
  c2.setMesh(1, 100, 100, 100);
  c2.transform.setPosition(2, 3, 0);
  c2.layer = 2; c2.mask = 2;
  const rb2 = new Rigidbody(-9.8, 0.0);
  rb2.floorY = -100.0;
  c2.addBehavior(rb2);

  sc.computeWorld();

  crInit(2);
  crSetBody(0, -2, 3, 0, 0.5, 0.5, 0.5, 1.0);
  crSetMaterial(0, c1, c1.transform);
  crSetBody(1, 2, 3, 0, 0.5, 0.5, 0.5, 1.0);
  crSetMaterial(1, c2, c2.transform);
  crSyncStatics(sc);

  for (let s = 0; s < 120; s = s + 1) {
    crStep(2);
  }

  io.print("  Rust: c1.y = " + crY(0) + ", c2.y = " + crY(1));
  check("Rust: C1 colide e assenta no chão (y ~ 1.0)", Math.abs(crY(0) - 1.0) < 0.2);
  check("Rust: C2 ignora chão e cai através dele (y < 0)", crY(1) < 0.0);
}

// ── 3. GPU (gpurigid) ──
if (rbAvailable() !== 0) {
  const sc = new Scene();
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0, 0, 0);
  chao.transform.sx = 10; chao.transform.sy = 1; chao.transform.sz = 10;
  chao.stationary = 1; chao.collideFlag = 1;
  chao.layer = 1; chao.mask = 1;
  sc.add(chao);

  const c1 = new GameObject("C1");
  c1.setMesh(1, 100, 100, 100);
  c1.transform.setPosition(-2, 3, 0);
  c1.layer = 1; c1.mask = 1;
  const rb1 = new Rigidbody(-9.8, 0.0);
  rb1.floorY = -100.0;
  c1.addBehavior(rb1);

  const c2 = new GameObject("C2");
  c2.setMesh(1, 100, 100, 100);
  c2.transform.setPosition(2, 3, 0);
  c2.layer = 2; c2.mask = 2;
  const rb2 = new Rigidbody(-9.8, 0.0);
  rb2.floorY = -100.0;
  c2.addBehavior(rb2);

  sc.computeWorld();

  rbInit(2);
  rbSetBody(0, -2, 3, 0, 0.5, 0.5, 0.5, 1.0);
  rbSetMaterial(0, c1, c1.transform);
  rbSetBody(1, 2, 3, 0, 0.5, 0.5, 0.5, 1.0);
  rbSetMaterial(1, c2, c2.transform);
  rbSyncStatics(sc);
  rbUpload();

  for (let s = 0; s < 120; s = s + 1) {
    rbStep(2);
  }

  io.print("  GPU: c1.y = " + rbY(0) + ", c2.y = " + rbY(1));
  check("GPU: C1 colide e assenta no chão (y ~ 1.0)", Math.abs(rbY(0) - 1.0) < 0.2);
  check("GPU: C2 ignora chão e cai através dele (y < 0)", rbY(1) < 0.0);
}

// ── 4. GPU, CORPO × CORPO ──
// O caso acima só exercita o filtro contra um ESTÁTICO. Com duas variantes do
// kernel (com e sem filtro, escolhidas pelo any_mask no rbKick), o filtro entre
// dois corpos precisa de prova própria: um corpo B cai sobre um corpo A imóvel
// (massa 0 e sem integrador, então não cai nem cede), sem nenhum estático na
// cena. Compatíveis, B assenta em cima de A; incompatíveis, B o atravessa. As
// máscaras são não-default nos dois casos, então é a variante COM filtro que
// roda — e o segundo caso reusa o pipeline dela com buffers novos.
function corpoSobreCorpo(layerA: number, maskA: number, layerB: number, maskB: number): f64 {
  const sc = new Scene();
  const a = new GameObject("A_Base");
  a.setMesh(1, 100, 100, 100);
  a.transform.setPosition(0, 0, 0);
  a.layer = layerA; a.mask = maskA;
  const b = new GameObject("B_Cai");
  b.setMesh(1, 100, 100, 100);
  b.transform.setPosition(0, 3, 0);
  b.layer = layerB; b.mask = maskB;
  const rb = new Rigidbody(-9.8, 0.0);
  rb.floorY = -100.0;
  b.addBehavior(rb);
  sc.computeWorld();

  rbInit(2);
  rbSetBody(0, 0, 0, 0, 0.5, 0.5, 0.5, 0.0);
  rbSetMaterial(0, a, a.transform);
  rbSetBody(1, 0, 3, 0, 0.5, 0.5, 0.5, 1.0);
  rbSetMaterial(1, b, b.transform);
  rbSyncStatics(sc);
  rbUpload();
  for (let s = 0; s < 120; s = s + 1) {
    rbStep(2);
  }
  io.print("  GPU corpo×corpo (A " + layerA + "/" + maskA + ", B " + layerB + "/" + maskB +
           "): a.y = " + rbY(0) + ", b.y = " + rbY(1));
  return rbY(1);
}

if (rbAvailable() !== 0) {
  const yCompat = corpoSobreCorpo(1, 1, 1, 1);
  check("GPU: corpo×corpo compatível — B assenta sobre A (y ~ 1.0)", Math.abs(yCompat - 1.0) < 0.2);
  const yIncompat = corpoSobreCorpo(2, 2, 1, 1);
  check("GPU: corpo×corpo incompatível — B atravessa A (y < -1)", yIncompat < -1.0);
}

if (falhas === 0) {
  io.print("[PASSOU] Filtragem por Layer/Mask em CPU, Rust e GPU (" + totalChecks + "/" + totalChecks + ")");
} else {
  io.print("[FALHA] Total de falhas: " + falhas + "/" + totalChecks);
}

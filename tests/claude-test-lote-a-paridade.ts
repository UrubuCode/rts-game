// Teste de Paridade do Lote A:
// 1. Colisores estáticos com offset (centerLocalX/Y/Z) nos 3 backends (CPU, GPU, Rust).
// 2. Preservação de velocidade em corpos cinemáticos ao mover externamente.

import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { scene } from "@editor/control/session";
import { GameObject, COL_SPHERE, COL_BOX } from "@engine/core/gameobject";
import { boxCollider, centerWorldX, centerWorldY, centerWorldZ } from "@engine/core/collider";
import { Transform } from "@engine/core/transform";
import { rbAvailable, rbInit, rbSetBody, rbSetShape, rbUpload, rbSyncStatics,
         rbStep, rbX, rbY, rbZ } from "@engine/rigid/gpurigid";
import { crInit, crSetBody, crSetShape, crSyncStatics, crStep,
         crX, crY, crZ } from "@engine/rigid/cpurigid";
import { rigidStep, rigidSetMode } from "@engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

io.print("=== TESTE LOTE A: PARIDADE DE ESTÁTICOS COM OFFSET E CINEMÁTICOS ===");

// ── 1. TESTE UNITÁRIO: centerWorldX/Y/Z com e sem rotação ──────────────────
{
  const g = new GameObject("ChaoDeslocado");
  g.transform.setPosition(10.0, 0.0, 5.0);
  g.transform.wx = 10.0; g.transform.wy = 0.0; g.transform.wz = 5.0;
  g.transform.sx = 2.0; g.transform.sy = 1.0; g.transform.sz = 2.0;
  
  // Sem colisor: centro = transform.wx/wy/wz
  check("Sem Collider: centerWorldX == wx", centerWorldX(g, g.transform) === 10.0 ? 1 : 0);
  check("Sem Collider: centerWorldY == wy", centerWorldY(g, g.transform) === 0.0 ? 1 : 0);
  check("Sem Collider: centerWorldZ == wz", centerWorldZ(g, g.transform) === 5.0 ? 1 : 0);

  // Com colisor deslocado (offset local cx=1, cy=2, cz=3)
  const col = boxCollider(1.0, 0.5, 1.0);
  col.cx = 1.0; col.cy = 2.0; col.cz = 3.0;
  g.addBehavior(col);

  // Sem rotação: offset é multiplicado pela escala (ox = 1*2=2, oy = 2*1=2, oz = 3*2=6)
  // wx = 10 + 2 = 12, wy = 0 + 2 = 2, wz = 5 + 6 = 11
  check("Com Collider (yaw=0): centerWorldX", math.abs(centerWorldX(g, g.transform) - 12.0) < 0.001 ? 1 : 0);
  check("Com Collider (yaw=0): centerWorldY", math.abs(centerWorldY(g, g.transform) - 2.0) < 0.001 ? 1 : 0);
  check("Com Collider (yaw=0): centerWorldZ", math.abs(centerWorldZ(g, g.transform) - 11.0) < 0.001 ? 1 : 0);

  // Com rotação yaw = 90 graus (PI / 2): ox e oz rotacionam
  g.transform.wry = math.PI * 0.5;
  // x' = ox * cos(90) + oz * sin(90) = 2 * 0 + 6 * 1 = 6 -> wx = 10 + 6 = 16
  // z' = -ox * sin(90) + oz * cos(90) = -2 * 1 + 6 * 0 = -2 -> wz = 5 - 2 = 3
  check("Com Collider (yaw=90): centerWorldX rotacionado", math.abs(centerWorldX(g, g.transform) - 16.0) < 0.01 ? 1 : 0);
  check("Com Collider (yaw=90): centerWorldZ rotacionado", math.abs(centerWorldZ(g, g.transform) - 3.0) < 0.01 ? 1 : 0);
}

// ── 2. TESTE DE PARIDADE GPU × RUST COM ESTÁTICO DESLOCADO ────────────────
{
  scene.clear();
  
  // Cria um estático com colisor deslocado em X por +4.0
  const chao = new GameObject("ChaoOffset");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 10.0; chao.transform.sy = 1.0; chao.transform.sz = 10.0;
  chao.stationary = 1;
  chao.collideFlag = 1;
  const cChao = boxCollider(5.0, 0.5, 5.0);
  cChao.cx = 4.0; // deslocado 4 unidades para a direita (em mundo: 4 * 10 = 40 se escalado, ou local sem escala?)
  // Lembrete: cChao.cx é local sem escala, multiplicado por sx na montagem.
  // Vamos usar sx = 1.0 para que cx = 4.0 signifique exatamente +4.0 em mundo.
  chao.transform.sx = 1.0; chao.transform.sy = 1.0; chao.transform.sz = 1.0;
  chao.addBehavior(cChao);
  scene.add(chao);
  scene.computeWorld();

  // Corpo 0: cai onde o pivô está (x=0), mas NÃO deve bater no colisor deslocado
  // Corpo 1: cai onde o colisor deslocado está (x=4), e DEVE apoiar no colisor
  const c0 = new GameObject("C0");
  c0.setMesh(1, 200, 50, 50);
  c0.transform.setPosition(0.0, 5.0, 0.0);
  c0.transform.sx = 1.0; c0.transform.sy = 1.0; c0.transform.sz = 1.0;
  c0.collideFlag = 1;

  const c1 = new GameObject("C1");
  c1.setMesh(1, 50, 200, 50);
  c1.transform.setPosition(4.0, 5.0, 0.0);
  c1.transform.sx = 1.0; c1.transform.sy = 1.0; c1.transform.sz = 1.0;
  c1.collideFlag = 1;

  // Testar Rust (CPU paralela)
  crInit(2);
  crSetBody(0, 0.0, 5.0, 0.0, 0.5, 0.5, 0.5, 1.0);
  crSetShape(0, COL_BOX);
  crSetBody(1, 4.0, 5.0, 0.0, 0.5, 0.5, 0.5, 1.0);
  crSetShape(1, COL_BOX);
  crSyncStatics(scene);

  for (let s = 0; s < 300; s = s + 1) {
    crStep(2);
  }

  const rustY0 = crY(0);
  const rustY1 = crY(1);

  // Corpo 1 deve ter assentado sobre o colisor estático (y ~ 1.0 = topo do chao em 0.5 + meia altura 0.5)
  check("Rust: C1 assentou sobre estático deslocado (y ~ 1.0)", math.abs(rustY1 - 1.0) < 0.15 ? 1 : 0);

  // Testar GPU se disponível
  if (rbAvailable() !== 0) {
    rbInit(2);
    rbSetBody(0, 0.0, 5.0, 0.0, 0.5, 0.5, 0.5, 1.0);
    rbSetShape(0, COL_BOX);
    rbSetBody(1, 4.0, 5.0, 0.0, 0.5, 0.5, 0.5, 1.0);
    rbSetShape(1, COL_BOX);
    rbUpload();
    rbSyncStatics(scene);

    for (let s = 0; s < 300; s = s + 1) {
      rbStep(2);
    }

    const gpuY0 = rbY(0);
    const gpuY1 = rbY(1);

    check("GPU: C1 assentou sobre estático deslocado (y ~ 1.0)", math.abs(gpuY1 - 1.0) < 0.15 ? 1 : 0);
    check("Paridade Rust × GPU no estático deslocado", math.abs(rustY1 - gpuY1) < 0.15 ? 1 : 0);
  } else {
    io.print("  [skip] GPU não disponível para teste de paridade");
  }
}

// ── 3. TESTE DE PRESERVAÇÃO DE VELOCIDADE CINEMÁTICA VIA RIGIDSTEP ────────
{
  scene.clear();
  rigidSetMode(2); // Força Rust para teste determinístico

  const dyn = new GameObject("Dinamico");
  dyn.setMesh(1, 100, 100, 100);
  dyn.transform.setPosition(0.0, 10.0, 0.0);
  dyn.transform.mass = 1.0;
  dyn.transform.vx = 5.0;
  dyn.stationary = 0;
  dyn.collideFlag = 1;
  scene.add(dyn);

  const kin = new GameObject("Cinematico");
  kin.setMesh(1, 100, 100, 100);
  kin.transform.setPosition(20.0, 10.0, 0.0);
  kin.transform.mass = 0.0; // Cinemático!
  kin.transform.vx = 5.0;
  kin.stationary = 0;
  kin.collideFlag = 1;
  scene.add(kin);

  scene.computeWorld();

  // 1º passo: inicializa e sincroniza no backend Rust
  rigidStep(scene, 1);

  // Agora movemos ambos externamente (teleporte / script de navegação)
  dyn.transform.px = 1.0;
  dyn.transform.vx = 12.0; // Script tenta dar velocidade

  kin.transform.px = 21.0;
  kin.transform.vx = 12.0; // Script dá velocidade ao cinemático

  // 2º passo: pbEmpurraTeleportes deve zerar o dinâmico e preservar o cinemático
  rigidStep(scene, 0);

  check("Cinemático preservou vx ao mover externamente", math.abs(kin.transform.vx - 12.0) < 0.01 ? 1 : 0);
  check("Dinâmico teve vx resetado no teleporte", math.abs(dyn.transform.vx) < 0.01 ? 1 : 0);
}

io.print("Resultado: " + ok + " passaram, " + fail + " falharam.");
if (fail > 0) {
  io.print("[FALHA]");
} else {
  io.print("[PASSOU]");
}

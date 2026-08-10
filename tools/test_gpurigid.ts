// Teste de sistema dos RÍGIDOS NA GPU (engine/rigid/gpurigid.ts) — headless.
//
//   rts.exe run tools/test_gpurigid.ts
//
// Os MESMOS invariantes que provamos no solver CPU (a lição da campanha do
// castelo): pilha assenta e DORME, coluna não tem ciclo-limite, nada atravessa
// o chão, nada nasce energia do nada. Sem GPU: [PULOU] limpo.
import io from "../compat/io.ts";
import math from "../compat/math.ts";

import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { rbAvailable, rbInit, rbSetBody, rbSetVel, rbUpload, rbSyncStatics,
         rbStep, rbReadState, rbX, rbY, rbZ, rbSleep, rbVelX, rbVelY, rbVelZ } from "../engine/rigid/gpurigid";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

if (rbAvailable() === 0) {
  io.print("[gpu-rigido] sem GPU — [PULOU] (o backend CPU da cena cobre)");
  io.print("[resultado] 0 ok, 0 falhas");
  io.print("[PASSOU]");
} else {
  // chão estático via cena
  {
    const g = new GameObject("Chao");
    g.setMesh(1, 100, 100, 100);
    g.transform.setPosition(0.0, 0.0, 0.0);
    g.transform.sx = 40.0; g.transform.sy = 1.0; g.transform.sz = 40.0;
    g.stationary = 1;
    scene.add(g);
    scene.computeWorld();
  }

  // ── cenário: coluna 1x5 + pilha 3x3x3 + um bloco jogado ──────────────────
  const N = 5 + 27 + 1;
  check("rbInit", rbInit(N));
  rbSyncStatics(scene);
  let idx = 0;
  // coluna (o teste do ciclo-limite: miolo preso em vy=-0.63 era O bug)
  let c = 0;
  while (c < 5) {
    rbSetBody(idx, 0.0 - 6.0, 1.15 + c * 1.32, 0.0, 0.65, 0.65, 0.65, 4.0);
    idx = idx + 1;
    c = c + 1;
  }
  // pilha 3x3x3
  let a = 0;
  while (a < 3) {
    let b = 0;
    while (b < 3) {
      let d = 0;
      while (d < 3) {
        rbSetBody(idx, a * 1.4 - 1.4, 1.15 + b * 1.32, d * 1.4 - 1.4,
                  0.65, 0.65, 0.65, 4.0);
        idx = idx + 1;
        d = d + 1;
      }
      b = b + 1;
    }
    a = a + 1;
  }
  // projétil: será disparado contra a pilha depois do assentamento
  const BALA = idx;
  rbSetBody(BALA, 12.0, 2.0, 0.0, 0.8, 0.8, 0.8, 32.0);
  rbUpload();

  // ── fase 1: assentar e DORMIR (5 s) ──────────────────────────────────────
  let f = 0;
  while (f < 300) { rbStep(1); f = f + 1; }
  rbStep(0);
  let dormindo = 0;
  let sobChao = 0;
  let vmax2: f64 = 0.0;
  let i = 0;
  while (i < N) {
    if (rbSleep(i) >= 10.0) dormindo = dormindo + 1;
    if (rbY(i) < 1.0) sobChao = sobChao + 1;
    i = i + 1;
  }
  rbReadState();
  i = 0;
  while (i < N) {
    const s2 = rbVelX(i) * rbVelX(i) + rbVelY(i) * rbVelY(i) + rbVelZ(i) * rbVelZ(i);
    if (s2 > vmax2) vmax2 = s2;
    i = i + 1;
  }
  io.print("  apos 5 s: dormindo=" + dormindo + "/" + N + " sobChao=" + sobChao +
           " vmax=" + math.sqrt(vmax2));
  check("nada atravessou o chao", sobChao === 0 ? 1 : 0);
  check("TUDO dormiu (coluna sem ciclo-limite)", dormindo === N ? 1 : 0);
  check("energia zerada (vmax < 0.45)", vmax2 < 0.2025 ? 1 : 0);
  // topo da coluna na altura certa (5 blocos de 1.3 sobre o chao em 0.5)
  const topoY = rbY(4);
  io.print("  topo da coluna: y=" + topoY);
  check("coluna empilhada (topo entre 5.5 e 6.5)", topoY > 5.5 && topoY < 6.5 ? 1 : 0);

  // ── fase 2: DISPARO acorda e derruba; depois re-assenta e re-dorme ───────
  rbReadState();
  rbSetVel(BALA, 0.0 - 30.0, 2.0, 0.0);
  rbUpload();
  f = 0;
  while (f < 600) { rbStep(1); f = f + 1; }
  rbStep(0);
  dormindo = 0;
  sobChao = 0;
  i = 0;
  while (i < N) {
    if (rbSleep(i) >= 10.0) dormindo = dormindo + 1;
    if (rbY(i) < 1.0 && rbY(i) > 0.0 - 17.0) sobChao = sobChao + 1;
    i = i + 1;
  }
  io.print("  apos o impacto + 10 s: dormindo=" + dormindo + "/" + N + " sobChao=" + sobChao);
  check("pos-impacto: nada sob o chao", sobChao === 0 ? 1 : 0);
  check("pos-impacto: os escombros re-DORMEM (>= 90%)", dormindo * 10 >= N * 9 ? 1 : 0);

  io.print("[resultado] " + ok + " ok, " + fail + " falhas");
  io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
}

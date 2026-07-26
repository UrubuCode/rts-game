// Teste de sistema do fluido GPU (engine/fluid/gpufluid.ts) — headless.
//
//   rts.exe run tools/test_gpufluid.ts
//
// Numa máquina SEM GPU imprime [PULOU] e sai com sucesso (o módulo é opcional
// por design; o jogo cai para o fluido CPU).
import io from "rts:io";

import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { gfAvailable, gfInit, gfSpawnBlock, gfSyncColliders, gfStep,
         gfX, gfY, gfZ, gfCount, gfHidden } from "../engine/fluid/gpufluid";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

if (gfAvailable() === 0) {
  io.print("[gpu-fluido] sem GPU nesta maquina — [PULOU] (fallback CPU e o esperado)");
  io.print("[resultado] 0 ok, 0 falhas");
  io.print("[PASSOU]");
} else {
  // ── cena: um chão e uma caixa no meio do caminho da água ──────────────────
  function box(x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64): void {
    const o = new GameObject("Caixa");
    o.setMesh(1, 100, 100, 100);          // kind 1 => COL_BOX
    o.transform.setPosition(x, y, z);
    o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
    o.stationary = 1;
    scene.add(o);
  }
  box(0.0, 0.0, 0.0, 12.0, 1.0, 12.0);    // chão (topo em y=0.5)
  box(0.0, 1.25, 0.0, 2.0, 1.5, 2.0);     // obstáculo (topo em y=2.0)
  scene.computeWorld();

  const N = 1024;                          // 8x16x8
  check("gfInit", gfInit(N));
  gfSyncColliders(scene);
  // coluna nasce ACIMA do obstáculo e desaba sobre ele
  gfSpawnBlock(8, 16, 8, 0.0 - 1.0, 3.2, 0.0 - 1.0, 0.3);
  check("count", gfCount() === N ? 1 : 0);

  // Logo após o spawn a coluna é COMPACTA: precisa existir miolo escondido —
  // senão o culling nunca é exercitado e o teste de cobertura passa vazio.
  let f = 0;
  while (f < 10) { gfStep(2); f = f + 1; }
  gfStep(0);
  let escondidasCedo = 0;
  let e = 0;
  while (e < N) { if (gfHidden(e) === 1) escondidasCedo = escondidasCedo + 1; e = e + 1; }
  io.print("  escondidas na coluna compacta: " + escondidasCedo + "/" + N);
  check("coluna compacta tem miolo escondido (culling exercitado)", escondidasCedo > 100 ? 1 : 0);
  // cobertura das escondidas TAMBÉM na configuração compacta
  let expostasCedo = 0;
  e = 0;
  while (e < N) {
    if (gfHidden(e) === 1) {
      const ax = gfX(e); const ay = gfY(e); const az = gfZ(e);
      let cover = 0;
      let b2 = 0;
      while (b2 < N) {
        if (b2 !== e) {
          const dx = gfX(b2) - ax; const dy = gfY(b2) - ay; const dz = gfZ(b2) - az;
          if (dx * dx + dy * dy + dz * dz < 0.49) {
            let oct = 0;
            if (dx > 0.0) oct = oct + 1;
            if (dy > 0.0) oct = oct + 2;
            if (dz > 0.0) oct = oct + 4;
            cover = cover | (1 << oct);
          }
        }
        b2 = b2 + 1;
      }
      if (cover !== 255) expostasCedo = expostasCedo + 1;
    }
    e = e + 1;
  }
  check("miolo compacto: cortada => cercada nas 6 direcoes", expostasCedo === 0 ? 1 : 0);

  // 600 frames de 2 sub-passos (5 s simulados)
  f = 0;
  while (f < 590) { gfStep(2); f = f + 1; }
  gfStep(0);   // só o readback final

  // 1) NENHUMA partícula atravessou o chão (topo 0.5; raio 0.16)
  // 2) NENHUMA dentro do obstáculo (|x|<2+eps, |z|<2+eps, y entre 0.5 e 2.0)
  // 3) o líquido ASSENTOU: espalhou pelos lados e ninguém ficou voando
  let underFloor = 0;
  let insideBox = 0;
  let flying = 0;
  let minY: f64 = 999.0;
  let maxY: f64 = 0.0 - 999.0;
  let i = 0;
  while (i < N) {
    const x = gfX(i); const y = gfY(i); const z = gfZ(i);
    if (y < 0.40) underFloor = underFloor + 1;
    const ax = x < 0.0 ? 0.0 - x : x;
    const az = z < 0.0 ? 0.0 - z : z;
    // meia-extensão do obstáculo é sx*0.5 = 1.0; "dentro" com margem de folga
    // para não contar a água ENCOSTADA na lateral (raio 0.16)
    if (ax < 0.9 && az < 0.9 && y > 0.65 && y < 1.85) insideBox = insideBox + 1;
    if (y > 6.0) flying = flying + 1;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    i = i + 1;
  }
  io.print("  minY=" + minY + " maxY=" + maxY +
           " sobChao=" + underFloor + " dentroCaixa=" + insideBox + " voando=" + flying);
  check("nenhuma particula sob o chao", underFloor === 0 ? 1 : 0);
  check("nenhuma particula DENTRO do obstaculo", insideBox === 0 ? 1 : 0);
  check("nenhuma particula voando (assentou)", flying === 0 ? 1 : 0);
  check("liquido acima do chao fisico", minY > 0.4 ? 1 : 0);

  // ── CASCA VISÍVEL DE TODOS OS ÂNGULOS ────────────────────────────────────
  // O render corta partículas de densidade alta ("miolo"). O critério só é
  // seguro se TODA partícula cortada estiver CERCADA em todas as 6 direções
  // por outra partícula próxima — aí nenhum ângulo de câmera vê buraco.
  // O corte agora é o veredito da PRÓPRIA GPU (gfHidden: cercada nas 6
  // direções, sinal do w). Este teste re-verifica a geometria na CPU, com o
  // MESMO critério — se o kernel mentir, o teste pega.
  let desenhadas = 0;
  let a = 0;
  while (a < N) { if (gfHidden(a) === 0) desenhadas = desenhadas + 1; a = a + 1; }
  let expostas = 0;   // cortadas mas com alguma direção descoberta = buraco
  const RV: f64 = 0.5;      // raio de vizinhança que "tampa" a visão (= kernel)
  a = 0;
  while (a < N) {
    if (gfHidden(a) === 1) {
      const ax = gfX(a); const ay = gfY(a); const az = gfZ(a);
      let cover = 0;
      let b = 0;
      while (b < N) {
        if (b !== a) {
          const dx = gfX(b) - ax; const dy = gfY(b) - ay; const dz = gfZ(b) - az;
          if (dx * dx + dy * dy + dz * dz < 0.49) {
            let oct = 0;
            if (dx > 0.0) oct = oct + 1;
            if (dy > 0.0) oct = oct + 2;
            if (dz > 0.0) oct = oct + 4;
            cover = cover | (1 << oct);
          }
        }
        b = b + 1;
      }
      if (cover !== 255) {
        expostas = expostas + 1;
      }
    }
    a = a + 1;
  }
  io.print("  casca=" + desenhadas + "/" + N + " cortadasExpostas=" + expostas);
  check("casca cobre todos os angulos (cortada => cercada nas 6 direcoes)", expostas === 0 ? 1 : 0);

  io.print("[resultado] " + ok + " ok, " + fail + " falhas");
  io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
}

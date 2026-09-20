// ═══════════════════════════════════════════════════════════════════════════
// FLUIDO — a fachada BURRA do motor (doutrina rts:render/egui: quem consome
// física de fluido fala SÓ com este módulo e nunca nomeia o backend).
//
//   flInit(n)            GPU sempre que houver; CPU só como fallback (política
//                        do projeto — 2026-07-26). NENHUMA decisão automática:
//                        troca de backend é REGRA EXPLÍCITA do dev, via
//                        flSwitch — ex.: "fluido a mais de X da câmera vai
//                        para a GPU": `if (dist > X && flBackend() === 0)
//                        flSwitch(1);`. (O medidor decide.ts existe como
//                        ferramenta de telemetria, mas o motor não o consulta.)
//   flInit2(n, modo)     força um backend (0 = CPU, 1 = GPU)
//   flSpawnBlock / flSyncColliders / flStep
//   flX / flY / flZ / flHidden / flCount     leitura para o desenho
//   flSwitch(modo)       TROCA DE BACKEND EM PLENO VOO — transfere posição,
//                        velocidade e densidade de repouso; a água não
//                        teleporta nem muda de comportamento (os dois backends
//                        implementam as MESMAS equações, por contrato).
//   flBackend()          0 = CPU, 1 = GPU (telemetria/HUD)
//
// A troca a quente é o teste de que a abstração é real: se um dia o backend
// GPU virar outro (Vulkan nativo, compute do render instanciado), os
// consumidores não mudam uma linha.
// ═══════════════════════════════════════════════════════════════════════════
import io from "../../compat/io.ts";

import { Scene } from "../core/scene";
import { cfInit, cfSpawnBlock, cfSyncColliders, cfStep, cfX, cfY, cfZ,
         cfVelX, cfVelY, cfVelZ, cfHidden, cfCount, cfSetState, cfSetRest,
         cfRestDensity } from "./cpufluid";
import { gfAvailable, gfInit, gfSpawnBlock, gfSyncColliders, gfStep, gfPull, gfKick, gfService,
         gfX, gfY, gfZ, gfVelX, gfVelY, gfVelZ, gfHidden, gfCount,
         gfSetState, gfUploadState, gfReadState, gfSetRest,
         gfRestDensity, gfPosBufferId, gfApplyWaterForces } from "./gpufluid";

let flMode = 0;      // 0 = CPU, 1 = GPU
let flN = 0;

export function flBackend(): number { return flMode; }
export function flCount(): number { return flN; }

/// GPU-first: usa a GPU se existir; sem GPU cai para a CPU sem erro.
export function flInit(n: number): number { return flInit2(n, 1); }

/// `modo`: 0 = CPU, 1 = GPU (sem GPU, o pedido de GPU cai para CPU sem erro).
export function flInit2(n: number, modo: number): number {
  flN = n;
  let m = modo;
  if (m === 1 && gfAvailable() === 0) m = 0;   // sem GPU não há escolha
  flMode = m;
  if (m === 1) {
    if (gfInit(n) === 0) { flMode = 0; return cfInit(n); }
    io.print("[fluido] n=" + n + " => GPU");
    return 1;
  }
  io.print("[fluido] n=" + n + " => CPU" + (modo === 1 ? " (fallback: sem GPU)" : ""));
  return cfInit(n);
}

export function flSpawnBlock(cols: number, rows: number, layers: number,
                             x0: f64, y0: f64, z0: f64, spacing: f64): void {
  if (flMode === 1) gfSpawnBlock(cols, rows, layers, x0, y0, z0, spacing);
  else cfSpawnBlock(cols, rows, layers, x0, y0, z0, spacing);
}

export function flSyncColliders(sc: Scene): void {
  if (flMode === 1) gfSyncColliders(sc);
  else cfSyncColliders(sc);
}

/// AGUA EMPURRA O MUNDO: aplica os impulsos agregados nos blocos nao-estaticos
/// da cena (backend GPU; no CPU e no-op por ora). Chamar apos flStep.
export function flApplyForces(sc: Scene, strength: f64): void {
  if (flMode === 1) gfApplyWaterForces(sc, strength);
}

export function flStep(substeps: number): void {
  if (flMode === 1) gfStep(substeps);
  else cfStep(substeps);
}
/// PULL/KICK separados (GPU): juntar os pulls de TODOS os sistemas num único
/// ponto do frame = uma espera só. No CPU, pull é no-op e kick é o passo.
export function flPull(): void { if (flMode === 1) gfPull(); }
/// Física como serviço (assíncrona): 1 = estado novo aplicado neste frame.
/// No CPU o passo é síncrono e sempre "chega".
export function flService(substeps: number): number {
  if (flMode === 1) return gfService(substeps);
  cfStep(substeps);
  return 1;
}
export function flKick(substeps: number): void {
  if (flMode === 1) gfKick(substeps);
  else cfStep(substeps);
}

/// Id do buffer GPU de posições para o render INSTANCIADO (drawWaterGPU).
/// 0 no backend CPU — aí o consumidor desenha pelo laço flX/flY/flZ.
export function flPosGpuBuf(): i64 { return flMode === 1 ? gfPosBufferId() : 0; }

export function flX(i: number): f64 { return flMode === 1 ? gfX(i) : cfX(i); }
export function flY(i: number): f64 { return flMode === 1 ? gfY(i) : cfY(i); }
export function flZ(i: number): f64 { return flMode === 1 ? gfZ(i) : cfZ(i); }
export function flHidden(i: number): number { return flMode === 1 ? gfHidden(i) : cfHidden(i); }

/// Troca de backend EM PLENO VOO. Devolve o modo efetivo (a troca para GPU
/// numa máquina sem GPU é recusada e devolve 0). Chamar `flSyncColliders`
/// depois — o backend novo ainda não conhece a cena.
export function flSwitch(modo: number): number {
  if (modo === flMode) return flMode;
  if (modo === 1) {
    if (gfAvailable() === 0) return flMode;
    if (gfInit(flN) === 0) return flMode;
    // CPU -> GPU: estado inteiro sobe de uma vez
    let i = 0;
    while (i < flN) {
      gfSetState(i, cfX(i), cfY(i), cfZ(i), cfVelX(i), cfVelY(i), cfVelZ(i));
      i = i + 1;
    }
    gfUploadState();
    gfSetRest(cfRestDensity());
    flMode = 1;
    io.print("[fluido] handoff CPU -> GPU (" + flN + " particulas)");
    return 1;
  }
  // GPU -> CPU: sincroniza os espelhos AGORA (o passo pipelined deixa o
  // espelho 1 frame atrás) e desce o estado
  gfReadState();
  cfInit(flN);
  let i = 0;
  while (i < flN) {
    cfSetState(i, gfX(i), gfY(i), gfZ(i), gfVelX(i), gfVelY(i), gfVelZ(i));
    i = i + 1;
  }
  cfSetRest(gfRestDensity());
  flMode = 0;
  io.print("[fluido] handoff GPU -> CPU (" + flN + " particulas)");
  return 0;
}

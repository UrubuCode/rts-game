// ═══════════════════════════════════════════════════════════════════════════
// LÍQUIDO NA GPU — demo do módulo engine/fluid/gpufluid.ts (SPH em WGSL).
//
//   rts.exe run gpu_fluid_demo.ts
//
// Uma coluna d'água desaba sobre uma escadaria de blocos: os blocos são
// GameObjects NORMAIS da cena (colShape BOX, os mesmos colisores do solver
// rígido) — o kernel WGSL recebe os AABBs via gfSyncColliders e a água escorre
// degrau a degrau. 8.192 partículas; a física inteira na GPU com relógio
// próprio (o frame desenha o resultado do frame anterior — o jogo nunca trava
// esperando a física).
//
// Controles: WASD voa, botão DIREITO gira, ESPAÇO sobe, R solta a água de novo.
// ═══════════════════════════════════════════════════════════════════════════
import io from "./compat/io.ts";
import math from "./compat/math.ts";
import input from "rts:input";
import gpu from "rts:gpu";

import { scene, S } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { gfAvailable, gfInit, gfSpawnBlock, gfSyncColliders, gfStep,
         gfX, gfY, gfZ, gfHidden } from "./engine/fluid/gpufluid";
import { initMeshes, setCam, setLgt, setShadow, drawGPU,
         frustumBegin, inFrustumFast, winWidth, winHeight, setVsync } from "./engine/render/gpu3d";
import { ctrlServe, ctrlPoll } from "./editor/control/server";

let W = 1280;
let H = 720;
const app = createAppAt("RTS — Castelo Inundado (SPH na GPU + colisores da cena)", W, H, 90, 50);
const WIN = app._win;
const FOV: f64 = 1.05;
S.win = WIN;
initMeshes(WIN);

if (gfAvailable() === 0) {
  io.print("[gpu-fluido] SEM GPU — rode o fluid_demo.ts (CPU). Encerrando.");
  app.close();
}
io.print("[gpu-fluido] adapter: " + gpu.adapter_name());

// ── cena: tanque + escadaria de blocos (tudo colisor BOX de verdade) ────────
function bloco(name: string, x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64,
               r: number, g: number, b: number): void {
  const o = new GameObject(name);
  o.setMesh(1, r, g, b);          // kind 1 => COL_BOX (o mesmo do solver rígido)
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.stationary = 1;
  scene.add(o);
}
const TANK_X: f64 = 5.0;
const TANK_Z: f64 = 2.6;
bloco("Chao", 0.0, 0.0, 0.0, TANK_X * 2.0 + 1.0, 1.0, TANK_Z * 2.0 + 1.0, 70, 78, 90);
bloco("ParedeE", 0.0 - TANK_X - 0.4, 3.0, 0.0, 0.8, 6.0, TANK_Z * 2.0 + 1.0, 90, 100, 115);
bloco("ParedeD", TANK_X + 0.4, 3.0, 0.0, 0.8, 6.0, TANK_Z * 2.0 + 1.0, 90, 100, 115);
bloco("ParedeF", 0.0, 3.0, TANK_Z + 0.4, TANK_X * 2.0 + 1.0, 6.0, 0.8, 80, 90, 105);
bloco("ParedeT", 0.0, 3.0, 0.0 - TANK_Z - 0.4, TANK_X * 2.0 + 1.0, 6.0, 0.8, 80, 90, 105);
// ── CASTELO: muralhas de blocos individuais + torres, com portão ────────────
// (mesma linguagem visual do castelo_demo; cada bloco é um colisor real)
const B: f64 = 0.55;             // aresta do bloco de muralha
const CX: f64 = 1.6;             // centro do castelo
const CH: f64 = 2.0;             // meia-largura do pátio
function muralha(): void {
  let camada = 0;
  while (camada < 3) {
    const y = 0.5 + B * 0.5 + camada * B;
    let k = 0;
    while (k < 7) {
      const off = (k - 3) * B * 1.05;
      // norte e sul
      bloco("M", CX + off, y, 0.0 - CH, B, B, B, 168, 158, 142);
      bloco("M", CX + off, y, CH, B, B, B, 168, 158, 142);
      // leste (fechado); oeste tem PORTÃO: vão de 2 blocos nas 2 camadas de baixo
      bloco("M", CX + CH, y, off, B, B, B, 160, 150, 134);
      const ehPortao = camada < 2 && (k === 3 || k === 2);
      if (ehPortao === false) bloco("M", CX - CH, y, off, B, B, B, 160, 150, 134);
      k = k + 1;
    }
    camada = camada + 1;
  }
  // torres nos 4 cantos, 5 blocos de altura
  let t = 0;
  while (t < 4) {
    const tx = t % 2 === 0 ? CX - CH : CX + CH;
    const tz = t < 2 ? 0.0 - CH : CH;
    let c2 = 0;
    while (c2 < 5) {
      bloco("T", tx, 0.5 + B * 0.5 + c2 * B, tz, B * 1.3, B, B * 1.3, 150, 140, 126);
      c2 = c2 + 1;
    }
    t = t + 1;
  }
}
muralha();
scene.computeWorld();

// ── fluido ──────────────────────────────────────────────────────────────────
const COLS = 32;
const ROWS = 32;
const LAYERS = 16;
const N = 16384;                   // 32*32*16 — o tanque inteiro
const SPACING: f64 = 0.28;
const DRAW_SCALE: f64 = 0.27;
const SUBSTEPS = 2;

if (gfInit(N) === 0) { io.print("[gpu-fluido] ERRO no init"); app.close(); }
gfSyncColliders(scene);
function solta(): void {
  gfSpawnBlock(COLS, ROWS, LAYERS,
               0.0 - TANK_X + 0.3, 2.6, 0.0 - (LAYERS - 1) * SPACING * 0.5, SPACING);
}
solta();

ctrlServe(7777);
io.print("[gpu-fluido] N=" + N + " colisores da cena sincronizados");
io.print("[gpu-fluido] WASD voa | botao DIR gira | ESPACO sobe | R solta de novo");

// ── câmera ──────────────────────────────────────────────────────────────────
S.camX = 0.0; S.camY = 7.0; S.camZ = 0.0 - 12.0;
S.camYaw = 0.0; S.camPitch = 0.0 - 0.42;
S.lightX = 8.0; S.lightY = 16.0; S.lightZ = 0.0 - 10.0; S.lightAmb = 0.34;
setVsync(WIN, 0);

let frames = 0;
let prevR = 0;
let dtAcc: f64 = 0.0;
let dtMax: f64 = 0.0;
let tPhys: f64 = 0.0;
let tRead: f64 = 0.0;
let tDraw: f64 = 0.0;


function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  const dt: f64 = app.delta();
  frames = frames + 1;
  dtAcc = dtAcc + dt;
  if (dt > dtMax) dtMax = dt;
  const dts: f64 = dt / 1000.0;

  const kW = app.keyDown(122); const kS = app.keyDown(118);
  const kA = app.keyDown(100); const kD = app.keyDown(103);
  const kSp = app.keyDown(3);
  const kR = app.keyDown(114);
  if (input.mouseDown(WIN, 1) !== 0) {
    S.camYaw = S.camYaw + input.mouseDeltaX(WIN) * 0.005;
    S.camPitch = S.camPitch - input.mouseDeltaY(WIN) * 0.005;
  }
  if (S.camPitch > 1.4) S.camPitch = 1.4;
  if (S.camPitch < 0.0 - 1.4) S.camPitch = 0.0 - 1.4;
  const cyw = math.cos(S.camYaw); const syw = math.sin(S.camYaw);
  const cpM = math.cos(S.camPitch); const spM = math.sin(S.camPitch);
  const mv: f64 = 9.0 * dts;
  if (kW !== 0) { S.camX = S.camX + syw * cpM * mv; S.camY = S.camY + spM * mv; S.camZ = S.camZ + cyw * cpM * mv; }
  if (kS !== 0) { S.camX = S.camX - syw * cpM * mv; S.camY = S.camY - spM * mv; S.camZ = S.camZ - cyw * cpM * mv; }
  if (kD !== 0) { S.camX = S.camX + cyw * mv; S.camZ = S.camZ - syw * mv; }
  if (kA !== 0) { S.camX = S.camX - cyw * mv; S.camZ = S.camZ + syw * mv; }
  if (kSp !== 0) S.camY = S.camY + mv;

  if (kR !== 0 && prevR === 0) solta();
  prevR = kR;

  ctrlPoll(W, H);

  // física GPU (relógio próprio: lê o frame anterior, submete o atual)
  const t0 = performance.now();
  gfStep(SUBSTEPS);
  tPhys = tPhys + (performance.now() - t0);

  // render
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 20.0);
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);

  // blocos da cena
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  const nObjs = objs.length;
  let i = 0;
  while (i < nObjs) {
    const o = objs[i];
    const t: Transform = trs[i];
    const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
    drawGPU(WIN, o.meshKind, t.wx, t.wy, t.wz, t.wrx, t.wry,
            t.sx, t.sy, t.sz, col, o.emissive, o.tex);
    i = i + 1;
  }

  // água, direto do buffer de readback — instrumentado: (a) leitura das
  // posições via FFI, (b) chamadas de desenho
  const tA = performance.now();
  i = 0;
  let drawn = 0;
  while (i < N) {
    const x = gfX(i);
    const y = gfY(i);
    const z = gfZ(i);
    i = i + 1;
  }
  const tB = performance.now();
  tRead = tRead + (tB - tA);
  // CULLING DE CASCA: a GPU marca quem está CERCADO nas 6 direções (sinal do
  // w) — invisível de QUALQUER ângulo de câmera. Só a casca é desenhada.
  i = 0;
  while (i < N) {
    if (gfHidden(i) === 0) {
      const x = gfX(i);
      const y = gfY(i);
      const z = gfZ(i);
      if (inFrustumFast(x, y, z, 0.3) !== 0) {
        const shade = math.floor(y * 22.0);
        const col = (60 << 16) | ((130 + shade) << 8) | 230;
        drawGPU(WIN, 4, x, y, z, 0.0, 0.0, DRAW_SCALE, DRAW_SCALE, DRAW_SCALE, col, 0.0, 0);
        drawn = drawn + 1;
      }
    }
    i = i + 1;
  }
  tDraw = tDraw + (performance.now() - tB);

  app.text(14, 12, "CASTELO INUNDADO — " + N + " particulas na GPU   fps " + math.floor(app.fps()), 0xD8E8FFFF, 15);
  app.text(14, 34, "fisica em WGSL (rts:gpu) | WASD voa | R solta a agua de novo", 0x90A8C0FF, 12);
  app.endFrame();

  if (frames % 300 === 0) {
    io.print("[g] f" + frames + " dtMED=" + math.floor(dtAcc / 300.0 * 10.0) / 10.0 +
             " dtMAX=" + math.floor(dtMax) +
             " fisicaGPU=" + math.floor(tPhys / 300.0 * 10.0) / 10.0 + "ms" +
             " lerPos=" + math.floor(tRead / 300.0 * 10.0) / 10.0 + "ms" +
             " desenho=" + math.floor(tDraw / 300.0 * 10.0) / 10.0 + "ms" +
             " desenhadas=" + drawn);
    dtAcc = 0.0; dtMax = 0.0; tPhys = 0.0; tRead = 0.0; tDraw = 0.0;
  }
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[gpu-fluido] encerrado apos " + frames + " frames");
app.close();

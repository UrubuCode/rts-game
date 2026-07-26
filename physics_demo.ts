// ═══════════════════════════════════════════════════════════════════════════
// PARQUE DE FÍSICA — demo executável do motor de física como SISTEMA.
//
//   rts.exe run physics_demo.ts
//
// Cinco estações clássicas rodando lado a lado, em ciclo (~7 s cada rodada):
//
//   pista 1  CORRIDA DE MATERIAIS  gelo, madeira e pedra lançados juntos —
//                                  o atrito ordena onde cada um para
//   pista 2  BERÇO DE NEWTON       o impulso atravessa a fila de bolas
//   pista 3  BILHAR                a branca abre o triângulo e a mesa freia
//   pista 4  DEMOLIÇÃO             bola de metal derruba a torre de madeira
//   pista 5  QUIQUES               borracha x metal x madeira da mesma altura
//
// É a versão VISUAL de tools/test_physics.ts — os mesmos cenários com
// asserções rodam headless; aqui eles rodam para serem VISTOS.
//
// Controles: WASD voa, botão DIREITO gira, ESPAÇO sobe, R reinicia o ciclo.
// Porta de controle em ws://127.0.0.1:7777 (`state` inspeciona os objetos).
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";
import input from "rts:input";

import { scene, S } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { PhysicsMaterial, MAT_ICE, MAT_STONE, MAT_RUBBER, MAT_WOOD, MAT_METAL } from "./scripts/physicsmaterial";
import { initMeshes, setCam, setLgt, setShadow, drawGPU,
         frustumBegin, inFrustumFast, winWidth, winHeight, setVsync } from "./engine/render/gpu3d";
import { ctrlServe, ctrlPoll } from "./editor/control/server";

// Dimensões da janela com prefixo PD_: `H` sem prefixo já colidiu com o raio do
// kernel do fluido — nomes de topo colidem entre módulos neste runtime.
let PD_W = 1500;
let PD_H = 950;
const app = createAppAt("RTS — Parque de Fisica", PD_W, PD_H, 60, 40);
const WIN = app._win;
const PD_FOV: f64 = 1.05;

S.win = WIN;
initMeshes(WIN);
ctrlServe(7777);

// ── chão único para todas as pistas ─────────────────────────────────────────
{
  const g = new GameObject("Chao");
  g.setMesh(1, 62, 70, 82);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 70.0; g.transform.sy = 1.0; g.transform.sz = 44.0;
  g.stationary = 1;
  g.transform.friction = 0.5;
  scene.add(g);
}

// ── estado de RESET: posição/velocidade inicial de cada dinâmico ────────────
// Arrays achatados (sem closures — capturas perdem prova de tipo no runtime).
const rIdx: number[] = [];
const rX: f64[] = [];
const rY: f64[] = [];
const rZ: f64[] = [];
const rVX: f64[] = [];

/// Cria um corpo dinâmico e registra seu estado inicial para o ciclo.
function body(name: string, mesh: number, x: f64, y: f64, z: f64, s: f64,
              cr: number, cg: number, cb: number, vx: f64): GameObject {
  const o = new GameObject(name);
  o.setMesh(mesh, cr, cg, cb);
  o.transform.setPosition(x, y, z);
  o.transform.setScale(s);
  scene.add(o);
  rIdx.push(scene.objects.length - 1);
  rX.push(x); rY.push(y); rZ.push(z); rVX.push(vx);
  return o;
}

// ── pista 1 (z = -16): CORRIDA DE MATERIAIS ────────────────────────────────
{
  const ice = body("Gelo", 1, 0.0 - 28.0, 1.1, 0.0 - 16.0, 1.2, 160, 220, 255, 13.0);
  ice.addBehavior(new PhysicsMaterial(MAT_ICE));
  const wood = body("Madeira", 1, 0.0 - 28.0, 1.1, 0.0 - 13.5, 1.2, 170, 120, 70, 13.0);
  wood.addBehavior(new PhysicsMaterial(MAT_WOOD));
  const stone = body("Pedra", 1, 0.0 - 28.0, 1.1, 0.0 - 11.0, 1.2, 130, 130, 135, 13.0);
  stone.addBehavior(new PhysicsMaterial(MAT_STONE));
}

// ── pista 2 (z = -6): BERÇO DE NEWTON ──────────────────────────────────────
{
  const b0 = body("Taco", 4, 0.0 - 24.0, 1.1, 0.0 - 6.0, 1.2, 220, 220, 230, 10.0);
  b0.addBehavior(new PhysicsMaterial(MAT_METAL));
  let i = 0;
  while (i < 5) {
    const b = body("Fila" + i, 4, 0.0 - 14.0 + i * 1.22, 1.1, 0.0 - 6.0, 1.2, 200, 205, 215, 0.0);
    b.addBehavior(new PhysicsMaterial(MAT_METAL));
    i = i + 1;
  }
}

// ── pista 3 (z = 0): BILHAR ────────────────────────────────────────────────
// Sem componente de material: restituição alta direto no Transform (bola de
// pedra tem e=0.15 e a colisão quase plástica não abre o triângulo).
function poolBall(name: string, x: f64, z: f64, cr: number, cg: number, cb: number, vx: f64): void {
  const b = body(name, 4, x, 1.0, z, 1.0, cr, cg, cb, vx);
  b.transform.restitution = 0.9;
  b.transform.friction = 0.2;
}
{
  poolBall("Branca", 0.0 - 22.0, 0.35, 245, 245, 245, 15.0);
  poolBall("B1", 0.0 - 4.0, 0.0, 220, 180, 60, 0.0);
  poolBall("B2", 0.0 - 3.0, 0.55, 60, 90, 200, 0.0);
  poolBall("B3", 0.0 - 3.0, 0.0 - 0.55, 200, 60, 60, 0.0);
  poolBall("B4", 0.0 - 2.0, 1.1, 130, 60, 180, 0.0);
  poolBall("B5", 0.0 - 2.0, 0.0, 40, 40, 45, 0.0);
  poolBall("B6", 0.0 - 2.0, 0.0 - 1.1, 60, 170, 90, 0.0);
}

// ── pista 4 (z = 8): DEMOLIÇÃO ─────────────────────────────────────────────
{
  let i = 0;
  while (i < 4) {
    const bx = body("Torre" + i, 1, 8.0, 1.1 + i * 1.21, 8.0, 1.2, 185, 135, 80, 0.0);
    bx.addBehavior(new PhysicsMaterial(MAT_WOOD));
    i = i + 1;
  }
  const wreck = body("Demolidora", 4, 0.0 - 20.0, 1.4, 8.0, 1.8, 90, 95, 110, 17.0);
  wreck.addBehavior(new PhysicsMaterial(MAT_METAL));
}

// ── pista 5 (z = 16): QUIQUES ──────────────────────────────────────────────
{
  const rub = body("Borracha", 4, 10.0, 9.0, 16.0, 1.2, 220, 70, 70, 0.0);
  rub.addBehavior(new PhysicsMaterial(MAT_RUBBER));
  const met = body("Metal", 4, 13.0, 9.0, 16.0, 1.2, 175, 180, 195, 0.0);
  met.addBehavior(new PhysicsMaterial(MAT_METAL));
  const wod = body("Madeira2", 4, 16.0, 9.0, 16.0, 1.2, 170, 120, 70, 0.0);
  wod.addBehavior(new PhysicsMaterial(MAT_WOOD));
}

/// Recoloca todos os dinâmicos no estado inicial — o ciclo recomeça.
function resetAll(): void {
  let k = 0;
  while (k < rIdx.length) {
    const t: Transform = scene.objects[rIdx[k]].transform;
    t.px = rX[k]; t.py = rY[k]; t.pz = rZ[k];
    t.vx = rVX[k]; t.vy = 0.0; t.vz = 0.0;
    k = k + 1;
  }
}

io.print("[fisica] parque com " + rIdx.length + " corpos dinamicos em 5 pistas");
io.print("[fisica] WASD voa | botao DIR gira | R reinicia | ws://127.0.0.1:7777");

// ── câmera: de cima e de frente, vendo as 5 pistas ─────────────────────────
S.camX = 0.0 - 4.0; S.camY = 26.0; S.camZ = 0.0 - 34.0;
S.camYaw = 0.1; S.camPitch = 0.0 - 0.62;
S.lightX = 10.0; S.lightY = 24.0; S.lightZ = 0.0 - 12.0; S.lightAmb = 0.36;
setVsync(WIN, 1);

/// Ciclo: cada rodada dura ~7 s (420 frames a 60 fps).
const CYCLE = 420;
let frames = 0;
let prevR = 0;

function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) PD_W = nw;
  if (nh > 300) PD_H = nh;
  let dt: f64 = app.delta();
  if (dt > 60) dt = 60;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  // câmera livre (mesmo esquema da demo de líquido)
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
  const mv: f64 = 14.0 * dts;
  if (kW !== 0) { S.camX = S.camX + syw * cpM * mv; S.camY = S.camY + spM * mv; S.camZ = S.camZ + cyw * cpM * mv; }
  if (kS !== 0) { S.camX = S.camX - syw * cpM * mv; S.camY = S.camY - spM * mv; S.camZ = S.camZ - cyw * cpM * mv; }
  if (kD !== 0) { S.camX = S.camX + cyw * mv; S.camZ = S.camZ - syw * mv; }
  if (kA !== 0) { S.camX = S.camX - cyw * mv; S.camZ = S.camZ + syw * mv; }
  if (kSp !== 0) S.camY = S.camY + mv;
  if (kR !== 0 && prevR === 0) { resetAll(); frames = 1; }
  prevR = kR;

  ctrlPoll(PD_W, PD_H);

  // ── FÍSICA: o MESMO laço do teste headless ───────────────────────────────
  scene.update(dts);
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    if (o.stationary === 0) {
      const t: Transform = o.transform;
      t.vy = t.vy - 9.8 * dts;
      t.px = t.px + t.vx * dts;
      t.py = t.py + t.vy * dts;
      t.pz = t.pz + t.vz * dts;
    }
    i = i + 1;
  }
  scene.computeWorld();
  scene.resolveCollisions();

  // ciclo automático
  if (frames % CYCLE === 0) resetAll();

  // ── RENDER ───────────────────────────────────────────────────────────────
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, PD_FOV, PD_W / PD_H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 30.0);
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, PD_FOV, PD_W / PD_H);
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  const n = objs.length;
  let drawn = 0;
  i = 0;
  while (i < n) {
    const o = objs[i];
    const t: Transform = trs[i];
    let rmax: f64 = t.sx;
    if (t.sy > rmax) rmax = t.sy;
    if (t.sz > rmax) rmax = t.sz;
    if (inFrustumFast(t.wx, t.wy, t.wz, rmax * 0.87) !== 0) {
      const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
      drawGPU(WIN, o.meshKind, t.wx, t.wy, t.wz, t.wrx, t.wry,
              t.sx, t.sy, t.sz, col, o.emissive, o.tex);
      drawn = drawn + 1;
    }
    i = i + 1;
  }
  // alimenta o `state` do WebSocket — o contador é do EDITOR; sem esta linha a
  // inspeção reportava drawn=0 com a cena visivelmente renderizando
  S.drawnLast = drawn;

  app.text(14, 12, "PARQUE DE FISICA — " + rIdx.length + " corpos   fps " + math.floor(app.fps()), 0xD8E8FFFF, 15);
  app.text(14, 34, "pistas: materiais | berco de newton | bilhar | demolicao | quiques", 0x90A8C0FF, 12);
  app.text(14, 52, "WASD voa | botao DIR gira | R reinicia o ciclo", 0x708096FF, 11);
  app.endFrame();
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[fisica] encerrado apos " + frames + " frames");
app.close();

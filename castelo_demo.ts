// ═══════════════════════════════════════════════════════════════════════════
// CASTELO SOB FOGO — o teste de estresse do motor de física, bonito de ver.
//
//   rts.exe run castelo_demo.ts
//
// Um castelo de ~130 blocos (muralha, ameias, duas torres com telhado) e um
// canhão que dispara balas de metal incandescentes a cada ~2,5 s, variando a
// mira. A demolição ACUMULA: cada tiro arranca um pedaço, os blocos deslizam,
// as torres desabam. Depois de 10 tiros o castelo se reconstrói e o ciclo
// recomeça.
//
// Por que é um bom teste: TODOS os corpos são dinâmicos ao mesmo tempo durante
// o desabamento (pior caso da colisão), a massa vem de densidade × volume
// (bala de metal ~32 contra bloco de pedra ~4.5), e o som do disparo sai do
// mixer da engine. O que as 14 asserções de tools/test_physics.ts provam
// headless, aqui vira espetáculo.
//
// Controles: WASD voa, botão DIREITO gira, ESPAÇO sobe, R reconstrói já.
// Porta de controle: ws://127.0.0.1:7777 (`state` lista todos os corpos).
// ═══════════════════════════════════════════════════════════════════════════
import io from "./compat/io.ts";
import math from "./compat/math.ts";
import input from "rts:input";

import { scene, S } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { PhysicsMaterial, MAT_STONE, MAT_WOOD, MAT_METAL } from "./scripts/physicsmaterial";
import { initAudio, pumpAudio, playNoise, playSquare } from "./engine/audio/audio";
import { initMeshes, setCam, setLgt, setShadow, drawGPU,
         frustumBegin, inFrustumFast, winWidth, winHeight, setVsync } from "./engine/render/gpu3d";
import { ctrlServe, ctrlPoll } from "./editor/control/server";

// Prefixo CD_ em TUDO de topo: nomes colidem em silêncio entre módulos neste
// runtime (o `let H` de uma demo já corrompeu o raio do kernel do fluido).
let CD_W = 1500;
let CD_H = 950;
const app = createAppAt("RTS — Castelo Sob Fogo", CD_W, CD_H, 60, 40);
const WIN = app._win;
const CD_FOV: f64 = 1.05;

S.win = WIN;
initMeshes(WIN);
initAudio();
ctrlServe(7777);

// ── terreno ─────────────────────────────────────────────────────────────────
{
  const g = new GameObject("Campo");
  g.setMesh(1, 74, 96, 66);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 90.0; g.transform.sy = 1.0; g.transform.sz = 60.0;
  g.stationary = 1;
  g.transform.friction = 0.55;
  scene.add(g);
}

// ── estado de RESET (arrays achatados; closures perdem prova de tipo) ───────
const rIdx: number[] = [];
const rX: f64[] = [];
const rY: f64[] = [];
const rZ: f64[] = [];

/// Bloco do castelo: cor com leve variação para a muralha não parecer plástico.
let tintSeed = 7;
function tint(): number {
  tintSeed = (tintSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  return tintSeed % 22;
}
function block(x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64,
               cr: number, cg: number, cb: number, mat: number): GameObject {
  const o = new GameObject("Bloco");
  const v = tint();
  o.setMesh(1, cr + v, cg + v, cb + v);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.addBehavior(new PhysicsMaterial(mat));
  scene.add(o);
  rIdx.push(scene.objects.length - 1);
  rX.push(x); rY.push(y); rZ.push(z);
  return o;
}

// ── a FORTALEZA (quadrada, centrada em x=20) ───────────────────────────────
// 4 muralhas fechando um pátio, 4 torres de canto com telhado, e a TORRE DE
// MENAGEM (o torreão central) mais alta que tudo. ~380 blocos, todos dinâmicos
// — o pior caso da colisão quando uma parede inteira desaba.
const FORT_X: f64 = 20.0;
const FORT_HALF: f64 = 9.0;   // meia-largura do pátio

// muralha reta ao longo de Z (em x fixo) ou ao longo de X (em z fixo)
function wallZ(x: f64, zc: f64, len: number, rows: number, gap: number): void {
  let row = 0;
  while (row < rows) {
    let col = 0;
    while (col < len) {
      // `gap` pula os blocos centrais da fileira de baixo (o portão)
      const isGate = gap !== 0 && row < 2 && col >= (len / 2 | 0) - 1 && col <= (len / 2 | 0);
      if (!isGate) {
        block(x, 1.15 + row * 1.32, zc - (len - 1) * 0.825 + col * 1.65,
              1.25, 1.3, 1.6, 118, 120, 126, MAT_STONE);
      }
      col = col + 1;
    }
    row = row + 1;
  }
  // ameias no topo
  let a = 0;
  while (a < ((len / 2) | 0)) {
    block(x, 1.15 + rows * 1.32 - 0.2, zc - (len - 1) * 0.825 + a * 3.3,
          1.1, 0.8, 1.1, 128, 130, 136, MAT_STONE);
    a = a + 1;
  }
}
function wallX(z: f64, xc: f64, len: number, rows: number): void {
  let row = 0;
  while (row < rows) {
    let col = 0;
    while (col < len) {
      block(xc - (len - 1) * 0.825 + col * 1.65, 1.15 + row * 1.32, z,
            1.6, 1.3, 1.25, 118, 120, 126, MAT_STONE);
      col = col + 1;
    }
    row = row + 1;
  }
  let a = 0;
  while (a < ((len / 2) | 0)) {
    block(xc - (len - 1) * 0.825 + a * 3.3, 1.15 + rows * 1.32 - 0.2, z,
          1.1, 0.8, 1.1, 128, 130, 136, MAT_STONE);
    a = a + 1;
  }
}
// frente (com portão), fundo, e duas laterais.
// As muralhas PARAM ANTES dos cantos: a primeira versão as levava até lá e os
// blocos nasciam INTERPENETRADOS com as torres (sobreposição de ~0.6) — o
// solver expulsava os cantos com violência e a fortaleza inteira desabava
// sozinha, antes do primeiro tiro. Peças de construção nunca podem nascer
// sobrepostas: para o solver, sobreposição é colisão em andamento.
wallZ(FORT_X - FORT_HALF, 0.0, 9, 4, 1);
wallZ(FORT_X + FORT_HALF, 0.0, 9, 4, 0);
wallX(0.0 - FORT_HALF, FORT_X, 8, 4);
wallX(FORT_HALF, FORT_X, 8, 4);

// torre de canto: 2x2 de base, `lvls` de altura, telhado de pirâmide
function tower(xc: f64, zc: f64, lvls: number): void {
  let lvl = 0;
  while (lvl < lvls) {
    let q = 0;
    while (q < 4) {
      block(xc + (q % 2) * 1.35 - 0.67, 1.15 + lvl * 1.32, zc + ((q / 2) | 0) * 1.35 - 0.67,
            1.3, 1.3, 1.3, 132, 128, 122, MAT_STONE);
      q = q + 1;
    }
    lvl = lvl + 1;
  }
  const roof = new GameObject("Telhado");
  roof.setMesh(2, 178, 62, 54);
  roof.transform.setPosition(xc, 1.15 + lvls * 1.32 + 0.9, zc);
  roof.transform.sx = 3.4; roof.transform.sy = 2.4; roof.transform.sz = 3.4;
  roof.addBehavior(new PhysicsMaterial(MAT_WOOD));
  scene.add(roof);
  rIdx.push(scene.objects.length - 1);
  rX.push(xc); rY.push(1.15 + lvls * 1.32 + 0.9); rZ.push(zc);
}
tower(FORT_X - FORT_HALF, 0.0 - FORT_HALF, 7);
tower(FORT_X - FORT_HALF, FORT_HALF, 7);
tower(FORT_X + FORT_HALF, 0.0 - FORT_HALF, 7);
tower(FORT_X + FORT_HALF, FORT_HALF, 7);

// TORRE DE MENAGEM: 3x3 de base, 9 níveis, o alvo mais satisfatório de todos
{
  let lvl = 0;
  while (lvl < 9) {
    let q = 0;
    while (q < 9) {
      block(FORT_X + (q % 3) * 1.35 - 1.35, 1.15 + lvl * 1.32, ((q / 3) | 0) * 1.35 - 1.35,
            1.3, 1.3, 1.3, 140, 134, 126, MAT_STONE);
      q = q + 1;
    }
    lvl = lvl + 1;
  }
  const roof = new GameObject("TelhadoMor");
  roof.setMesh(2, 190, 58, 48);
  roof.transform.setPosition(FORT_X, 1.15 + 9.0 * 1.32 + 1.2, 0.0);
  roof.transform.sx = 5.0; roof.transform.sy = 3.2; roof.transform.sz = 5.0;
  roof.addBehavior(new PhysicsMaterial(MAT_WOOD));
  scene.add(roof);
  rIdx.push(scene.objects.length - 1);
  rX.push(FORT_X); rY.push(1.15 + 9.0 * 1.32 + 1.2); rZ.push(0.0);
}

// ── o CANHÃO (visual estático) e as BALAS (pool reciclado) ──────────────────
{
  const barrel = new GameObject("Canhao");
  barrel.setMesh(1, 52, 54, 60);
  barrel.transform.setPosition(0.0 - 26.0, 2.2, 0.0);
  barrel.transform.sx = 3.6; barrel.transform.sy = 1.1; barrel.transform.sz = 1.1;
  barrel.stationary = 1;
  scene.add(barrel);
  const base = new GameObject("Reparo");
  base.setMesh(1, 96, 70, 46);
  base.transform.setPosition(0.0 - 26.6, 1.0, 0.0);
  base.transform.sx = 2.4; base.transform.sy = 1.4; base.transform.sz = 2.2;
  base.stationary = 1;
  scene.add(base);
}
/// Pool de 6 balas: recicladas em vez de criadas (nada de alocar em jogo).
/// Incandescentes (emissive): o rastro escuro do metal vira brasa na tela.
const ballIdx: number[] = [];
{
  let b = 0;
  while (b < 6) {
    const o = new GameObject("Bala" + b);
    o.setMesh(4, 255, 176, 92);
    o.emissive = 1;
    o.transform.setPosition(0.0 - 26.0 - b * 4.0, 0.0 - 16.0, 0.0);   // estacionadas fora de cena
    o.transform.setScale(1.7);
    o.addBehavior(new PhysicsMaterial(MAT_METAL));
    scene.add(o);
    ballIdx.push(scene.objects.length - 1);
    b = b + 1;
  }
}

io.print("[castelo] " + rIdx.length + " blocos + " + ballIdx.length + " balas | ws://127.0.0.1:7777");
io.print("[castelo] WASD voa | botao DIR gira | R reconstroi");

/// Reconstrói o castelo e estaciona as balas.
function rebuild(): void {
  let k = 0;
  while (k < rIdx.length) {
    const t: Transform = scene.objects[rIdx[k]].transform;
    t.px = rX[k]; t.py = rY[k]; t.pz = rZ[k];
    t.vx = 0.0; t.vy = 0.0; t.vz = 0.0;
    t.asleep = 0; t.quiet = 0;
    k = k + 1;
  }
  k = 0;
  while (k < ballIdx.length) {
    const t: Transform = scene.objects[ballIdx[k]].transform;
    t.px = 0.0 - 26.0 - k * 4.0; t.py = 0.0 - 16.0; t.pz = 0.0;
    t.vx = 0.0; t.vy = 0.0; t.vz = 0.0;
    t.asleep = 0; t.quiet = 0;
    k = k + 1;
  }
}

/// Dispara a próxima bala do pool, variando a mira (LCG determinístico).
let aimSeed = 4242;
let nextBall = 0;
let shots = 0;
function fire(): void {
  aimSeed = (aimSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  const vz: f64 = ((aimSeed % 100) - 50) * 0.16;        // -8 .. +8 (varre a fortaleza inteira)
  aimSeed = (aimSeed * 1103515245 + 12345) & 0x7FFFFFFF;
  const vy: f64 = 2.0 + (aimSeed % 60) * 0.14;          // 2 .. 10.3 (as altas acertam o torreão)
  const t: Transform = scene.objects[ballIdx[nextBall]].transform;
  t.px = 0.0 - 24.0; t.py = 2.4; t.pz = 0.0;
  t.vx = 34.0; t.vy = vy; t.vz = vz;
  t.asleep = 0; t.quiet = 0;
  nextBall = nextBall + 1;
  if (nextBall >= ballIdx.length) nextBall = 0;
  shots = shots + 1;
  // ESTRONDO: ruído (a explosão) + quadrada grave (o corpo do disparo)
  playNoise(0.22, 0.5);
  playSquare(62.0, 0.28, 0.34);
}

// ── câmera: diagonal alta, vendo canhão e castelo ──────────────────────────
S.camX = 0.0 - 22.0; S.camY = 22.0; S.camZ = 0.0 - 40.0;
S.camYaw = 0.62; S.camPitch = 0.0 - 0.36;
S.lightX = 12.0; S.lightY = 26.0; S.lightZ = 0.0 - 14.0; S.lightAmb = 0.34;
setVsync(WIN, 0);   // sem vsync: mostra o desempenho REAL no contador

/// Acumulador do PASSO FIXO da física. A física roda a 16 ms SEMPRE — as
/// suítes headless passavam e a demo ao vivo explodia porque a demo integrava
/// com o dt REAL do frame (até 60 ms): penetrações profundas escolhem o eixo
/// errado no solver e o caos se auto-sustenta. Mesma lição do fluido (SUBSTEP).
/// Teto de 3 sub-passos: frame muito lento vira câmera lenta, não instabilidade.
let phAcc: f64 = 0.0;
// medidor honesto de fps: media e pior frame por janela de 300
let dtSum: f64 = 0.0;
let dtMax: f64 = 0.0;

/// Um tiro a cada ~2,5 s; 10 tiros por rodada; reconstrói 6 s após o último.
const FIRE_EVERY = 120;
const SHOTS_PER_ROUND = 16;
let frames = 0;
let prevR = 0;

function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) CD_W = nw;
  if (nh > 300) CD_H = nh;
  let dt: f64 = app.delta();
  if (dt > 60) dt = 60;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;
  dtSum = dtSum + dt;
  if (dt > dtMax) dtMax = dt;

  // câmera livre
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
  const mv: f64 = 15.0 * dts;
  if (kW !== 0) { S.camX = S.camX + syw * cpM * mv; S.camY = S.camY + spM * mv; S.camZ = S.camZ + cyw * cpM * mv; }
  if (kS !== 0) { S.camX = S.camX - syw * cpM * mv; S.camY = S.camY - spM * mv; S.camZ = S.camZ - cyw * cpM * mv; }
  if (kD !== 0) { S.camX = S.camX + cyw * mv; S.camZ = S.camZ - syw * mv; }
  if (kA !== 0) { S.camX = S.camX - cyw * mv; S.camZ = S.camZ + syw * mv; }
  if (kSp !== 0) S.camY = S.camY + mv;
  if (kR !== 0 && prevR === 0) { rebuild(); frames = 1; shots = 0; }
  prevR = kR;

  ctrlPoll(CD_W, CD_H);

  // ── ciclo do canhão ──────────────────────────────────────────────────────
  // trégua inicial: o castelo assenta e DORME antes do primeiro tiro — dá para
  // ver o repouso de verdade, e é a janela que mede o sleeping sem ruído
  if (frames >= 300 && frames % FIRE_EVERY === 0 && shots < SHOTS_PER_ROUND) fire();
  if (shots >= SHOTS_PER_ROUND && frames % (FIRE_EVERY * SHOTS_PER_ROUND + 360) === 0) {
    rebuild();
    shots = 0;
    frames = 1;
  }

  // ── FÍSICA em PASSO FIXO de 16 ms (o mesmo dt das suítes headless) ───────
  phAcc = phAcc + dts;
  if (phAcc > 0.017) phAcc = 0.017;  // teto: 1 sub-passo — 60 fps sempre; o pico do desabamento vira câmera lenta
  while (phAcc >= 0.016) {
    phAcc = phAcc - 0.016;
    scene.update(0.016);
    // arrays HOISTADOS e tipados: ler `scene.objects` pelo import a cada
    // iteração custava 3,3 ms por frame só neste laço (caminho dinâmico)
    const iObjs: GameObject[] = scene.objects;
    const iTrs: Transform[] = scene.trs;
    const iN = iObjs.length;
    let i = 0;
    while (i < iN) {
      const o: GameObject = iObjs[i];
      if (o.stationary === 0) {
        const t: Transform = iTrs[i];
        if (t.asleep !== 0) { i = i + 1; continue; }   // dormindo: nao integra
        t.vy = t.vy - 9.8 * 0.016;
        // teto anti-tunneling (um impulso de bala atravessaria o chão num passo)
        const spd2 = t.vx * t.vx + t.vy * t.vy + t.vz * t.vz;
        if (spd2 > 2304.0) {   // 48 u/s
          const sc = 48.0 / math.sqrt(spd2);
          t.vx = t.vx * sc; t.vy = t.vy * sc; t.vz = t.vz * sc;
        }
        t.px = t.px + t.vx * 0.016;
        t.py = t.py + t.vy * 0.016;
        t.pz = t.pz + t.vz * 0.016;
        // quem caiu da borda fica ESTACIONADO sob o mundo
        if (t.py < 0.0 - 18.0) { t.py = 0.0 - 18.0; t.vy = 0.0; t.vx = 0.0; t.vz = 0.0; }
      }
      i = i + 1;
    }
    scene.resolveCollisions();
  }
  scene.computeWorld();

  if (frames % 300 === 0) {
    let dorm = 0;
    let dq = 0;
    while (dq < scene.objects.length) {
      if (scene.objects[dq].transform.asleep !== 0) dorm = dorm + 1;
      dq = dq + 1;
    }
    // distribuicao de velocidade: quantos abaixo do limiar de sono, o maximo e QUEM
    let lentos = 0;
    let vmx: f64 = 0.0;
    let vmxI = 0;
    let dq2 = 0;
    while (dq2 < scene.objects.length) {
      const tt = scene.objects[dq2].transform;
      const sp2 = tt.vx * tt.vx + tt.vy * tt.vy + tt.vz * tt.vz;
      if (sp2 < 0.09) lentos = lentos + 1;
      if (sp2 > vmx) { vmx = sp2; vmxI = dq2; }
      dq2 = dq2 + 1;
    }
    const tmx = scene.objects[vmxI].transform;
    io.print("[c] f" + frames + " dtMED=" + (math.floor(dtSum / 300.0 * 10.0) / 10.0) + " dtMAX=" + dtMax + " dormindo=" + dorm + " lentos=" + lentos +
             "/" + scene.objects.length + " | vmax=" + (math.floor(math.sqrt(vmx) * 100.0) / 100.0) +
             " " + scene.objects[vmxI].name + " y=" + (math.floor(tmx.py * 100.0) / 100.0) +
             " vy=" + (math.floor(tmx.vy * 100.0) / 100.0));
  }

  // bala que passou da fortaleza volta ao estacionamento do pool
  let rb = 0;
  while (rb < ballIdx.length) {
    const bt: Transform = scene.objects[ballIdx[rb]].transform;
    if (bt.px > 62.0 && bt.py > 0.0 - 17.0) {
      bt.px = 0.0 - 26.0; bt.py = 0.0 - 16.0; bt.pz = 0.0;
      bt.vx = 0.0; bt.vy = 0.0; bt.vz = 0.0;
    }
    rb = rb + 1;
  }

  // ── RENDER ───────────────────────────────────────────────────────────────
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, CD_FOV, CD_W / CD_H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 34.0);
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, CD_FOV, CD_W / CD_H);
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
  S.drawnLast = drawn;

  pumpAudio();

  app.text(14, 12, "CASTELO SOB FOGO — tiro " + shots + "/" + SHOTS_PER_ROUND + "   fps " + math.floor(app.fps()), 0xD8E8FFFF, 15);
  app.text(14, 34, "WASD voa | botao DIR gira | R reconstroi o castelo", 0x90A8C0FF, 12);
  app.endFrame();
  if (frames % 300 === 0) { dtSum = 0.0; dtMax = 0.0; }
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[castelo] encerrado apos " + frames + " frames");
app.close();

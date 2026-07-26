// ═══════════════════════════════════════════════════════════════════════════
// SIMULADOR DE LÍQUIDO — demo executável (SPH, ver scripts/fluid.ts).
//
//   rts.exe run fluid_demo.ts
//
// Uma coluna de água é solta num tanque e desaba (dam break — o teste clássico
// de fluidos). Cada partícula é um GameObject de verdade, então o líquido usa o
// mesmo render, a mesma câmera e o mesmo pipeline do resto do motor.
//
// Controles: WASD voa, botão DIREITO gira, ESPAÇO sobe, R reinicia a coluna.
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";
import input from "rts:input";

import { scene, S } from "./editor/control/session";
import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { Fluid } from "./scripts/fluid";
import { initMeshes, setCam, setLgt, setShadow, drawGPU,
         frustumBegin, inFrustumFast, winWidth, winHeight, setVsync } from "./engine/render/gpu3d";
// Porta de controle: permite INSPECIONAR a simulação rodando, por comando, em
// vez de olhar a tela. Verificar líquido por screenshot não funciona — a foto
// rouba o foco do usuário e mostra a janela que estiver por cima.
import { ctrlServe, ctrlPoll } from "./editor/control/server";
import { setInspectFluid, setInspectDt } from "./editor/control/commands/scene";

let W = 1280;
let H = 720;
const app = createAppAt("RTS — Simulador de Liquido (SPH)", W, H, 90, 50);
const WIN = app._win;
const FOV: f64 = 1.05;

S.win = WIN;
initMeshes(WIN);

// ── tanque ────────────────────────────────────────────────────────────────
const TANK_X: f64 = 2.6;    // meia-largura
const TANK_Z: f64 = 2.2;    // meia-profundidade
// O tanque era 7x5 e o líquido virava uma POÇA de uma partícula de espessura:
// 364 partículas cabem numa única camada dessa área, e só há 168. Fisicamente
// correto, visualmente decepcionante — não parece líquido, parece bolinhas
// espalhadas. Estreitando, o mesmo volume forma profundidade.
const FLOOR_Y: f64 = 0.5;

// chão + 4 paredes (visuais; a contenção do líquido é feita por `setBounds`)
function wall(name: string, x: f64, y: f64, z: f64, sx: f64, sy: f64, sz: f64,
              r: number, g: number, b: number): void {
  const o = new GameObject(name);
  o.setMesh(1, r, g, b);
  o.transform.setPosition(x, y, z);
  o.transform.sx = sx; o.transform.sy = sy; o.transform.sz = sz;
  o.stationary = 1;
  scene.add(o);
}
wall("Chao", 0.0, 0.0, 0.0, TANK_X * 2.0 + 1.0, 0.5, TANK_Z * 2.0 + 1.0, 70, 78, 90);
wall("ParedeE", 0.0 - TANK_X - 0.4, 2.5, 0.0, 0.5, 5.0, TANK_Z * 2.0, 90, 100, 115);
wall("ParedeD", TANK_X + 0.4, 2.5, 0.0, 0.5, 5.0, TANK_Z * 2.0, 90, 100, 115);
wall("ParedeF", 0.0, 2.5, TANK_Z + 0.4, TANK_X * 2.0 + 1.0, 5.0, 0.5, 80, 90, 105);

// ── partículas ────────────────────────────────────────────────────────────
// Uma COLUNA densa de um lado do tanque: ao soltar, ela desaba e espalha —
// o "dam break", que mostra de uma vez pressão, viscosidade e onda de retorno.
// 8×7×3 = 168 partículas. O custo é O(n × vizinhos) e está no PISO do runtime,
// não no algoritmo: medido, 3,2 M de visitas de vizinho nuas (só ler px/py/pz e
// a distância ao quadrado) custam 0,64 s — um terço do simulador inteiro. O
// resto é a matemática SPH de verdade. 168 é onde o passo cabe num frame de
// 60 fps com folga para o render; ver UrubuCode/rts#1997 para o custo por
// acesso a campo, que é o que fixa esse teto.
// A coluna nasce como um BLOCO no canto do tanque e desaba (dam break). 6x14x2
// = 168, as mesmas partículas de antes, mas ALTAS e estreitas: é o formato que
// mostra o colapso, e cabe no tanque de 5.2 x 4.4.
const COLS = 6;
const ROWS = 14;
const LAYERS = 2;
const SPACING: f64 = 0.62;
const PARTICLE_SCALE: f64 = 0.62;

const firstParticle = scene.count();
function spawnColumn(): void {
  let c = 0;
  while (c < COLS) {
    let r = 0;
    while (r < ROWS) {
      let l = 0;
      while (l < LAYERS) {
        const o = new GameObject("Gota");
        // esfera azulada; o topo da coluna fica mais claro (dá leitura de volume)
        const shade = 40 + (r * 6);
        o.setMesh(4, 60, 130 + (shade / 3), 210 + (shade / 8));
        o.transform.setPosition(
          0.0 - TANK_X + 0.5 + c * SPACING,
          FLOOR_Y + 0.35 + r * SPACING,
          0.0 - (LAYERS - 1) * SPACING * 0.5 + l * SPACING
        );
        o.transform.setScale(PARTICLE_SCALE);
        scene.add(o);
        l = l + 1;
      }
      r = r + 1;
    }
    c = c + 1;
  }
}
spawnColumn();
const lastParticle = scene.count() - 1;
const N_PART = lastParticle - firstParticle + 1;

const fluid = new Fluid();
fluid.setBounds(0.0 - TANK_X, TANK_X, FLOOR_Y + 0.3, 0.0 - TANK_Z, TANK_Z);
fluid.addFrom(scene, firstParticle, lastParticle);

io.print("[liquido] " + N_PART + " particulas (" + COLS + "x" + ROWS + "x" + LAYERS + ")");
ctrlServe(7777);
setInspectFluid(fluid, firstParticle);
io.print("[liquido] inspecione com: python tools/ws_client.py \"fluid\"");
io.print("[liquido] WASD voa | botao DIR gira | ESPACO sobe | R reinicia");

// ── câmera ────────────────────────────────────────────────────────────────
S.camX = 0.0; S.camY = 5.0; S.camZ = 0.0 - 9.0;
S.camYaw = 0.0; S.camPitch = 0.0 - 0.38;
S.lightX = 8.0; S.lightY = 16.0; S.lightZ = 0.0 - 10.0; S.lightAmb = 0.34;
setVsync(WIN, 1);

let frames = 0;
let prevR = 0;

function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  let dt: f64 = app.delta();
  if (dt > 60) dt = 60;          // um frame lento não vira um salto no líquido
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  // ── câmera livre ─────────────────────────────────────────────────────────
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

  // R = recoloca a coluna (mantém as partículas, só reposiciona)
  if (kR !== 0 && prevR === 0) {
    let idx = firstParticle;
    let c = 0;
    while (c < COLS) {
      let r = 0;
      while (r < ROWS) {
        let l = 0;
        while (l < LAYERS) {
          if (idx <= lastParticle) {
            const t: Transform = scene.objects[idx].transform;
            t.setPosition(
              0.0 - TANK_X + 0.5 + c * SPACING,
              FLOOR_Y + 0.35 + r * SPACING,
              0.0 - (LAYERS - 1) * SPACING * 0.5 + l * SPACING
            );
            const k = idx - firstParticle;
            fluid.vx[k] = 0.0; fluid.vy[k] = 0.0; fluid.vz[k] = 0.0;
          }
          idx = idx + 1;
          l = l + 1;
        }
        r = r + 1;
      }
      c = c + 1;
    }
  }
  prevR = kR;

  // ── SIMULAÇÃO ────────────────────────────────────────────────────────────
  ctrlPoll(W, H);   // atende o WebSocket (não-bloqueante)
  setInspectDt(dts);
  fluid.step(dts, scene);
  scene.computeWorld();

  // ── RENDER ───────────────────────────────────────────────────────────────
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 20.0);
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);

  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;
  const n = objs.length;
  let i = 0;
  let drawn = 0;
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

  app.text(14, 12, "LIQUIDO SPH — " + N_PART + " particulas   fps " + math.floor(app.fps()), 0xD8E8FFFF, 15);
  app.text(14, 34, "WASD voa | botao DIR gira | ESPACO sobe | R reinicia a coluna", 0x90A8C0FF, 12);
  app.endFrame();
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[liquido] encerrado apos " + frames + " frames");
app.close();

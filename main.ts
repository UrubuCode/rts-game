// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — editor + game loop + RENDER DE CENA. Estilo Unity: tudo é
// GameObject, ciclo mount → update(dt) → render pass. Roda 100% no motor RTS.
//   rts.exe run main.ts
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { drawCube, drawGrid } from "./engine/render/draw";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";

// ── janela ────────────────────────────────────────────────────────────────
const W = 1200;
const H = 720;
const app = createAppAt("Engine RTS — editor", W, H, 120, 90);
const WIN = app._win;

// layout do editor
const HIER_W = 250;      // painel hierarquia (esquerda)
const INSP_W = 270;      // painel inspector (direita)
const BAR_H = 46;        // toolbar (topo)

// ── câmera (fly) — estado top-level ─────────────────────────────────────────
let camX: f64 = 0.0;
let camY: f64 = 3.0;
let camZ: f64 = -10.0;
let camYaw: f64 = 0.0;
let camPitch: f64 = 0.18;
const FOV: f64 = 1.05;
const focal: f64 = (H * 0.5) / math.tan(FOV * 0.5);

// ── cena (estilo Unity) ─────────────────────────────────────────────────────
const scene = new Scene("Main");

const cubeA = new GameObject("Cube.Spin");
cubeA.setMesh(1, 120, 200, 255);
cubeA.transform.setPosition(0, 1.5, 0);
cubeA.addBehavior(new Spinner(1.1, 0.4));
scene.add(cubeA);

const cubeB = new GameObject("Cube.Bob");
cubeB.setMesh(1, 255, 180, 90);
cubeB.transform.setPosition(-3, 1.5, 2);
cubeB.transform.setScale(0.8);
cubeB.addBehavior(new Bobber(0.8, 2.0, 1.5));
scene.add(cubeB);

const cubeC = new GameObject("Cube.SpinBob");
cubeC.setMesh(1, 160, 255, 160);
cubeC.transform.setPosition(3, 1.5, -1);
cubeC.transform.setScale(1.2);
cubeC.addBehavior(new Spinner(0.6, 0.0));
cubeC.addBehavior(new Bobber(0.5, 1.3, 1.5));
scene.add(cubeC);

// ── estado do editor ────────────────────────────────────────────────────────
let playing = 1;      // 1 = rodando os scripts, 0 = pausado (edição)
let selected = 0;     // índice do GameObject selecionado
let frames = 0;

io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos");

while (app.running()) {
  const goOn = app.beginFrame();
  if (!goOn) break;
  let dt: f64 = app.delta();
  if (dt > 100) dt = 100;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  // ── input de câmera (fly): WASD move, setas olham, espaço sobe ────────────
  const kW = app.keyDown(122);
  const kS = app.keyDown(118);
  const kA = app.keyDown(100);
  const kD = app.keyDown(103);
  const kUp = app.keyDown(5);
  const kDn = app.keyDown(6);
  const kLf = app.keyDown(7);
  const kRt = app.keyDown(8);
  const kSp = app.keyDown(3);

  const lookSpeed: f64 = 1.6 * dts;
  if (kLf !== 0) camYaw = camYaw - lookSpeed;
  if (kRt !== 0) camYaw = camYaw + lookSpeed;
  if (kUp !== 0) camPitch = camPitch - lookSpeed;
  if (kDn !== 0) camPitch = camPitch + lookSpeed;
  if (camPitch > 1.4) camPitch = 1.4;
  if (camPitch < 0 - 1.4) camPitch = 0 - 1.4;

  const cyw = math.cos(camYaw);
  const syw = math.sin(camYaw);
  const moveSpeed: f64 = 6.0 * dts;
  // frente no plano XZ (ignora pitch pra voo estável)
  const fx = syw;
  const fz = cyw;
  const rxv = cyw;
  const rzv = 0 - syw;
  if (kW !== 0) { camX = camX + fx * moveSpeed; camZ = camZ + fz * moveSpeed; }
  if (kS !== 0) { camX = camX - fx * moveSpeed; camZ = camZ - fz * moveSpeed; }
  if (kD !== 0) { camX = camX + rxv * moveSpeed; camZ = camZ + rzv * moveSpeed; }
  if (kA !== 0) { camX = camX - rxv * moveSpeed; camZ = camZ - rzv * moveSpeed; }
  if (kSp !== 0) camY = camY + moveSpeed;

  // ── UPDATE da cena (só quando playing) ────────────────────────────────────
  if (playing !== 0) scene.update(dts);

  // ── RENDER DE CENA ────────────────────────────────────────────────────────
  // fundo do viewport
  app.box(0, 0, W, H, 0x0E1420FF, 0, 0, 0);
  // grid de chão
  drawGrid(WIN, camX, camY, camZ, camYaw, camPitch, focal, W, H, 10, 0x24405EFF);

  // cada GameObject com mesh → cubo (extrai campos AQUI e passa primitivos)
  let oi = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    if (o.active !== 0 && o.meshKind === 1) {
      let col = (o.cr | 0) | ((o.cg | 0) << 8) | ((o.cb | 0) << 16) | (0xFF << 24);
      if (oi === selected) col = 0xFFEE66FF; // selecionado = amarelo
      drawCube(WIN, camX, camY, camZ, camYaw, camPitch, focal, W, H,
               o.transform.px, o.transform.py, o.transform.pz,
               o.transform.rx, o.transform.ry, o.transform.sx, col);
    }
    oi = oi + 1;
  }

  // ═══ EDITOR UI (painéis opacos por cima) ═══════════════════════════════════
  // ── toolbar (topo) ─────────────────────────────────────────────────────────
  app.box(0, 0, W, BAR_H, 0x161C28FF, 0, 0, 0);
  app.line(0, BAR_H, W, BAR_H, 1, 0x2A3546FF);
  const bPlay = app.button(12, 8, 90, 30, "Play");
  if (bPlay) playing = 1;
  const bPause = app.button(110, 8, 90, 30, "Pause");
  if (bPause) playing = 0;
  let modeS = "EDIT";
  if (playing !== 0) modeS = "PLAY";
  app.text(220, 15, "modo: " + modeS + "   fps " + math.floor(app.fps()), 0xC8D2E0FF, 15);
  app.text(W - 300, 15, "WASD mover | setas olhar | espaco subir", 0x8896A8FF, 12);

  // ── hierarquia (esquerda) ──────────────────────────────────────────────────
  app.box(0, BAR_H, HIER_W, H - BAR_H, 0x121826FF, 0, 0, 0);
  app.line(HIER_W, BAR_H, HIER_W, H, 1, 0x2A3546FF);
  app.text(14, BAR_H + 12, "HIERARQUIA", 0x6FA8DCFF, 15);
  let hi = 0;
  while (hi < scene.objects.length) {
    const obj = scene.objects[hi];
    const ry0 = BAR_H + 40 + hi * 30;
    const st = app.clickable(100 + hi, 8, ry0, HIER_W - 16, 26);
    let fill = 0x1A2230FF;
    if (hi === selected) fill = 0x274064FF;
    if (st === 1) fill = 0x202A3AFF;
    app.box(8, ry0, HIER_W - 16, 26, fill, 0, 0, 5);
    app.text(18, ry0 + 5, obj.name, 0xDCE4F0FF, 14);
    if (st === 3) selected = hi;
    hi = hi + 1;
  }

  // ── inspector (direita) ─────────────────────────────────────────────────────
  const ix = W - INSP_W;
  app.box(ix, BAR_H, INSP_W, H - BAR_H, 0x121826FF, 0, 0, 0);
  app.line(ix, BAR_H, ix, H, 1, 0x2A3546FF);
  app.text(ix + 14, BAR_H + 12, "INSPECTOR", 0x6FA8DCFF, 15);
  const sel = scene.objects[selected];
  app.text(ix + 14, BAR_H + 40, sel.name, 0xFFFFFFFF, 16);
  app.text(ix + 14, BAR_H + 70, "Position", 0x9AA6B6FF, 13);
  app.text(ix + 14, BAR_H + 90, "X", 0xC8D2E0FF, 13);
  sel.transform.px = app.slider(ix + 34, BAR_H + 88, INSP_W - 60, sel.transform.px, -8, 8);
  app.text(ix + 14, BAR_H + 118, "Y", 0xC8D2E0FF, 13);
  sel.transform.py = app.slider(ix + 34, BAR_H + 116, INSP_W - 60, sel.transform.py, -2, 8);
  app.text(ix + 14, BAR_H + 146, "Z", 0xC8D2E0FF, 13);
  sel.transform.pz = app.slider(ix + 34, BAR_H + 144, INSP_W - 60, sel.transform.pz, -8, 8);
  app.text(ix + 14, BAR_H + 180, "Scale", 0x9AA6B6FF, 13);
  const nsc = app.slider(ix + 34, BAR_H + 200, INSP_W - 60, sel.transform.sx, 0.2, 3);
  sel.transform.sx = nsc;
  sel.transform.sy = nsc;
  sel.transform.sz = nsc;

  app.endFrame();
}

io.print("[engine] encerrado apos " + frames + " frames");
app.close();

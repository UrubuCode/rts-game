// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — editor + game loop + RENDER DE CENA (faces sólidas + z-buffer).
// Estilo Unity: tudo é GameObject, ciclo mount → update(dt) → render pass.
//   rts.exe run main.ts
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";
import buffer from "rts:buffer";
import render from "rts:render";
import input from "rts:input";
import fs from "rts:fs";

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { clearFB, drawFloor } from "./engine/render/raster";
import { drawMeshSolid, setLight, setAmbient } from "./engine/render/mesh";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";
import { Rigidbody } from "./scripts/rigidbody";
import { Mover } from "./scripts/mover";
import { Pulse } from "./scripts/pulse";

// ── janela ────────────────────────────────────────────────────────────────
const W = 1200;
const H = 720;
const app = createAppAt("Engine RTS — editor", W, H, 120, 90);
const WIN = app._win;

// layout do editor
const HIER_W = 250;      // painel hierarquia (esquerda)
const INSP_W = 270;      // painel inspector (direita)
const BAR_H = 46;        // toolbar (topo)

// ── framebuffer 3D (rasterizado em software, blitado com render.image) ───────
const RW = 480;          // resolução de render (blitada p/ WxH)
const RH = 288;
const NPIX = RW * RH;
const fbuf = buffer.alloc(NPIX * 4);   // RGBA
const zbuf = buffer.alloc(NPIX * 8);   // profundidade f64/pixel
const fptr = buffer.ptr(fbuf);

// ── câmera (fly) — estado top-level ─────────────────────────────────────────
let camX: f64 = 0.0;
let camY: f64 = 3.0;
let camZ: f64 = -10.0;
let camYaw: f64 = 0.0;
let camPitch: f64 = 0.18;
const FOV: f64 = 1.05;
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);   // p/ framebuffer
const focalW: f64 = (H * 0.5) / math.tan(FOV * 0.5);    // p/ picking em janela

// ── cena (estilo Unity) ─────────────────────────────────────────────────────
const scene = new Scene("Main");

// carrega a cena de demonstração (scenes/demo.json) — mesmo formato das portas de
// controle; se não existir, começa vazio (use +Cubo/+Esfera na toolbar).
if (fs.exists("scenes/demo.json")) {
  const data = JSON.parse(fs.read_text("scenes/demo.json"));
  const arr = data.objects;
  let ci = 0;
  while (ci < arr.length) {
    const od = arr[ci];
    const go = new GameObject(od.name);
    if (od.parent !== undefined) go.parent = od.parent;
    if (od.stationary !== undefined) go.stationary = od.stationary;
    const col = od.color;
    go.setMesh(od.mesh, col[0], col[1], col[2]);
    const p = od.pos;
    const r = od.rot;
    go.transform.setPosition(p[0], p[1], p[2]);
    go.transform.rx = r[0];
    go.transform.ry = r[1];
    go.transform.setScale(od.scale);
    const scr = od.scripts;
    let si = 0;
    while (si < scr.length) {
      const sd = scr[si];
      const t = sd.type;
      if (t === "spin") go.addBehavior(new Spinner(sd.sy, sd.sx));
      if (t === "bob") go.addBehavior(new Bobber(sd.amp, sd.freq, sd.base));
      if (t === "rigidbody") go.addBehavior(new Rigidbody(sd.g, sd.bounce));
      if (t === "mover") go.addBehavior(new Mover(sd.vx, sd.vy, sd.vz));
      if (t === "pulse") go.addBehavior(new Pulse(sd.amp, sd.freq, sd.base));
      si = si + 1;
    }
    scene.add(go);
    ci = ci + 1;
  }
  setLight(0.35, 1.0, 0.25);
  setAmbient(0.2);
}

// ── estado do editor ────────────────────────────────────────────────────────
let playing = 1;
let selected = 0;
let frames = 0;
let spawnN = 0;
let dragging = 0;
let lastMx: f64 = 0.0;
let lastMy: f64 = 0.0;

io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos (raster solido)");

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
  const fx = syw; const fz = cyw;
  const rxv = cyw; const rzv = 0 - syw;
  if (kW !== 0) { camX = camX + fx * moveSpeed; camZ = camZ + fz * moveSpeed; }
  if (kS !== 0) { camX = camX - fx * moveSpeed; camZ = camZ - fz * moveSpeed; }
  if (kD !== 0) { camX = camX + rxv * moveSpeed; camZ = camZ + rzv * moveSpeed; }
  if (kA !== 0) { camX = camX - rxv * moveSpeed; camZ = camZ - rzv * moveSpeed; }
  if (kSp !== 0) camY = camY + moveSpeed;

  // ── UPDATE da cena (só quando playing) ────────────────────────────────────
  if (playing !== 0) { scene.update(dts); scene.resolveCollisions(); }
  scene.computeWorld();

  // ── PICKING + DRAG: pressionar seleciona; segurando, ARRASTA o objeto ───────
  const mPressed = input.mousePressed(WIN, 0);
  const mDownNow = input.mouseDown(WIN, 0);
  const mx: f64 = input.mouseX(WIN);
  const my: f64 = input.mouseY(WIN);
  const inViewport = mx > HIER_W && mx < W - INSP_W && my > BAR_H;
  const cpt2 = math.cos(camPitch); const spt2 = math.sin(camPitch);
  if (mPressed !== 0 && inViewport) {
    // seleciona o objeto projetado mais perto do mouse e começa o drag
    let best = 0 - 1;
    let bestD: f64 = 1e30;
    let pi = 0;
    while (pi < scene.objects.length) {
      const po = scene.objects[pi];
      if (po.meshKind !== 0) {
        const dx = po.transform.wx - camX;
        const dy = po.transform.wy - camY;
        const dz = po.transform.wz - camZ;
        const x1 = dx * cyw - dz * syw;
        const z1 = dx * syw + dz * cyw;
        const y2 = dy * cpt2 - z1 * spt2;
        const z2 = dy * spt2 + z1 * cpt2;
        if (z2 > 0.2) {
          const psx = W * 0.5 + (x1 / z2) * focalW;
          const psy = H * 0.5 - (y2 / z2) * focalW;
          const ex = psx - mx; const ey = psy - my;
          const d2 = ex * ex + ey * ey;
          if (d2 < bestD && d2 < 4000) { bestD = d2; best = pi; }
        }
      }
      pi = pi + 1;
    }
    if (best >= 0) { selected = best; dragging = 1; }
    lastMx = mx; lastMy = my;
  }
  if (mDownNow === 0) dragging = 0;
  // enquanto arrasta: move o selecionado no plano da tela (direita da câmera + Y)
  if (dragging !== 0 && mDownNow !== 0 && inViewport && scene.objects.length > 0) {
    const so = scene.objects[selected];
    const dxo = so.transform.wx - camX;
    const dzo = so.transform.wz - camZ;
    const z1o = dxo * syw + dzo * cyw;
    let depth: f64 = (so.transform.wy - camY) * spt2 + z1o * cpt2;
    if (depth < 1.0) depth = 1.0;
    const perPx: f64 = depth / focalW;   // unidades de mundo por pixel de tela
    const mdx: f64 = (mx - lastMx) * perPx;
    const mdy: f64 = (my - lastMy) * perPx;
    so.transform.px = so.transform.px + cyw * mdx;
    so.transform.pz = so.transform.pz + (0 - syw) * mdx;
    so.transform.py = so.transform.py - mdy;
    lastMx = mx; lastMy = my;
  }

  // ── RENDER DE CENA (rasteriza no framebuffer, depois blita) ────────────────
  scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0xFF201810);   // fundo (ABGR: azul-acinzentado escuro)
  drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);

  let oi = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    if (o.active !== 0 && o.meshKind !== 0) {
      let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
      if (oi === selected) { rr = 255; gg = 230; bbv = 120; } // selecionado = dourado
      drawMeshSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
        o.transform.wx, o.transform.wy, o.transform.wz,
        o.transform.wrx, o.transform.wry, o.transform.sx, o.meshKind, rr, gg, bbv);
    }
    oi = oi + 1;
  }
  render.image(WIN, 0, 0, W, H, fptr, RW, RH);

  // ═══ EDITOR UI (painéis opacos por cima) ═══════════════════════════════════
  app.box(0, 0, W, BAR_H, 0x161C28FF, 0, 0, 0);
  app.line(0, BAR_H, W, BAR_H, 1, 0x2A3546FF);
  const bPlay = app.button(12, 8, 90, 30, "Play");
  if (bPlay) playing = 1;
  const bPause = app.button(110, 8, 90, 30, "Pause");
  if (bPause) playing = 0;
  // GameObject menu (add/delete)
  const bCube = app.button(214, 8, 82, 30, "+ Cubo");
  if (bCube) {
    const g = new GameObject("Cube." + spawnN);
    g.setMesh(1, 150, 180, 220);
    g.transform.setPosition(0, 1.5, 0);
    scene.add(g);
    selected = scene.objects.length - 1;
    spawnN = spawnN + 1;
  }
  const bSph = app.button(302, 8, 92, 30, "+ Esfera");
  if (bSph) {
    const g = new GameObject("Sphere." + spawnN);
    g.setMesh(4, 220, 140, 180);
    g.transform.setPosition(0, 1.5, 0);
    scene.add(g);
    selected = scene.objects.length - 1;
    spawnN = spawnN + 1;
  }
  const bDel = app.button(400, 8, 84, 30, "Deletar");
  if (bDel && scene.objects.length > 0) {
    scene.removeAt(selected);
    if (selected >= scene.objects.length) selected = scene.objects.length - 1;
    if (selected < 0) selected = 0;
  }
  let modeS = "EDIT";
  if (playing !== 0) modeS = "PLAY";
  app.text(500, 15, "modo: " + modeS + "   fps " + math.floor(app.fps()), 0xC8D2E0FF, 15);
  app.text(W - 340, 15, "WASD mover | setas olhar | espaco subir | clique = selecionar", 0x8896A8FF, 12);

  // ── hierarquia (esquerda) ──────────────────────────────────────────────────
  app.box(0, BAR_H, HIER_W, H - BAR_H, 0x121826FF, 0, 0, 0);
  app.line(HIER_W, BAR_H, HIER_W, H, 1, 0x2A3546FF);
  app.text(14, BAR_H + 12, "HIERARQUIA", 0x6FA8DCFF, 15);
  app.text(HIER_W - 60, BAR_H + 13, scene.objects.length + " obj", 0x5E6B7EFF, 12);
  // TREEVIEW: cada objeto indentado pela profundidade (cadeia de pais); filhos
  // aparecem aninhados sob o pai com um conector, estilo Unity Hierarchy.
  let hi = 0;
  while (hi < scene.objects.length) {
    const obj = scene.objects[hi];
    // profundidade = quantos ancestrais o objeto tem
    let depth = 0;
    let pp = obj.parent;
    while (pp >= 0 && depth < 8) { depth = depth + 1; pp = scene.objects[pp].parent; }
    const indent = depth * 16;
    const ry0 = BAR_H + 40 + hi * 27;
    const st = app.clickable(100 + hi, 8 + indent, ry0, HIER_W - 16 - indent, 24);
    let fill = 0x1A2230FF;
    if (hi === selected) fill = 0x2C4A72FF;
    if (st === 1) fill = 0x202A3AFF;
    app.box(8 + indent, ry0, HIER_W - 16 - indent, 24, fill, 0, 0, 5);
    // conector do galho pros filhos
    if (depth > 0) {
      app.text(8 + indent - 12, ry0 + 3, "└", 0x556377FF, 14);
    }
    // ícone do tipo de mesh
    let icon = "[C]";
    if (obj.meshKind === 2) icon = "[P]";
    if (obj.meshKind === 3) icon = "[O]";
    if (obj.meshKind === 4) icon = "[S]";
    app.text(14 + indent, ry0 + 4, icon + " " + obj.name, 0xDCE4F0FF, 13);
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
  sel.transform.sx = nsc; sel.transform.sy = nsc; sel.transform.sz = nsc;
  app.text(ix + 14, BAR_H + 226, "Rot Y", 0x9AA6B6FF, 13);
  sel.transform.ry = app.slider(ix + 60, BAR_H + 226, INSP_W - 86, sel.transform.ry, -3.14, 3.14);

  // ── mesh + estático ─────────────────────────────────────────────────────────
  let meshName = "Cubo";
  if (sel.meshKind === 2) meshName = "Piramide";
  if (sel.meshKind === 3) meshName = "Octaedro";
  if (sel.meshKind === 4) meshName = "Esfera";
  app.text(ix + 14, BAR_H + 258, "Mesh: " + meshName, 0xC8D2E0FF, 13);
  const bMesh = app.button(ix + 14, BAR_H + 278, 104, 26, "Trocar");
  if (bMesh) { sel.meshKind = sel.meshKind + 1; if (sel.meshKind > 4) sel.meshKind = 1; }
  sel.stationary = app.checkbox(ix + 134, BAR_H + 281, sel.stationary, "Estatico");

  // ── componentes (scripts) do objeto — estilo Inspector do Unity ─────────────
  app.text(ix + 14, BAR_H + 320, "COMPONENTES", 0x6FA8DCFF, 14);
  let bc = 0;
  let cyc = BAR_H + 344;
  while (bc < sel.behaviors.length) {
    const d = sel.behaviors[bc].toData();
    let tn = "script";
    if (d !== null) tn = d.type;
    app.box(ix + 14, cyc, INSP_W - 28, 22, 0x1A2230FF, 1, 0x2A3546FF, 4);
    app.text(ix + 22, cyc + 3, "> " + tn, 0xC8D2E0FF, 13);
    cyc = cyc + 26;
    bc = bc + 1;
  }
  if (sel.behaviors.length === 0) {
    app.text(ix + 22, cyc, "(nenhum)", 0x66707EFF, 12);
  }

  app.endFrame();
}

io.print("[engine] encerrado apos " + frames + " frames");
buffer.free(fbuf);
buffer.free(zbuf);
app.close();

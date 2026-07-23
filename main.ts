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
import { numField, AXIS_X, AXIS_Y, AXIS_Z } from "./editor/widgets";
import { assetsInit, drawAssets } from "./editor/assets";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, inFrustum, winWidth, winHeight } from "./engine/render/gpu3d";

// ── janela ────────────────────────────────────────────────────────────────
let W = 1200;   // tamanho LÓGICO da janela — atualizado a cada frame (segue o resize)
let H = 720;
const app = createAppAt("Engine RTS — editor", W, H, 120, 90);
const WIN = app._win;

// layout do editor
const HIER_W = 250;      // painel hierarquia (esquerda)
const INSP_W = 270;      // painel inspector (direita)
const BAR_H = 46;        // toolbar (topo)
const ASSET_H = 200;     // Project panel (base, sobre o viewport)

// ── framebuffer 3D (rasterizado em software, blitado com render.image) ───────
const RW = 320;          // resolucao de render (blitada p/ WxH)
const RH = 200;
const NPIX = RW * RH;
const fbuf = buffer.alloc(NPIX * 4);   // RGBA
const zbuf = buffer.alloc(NPIX * 8);   // profundidade f64/pixel
const fptr = buffer.ptr(fbuf);

// ── câmera (fly) — estado top-level ─────────────────────────────────────────
let camX: f64 = 0.0;
let camY: f64 = 11.0;
let camZ: f64 = -15.0;
let camYaw: f64 = 0.0;
let camPitch: f64 = 0 - 0.5;
const FOV: f64 = 1.05;
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);   // p/ framebuffer
let focalW: f64 = (H * 0.5) / math.tan(FOV * 0.5);      // p/ picking; recalc por frame

// ── cena (estilo Unity) ─────────────────────────────────────────────────────
const scene = new Scene("Main");

// Constrói 1 GameObject a partir de um descritor JSON. Campos opcionais: parent,
// stationary, emissive, tex, scale3 [x,y,z], scripts [].
function buildObject(od: any): GameObject {
  const go = new GameObject(od.name);
  if (od.parent !== undefined) go.parent = od.parent;
  if (od.stationary !== undefined) go.stationary = od.stationary;
  if (od.emissive !== undefined) go.emissive = od.emissive;
  if (od.tex !== undefined) go.tex = od.tex;
  const col = od.color;
  go.setMesh(od.mesh, col[0], col[1], col[2]);
  const p = od.pos;
  const r = od.rot;
  go.transform.setPosition(p[0], p[1], p[2]);
  go.transform.rx = r[0];
  go.transform.ry = r[1];
  if (od.scale3 !== undefined) {
    const s3 = od.scale3;
    go.transform.sx = s3[0]; go.transform.sy = s3[1]; go.transform.sz = s3[2];
  } else {
    go.transform.setScale(od.scale);
  }
  const scr = od.scripts;
  if (scr !== undefined) {
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
  }
  return go;
}

// Carrega uma cena inteira (arquivo { objects: [...] }), SUBSTITUINDO a atual.
function loadSceneFrom(path: string): void {
  if (!fs.exists(path)) return;
  scene.clear();
  const data = JSON.parse(fs.read_text(path));
  const arr = data.objects;
  let ci = 0;
  while (ci < arr.length) { scene.add(buildObject(arr[ci])); ci = ci + 1; }
  setLight(0.35, 1.0, 0.25);
  setAmbient(0.2);
  let ei = 0;
  while (ei < scene.objects.length) {
    if (scene.objects[ei].name === "Sun") scene.objects[ei].emissive = 1;
    ei = ei + 1;
  }
}

// Instancia 1 prefab (arquivo com UM objeto) na cena atual, sem limpá-la.
function instantiatePrefab(path: string): void {
  if (!fs.exists(path)) return;
  const od = JSON.parse(fs.read_text(path));
  scene.add(buildObject(od));
}

// carga inicial: prefere shadowdemo.json (sombras + textura); senão solar.json.
let sceneFile = "scenes/solar.json";
if (fs.exists("scenes/shadowdemo.json")) sceneFile = "scenes/shadowdemo.json";
loadSceneFrom(sceneFile);

// ── estado do editor ────────────────────────────────────────────────────────
let playing = 1;
let selected = 0;
let frames = 0;
let spawnN = 0;
let dragging = 0;
let hierDrag = 0 - 1;
let lastMx: f64 = 0.0;
let lastMy: f64 = 0.0;

initMeshes(WIN);
assetsInit();
io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos (raster solido)");

while (app.running()) {
  const goOn = app.beginFrame();
  if (!goOn) break;
  // ── layout RESPONSIVO: lê o tamanho lógico atual da janela (segue o resize) ──
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  focalW = (H * 0.5) / math.tan(FOV * 0.5);
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
  // olhar com o BOTÃO DIREITO do mouse (mouse-look estilo Unity fly)
  const mvdx: f64 = input.mouseDeltaX(WIN);
  const mvdy: f64 = input.mouseDeltaY(WIN);
  if (input.mouseDown(WIN, 1) !== 0) {
    camYaw = camYaw + mvdx * 0.005;
    camPitch = camPitch - mvdy * 0.005;
  }
  if (camPitch > 1.4) camPitch = 1.4;
  if (camPitch < 0 - 1.4) camPitch = 0 - 1.4;

  const cyw = math.cos(camYaw);
  const syw = math.sin(camYaw);
  const cpM = math.cos(camPitch);
  const spM = math.sin(camPitch);
  const moveSpeed: f64 = 6.0 * dts;
  // forward = direção que a câmera olha (inclui o pitch); W/S voam nessa direção
  const fx = syw * cpM; const fy = spM; const fz = cyw * cpM;
  const rxv = cyw; const rzv = 0 - syw;   // strafe (A/D) no plano horizontal
  if (kW !== 0) { camX = camX + fx * moveSpeed; camY = camY + fy * moveSpeed; camZ = camZ + fz * moveSpeed; }
  if (kS !== 0) { camX = camX - fx * moveSpeed; camY = camY - fy * moveSpeed; camZ = camZ - fz * moveSpeed; }
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
  const inViewport = mx > HIER_W && mx < W - INSP_W && my > BAR_H && my < H - 24 - ASSET_H;
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
  // ── RENDER 3D por GPU (pipeline wgpu no scene pass; a UI do egui compõe por
  //    cima). Só manda câmera/luz + 1 drawMesh por objeto — a GPU faz o resto. ──
  scene.computeWorld();
  setCam(WIN, camX, camY, camZ, camYaw, camPitch, FOV, W / H);
  setLgt(WIN, 7.0, 13.0, 5.0, 0.28);   // luz PONTUAL (posição no alto)
  // shadow map direcional: luz viaja do alto pra baixo em direção à cena
  setShadow(WIN, 0 - 7.0, 0 - 12.0, 0 - 5.0, 0.0, 1.0, 0.0, 24.0);
  let oi = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    if (o.active !== 0 && o.meshKind !== 0) {
      // frustum culling: raio da esfera envolvente (maior escala × ~0.87)
      let rmax: f64 = o.transform.sx;
      if (o.transform.sy > rmax) rmax = o.transform.sy;
      if (o.transform.sz > rmax) rmax = o.transform.sz;
      const vis = inFrustum(camX, camY, camZ, camYaw, camPitch, FOV, W / H,
        o.transform.wx, o.transform.wy, o.transform.wz, rmax * 0.87);
      if (vis !== 0) {
        let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
        if (oi === selected) { rr = 255; gg = 230; bbv = 120; } // selecionado = dourado
        const col = (rr << 16) | (gg << 8) | bbv;
        drawGPU(WIN, o.meshKind, o.transform.wx, o.transform.wy, o.transform.wz,
          o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, o.emissive, o.tex);
      }
    }
    oi = oi + 1;
  }

  // ═══ EDITOR UI (estilo Unity) ══════════════════════════════════════════════
  // toolbar
  app.box(0, 0, W, BAR_H, 0x393939FF, 0, 0, 0);
  app.line(0, BAR_H, W, BAR_H, 1, 0x232323FF);

  // — GameObject menu (esquerda): + Cubo / + Esfera / Deletar —
  const stCube = app.clickable(902, 10, 9, 74, 28);
  let fCube = 0x2D2D2DFF; if (stCube === 1) fCube = 0x454545FF; if (stCube === 2) fCube = 0x252525FF;
  app.box(10, 9, 74, 28, fCube, 1, 0x232323FF, 3);
  app.text(18, 15, "+ Cubo", 0xC8C8C8FF, 13);
  if (stCube === 3) {
    const g = new GameObject("Cube." + spawnN);
    g.setMesh(1, 150, 180, 220); g.transform.setPosition(0, 1.5, 0);
    scene.add(g); selected = scene.objects.length - 1; spawnN = spawnN + 1;
  }
  const stSph = app.clickable(903, 88, 9, 80, 28);
  let fSph = 0x2D2D2DFF; if (stSph === 1) fSph = 0x454545FF; if (stSph === 2) fSph = 0x252525FF;
  app.box(88, 9, 80, 28, fSph, 1, 0x232323FF, 3);
  app.text(96, 15, "+ Esfera", 0xC8C8C8FF, 13);
  if (stSph === 3) {
    const g = new GameObject("Sphere." + spawnN);
    g.setMesh(4, 220, 140, 180); g.transform.setPosition(0, 1.5, 0);
    scene.add(g); selected = scene.objects.length - 1; spawnN = spawnN + 1;
  }
  const stDel = app.clickable(904, 172, 9, 74, 28);
  let fDel = 0x2D2D2DFF; if (stDel === 1) fDel = 0x5A3A3AFF; if (stDel === 2) fDel = 0x252525FF;
  app.box(172, 9, 74, 28, fDel, 1, 0x232323FF, 3);
  app.text(182, 15, "Deletar", 0xC8B0B0FF, 13);
  if (stDel === 3 && scene.objects.length > 0) {
    scene.removeAt(selected);
    if (selected >= scene.objects.length) selected = scene.objects.length - 1;
    if (selected < 0) selected = 0;
  }

  // — play controls CENTRALIZADOS (Play / Pause) —
  const pcx = W / 2 - 44;
  const stPlay = app.clickable(900, pcx, 9, 42, 28);
  let fPlay = 0x2D2D2DFF;
  if (playing !== 0) fPlay = 0x4A75B0FF; else if (stPlay === 1) fPlay = 0x454545FF;
  app.box(pcx, 9, 42, 28, fPlay, 1, 0x232323FF, 3);
  app.text(pcx + 16, 13, "|>", 0xE0E0E0FF, 15);
  if (stPlay === 3) playing = 1;
  const stPause = app.clickable(901, pcx + 44, 9, 42, 28);
  let fPause = 0x2D2D2DFF;
  if (playing === 0) fPause = 0x4A75B0FF; else if (stPause === 1) fPause = 0x454545FF;
  app.box(pcx + 44, 9, 42, 28, fPause, 1, 0x232323FF, 3);
  app.text(pcx + 44 + 15, 13, "||", 0xE0E0E0FF, 15);
  if (stPause === 3) playing = 0;

  // — direita: fps —
  app.text(W - 92, 15, "fps " + math.floor(app.fps()), 0x909090FF, 13);

  // ── hierarquia (esquerda) ──────────────────────────────────────────────────
  app.box(0, BAR_H, HIER_W, H - BAR_H, 0x383838FF, 0, 0, 0);
  app.line(HIER_W, BAR_H, HIER_W, H, 1, 0x232323FF);
  // header/tab
  app.box(0, BAR_H, HIER_W, 22, 0x303030FF, 0, 0, 0);
  app.box(4, BAR_H + 2, 88, 20, 0x424242FF, 0, 0, 3);
  app.text(12, BAR_H + 5, "Hierarchy", 0xCACACAFF, 12);
  app.text(HIER_W - 52, BAR_H + 5, scene.objects.length + " obj", 0x808080FF, 11);
  app.line(0, BAR_H + 22, HIER_W, BAR_H + 22, 1, 0x232323FF);

  app.text(14, BAR_H + 34, "arraste: meio = filho | topo/base = irmao", 0x808080FF, 11);

  // TREEVIEW com SLOTS de inserção (estilo Unity): por linha, o terço de cima =
  // soltar ANTES (irmão), o meio = virar FILHO, o de baixo = soltar DEPOIS (irmão).
  let dropIdx = 0 - 1;
  let dropMode = 0;          // 1 = antes, 2 = filho, 3 = depois
  let dropLineY: f64 = 0.0;
  let hi = 0;
  while (hi < scene.objects.length) {
    const obj = scene.objects[hi];
    let depth = 0;
    let pp = obj.parent;
    while (pp >= 0 && depth < 8) { depth = depth + 1; pp = scene.objects[pp].parent; }
    const indent = depth * 16;
    const ry0 = BAR_H + 52 + hi * 26;
    const inRow = mx < HIER_W && my >= ry0 && my < ry0 + 26;
    if (mPressed !== 0 && inRow) { hierDrag = hi; selected = hi; }
    // detecta a zona de drop enquanto arrasta
    if (hierDrag >= 0 && inRow) {
      const local: f64 = my - ry0;
      if (local < 8.0) { dropIdx = hi; dropMode = 1; dropLineY = ry0; }
      else if (local >= 18.0) { dropIdx = hi; dropMode = 3; dropLineY = ry0 + 26; }
      else { dropIdx = hi; dropMode = 2; }
    }
    let fill = 0x333333FF;
    if (hi === selected) fill = 0x4A75B0FF;
    if (hierDrag < 0 && inRow) fill = 0x454545FF;
    if (hierDrag >= 0 && dropMode === 2 && dropIdx === hi && hi !== hierDrag) fill = 0x2E5A3AFF; // vira filho
    app.box(8 + indent, ry0 + 1, HIER_W - 16 - indent, 24, fill, 0, 0, 5);
    if (depth > 0) app.text(8 + indent - 12, ry0 + 5, "└", 0x556377FF, 14);
    let icon = "[C]";
    if (obj.meshKind === 2) icon = "[P]";
    if (obj.meshKind === 3) icon = "[O]";
    if (obj.meshKind === 4) icon = "[S]";
    app.text(14 + indent, ry0 + 6, icon + " " + obj.name, 0xC8C8C8FF, 13);
    hi = hi + 1;
  }
  // linha de inserção (irmão antes/depois)
  if (hierDrag >= 0 && (dropMode === 1 || dropMode === 3)) {
    app.box(10, dropLineY - 1, HIER_W - 20, 3, 0x77DD99FF, 0, 0, 0);
  }
  // soltar → aplica o move (reordena + reparenta a subárvore)
  if (hierDrag >= 0 && mDownNow === 0) {
    if (dropMode !== 0 && dropIdx >= 0 && dropIdx !== hierDrag) {
      const dref = scene.objects[hierDrag];
      if (dropMode === 2) {
        scene.moveSubtree(hierDrag, dropIdx + 1, dropIdx);       // filho do alvo
      } else {
        const tp = scene.objects[dropIdx].parent;                // irmão do alvo
        let bidx = dropIdx;
        if (dropMode === 3) bidx = dropIdx + 1;
        scene.moveSubtree(hierDrag, bidx, tp);
      }
      // re-seleciona o arrastado na nova posição
      let f2 = 0;
      while (f2 < scene.objects.length) {
        if (scene.objects[f2] === dref) { selected = f2; f2 = scene.objects.length; } else f2 = f2 + 1;
      }
    }
    hierDrag = 0 - 1;
  }
  // GHOST: o item arrastado segue o cursor
  if (hierDrag >= 0 && hierDrag < scene.objects.length) {
    app.box(mx + 12, my - 9, 150, 22, 0x2E4E86EE, 1, 0x88BBFFFF, 5);
    app.text(mx + 18, my - 5, ">> " + scene.objects[hierDrag].name, 0xFFFFFFFF, 13);
  }

  // ── inspector (direita) ─────────────────────────────────────────────────────
  const ix = W - INSP_W;
  app.box(ix, BAR_H, INSP_W, H - BAR_H, 0x383838FF, 0, 0, 0);
  app.line(ix, BAR_H, ix, H, 1, 0x232323FF);
  // header/tab
  app.box(ix, BAR_H, INSP_W, 22, 0x303030FF, 0, 0, 0);
  app.box(ix + 4, BAR_H + 2, 84, 20, 0x424242FF, 0, 0, 3);
  app.text(ix + 12, BAR_H + 5, "Inspector", 0xCACACAFF, 12);
  app.line(ix, BAR_H + 22, W, BAR_H + 22, 1, 0x232323FF);
  const sel = scene.objects[selected];
  // faixa do nome do objeto
  app.box(ix + 6, BAR_H + 30, INSP_W - 12, 22, 0x2D2D2DFF, 0, 0, 3);
  app.text(ix + 14, BAR_H + 34, sel.name, 0xF0F0F0FF, 14);
  // pai + desaninhar
  if (sel.parent >= 0 && sel.parent < scene.objects.length) {
    app.text(ix + 14, BAR_H + 62, "Pai: " + scene.objects[sel.parent].name, 0x9A9A9AFF, 12);
    const bUn = app.button(ix + INSP_W - 108, BAR_H + 58, 94, 20, "Desaninhar");
    if (bUn) sel.parent = 0 - 1;
  } else {
    app.text(ix + 14, BAR_H + 62, "Pai: (raiz)", 0x707070FF, 12);
  }
  // ── Transform: campos numéricos X/Y/Z (scrub arrastando), estilo Unity ──────
  app.text(ix + 10, BAR_H + 74, "Transform", 0xB8B8B8FF, 13);
  const fx0 = ix + 66; const fw = 60; const g2 = 3;
  app.text(ix + 10, BAR_H + 96, "Position", 0x9A9A9AFF, 12);
  sel.transform.px = numField(WIN, 510, fx0, BAR_H + 92, fw, "X", AXIS_X, sel.transform.px, mx, my, mDownNow, mPressed);
  sel.transform.py = numField(WIN, 511, fx0 + fw + g2, BAR_H + 92, fw, "Y", AXIS_Y, sel.transform.py, mx, my, mDownNow, mPressed);
  sel.transform.pz = numField(WIN, 512, fx0 + (fw + g2) * 2, BAR_H + 92, fw, "Z", AXIS_Z, sel.transform.pz, mx, my, mDownNow, mPressed);
  app.text(ix + 10, BAR_H + 122, "Rotation", 0x9A9A9AFF, 12);
  sel.transform.rx = numField(WIN, 520, fx0, BAR_H + 118, fw, "X", AXIS_X, sel.transform.rx, mx, my, mDownNow, mPressed);
  sel.transform.ry = numField(WIN, 521, fx0 + fw + g2, BAR_H + 118, fw, "Y", AXIS_Y, sel.transform.ry, mx, my, mDownNow, mPressed);
  sel.transform.rz = numField(WIN, 522, fx0 + (fw + g2) * 2, BAR_H + 118, fw, "Z", AXIS_Z, sel.transform.rz, mx, my, mDownNow, mPressed);
  app.text(ix + 10, BAR_H + 148, "Scale", 0x9A9A9AFF, 12);
  const nsx = numField(WIN, 530, fx0, BAR_H + 144, fw, "X", AXIS_X, sel.transform.sx, mx, my, mDownNow, mPressed);
  const nsy = numField(WIN, 531, fx0 + fw + g2, BAR_H + 144, fw, "Y", AXIS_Y, sel.transform.sy, mx, my, mDownNow, mPressed);
  const nsz = numField(WIN, 532, fx0 + (fw + g2) * 2, BAR_H + 144, fw, "Z", AXIS_Z, sel.transform.sz, mx, my, mDownNow, mPressed);
  sel.transform.sx = nsx; sel.transform.sy = nsy; sel.transform.sz = nsz;

  // ── mesh + estático ─────────────────────────────────────────────────────────
  let meshName = "Cubo";
  if (sel.meshKind === 2) meshName = "Piramide";
  if (sel.meshKind === 3) meshName = "Octaedro";
  if (sel.meshKind === 4) meshName = "Esfera";
  app.text(ix + 14, BAR_H + 180, "Mesh: " + meshName, 0xC0C0C0FF, 13);
  const bMesh = app.button(ix + 14, BAR_H + 200, 104, 26, "Trocar");
  if (bMesh) { sel.meshKind = sel.meshKind + 1; if (sel.meshKind > 4) sel.meshKind = 1; }
  sel.stationary = app.checkbox(ix + 134, BAR_H + 203, sel.stationary, "Estatico");

  // ── componentes (scripts) do objeto — estilo Inspector do Unity ─────────────
  app.text(ix + 14, BAR_H + 242, "COMPONENTES", 0xC8C8C8FF, 14);
  let bc = 0;
  let cyc = BAR_H + 266;
  while (bc < sel.behaviors.length) {
    const d = sel.behaviors[bc].toData();
    let tn = "script";
    if (d !== null) tn = d.type;
    app.box(ix + 14, cyc, INSP_W - 28, 22, 0x333333FF, 1, 0x232323FF, 4);
    app.text(ix + 22, cyc + 3, "> " + tn, 0xC0C0C0FF, 13);
    cyc = cyc + 26;
    bc = bc + 1;
  }
  if (sel.behaviors.length === 0) {
    app.text(ix + 22, cyc, "(nenhum)", 0x707070FF, 12);
  }

  // ── barra inferior (status bar estilo Unity) sobre a área do viewport ───────
  const vpx = HIER_W;
  const vpw = W - HIER_W - INSP_W;
  app.box(vpx, H - 24, vpw, 24, 0x2D2D2DFF, 0, 0, 0);
  app.line(vpx, H - 24, vpx + vpw, H - 24, 1, 0x232323FF);
  let modeTxt = "Editing";
  if (playing !== 0) modeTxt = "Playing";
  app.text(vpx + 10, H - 19, modeTxt + "  |  objetos: " + scene.objects.length, 0x9A9A9AFF, 12);
  app.text(vpx + 10, BAR_H + 8, "Scene", 0xB0B0B0C0, 13);
  app.text(W - INSP_W - 470, H - 19, "WASD voa | botao DIR gira camera | esq seleciona/arrasta | espaco sobe", 0x808080FF, 11);

  // ── PROJECT PANEL (asset browser) na base do viewport ───────────────────────
  const apX = HIER_W;
  const apY = H - 24 - ASSET_H;
  const apW = W - HIER_W - INSP_W;
  const assetAct = drawAssets(WIN, apX, apY, apW, ASSET_H, mx, my, mPressed, frames);
  if (assetAct.length > 0) {
    const path = assetAct.substring(assetAct.indexOf(":") + 1);
    if (assetAct.charCodeAt(0) === 115) {      // "scene:" → recarrega a cena
      loadSceneFrom(path);
      selected = 0;
    } else {                                   // "prefab:" → instancia na cena
      instantiatePrefab(path);
      selected = scene.objects.length - 1;
    }
  }

  app.endFrame();
}

io.print("[engine] encerrado apos " + frames + " frames");
buffer.free(fbuf);
buffer.free(zbuf);
app.close();

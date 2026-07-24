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

import { GameObject } from "./engine/core/gameobject";
import { numField, AXIS_X, AXIS_Y, AXIS_Z, subStr } from "./editor/widgets";
import { COMPONENT_NAMES, createComponent } from "./editor/components";
import { assetsInit, drawAssets } from "./editor/assets";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, drawGPUMesh, inFrustum, winWidth, winHeight, loadTexture } from "./engine/render/gpu3d";
import { scene, S } from "./editor/control/session";
import { loadSceneFrom, instantiatePrefab } from "./editor/sceneio";
import { ctrlServe, ctrlPoll } from "./editor/control/server";

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
const FOV: f64 = 1.05;
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);   // p/ framebuffer
let focalW: f64 = (H * 0.5) / math.tan(FOV * 0.5);      // p/ picking; recalc por frame

// ── cena (estilo Unity) ─────────────────────────────────────────────────────

// carga inicial: prefere shadowdemo.json (sombras + textura); senão solar.json.
let sceneFile = "scenes/solar.json";
if (fs.exists("scenes/shadowdemo.json")) sceneFile = "scenes/shadowdemo.json";
loadSceneFrom(sceneFile);

// ── estado do editor ────────────────────────────────────────────────────────
let frames = 0;
let spawnN = 0;
let dragging = 0;
let addMenuOpen = 0;   // dropdown "Add Component" aberto?
let addFilter = "";    // texto de busca do dropdown (filtra a lista)

// conversão rad↔graus + wrap [0,360) pra rotação no inspector
const RAD2DEG: f64 = 57.2957795;
const DEG2RAD: f64 = 0.0174532925;
function wrapDeg(d: f64): f64 {
  let r = d - math.floor(d / 360.0) * 360.0;
  if (r < 0.0) r = r + 360.0;
  return r;
}

// posiciona a câmera do editor pra ENQUADRAR o objeto idx (Unity "frame selected").
function frameObject(idx: number): void {
  if (idx < 0 || idx >= scene.objects.length) return;
  const o = scene.objects[idx];
  const wx: f64 = o.transform.wx; const wy: f64 = o.transform.wy; const wz: f64 = o.transform.wz;
  let sz: f64 = o.transform.sx;
  if (o.transform.sy > sz) sz = o.transform.sy;
  if (o.transform.sz > sz) sz = o.transform.sz;
  const dist: f64 = sz * 2.2 + 3.0;
  S.camX = wx;
  S.camY = wy + dist * 0.4;
  S.camZ = wz - dist;
  S.camYaw = 0.0;
  S.camPitch = math.atan2(wy - S.camY, dist);   // olha pra baixo, pro objeto
}

// "name contém filter" case-insensitive (só charCodeAt/length — robusto no motor).
function containsCI(name: string, filter: string): boolean {
  if (filter.length === 0) return true;
  if (filter.length > name.length) return false;
  let off = 0;
  while (off + filter.length <= name.length) {
    let ok = 1;
    let i = 0;
    while (i < filter.length) {
      let a = name.charCodeAt(off + i);
      let b = filter.charCodeAt(i);
      if (a >= 65 && a <= 90) a = a + 32;
      if (b >= 65 && b <= 90) b = b + 32;
      if (a !== b) { ok = 0; i = filter.length; } else { i = i + 1; }
    }
    if (ok === 1) return true;
    off = off + 1;
  }
  return false;
}
let hierDrag = 0 - 1;
let hierLastClick = 0 - 1;      // duplo-clique na hierarquia (enquadra a câmera)
let hierLastClickFrame = 0 - 999;
let lastMx: f64 = 0.0;
let lastMy: f64 = 0.0;

initMeshes(WIN);
assetsInit();
ctrlServe(7777);   // porta de controle da LLM (ws://127.0.0.1:7777)
S.win = WIN;
io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos");

// Corpo de 1 frame numa FUNÇÃO — no motor, métodos de singleton importado
// (scene/S) despacham corretamente em função, não no top-level do while.
function frame(): void {
  // ── layout RESPONSIVO: lê o tamanho lógico atual da janela (segue o resize) ──
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  focalW = (H * 0.5) / math.tan(FOV * 0.5);
  ctrlPoll(W, H);   // ← controle da LLM por WebSocket (não-bloqueante)
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
  if (kLf !== 0) S.camYaw = S.camYaw - lookSpeed;
  if (kRt !== 0) S.camYaw = S.camYaw + lookSpeed;
  if (kUp !== 0) S.camPitch = S.camPitch - lookSpeed;
  if (kDn !== 0) S.camPitch = S.camPitch + lookSpeed;
  // olhar com o BOTÃO DIREITO do mouse (mouse-look estilo Unity fly)
  const mvdx: f64 = input.mouseDeltaX(WIN);
  const mvdy: f64 = input.mouseDeltaY(WIN);
  if (input.mouseDown(WIN, 1) !== 0) {
    S.camYaw = S.camYaw + mvdx * 0.005;
    S.camPitch = S.camPitch - mvdy * 0.005;
  }
  if (S.camPitch > 1.4) S.camPitch = 1.4;
  if (S.camPitch < 0 - 1.4) S.camPitch = 0 - 1.4;

  const cyw = math.cos(S.camYaw);
  const syw = math.sin(S.camYaw);
  const cpM = math.cos(S.camPitch);
  const spM = math.sin(S.camPitch);
  const moveSpeed: f64 = 6.0 * dts;
  // forward = direção que a câmera olha (inclui o pitch); W/S voam nessa direção
  const fx = syw * cpM; const fy = spM; const fz = cyw * cpM;
  const rxv = cyw; const rzv = 0 - syw;   // strafe (A/D) no plano horizontal
  if (kW !== 0) { S.camX = S.camX + fx * moveSpeed; S.camY = S.camY + fy * moveSpeed; S.camZ = S.camZ + fz * moveSpeed; }
  if (kS !== 0) { S.camX = S.camX - fx * moveSpeed; S.camY = S.camY - fy * moveSpeed; S.camZ = S.camZ - fz * moveSpeed; }
  if (kD !== 0) { S.camX = S.camX + rxv * moveSpeed; S.camZ = S.camZ + rzv * moveSpeed; }
  if (kA !== 0) { S.camX = S.camX - rxv * moveSpeed; S.camZ = S.camZ - rzv * moveSpeed; }
  if (kSp !== 0) S.camY = S.camY + moveSpeed;

  // ── UPDATE da cena (só quando S.playing) ────────────────────────────────────
  if (S.playing !== 0) { scene.update(dts); scene.resolveCollisions(); }
  scene.computeWorld();

  // ── PICKING + DRAG: pressionar seleciona; segurando, ARRASTA o objeto ───────
  const mPressed = input.mousePressed(WIN, 0);
  const mDownNow = input.mouseDown(WIN, 0);
  const mx: f64 = input.mouseX(WIN);
  const my: f64 = input.mouseY(WIN);
  const inViewport = mx > HIER_W && mx < W - INSP_W && my > BAR_H && my < H - 24 - ASSET_H;
  const cpt2 = math.cos(S.camPitch); const spt2 = math.sin(S.camPitch);
  if (mPressed !== 0 && inViewport) {
    // seleciona o objeto projetado mais perto do mouse e começa o drag
    let best = 0 - 1;
    let bestD: f64 = 1e30;
    let pi = 0;
    while (pi < scene.objects.length) {
      const po = scene.objects[pi];
      if (po.meshKind !== 0) {
        const dx = po.transform.wx - S.camX;
        const dy = po.transform.wy - S.camY;
        const dz = po.transform.wz - S.camZ;
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
    if (best >= 0) { S.selected = best; dragging = 1; }
    lastMx = mx; lastMy = my;
  }
  if (mDownNow === 0) dragging = 0;
  // enquanto arrasta: move o selecionado no plano da tela (direita da câmera + Y)
  if (dragging !== 0 && mDownNow !== 0 && inViewport && scene.objects.length > 0) {
    const so = scene.objects[S.selected];
    const dxo = so.transform.wx - S.camX;
    const dzo = so.transform.wz - S.camZ;
    const z1o = dxo * syw + dzo * cyw;
    let depth: f64 = (so.transform.wy - S.camY) * spt2 + z1o * cpt2;
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
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);
  setLgt(WIN, 7.0, 13.0, 5.0, 0.28);   // luz PONTUAL (posição no alto)
  // shadow map direcional: luz viaja do alto pra baixo em direção à cena
  setShadow(WIN, 0 - 7.0, 0 - 12.0, 0 - 5.0, 0.0, 1.0, 0.0, 24.0);
  let oi = 0;
  let drawnN = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    if (o.active !== 0 && (o.meshKind !== 0 || o.customMesh > 0)) {
      // frustum culling: raio da esfera envolvente (maior escala × ~0.87)
      let rmax: f64 = o.transform.sx;
      if (o.transform.sy > rmax) rmax = o.transform.sy;
      if (o.transform.sz > rmax) rmax = o.transform.sz;
      const vis = inFrustum(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H,
        o.transform.wx, o.transform.wy, o.transform.wz, rmax * 0.87);
      if (vis !== 0) {
        let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
        if (oi === S.selected) { rr = 255; gg = 230; bbv = 120; } // selecionado = dourado
        const col = (rr << 16) | (gg << 8) | bbv;
        // APARÊNCIA: se o objeto tem um component Material (matIdx cacheado, O(1)),
        // ele manda; senão fallback pros campos do GameObject (cenas sem Material).
        // tex: imagem real (id>=2) tem prioridade sobre o procedural (0/1).
        let texArg = o.tex;
        if (o.textureId > 0) texArg = o.textureId;
        let emisArg = o.emissive;
        if (o.matIdx >= 0) {
          const m = o.behaviors[o.matIdx];
          const tid = m.matTexId() | 0;
          if (tid > 0) texArg = tid; else texArg = m.matTexMode();
          emisArg = m.matEmissive();
        }
        if (o.customMesh > 0) {
          drawGPUMesh(WIN, o.customMesh, o.transform.wx, o.transform.wy, o.transform.wz,
            o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, emisArg, texArg);
        } else {
          drawGPU(WIN, o.meshKind, o.transform.wx, o.transform.wy, o.transform.wz,
            o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, emisArg, texArg);
        }
        drawnN = drawnN + 1;
      }
    }
    oi = oi + 1;
  }
  S.drawnLast = drawnN;   // nº de objetos desenhados neste frame (diagnóstico via ws 'dbg')

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
    scene.add(g); S.selected = scene.objects.length - 1; spawnN = spawnN + 1;
  }
  const stSph = app.clickable(903, 88, 9, 80, 28);
  let fSph = 0x2D2D2DFF; if (stSph === 1) fSph = 0x454545FF; if (stSph === 2) fSph = 0x252525FF;
  app.box(88, 9, 80, 28, fSph, 1, 0x232323FF, 3);
  app.text(96, 15, "+ Esfera", 0xC8C8C8FF, 13);
  if (stSph === 3) {
    const g = new GameObject("Sphere." + spawnN);
    g.setMesh(4, 220, 140, 180); g.transform.setPosition(0, 1.5, 0);
    scene.add(g); S.selected = scene.objects.length - 1; spawnN = spawnN + 1;
  }
  const stDel = app.clickable(904, 172, 9, 74, 28);
  let fDel = 0x2D2D2DFF; if (stDel === 1) fDel = 0x5A3A3AFF; if (stDel === 2) fDel = 0x252525FF;
  app.box(172, 9, 74, 28, fDel, 1, 0x232323FF, 3);
  app.text(182, 15, "Deletar", 0xC8B0B0FF, 13);
  if (stDel === 3 && scene.objects.length > 0) {
    scene.removeAt(S.selected);
    if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
    if (S.selected < 0) S.selected = 0;
  }

  // — play controls CENTRALIZADOS (Play / Pause) —
  const pcx = W / 2 - 44;
  const stPlay = app.clickable(900, pcx, 9, 42, 28);
  let fPlay = 0x2D2D2DFF;
  if (S.playing !== 0) fPlay = 0x4A75B0FF; else if (stPlay === 1) fPlay = 0x454545FF;
  app.box(pcx, 9, 42, 28, fPlay, 1, 0x232323FF, 3);
  app.text(pcx + 16, 13, "|>", 0xE0E0E0FF, 15);
  if (stPlay === 3) S.playing = 1;
  const stPause = app.clickable(901, pcx + 44, 9, 42, 28);
  let fPause = 0x2D2D2DFF;
  if (S.playing === 0) fPause = 0x4A75B0FF; else if (stPause === 1) fPause = 0x454545FF;
  app.box(pcx + 44, 9, 42, 28, fPause, 1, 0x232323FF, 3);
  app.text(pcx + 44 + 15, 13, "||", 0xE0E0E0FF, 15);
  if (stPause === 3) S.playing = 0;

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
    if (mPressed !== 0 && inRow) {
      // duplo-clique = enquadra a câmera no objeto (Unity "F"); simples = seleciona
      const dbl = (hi === hierLastClick && frames - hierLastClickFrame < 24) ? 1 : 0;
      hierDrag = hi; S.selected = hi;
      if (dbl !== 0) frameObject(hi);
      hierLastClick = hi; hierLastClickFrame = frames;
    }
    // detecta a zona de drop enquanto arrasta
    if (hierDrag >= 0 && inRow) {
      const local: f64 = my - ry0;
      if (local < 8.0) { dropIdx = hi; dropMode = 1; dropLineY = ry0; }
      else if (local >= 18.0) { dropIdx = hi; dropMode = 3; dropLineY = ry0 + 26; }
      else { dropIdx = hi; dropMode = 2; }
    }
    let fill = 0x333333FF;
    if (hi === S.selected) fill = 0x4A75B0FF;
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
        if (scene.objects[f2] === dref) { S.selected = f2; f2 = scene.objects.length; } else f2 = f2 + 1;
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
  const sel = scene.objects[S.selected];
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
  // Rotação em GRAUS dando a volta 0–360 (interno é radiano e acumula; converte
  // pra graus + wrap pro display/edição — estilo Unity, não um número que só sobe).
  let rxD = numField(WIN, 520, fx0, BAR_H + 118, fw, "X", AXIS_X, wrapDeg(sel.transform.rx * RAD2DEG), mx, my, mDownNow, mPressed);
  let ryD = numField(WIN, 521, fx0 + fw + g2, BAR_H + 118, fw, "Y", AXIS_Y, wrapDeg(sel.transform.ry * RAD2DEG), mx, my, mDownNow, mPressed);
  let rzD = numField(WIN, 522, fx0 + (fw + g2) * 2, BAR_H + 118, fw, "Z", AXIS_Z, wrapDeg(sel.transform.rz * RAD2DEG), mx, my, mDownNow, mPressed);
  sel.transform.rx = wrapDeg(rxD) * DEG2RAD;
  sel.transform.ry = wrapDeg(ryD) * DEG2RAD;
  sel.transform.rz = wrapDeg(rzD) * DEG2RAD;
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

  // ── componentes do objeto — cada um com CABEÇALHO + campos de CONFIG editáveis
  //    + botão remover; e a lista "Add Component" no fim (estilo Inspector Unity)
  app.text(ix + 14, BAR_H + 242, "COMPONENTES", 0xC8C8C8FF, 14);
  let bc = 0;
  let cyc = BAR_H + 266;
  let removeIdx = 0 - 1;
  while (bc < sel.behaviors.length) {
    // cabeçalho: nome do componente + botão remover (X) — método DIRETO no index
    // (dispatch provado; método em local tipado-classe pode não despachar)
    app.box(ix + 14, cyc, INSP_W - 28, 22, 0x3A3A3AFF, 1, 0x232323FF, 4);
    app.text(ix + 22, cyc + 4, sel.behaviors[bc].typeName(), 0xD0D0D0FF, 13);
    const bDel = app.button(ix + INSP_W - 42, cyc + 2, 20, 18, "x");
    if (bDel) removeIdx = bc;
    cyc = cyc + 26;
    // campos de config: um numField por campo (arraste horizontal edita)
    const nf = sel.behaviors[bc].fieldCount();
    let fi = 0;
    while (fi < nf) {
      const id = 600 + bc * 20 + fi;
      const nv = numField(WIN, id, ix + 24, cyc, INSP_W - 52, sel.behaviors[bc].fieldLabel(fi), 0x5A7FB0FF,
        sel.behaviors[bc].fieldGet(fi), mx, my, mDownNow, mPressed);
      sel.behaviors[bc].fieldSet(fi, nv);
      cyc = cyc + 23;
      fi = fi + 1;
    }
    cyc = cyc + 6;
    bc = bc + 1;
  }
  if (sel.behaviors.length === 0) {
    app.text(ix + 22, cyc, "(nenhum componente)", 0x707070FF, 12);
    cyc = cyc + 22;
  }
  // remove após o loop (não mexe no array durante a iteração)
  if (removeIdx >= 0) sel.removeBehavior(removeIdx);

  // ── ADD COMPONENT: botão que abre um DROPDOWN com CAMPO DE BUSCA + lista ─────
  cyc = cyc + 8;
  const bAddC = app.button(ix + 14, cyc, INSP_W - 28, 24, "Add Component  v");
  if (bAddC) {
    if (addMenuOpen === 0) { addMenuOpen = 1; addFilter = ""; app.setFocus(950); }
    else { addMenuOpen = 0; app.setFocus(0 - 1); }
  }
  cyc = cyc + 28;
  if (addMenuOpen !== 0) {
    // campo de busca (digitar filtra a lista); Backspace (tecla 4) apaga
    addFilter = app.textField(950, ix + 14, cyc, INSP_W - 28, addFilter);
    if (app.isFocused(950) && app.keyPressed(4) !== 0 && addFilter.length > 0) {
      addFilter = subStr(addFilter, 0, addFilter.length - 1);
    }
    cyc = cyc + 34;
    // lista filtrada
    app.box(ix + 14, cyc, INSP_W - 28, COMPONENT_NAMES.length * 24 + 4, 0x252525FF, 1, 0x151515FF, 4);
    let ci = 0;
    let shown = 0;
    while (ci < COMPONENT_NAMES.length) {
      const nm = COMPONENT_NAMES[ci];
      if (containsCI(nm, addFilter)) {
        const rowy = cyc + 2 + shown * 24;
        const over = mx >= ix + 16 && mx < ix + INSP_W - 14 && my >= rowy && my < rowy + 23;
        if (over) app.box(ix + 16, rowy, INSP_W - 32, 23, 0x3A5A80FF, 0, 0, 3);
        app.text(ix + 24, rowy + 4, nm, 0xD4D4D4FF, 13);
        if (over && mPressed !== 0) { sel.addBehavior(createComponent(nm)); addMenuOpen = 0; app.setFocus(0 - 1); }
        shown = shown + 1;
      }
      ci = ci + 1;
    }
    if (shown === 0) app.text(ix + 24, cyc + 6, "(nenhum)", 0x707070FF, 12);
  }

  // ── barra inferior (status bar estilo Unity) sobre a área do viewport ───────
  const vpx = HIER_W;
  const vpw = W - HIER_W - INSP_W;
  app.box(vpx, H - 24, vpw, 24, 0x2D2D2DFF, 0, 0, 0);
  app.line(vpx, H - 24, vpx + vpw, H - 24, 1, 0x232323FF);
  let modeTxt = "Editing";
  if (S.playing !== 0) modeTxt = "Playing";
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
    const c0 = assetAct.charCodeAt(0);
    if (c0 === 115) {                          // "scene:" → recarrega a cena
      loadSceneFrom(path);
      S.selected = 0;
    } else if (c0 === 116) {                   // "tex:" → aplica no obj selecionado
      if (S.selected >= 0 && S.selected < scene.objects.length) {
        const tid = loadTexture(WIN, path) | 0;
        if (tid > 0) scene.objects[S.selected].applyTexture(tid, path);
      }
    } else {                                   // "prefab:" → instancia na cena
      instantiatePrefab(path);
      S.selected = scene.objects.length - 1;
    }
  }

  app.endFrame();
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}


io.print("[engine] encerrado apos " + frames + " frames");
buffer.free(fbuf);
buffer.free(zbuf);
app.close();

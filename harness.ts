// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — PORTA DE CONTROLE headless (protocolo de linha stdin/stdout).
//
// Uma IA (ou script) dirige a engine SEM janela: manda comandos linha-a-linha
// no stdin; a engine executa e responde no stdout (acks, estado, preview ASCII
// do frame). Determinístico (dt fixo). Ideal p/ testar a engine do zero.
//
//   printf 'spawn box 0 1 0\nstep 30\nframe\nstate\nquit\n' | rts.exe run harness.ts
//
// PROTOCOLO (um comando por linha):
//   spawn <name> <x> <y> <z> [scale]   cria um cubo
//   move  <i> <x> <y> <z>              seta posição do objeto i
//   rot   <i> <rx> <ry>                seta rotação (rad)
//   scale <i> <s>                      seta escala
//   spin  <i> <spdY> [spdX]            anexa script Spinner
//   bob   <i> <amp> <freq>            anexa script Bobber (baseY = y atual)
//   select <i>                         seleciona (destaque dourado)
//   cam   <x> <y> <z> <yaw> <pitch>    posiciona a câmera
//   play | pause                       liga/desliga o update dos scripts
//   step  [n]                          avança n ticks de update (dt=16ms)
//   frame [cols] [rows]                rasteriza e imprime preview ASCII
//   state                              imprime estado (objetos + câmera)
//   lit                                imprime nº de pixels desenhados (sanity)
//   save  <path>                       salva PPM P3 (160x96) do frame atual
//   quit | exit                        encerra
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";
import buffer from "rts:buffer";
import fs from "rts:fs";

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";
import { Rigidbody } from "./scripts/rigidbody";
import { clearFB, drawFloor } from "./engine/render/raster";
import { drawMeshSolid } from "./engine/render/mesh";
import { asciiFrame, dumpObject, dumpCamera, countLit, savePPM } from "./engine/testkit/dump";

const RW = 240;
const RH = 144;
const NPIX = RW * RH;
const fbuf = buffer.alloc(NPIX * 4);
const zbuf = buffer.alloc(NPIX * 8);
const FOV: f64 = 1.05;
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);

// câmera
let camX: f64 = 0.0; let camY: f64 = 3.0; let camZ: f64 = -10.0;
let camYaw: f64 = 0.0; let camPitch: f64 = 0.18;

const scene = new Scene("Headless");
let playing = 1;
let selected = 0;
let frame = 0;
let tsec: f64 = 0.0;

// buffer de leitura de comando
const cmdbuf = buffer.alloc_zeroed(512);
const cptr = buffer.ptr(cmdbuf);

io.print("[engine] porta de controle pronta — envie comandos (help no README). RW=" + RW + " RH=" + RH);

// paleta ciclada p/ spawns
function spawnColor(i: number, ch: number): number {
  let base = 120;
  if (ch === 0) { if (i % 3 === 0) base = 90; if (i % 3 === 1) base = 240; if (i % 3 === 2) base = 120; }
  if (ch === 1) { if (i % 3 === 0) base = 150; if (i % 3 === 1) base = 150; if (i % 3 === 2) base = 220; }
  if (ch === 2) { if (i % 3 === 0) base = 240; if (i % 3 === 1) base = 70; if (i % 3 === 2) base = 120; }
  return base;
}

let running = 1;
while (running !== 0) {
  const n = io.stdin_read_line(cptr, 512);
  if (n <= 0) break; // EOF (pipe fechado)
  const full = buffer.to_string(cmdbuf);
  const line = full.substring(0, n);
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;

  if (cmd === "quit" || cmd === "exit") {
    running = 0;
  } else if (cmd === "" || cmd === "#") {
    // ignora
  } else if (cmd === "spawn") {
    const name = parts[1];
    const x = parseFloat(parts[2]);
    const y = parseFloat(parts[3]);
    const z = parseFloat(parts[4]);
    let sc: f64 = 1.0;
    if (np > 5) sc = parseFloat(parts[5]);
    const idx = scene.objects.length;
    const go = new GameObject(name);
    go.setMesh(1, spawnColor(idx, 0), spawnColor(idx, 1), spawnColor(idx, 2));
    go.transform.setPosition(x, y, z);
    go.transform.setScale(sc);
    scene.add(go);
    io.print("[ok] spawn #" + idx + " " + name);
  } else if (cmd === "move") {
    const i = parseFloat(parts[1]) | 0;
    const o = scene.objects[i];
    o.transform.px = parseFloat(parts[2]);
    o.transform.py = parseFloat(parts[3]);
    o.transform.pz = parseFloat(parts[4]);
    io.print("[ok] move #" + i);
  } else if (cmd === "rot") {
    const i = parseFloat(parts[1]) | 0;
    const o = scene.objects[i];
    o.transform.rx = parseFloat(parts[2]);
    o.transform.ry = parseFloat(parts[3]);
    io.print("[ok] rot #" + i);
  } else if (cmd === "scale") {
    const i = parseFloat(parts[1]) | 0;
    const s = parseFloat(parts[2]);
    const o = scene.objects[i];
    o.transform.sx = s; o.transform.sy = s; o.transform.sz = s;
    io.print("[ok] scale #" + i);
  } else if (cmd === "spin") {
    const i = parseFloat(parts[1]) | 0;
    const sy = parseFloat(parts[2]);
    let sx: f64 = 0.0;
    if (np > 3) sx = parseFloat(parts[3]);
    scene.objects[i].addBehavior(new Spinner(sy, sx));
    io.print("[ok] spin #" + i);
  } else if (cmd === "bob") {
    const i = parseFloat(parts[1]) | 0;
    const amp = parseFloat(parts[2]);
    const freq = parseFloat(parts[3]);
    const o = scene.objects[i];
    o.addBehavior(new Bobber(amp, freq, o.transform.py));
    io.print("[ok] bob #" + i);
  } else if (cmd === "rigid") {
    const i = parseFloat(parts[1]) | 0;
    let g: f64 = -9.8;
    let bounce: f64 = 0.5;
    if (np > 2) g = parseFloat(parts[2]);
    if (np > 3) bounce = parseFloat(parts[3]);
    scene.objects[i].addBehavior(new Rigidbody(g, bounce));
    io.print("[ok] rigid #" + i + " g=" + g + " bounce=" + bounce);
  } else if (cmd === "parent") {
    const ci = parseFloat(parts[1]) | 0;
    scene.objects[ci].parent = parseFloat(parts[2]) | 0;
    io.print("[ok] parent #" + ci + " -> #" + (parseFloat(parts[2]) | 0));
  } else if (cmd === "select") {
    selected = parseFloat(parts[1]) | 0;
    io.print("[ok] select #" + selected);
  } else if (cmd === "cam") {
    camX = parseFloat(parts[1]); camY = parseFloat(parts[2]); camZ = parseFloat(parts[3]);
    camYaw = parseFloat(parts[4]); camPitch = parseFloat(parts[5]);
    io.print("[ok] cam");
  } else if (cmd === "play") {
    playing = 1; io.print("[ok] play");
  } else if (cmd === "pause") {
    playing = 0; io.print("[ok] pause");
  } else if (cmd === "step") {
    let cnt = 1;
    if (np > 1) cnt = parseFloat(parts[1]) | 0;
    let k = 0;
    while (k < cnt) {
      if (playing !== 0) { scene.update(0.016); scene.resolveCollisions(); }
      tsec = tsec + 0.016;
      frame = frame + 1;
      k = k + 1;
    }
    io.print("[ok] step " + cnt + " -> frame " + frame);
  } else if (cmd === "frame") {
    let cols = 64; let rows = 26;
    if (np > 1) cols = parseFloat(parts[1]) | 0;
    if (np > 2) rows = parseFloat(parts[2]) | 0;
    scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind !== 0) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawMeshSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.wx, ro.transform.wy, ro.transform.wz,
          ro.transform.wrx, ro.transform.wry, ro.transform.sx, ro.meshKind, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    asciiFrame(fbuf, RW, RH, cols, rows);
  } else if (cmd === "state") {
    scene.computeWorld();
    io.print("[state] frame=" + frame + " playing=" + playing + " objetos=" + scene.objects.length + " selecionado=" + selected);
    let si = 0;
    while (si < scene.objects.length) {
      const o = scene.objects[si];
      dumpObject(si, o.name, o.transform.px, o.transform.py, o.transform.pz,
        o.transform.wrx, o.transform.wry, o.transform.sx, o.meshKind);
      io.print("       world(" + o.transform.wx + "," + o.transform.wy + "," + o.transform.wz + ") parent=" + o.parent);
      si = si + 1;
    }
    dumpCamera(camX, camY, camZ, camYaw, camPitch);
  } else if (cmd === "lit") {
    scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind !== 0) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawMeshSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.wx, ro.transform.wy, ro.transform.wz,
          ro.transform.wrx, ro.transform.wry, ro.transform.sx, ro.meshKind, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    const lit = countLit(fbuf, RW, RH, 12.0);
    io.print("[lit] " + lit + " pixels desenhados de " + NPIX);
  } else if (cmd === "save") {
    scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind !== 0) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawMeshSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.wx, ro.transform.wy, ro.transform.wz,
          ro.transform.wrx, ro.transform.wry, ro.transform.sx, ro.meshKind, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    savePPM(parts[1], fbuf, RW, RH, 160, 96);
    io.print("[ok] save " + parts[1]);
  } else if (cmd === "mesh") {
    const i = parseFloat(parts[1]) | 0;
    scene.objects[i].meshKind = parseFloat(parts[2]) | 0;
    io.print("[ok] mesh #" + i + " kind=" + (parseFloat(parts[2]) | 0));
  } else if (cmd === "delete") {
    const i = parseFloat(parts[1]) | 0;
    scene.removeAt(i);
    if (selected >= scene.objects.length) selected = scene.objects.length - 1;
    if (selected < 0) selected = 0;
    io.print("[ok] delete #" + i + " -> " + scene.objects.length + " objetos");
  } else if (cmd === "dup") {
    const i = parseFloat(parts[1]) | 0;
    const src = scene.objects[i];
    const go = new GameObject(src.name + ".copy");
    go.setMesh(src.meshKind, src.cr, src.cg, src.cb);
    go.transform.setPosition(src.transform.px + 1.0, src.transform.py, src.transform.pz);
    go.transform.setScale(src.transform.sx);
    go.transform.rx = src.transform.rx; go.transform.ry = src.transform.ry;
    scene.add(go);
    io.print("[ok] dup #" + i + " -> #" + (scene.objects.length - 1));
  } else if (cmd === "color") {
    const i = parseFloat(parts[1]) | 0;
    const o = scene.objects[i];
    o.cr = parseFloat(parts[2]) | 0; o.cg = parseFloat(parts[3]) | 0; o.cb = parseFloat(parts[4]) | 0;
    io.print("[ok] color #" + i);
  } else if (cmd === "name") {
    const i = parseFloat(parts[1]) | 0;
    scene.objects[i].name = parts[2];
    io.print("[ok] name #" + i + " " + parts[2]);
  } else if (cmd === "savescene") {
    // monta a árvore de objetos simples e deixa o JSON.stringify do motor formatar
    const objs: any[] = [];
    let oi = 0;
    while (oi < scene.objects.length) {
      const o = scene.objects[oi];
      const scripts: any[] = [];
      let bi = 0;
      while (bi < o.behaviors.length) {
        const d = o.behaviors[bi].toData();
        if (d !== null) scripts.push(d);
        bi = bi + 1;
      }
      objs.push({
        name: o.name, parent: o.parent,
        mesh: o.meshKind,
        color: [o.cr | 0, o.cg | 0, o.cb | 0],
        pos: [o.transform.px, o.transform.py, o.transform.pz],
        rot: [o.transform.rx, o.transform.ry],
        scale: o.transform.sx,
        scripts: scripts
      });
      oi = oi + 1;
    }
    const doc = { scene: scene.name, objects: objs };
    fs.write(parts[1], JSON.stringify(doc));
    io.print("[ok] savescene " + parts[1] + " (" + scene.objects.length + " objetos)");
  } else if (cmd === "loadscene") {
    const src = fs.read_text(parts[1]);
    const data = JSON.parse(src);
    const arr = data.objects;
    scene.clear();
    selected = 0;
    let ci = 0;
    while (ci < arr.length) {
      const od = arr[ci];
      const go = new GameObject(od.name);
      if (od.parent !== undefined) go.parent = od.parent;
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
        si = si + 1;
      }
      scene.add(go);
      ci = ci + 1;
    }
    io.print("[ok] loadscene " + parts[1] + " -> " + scene.objects.length + " objetos");
  } else {
    io.print("[erro] comando desconhecido: " + cmd);
  }
}

io.print("[engine] porta de controle encerrada (frame=" + frame + ")");
buffer.free(fbuf);
buffer.free(zbuf);
buffer.free(cmdbuf);

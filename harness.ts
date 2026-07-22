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

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";
import { clearFB, drawCubeSolid, drawFloor } from "./engine/render/raster";
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
      if (playing !== 0) scene.update(0.016);
      tsec = tsec + 0.016;
      frame = frame + 1;
      k = k + 1;
    }
    io.print("[ok] step " + cnt + " -> frame " + frame);
  } else if (cmd === "frame") {
    let cols = 64; let rows = 26;
    if (np > 1) cols = parseFloat(parts[1]) | 0;
    if (np > 2) rows = parseFloat(parts[2]) | 0;
    clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind === 1) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawCubeSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.px, ro.transform.py, ro.transform.pz,
          ro.transform.rx, ro.transform.ry, ro.transform.sx, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    asciiFrame(fbuf, RW, RH, cols, rows);
  } else if (cmd === "state") {
    io.print("[state] frame=" + frame + " playing=" + playing + " objetos=" + scene.objects.length + " selecionado=" + selected);
    let si = 0;
    while (si < scene.objects.length) {
      const o = scene.objects[si];
      dumpObject(si, o.name, o.transform.px, o.transform.py, o.transform.pz,
        o.transform.rx, o.transform.ry, o.transform.sx, o.meshKind);
      si = si + 1;
    }
    dumpCamera(camX, camY, camZ, camYaw, camPitch);
  } else if (cmd === "lit") {
    clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind === 1) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawCubeSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.px, ro.transform.py, ro.transform.pz,
          ro.transform.rx, ro.transform.ry, ro.transform.sx, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    const lit = countLit(fbuf, RW, RH, 12.0);
    io.print("[lit] " + lit + " pixels desenhados de " + NPIX);
  } else if (cmd === "save") {
    clearFB(fbuf, zbuf, NPIX, 0xFF201810);
    drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
    let roi = 0;
    while (roi < scene.objects.length) {
      const ro = scene.objects[roi];
      if (ro.active !== 0 && ro.meshKind === 1) {
        let rr = ro.cr | 0; let gg = ro.cg | 0; let bbv = ro.cb | 0;
        if (roi === selected) { rr = 255; gg = 230; bbv = 120; }
        drawCubeSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
          ro.transform.px, ro.transform.py, ro.transform.pz,
          ro.transform.rx, ro.transform.ry, ro.transform.sx, rr, gg, bbv);
      }
      roi = roi + 1;
    }
    savePPM(parts[1], fbuf, RW, RH, 160, 96);
    io.print("[ok] save " + parts[1]);
  } else {
    io.print("[erro] comando desconhecido: " + cmd);
  }
}

io.print("[engine] porta de controle encerrada (frame=" + frame + ")");
buffer.free(fbuf);
buffer.free(zbuf);
buffer.free(cmdbuf);

// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — PORTA DE CONTROLE via WebSocket + janela AO VIVO (render GPU).
//
// Diferente do netharness (TCP bloqueante), aqui o loop RENDERIZA TODO FRAME pelo
// caminho GPU (sombras/textura/skybox) e faz POLL do WebSocket sem bloquear —
// `ws.serve` marca o listener non-blocking, `ws.accept` volta 0 sem cliente e
// `ws.recv` volta "" sem dados. Resultado: janela fluida que NÃO trava, dirigível
// de um NAVEGADOR (ws://127.0.0.1:7777) ou de qualquer cliente WebSocket.
//
//   ./rts.exe run wsharness.ts        # servidor + janela viva
//   (browser) abra tools/ws_control.html  → conecta e manda comandos
// ═══════════════════════════════════════════════════════════════════════════
import io from "./compat/io.ts";
import math from "./compat/math.ts";
import ws from "rts:ws";
import fs from "./compat/fs.ts";

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";
import { Mover } from "./scripts/mover";
import { Pulse } from "./scripts/pulse";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, inFrustum, winWidth, winHeight } from "./engine/render/gpu3d";

const PORT = 7777;

// ── janela + câmera ──────────────────────────────────────────────────────────
let W = 1000;
let H = 640;
const app = createAppAt("Engine RTS — WebSocket ao vivo", W, H, 140, 100);
const WIN = app._win;
const FOV: f64 = 1.05;

let camX: f64 = 0.0; let camY: f64 = 11.0; let camZ: f64 = -15.0;
let camYaw: f64 = 0.0; let camPitch: f64 = 0 - 0.5;

const scene = new Scene("WS");
let playing = 1;
let selected = 0;
let frame = 0;

function spawnColor(i: number, ch: number): number {
  let base = 120;
  if (ch === 0) { if (i % 3 === 0) base = 90; if (i % 3 === 1) base = 240; if (i % 3 === 2) base = 120; }
  if (ch === 1) { if (i % 3 === 0) base = 150; if (i % 3 === 1) base = 150; if (i % 3 === 2) base = 220; }
  if (ch === 2) { if (i % 3 === 0) base = 240; if (i % 3 === 1) base = 70; if (i % 3 === 2) base = 120; }
  return base;
}

// carrega a mesma cena do editor (chão + objetos), se existir
function loadSceneFrom(path: string): void {
  if (!fs.exists(path)) return;
  scene.clear();
  selected = 0;
  const data = JSON.parse(fs.read_text(path));
  const arr = data.objects;
  let ci = 0;
  while (ci < arr.length) {
    const od = arr[ci];
    const go = new GameObject(od.name);
    if (od.stationary !== undefined) go.stationary = od.stationary;
    if (od.emissive !== undefined) go.emissive = od.emissive;
    if (od.tex !== undefined) go.tex = od.tex;
    const col = od.color;
    go.setMesh(od.mesh, col[0], col[1], col[2]);
    const p = od.pos; const r = od.rot;
    go.transform.setPosition(p[0], p[1], p[2]);
    go.transform.rx = r[0]; go.transform.ry = r[1];
    if (od.scale3 !== undefined) { const s3 = od.scale3; go.transform.sx = s3[0]; go.transform.sy = s3[1]; go.transform.sz = s3[2]; }
    else go.transform.setScale(od.scale);
    const scr = od.scripts;
    if (scr !== undefined) {
      let si = 0;
      while (si < scr.length) {
        const sd = scr[si]; const t = sd.type;
        if (t === "spin") go.addBehavior(new Spinner(sd.sy, sd.sx));
        if (t === "bob") go.addBehavior(new Bobber(sd.amp, sd.freq, sd.base));
        if (t === "mover") go.addBehavior(new Mover(sd.vx, sd.vy, sd.vz));
        if (t === "pulse") go.addBehavior(new Pulse(sd.amp, sd.freq, sd.base));
        si = si + 1;
      }
    }
    scene.add(go);
    ci = ci + 1;
  }
}

// ── RENDER GPU (mesmo caminho do editor) ─────────────────────────────────────
function present(): void {
  const goOn = app.beginFrame();
  if (!goOn) return;
  // segue o resize
  const nw = winWidth(WIN); const nh = winHeight(WIN);
  if (nw > 300) W = nw;
  if (nh > 200) H = nh;

  scene.computeWorld();
  setCam(WIN, camX, camY, camZ, camYaw, camPitch, FOV, W / H);
  setLgt(WIN, 7.0, 13.0, 5.0, 0.28);
  setShadow(WIN, 0 - 7.0, 0 - 12.0, 0 - 5.0, 0.0, 1.0, 0.0, 24.0);
  let oi = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    if (o.active !== 0 && o.meshKind !== 0) {
      let rmax: f64 = o.transform.sx;
      if (o.transform.sy > rmax) rmax = o.transform.sy;
      if (o.transform.sz > rmax) rmax = o.transform.sz;
      if (inFrustum(camX, camY, camZ, camYaw, camPitch, FOV, W / H,
            o.transform.wx, o.transform.wy, o.transform.wz, rmax * 0.87) !== 0) {
        let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
        if (oi === selected) { rr = 255; gg = 230; bbv = 120; }
        const col = (rr << 16) | (gg << 8) | bbv;
        drawGPU(WIN, o.meshKind, o.transform.wx, o.transform.wy, o.transform.wz,
          o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, o.emissive, o.tex);
      }
    }
    oi = oi + 1;
  }
  app.text(10, 8, "WebSocket :7777  |  objs " + scene.objects.length + "  frame " + frame + "  " + W + "x" + H, 0xFFFFFFE6, 14);
  app.endFrame();
}

// ── executa 1 comando (linha) e devolve a resposta ───────────────────────────
function exec(line: string): string {
  const parts = line.split(" ");
  const cmd = parts[0];
  const np = parts.length;
  if (cmd === "spawn") {
    const idx = scene.objects.length;
    const go = new GameObject(parts[1]);
    go.setMesh(1, spawnColor(idx, 0), spawnColor(idx, 1), spawnColor(idx, 2));
    go.transform.setPosition(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]));
    if (np > 5) go.transform.setScale(parseFloat(parts[5]));
    scene.add(go);
    return "[ok] spawn #" + idx + " " + parts[1];
  }
  if (cmd === "move") {
    const o = scene.objects[parseFloat(parts[1]) | 0];
    o.transform.px = parseFloat(parts[2]); o.transform.py = parseFloat(parts[3]); o.transform.pz = parseFloat(parts[4]);
    return "[ok] move";
  }
  if (cmd === "mesh") { scene.objects[parseFloat(parts[1]) | 0].meshKind = parseFloat(parts[2]) | 0; return "[ok] mesh"; }
  if (cmd === "color") {
    const o = scene.objects[parseFloat(parts[1]) | 0];
    o.cr = parseFloat(parts[2]) | 0; o.cg = parseFloat(parts[3]) | 0; o.cb = parseFloat(parts[4]) | 0;
    return "[ok] color";
  }
  if (cmd === "spin") {
    let sx: f64 = 0.0; if (np > 3) sx = parseFloat(parts[3]);
    scene.objects[parseFloat(parts[1]) | 0].addBehavior(new Spinner(parseFloat(parts[2]), sx));
    return "[ok] spin";
  }
  if (cmd === "bob") {
    const o = scene.objects[parseFloat(parts[1]) | 0];
    o.addBehavior(new Bobber(parseFloat(parts[2]), parseFloat(parts[3]), o.transform.py));
    return "[ok] bob";
  }
  if (cmd === "select") { selected = parseFloat(parts[1]) | 0; return "[ok] select #" + selected; }
  if (cmd === "cam") {
    camX = parseFloat(parts[1]); camY = parseFloat(parts[2]); camZ = parseFloat(parts[3]);
    camYaw = parseFloat(parts[4]); camPitch = parseFloat(parts[5]);
    return "[ok] cam";
  }
  if (cmd === "play") { playing = 1; return "[ok] play"; }
  if (cmd === "pause") { playing = 0; return "[ok] pause"; }
  if (cmd === "clear") { scene.clear(); selected = 0; return "[ok] clear"; }
  if (cmd === "loadscene") { loadSceneFrom(parts[1]); return "[ok] loadscene " + parts[1] + " -> " + scene.objects.length; }
  if (cmd === "res") { return "[res] " + W + " x " + H; }
  if (cmd === "state") {
    let msg = "[state] frame=" + frame + " playing=" + playing + " objs=" + scene.objects.length + " sel=" + selected;
    let si = 0;
    while (si < scene.objects.length) {
      const o = scene.objects[si];
      msg = msg + " | #" + si + " " + o.name + "(" + o.transform.px + "," + o.transform.py + "," + o.transform.pz + ")";
      si = si + 1;
    }
    return msg;
  }
  return "[erro] desconhecido: " + cmd;
}

// ── setup ────────────────────────────────────────────────────────────────────
initMeshes(WIN);
if (fs.exists("scenes/shadowdemo.json")) loadSceneFrom("scenes/shadowdemo.json");

const server = ws.serve(PORT);
if (server === 0) {
  io.print("[ws] FALHA ao ouvir em " + PORT);
} else {
  io.print("[ws] ouvindo em ws://127.0.0.1:" + PORT + " — janela AO VIVO (nao bloqueia)");
  let client = 0;
  while (app.running()) {
    present();                                  // ← RENDERIZA TODO FRAME (fluido)
    if (client === 0) {
      const c = ws.accept(server);
      if (c !== 0) { client = c; ws.send(client, "[engine] conectado. cmds: spawn/move/mesh/color/spin/bob/select/cam/play/pause/step/clear/loadscene/state/res"); }
    } else {
      const rr = ws.recvReady(client);
      if (rr < 0) { ws.close(client); client = 0; }   // cliente fechou
      else if (rr > 0) {
        const msg = ws.recv(client);
        if (msg.length > 0) {
          // uma msg pode ter varias linhas
          const lines = msg.split("\n");
          let li = 0;
          while (li < lines.length) {
            const l = lines[li].split("\r")[0];
            if (l.length > 0) {
              if (l === "quit") { ws.send(client, "[ok] bye"); ws.close(client); client = 0; li = lines.length; }
              else if (l.split(" ")[0] === "step") {
                let cnt = 1; const sp = l.split(" ");
                if (sp.length > 1) cnt = parseFloat(sp[1]) | 0;
                let k = 0;
                while (k < cnt) { if (playing !== 0) { scene.update(0.016); scene.resolveCollisions(); } frame = frame + 1; k = k + 1; }
                ws.send(client, "[ok] step " + cnt + " -> frame " + frame);
              } else {
                ws.send(client, exec(l));
              }
            }
            li = li + 1;
          }
        }
      }
    }
    // avança a animação suavemente quando em play (janela viva de verdade)
    if (playing !== 0) { scene.update(0.016); scene.resolveCollisions(); frame = frame + 1; }
  }
  ws.close(server);
}

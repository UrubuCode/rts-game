// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — PORTA DE CONTROLE via TCP (socket) + janela ao vivo.
//
// Abre uma janela (viewport) E um socket TCP. Uma IA/cliente conecta na porta,
// manda comandos (mesmos do harness.ts) e recebe respostas/estado/preview ASCII
// de volta pelo socket. A cada comando a janela reapresenta a cena — dá pra VER
// o que o controle remoto está fazendo.
//
//   ./rts.exe run netharness.ts          # servidor (fica ouvindo em :7777)
//   (noutro terminal) um cliente TCP conecta em 127.0.0.1:7777 e envia linhas.
//
// recv/accept são BLOQUEANTES: entre comandos a janela fica estática (sem pump),
// mas mostra o último frame. Controle ao vivo TOTAL (janela responsiva enquanto
// espera) exigiria um thread leitor — próximo passo.
// ═══════════════════════════════════════════════════════════════════════════
import io from "./compat/io.ts";
import math from "./compat/math.ts";
import buffer from "rts:buffer";
import render from "rts:render";
import net from "rts:net";
import fs from "./compat/fs.ts";
import egui from "rts:egui";

import { Scene } from "./engine/core/scene";
import { GameObject } from "./engine/core/gameobject";
import { Spinner } from "./scripts/spinner";
import { Bobber } from "./scripts/bobber";
import { Rigidbody } from "./scripts/rigidbody";
import { Mover } from "./scripts/mover";
import { Pulse } from "./scripts/pulse";
import { clearFB, drawFloor } from "./engine/render/raster";
import { drawMeshSolid, setLight, setAmbient } from "./engine/render/mesh";
import { asciiFrameStr } from "./engine/testkit/dump";

const PORT = "127.0.0.1:7777";
const RW = 240;
const RH = 144;
const NPIX = RW * RH;
const fbuf = buffer.alloc(NPIX * 4);
const zbuf = buffer.alloc(NPIX * 8);
const fptr = buffer.ptr(fbuf);
const FOV: f64 = 1.05;
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);

// buffer de recv do socket
const cmdbuf = buffer.alloc_zeroed(1024);
const cptr = buffer.ptr(cmdbuf);

// tcp_send(stream, data: string) aceita a string direto — só um wrapper de nome.
function sendStr(stream: i64, s: string): void {
  net.tcp_send(stream, s);
}

// câmera + estado
let camX: f64 = 0.0; let camY: f64 = 3.0; let camZ: f64 = -10.0;
let camYaw: f64 = 0.0; let camPitch: f64 = 0.18;
const scene = new Scene("TCP");
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

// ── janela ao vivo ──────────────────────────────────────────────────────────
const app = createAppAt("Engine RTS — controle TCP", 960, 600, 160, 120);
const WIN = app._win;

// ── socket ──────────────────────────────────────────────────────────────────
const listener = net.tcp_listen(PORT);
if (listener === 0) {
  io.print("[net] FALHA ao ouvir em " + PORT);
} else {
  io.print("[net] ouvindo em " + PORT + " — aguardando conexao...");
  const stream = net.tcp_accept(listener);   // BLOQUEIA até um cliente conectar
  io.print("[net] cliente conectado");
  sendStr(stream, "[engine] conectado. comandos: spawn/move/rot/spin/bob/select/cam/play/pause/step/state/frame/lit/quit\n");

  let running = 1;
  while (running !== 0) {
    const n = net.tcp_recv(stream, cptr, 1024);
    if (n <= 0) { running = 0; }
    else {
      const full = buffer.to_string(cmdbuf);
      const chunk = full.substring(0, n);
      const lines = chunk.split("\n");
      let li = 0;
      while (li < lines.length) {
        const raw = lines[li];
        const line = raw.split("\r")[0];   // tolera CRLF
        const parts = line.split(" ");
        const cmd = parts[0];
        const np = parts.length;

        if (cmd === "quit" || cmd === "exit") {
          sendStr(stream, "[ok] bye\n"); running = 0;
        } else if (cmd === "" || cmd === "#") {
          // ignora linha vazia
        } else if (cmd === "spawn") {
          const idx = scene.objects.length;
          const go = new GameObject(parts[1]);
          go.setMesh(1, spawnColor(idx, 0), spawnColor(idx, 1), spawnColor(idx, 2));
          go.transform.setPosition(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]));
          if (np > 5) go.transform.setScale(parseFloat(parts[5]));
          scene.add(go);
          sendStr(stream, "[ok] spawn #" + idx + " " + parts[1] + "\n");
        } else if (cmd === "move") {
          const i = parseFloat(parts[1]) | 0;
          const o = scene.objects[i];
          o.transform.px = parseFloat(parts[2]); o.transform.py = parseFloat(parts[3]); o.transform.pz = parseFloat(parts[4]);
          sendStr(stream, "[ok] move #" + i + "\n");
        } else if (cmd === "rot") {
          const i = parseFloat(parts[1]) | 0;
          const o = scene.objects[i];
          o.transform.rx = parseFloat(parts[2]); o.transform.ry = parseFloat(parts[3]);
          sendStr(stream, "[ok] rot #" + i + "\n");
        } else if (cmd === "spin") {
          const i = parseFloat(parts[1]) | 0;
          let sx: f64 = 0.0;
          if (np > 3) sx = parseFloat(parts[3]);
          scene.objects[i].addBehavior(new Spinner(parseFloat(parts[2]), sx));
          sendStr(stream, "[ok] spin #" + i + "\n");
        } else if (cmd === "bob") {
          const i = parseFloat(parts[1]) | 0;
          const o = scene.objects[i];
          o.addBehavior(new Bobber(parseFloat(parts[2]), parseFloat(parts[3]), o.transform.py));
          sendStr(stream, "[ok] bob #" + i + "\n");
        } else if (cmd === "rigid") {
          const i = parseFloat(parts[1]) | 0;
          let g: f64 = -9.8; let bounce: f64 = 0.5;
          if (np > 2) g = parseFloat(parts[2]);
          if (np > 3) bounce = parseFloat(parts[3]);
          scene.objects[i].addBehavior(new Rigidbody(g, bounce));
          sendStr(stream, "[ok] rigid #" + i + "\n");
        } else if (cmd === "parent") {
          const ci = parseFloat(parts[1]) | 0;
          scene.objects[ci].parent = parseFloat(parts[2]) | 0;
          sendStr(stream, "[ok] parent\n");
        } else if (cmd === "select") {
          selected = parseFloat(parts[1]) | 0;
          sendStr(stream, "[ok] select #" + selected + "\n");
        } else if (cmd === "cam") {
          camX = parseFloat(parts[1]); camY = parseFloat(parts[2]); camZ = parseFloat(parts[3]);
          camYaw = parseFloat(parts[4]); camPitch = parseFloat(parts[5]);
          sendStr(stream, "[ok] cam\n");
        } else if (cmd === "play") { playing = 1; sendStr(stream, "[ok] play\n"); }
        else if (cmd === "pause") { playing = 0; sendStr(stream, "[ok] pause\n"); }
        else if (cmd === "step") {
          let cnt = 1;
          if (np > 1) cnt = parseFloat(parts[1]) | 0;
          let k = 0;
          while (k < cnt) {
            if (playing !== 0) { scene.update(0.016); scene.resolveCollisions(); }
            frame = frame + 1;
            k = k + 1;
          }
          sendStr(stream, "[ok] step " + cnt + " -> frame " + frame + "\n");
        } else if (cmd === "state") {
          let msg = "[state] frame=" + frame + " playing=" + playing + " objetos=" + scene.objects.length + " selecionado=" + selected + "\n";
          let si = 0;
          while (si < scene.objects.length) {
            const o = scene.objects[si];
            msg = msg + "  [" + si + "] " + o.name + " pos(" + o.transform.px + "," + o.transform.py + "," + o.transform.pz + ") ry=" + o.transform.ry + " sc=" + o.transform.sx + "\n";
            si = si + 1;
          }
          sendStr(stream, msg);
        } else if (cmd === "res") {
          // resolução LÓGICA atual da janela (segue o resize) — via egui.winWidth/Height
          sendStr(stream, "[res] " + egui.winWidth(WIN) + " x " + egui.winHeight(WIN) + " (logico)\n");
        } else if (cmd === "frame" || cmd === "lit") {
          scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0x18);
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
          if (cmd === "frame") {
            let cols = 60; let rows = 22;
            if (np > 1) cols = parseFloat(parts[1]) | 0;
            if (np > 2) rows = parseFloat(parts[2]) | 0;
            sendStr(stream, asciiFrameStr(fbuf, RW, RH, cols, rows));
          } else {
            let lit = 0; let pi = 0;
            while (pi < NPIX) {
              const px = buffer.read_i32(fbuf, pi * 4);
              const lr = px & 255; const lg = (px >> 8) & 255; const lb = (px >> 16) & 255;
              const lum: f64 = lr * 0.30 + lg * 0.59 + lb * 0.11;
              if (lum > 20) lit = lit + 1;
              pi = pi + 1;
            }
            sendStr(stream, "[lit] " + lit + "/" + NPIX + "\n");
          }
        } else if (cmd === "mesh") {
          const i = parseFloat(parts[1]) | 0;
          scene.objects[i].meshKind = parseFloat(parts[2]) | 0;
          sendStr(stream, "[ok] mesh #" + i + " kind=" + (parseFloat(parts[2]) | 0) + "\n");
        } else if (cmd === "mover") {
          const i = parseFloat(parts[1]) | 0;
          scene.objects[i].addBehavior(new Mover(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4])));
          sendStr(stream, "[ok] mover\n");
        } else if (cmd === "pulse") {
          const i = parseFloat(parts[1]) | 0;
          const o = scene.objects[i];
          o.addBehavior(new Pulse(parseFloat(parts[2]), parseFloat(parts[3]), o.transform.sx));
          sendStr(stream, "[ok] pulse\n");
        } else if (cmd === "light") {
          setLight(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
          sendStr(stream, "[ok] light\n");
        } else if (cmd === "ambient") {
          setAmbient(parseFloat(parts[1]));
          sendStr(stream, "[ok] ambient\n");
        } else if (cmd === "static") {
          const i = parseFloat(parts[1]) | 0;
          let v = 1;
          if (np > 2) v = parseFloat(parts[2]) | 0;
          scene.objects[i].stationary = v;
          sendStr(stream, "[ok] static #" + i + "\n");
        } else if (cmd === "delete") {
          const i = parseFloat(parts[1]) | 0;
          scene.removeAt(i);
          if (selected >= scene.objects.length) selected = scene.objects.length - 1;
          if (selected < 0) selected = 0;
          sendStr(stream, "[ok] delete #" + i + "\n");
        } else if (cmd === "dup") {
          const i = parseFloat(parts[1]) | 0;
          const src = scene.objects[i];
          const go = new GameObject(src.name + ".copy");
          go.setMesh(src.meshKind, src.cr, src.cg, src.cb);
          go.transform.setPosition(src.transform.px + 1.0, src.transform.py, src.transform.pz);
          go.transform.setScale(src.transform.sx);
          go.transform.rx = src.transform.rx; go.transform.ry = src.transform.ry;
          let bi = 0;
          while (bi < src.behaviors.length) {
            const d = src.behaviors[bi].toData();
            if (d !== null) {
              const t = d.type;
              if (t === "spin") go.addBehavior(new Spinner(d.sy, d.sx));
              if (t === "bob") go.addBehavior(new Bobber(d.amp, d.freq, d.base));
              if (t === "rigidbody") go.addBehavior(new Rigidbody(d.g, d.bounce));
              if (t === "mover") go.addBehavior(new Mover(d.vx, d.vy, d.vz));
              if (t === "pulse") go.addBehavior(new Pulse(d.amp, d.freq, d.base));
            }
            bi = bi + 1;
          }
          scene.add(go);
          sendStr(stream, "[ok] dup #" + i + "\n");
        } else if (cmd === "color") {
          const i = parseFloat(parts[1]) | 0;
          const o = scene.objects[i];
          o.cr = parseFloat(parts[2]) | 0; o.cg = parseFloat(parts[3]) | 0; o.cb = parseFloat(parts[4]) | 0;
          sendStr(stream, "[ok] color #" + i + "\n");
        } else if (cmd === "name") {
          const i = parseFloat(parts[1]) | 0;
          scene.objects[i].name = parts[2];
          sendStr(stream, "[ok] name #" + i + "\n");
        } else if (cmd === "savescene") {
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
              name: o.name, parent: o.parent, stationary: o.stationary, mesh: o.meshKind,
              color: [o.cr | 0, o.cg | 0, o.cb | 0],
              pos: [o.transform.px, o.transform.py, o.transform.pz],
              rot: [o.transform.rx, o.transform.ry],
              scale: o.transform.sx, scripts: scripts
            });
            oi = oi + 1;
          }
          fs.write(parts[1], JSON.stringify({ scene: scene.name, objects: objs }));
          sendStr(stream, "[ok] savescene " + parts[1] + " (" + scene.objects.length + ")\n");
        } else if (cmd === "loadscene") {
          const data = JSON.parse(fs.read_text(parts[1]));
          const arr = data.objects;
          scene.clear();
          selected = 0;
          let ci = 0;
          while (ci < arr.length) {
            const od = arr[ci];
            const go = new GameObject(od.name);
            if (od.parent !== undefined) go.parent = od.parent;
            if (od.stationary !== undefined) go.stationary = od.stationary;
            const col = od.color;
            go.setMesh(od.mesh, col[0], col[1], col[2]);
            const p = od.pos; const r = od.rot;
            go.transform.setPosition(p[0], p[1], p[2]);
            go.transform.rx = r[0]; go.transform.ry = r[1];
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
          sendStr(stream, "[ok] loadscene " + parts[1] + " -> " + scene.objects.length + " objetos\n");
        } else {
          sendStr(stream, "[erro] desconhecido: " + cmd + "\n");
        }
        li = li + 1;
      }

      // ── reapresenta a cena na janela (pump 1x + blit) ──────────────────────
      const goOn = app.beginFrame();
      if (goOn) {
        scene.computeWorld(); clearFB(fbuf, zbuf, NPIX, 0x18);
        drawFloor(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR, 40, 0xFF3A2E24);
        let doi = 0;
        while (doi < scene.objects.length) {
          const dobj = scene.objects[doi];
          if (dobj.active !== 0 && dobj.meshKind !== 0) {
            let rr = dobj.cr | 0; let gg = dobj.cg | 0; let bbv = dobj.cb | 0;
            if (doi === selected) { rr = 255; gg = 230; bbv = 120; }
            drawMeshSolid(fbuf, zbuf, RW, RH, camX, camY, camZ, camYaw, camPitch, focalR,
              dobj.transform.wx, dobj.transform.wy, dobj.transform.wz,
              dobj.transform.wrx, dobj.transform.wry, dobj.transform.sx, dobj.meshKind, rr, gg, bbv);
          }
          doi = doi + 1;
        }
        render.image(WIN, 0, 0, 960, 600, fptr, RW, RH);
        app.text(10, 8, "controle TCP :7777  |  objs " + scene.objects.length + "  frame " + frame, 0xFFFFFFE6, 14);
        app.endFrame();
      }
    }
  }

  io.print("[net] sessao encerrada (frame=" + frame + ")");
  net.tcp_close(stream);
  net.tcp_close(listener);
}

buffer.free(fbuf); buffer.free(zbuf); buffer.free(cmdbuf);
app.close();

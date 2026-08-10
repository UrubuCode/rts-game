// A engine RTS com janela E porta de controle WebSocket, no motor novo.
//
//   cargo build --features ui
//   target/debug/examples/run_fixture.exe demo_ws_controlada.ts
//
// e, de fora, qualquer cliente WebSocket em ws://127.0.0.1:7777.
//
// # Por que isto existe
//
// Para que quem não está olhando a tela possa dirigir e INSPECIONAR a cena — que
// é o que o editor faz com `ctrlServe`/`ctrlPoll`, e o que uma LLM precisa para
// validar uma mudança sem depender de screenshot.
//
// A porta é a 7777 e os comandos têm os nomes do editor (`spawn`, `move`,
// `spin`, `color`, `state`) de propósito: quando `editor/control/` for portado, o
// mesmo cliente serve os dois.
//
// # O que foi preciso no MOTOR para isto funcionar
//
// `pumpEvents()`. Um laço de render é um `while` que nunca retorna, e o laço do
// host — o que entrega timers, promessas e mensagens de socket — só roda ENTRE as
// instruções de topo do programa. Sem ceder o controle, o servidor aceitava a
// conexão (a thread de accept é nativa) e nenhuma mensagem chegava.

import { WebSocketServer } from "ws";
import {
  openWindow, pump, isOpen, close, beginFrame, endFrame,
  drawRect, drawText, winWidth, winHeight,
  meshUpload, setCamera, setLight, setShadow, setClearColor, drawMesh,
} from "rts:egui";
import { mouseX } from "rts:input";

import { GameObject } from "./engine/core/gameobject";
import { scene } from "./editor/control/session";
import { Rigidbody } from "./scripts/rigidbody";

// ── geometria ─────────────────────────────────────────────────────────────

function esfera(h: number, v: number): Float32Array {
  const d: number[] = [];
  for (let i = 0; i <= v; i++) {
    const phi = (i / v) * Math.PI;
    for (let j = 0; j <= h; j++) {
      const th = (j / h) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(th);
      d.push(x, y, z, x, y, z, j / h, i / v);
    }
  }
  return new Float32Array(d);
}

function esferaIdx(h: number, v: number): Uint32Array {
  const idx: number[] = [];
  for (let i = 0; i < v; i++) {
    for (let j = 0; j < h; j++) {
      const a = i * (h + 1) + j;
      const b = a + h + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return new Uint32Array(idx);
}

function chao(lado: number): Float32Array {
  const m = lado / 2;
  return new Float32Array([
    -m, 0, -m, 0, 1, 0, 0, 0,
     m, 0, -m, 0, 1, 0, 1, 0,
     m, 0,  m, 0, 1, 0, 1, 1,
    -m, 0,  m, 0, 1, 0, 0, 1,
  ]);
}

// ── cena ──────────────────────────────────────────────────────────────────

const win = openWindow("RTS — engine controlada por WebSocket", 1100, 660, 0);
if (win <= 0) {
  println("openWindow devolveu 0 — o motivo saiu no stderr acima");
} else {

const malha = meshUpload(win, esfera(20, 14), esferaIdx(20, 14));
const malhaChao = meshUpload(win, chao(40), new Uint32Array([0, 1, 2, 0, 2, 3]));

scene.clear();
const objetos: GameObject[] = [];
const cores: number[] = [];
const giros: number[] = [];

function criar(nome: string, x: number, y: number, z: number, cor: number, fisica: boolean): number {
  const g = new GameObject(nome);
  g.setMesh(4, 200, 200, 200);
  g.transform.setPosition(x, y, z);
  g.transform.setScale(0.8);
  // A gravidade é NEGATIVA por convenção do Rigidbody — passá-la positiva faz o
  // objeto subir.
  if (fisica) g.addBehavior(new Rigidbody(0.0 - 9.8, 0.7));
  scene.add(g);
  objetos.push(g);
  cores.push(cor);
  giros.push(0);
  return objetos.length - 1;
}

criar("bola0", -3, 5, 0, 0xFF4FC3F7, true);
criar("bola1", 0, 7, 1, 0xFFFF8A65, true);
criar("bola2", 3, 6, -1, 0xFFAED581, true);

setClearColor(win, 0.07, 0.09, 0.13);
setLight(win, { x: 8, y: 18, z: -6, ambient: 0.28 });
setShadow(win, { dx: -0.4, dy: -1, dz: 0.3, cx: 0, cy: 0, cz: 0, radius: 22 });

// ── porta de controle ─────────────────────────────────────────────────────

let pausado = false;
let ultimoComando = "(nenhum)";
let clientes = 0;

const PALETA: number[] = [
  0xFF4FC3F7, 0xFFFF8A65, 0xFFAED581, 0xFFBA68C8,
  0xFFFFD54F, 0xFF4DB6AC, 0xFFF06292, 0xFF9575CD,
];

function num(texto: string, seFaltar: number): number {
  if (texto === undefined || texto === "") return seFaltar;
  const v = Number(texto);
  return Number.isNaN(v) ? seFaltar : v;
}

function estado(): string {
  const linhas: string[] = [];
  for (let i = 0; i < objetos.length; i++) {
    const t = objetos[i].transform;
    linhas.push(
      '{"id":' + i + ',"nome":"' + objetos[i].name + '"' +
      ',"x":' + t.px.toFixed(3) + ',"y":' + t.py.toFixed(3) + ',"z":' + t.pz.toFixed(3) +
      ',"escala":' + t.sx.toFixed(3) + ',"giro":' + giros[i].toFixed(3) + "}"
    );
  }
  return '{"pausado":' + pausado + ',"objetos":[' + linhas.join(",") + "]}";
}

function executar(linha: string): string {
  const p = linha.trim().split(" ");
  const cmd = p[0];
  ultimoComando = linha.trim();

  if (cmd === "help") {
    return "comandos: help | state | spawn [x y z] | move <id> <x y z> | " +
           "spin <id> <vel> | color <id> <indice> | scl <id> <s> | " +
           "pause | resume | reset";
  }
  if (cmd === "state") return estado();
  if (cmd === "pause") { pausado = true; return '{"ok":true,"pausado":true}'; }
  if (cmd === "resume") { pausado = false; return '{"ok":true,"pausado":false}'; }

  if (cmd === "spawn") {
    const x = num(p[1], (Math.random() - 0.5) * 8);
    const y = num(p[2], 8);
    const z = num(p[3], (Math.random() - 0.5) * 6);
    const id = criar("obj" + objetos.length, x, y, z, PALETA[objetos.length % PALETA.length], true);
    return '{"ok":true,"id":' + id + ',"x":' + x + ',"y":' + y + ',"z":' + z + "}";
  }

  const id = Math.floor(num(p[1], -1));
  if (id < 0 || id >= objetos.length) {
    return '{"erro":"id fora da faixa: ' + p[1] + ' (existem ' + objetos.length + ')"}';
  }
  const t = objetos[id].transform;

  if (cmd === "move") {
    t.setPosition(num(p[2], t.px), num(p[3], t.py), num(p[4], t.pz));
    return '{"ok":true,"id":' + id + ',"y":' + t.py.toFixed(3) + "}";
  }
  if (cmd === "spin") { giros[id] = num(p[2], 1); return '{"ok":true,"id":' + id + ',"giro":' + giros[id] + "}"; }
  if (cmd === "scl") { t.setScale(num(p[2], 1)); return '{"ok":true,"id":' + id + "}"; }
  if (cmd === "color") {
    cores[id] = PALETA[Math.floor(num(p[2], 0)) % PALETA.length];
    return '{"ok":true,"id":' + id + "}";
  }
  if (cmd === "reset") {
    t.setPosition(t.px, 8, t.pz);
    return '{"ok":true,"id":' + id + ',"y":8}';
  }
  return '{"erro":"comando desconhecido: ' + cmd + '"}';
}

const wss = new WebSocketServer({ port: 7777 });
wss.on("listening", () => println("[controle] ws://127.0.0.1:7777 pronto"));
wss.on("connection", (ws: any) => {
  clientes = clientes + 1;
  println("[controle] cliente conectou");
  ws.send('{"engine":"RTS","pronto":true,"dica":"envie help"}');
  ws.on("message", (dados: any) => {
    const linha = dados.toString();
    println("[controle] <- " + linha);
    ws.send(executar(linha));
  });
  ws.on("close", () => { clientes = clientes - 1; println("[controle] cliente saiu"); });
  ws.on("error", (e: any) => println("[controle] erro: " + e.message));
});

// ── laço ──────────────────────────────────────────────────────────────────

let frame = 0;
while (isOpen(win)) {
  pump(win);

  // O ponto seguro para o resto do mundo andar: entre dois frames, nunca no
  // meio de um. Sem isto o servidor aceita a conexão e nenhuma mensagem chega.
  pumpEvents();

  beginFrame(win);
  const w = winWidth(win);
  const h = winHeight(win);

  if (!pausado) {
    scene.update(1 / 60);
    scene.resolveCollisions();
  }
  scene.computeWorld();
  for (let i = 0; i < objetos.length; i++) {
    if (giros[i] !== 0) objetos[i].transform.ry = objetos[i].transform.ry + giros[i] * (1 / 60);
  }

  const ang = (mouseX(win) / (w > 0 ? w : 1)) * Math.PI * 2;
  setCamera(win, {
    x: Math.sin(ang) * 26, y: 11, z: Math.cos(ang) * 26,
    yaw: ang + Math.PI, pitch: -0.36, fov: 1.0,
    aspect: h > 0 ? w / h : 1.6,
  });

  drawMesh(win, { mesh: malhaChao, x: 0, y: 0, z: 0, color: 0xFF243040, tex: 1 });
  for (let i = 0; i < objetos.length; i++) {
    const t = objetos[i].transform;
    drawMesh(win, {
      mesh: malha,
      x: t.px, y: t.py, z: t.pz,
      ry: t.ry,
      sx: t.sx, sy: t.sy, sz: t.sz,
      color: cores[i],
    });
  }

  drawRect(win, { x: 0, y: 0, w: 460, h: 100, fill: 0x000000A0, radius: 10 });
  drawText(win, { x: 18, y: 14, size: 18, color: 0xFFFFFFFF, text: "engine RTS — controle em ws://127.0.0.1:7777" });
  drawText(win, { x: 18, y: 42, size: 14, color: 0xFF90A0B0,
    text: objetos.length + " objetos · " + clientes + " cliente(s) · frame " + frame + (pausado ? " · PAUSADO" : "") });
  drawText(win, { x: 18, y: 66, size: 14, color: 0xFF80D0A0, text: "ultimo: " + ultimoComando });

  endFrame(win);
  frame = frame + 1;
}
close(win);
}

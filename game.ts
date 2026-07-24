// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — RUNTIME DO JOGO (o entrypoint da BUILD).
//
// É o que o botão "Build" compila: `rts.exe compile game.ts MeuJogo.exe`.
// Diferente do main.ts (o EDITOR), aqui NÃO há hierarquia, inspector, Project,
// gizmo nem porta de controle — só carrega a cena, roda os scripts e renderiza.
// O jogador recebe um .exe que abre direto no jogo.
//
// A cena carregada é a `assets/scene.json` (a que o editor salva com "Salvar").
// O build copia os assets junto; ver tools/build.ts.
//
//   rts.exe run game.ts        → testa o runtime sem compilar
//   rts.exe compile game.ts    → gera o .exe distribuível
// ═══════════════════════════════════════════════════════════════════════════
import io from "rts:io";
import math from "rts:math";
import fs from "rts:fs";
import input from "rts:input";

import { scene, S } from "./editor/control/session";
import { loadSceneFrom } from "./editor/sceneio";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, drawGPUMesh,
         inFrustum, winWidth, winHeight } from "./engine/render/gpu3d";

// ── janela do JOGO (sem os painéis do editor: a tela toda é o jogo) ─────────
let W = 1280;
let H = 720;
const app = createAppAt("RTS Game", W, H, 100, 60);
const WIN = app._win;

const FOV: f64 = 1.05;

// Cena a carregar: a que o editor salvou. Fallback pros demos do repo, pro
// runtime rodar mesmo num checkout limpo.
let sceneFile = "assets/scene.json";
if (!fs.exists(sceneFile)) sceneFile = "scenes/shadowdemo.json";
if (!fs.exists(sceneFile)) sceneFile = "scenes/solar.json";

S.win = WIN;
initMeshes(WIN);
if (fs.exists(sceneFile)) {
  loadSceneFrom(sceneFile);
  io.print("[jogo] cena '" + sceneFile + "' com " + scene.count() + " objetos");
} else {
  // Sem cena o jogo abriria numa tela vazia sem explicação. As pastas 'assets/'
  // e 'scenes/' têm que estar AO LADO do .exe — o jogo lê a cena do disco.
  io.print("[ERRO] nenhuma cena encontrada. As pastas 'assets/' e 'scenes/'");
  io.print("       precisam ficar ao lado do executavel.");
}

// câmera de jogo: começa na posição salva na sessão (mesma default do editor)
let frames = 0;

function frame(): void {
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  let dt: f64 = app.delta();
  if (dt > 100) dt = 100;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  // ── CÂMERA DA CENA: o jogo renderiza pelo GameObject que tem o component
  // Camera (marcado como Main). Se a cena não tiver nenhum, cai na câmera livre
  // da sessão — assim uma cena antiga ainda abre.
  const camIdx = scene.mainCameraIdx();
  const hasCam = camIdx >= 0 ? 1 : 0;

  // ── CONTROLE: os mesmos controles de voo do editor (WASD + setas + botão dir) ─
  const kW = app.keyDown(122); const kS = app.keyDown(118);
  const kA = app.keyDown(100); const kD = app.keyDown(103);
  const kUp = app.keyDown(5); const kDn = app.keyDown(6);
  const kLf = app.keyDown(7); const kRt = app.keyDown(8);
  const kSp = app.keyDown(3);

  // O controle escreve NO TRANSFORM do objeto-câmera (quando há um): assim a
  // câmera é um GameObject de verdade — scripts e parent também podem movê-la.
  let cx: f64 = S.camX; let cy: f64 = S.camY; let cz: f64 = S.camZ;
  let yaw: f64 = S.camYaw; let pitch: f64 = S.camPitch;
  if (hasCam !== 0) {
    const ct = scene.objects[camIdx].transform;
    cx = ct.px; cy = ct.py; cz = ct.pz;
    yaw = ct.ry; pitch = ct.rx;
  }

  const lookSpeed: f64 = 1.6 * dts;
  if (kLf !== 0) yaw = yaw - lookSpeed;
  if (kRt !== 0) yaw = yaw + lookSpeed;
  if (kUp !== 0) pitch = pitch - lookSpeed;
  if (kDn !== 0) pitch = pitch + lookSpeed;
  if (input.mouseDown(WIN, 1) !== 0) {
    yaw = yaw + input.mouseDeltaX(WIN) * 0.005;
    pitch = pitch - input.mouseDeltaY(WIN) * 0.005;
  }
  if (pitch > 1.4) pitch = 1.4;
  if (pitch < 0.0 - 1.4) pitch = 0.0 - 1.4;

  const cyw = math.cos(yaw); const syw = math.sin(yaw);
  const cpM = math.cos(pitch); const spM = math.sin(pitch);
  const moveSpeed: f64 = 6.0 * dts;
  const fx = syw * cpM; const fy = spM; const fz = cyw * cpM;
  const rxv = cyw; const rzv = 0.0 - syw;
  if (kW !== 0) { cx = cx + fx * moveSpeed; cy = cy + fy * moveSpeed; cz = cz + fz * moveSpeed; }
  if (kS !== 0) { cx = cx - fx * moveSpeed; cy = cy - fy * moveSpeed; cz = cz - fz * moveSpeed; }
  if (kD !== 0) { cx = cx + rxv * moveSpeed; cz = cz + rzv * moveSpeed; }
  if (kA !== 0) { cx = cx - rxv * moveSpeed; cz = cz - rzv * moveSpeed; }
  if (kSp !== 0) cy = cy + moveSpeed;

  // devolve a pose ao transform do objeto-câmera (ou à sessão, sem câmera)
  if (hasCam !== 0) {
    const ct2 = scene.objects[camIdx].transform;
    ct2.px = cx; ct2.py = cy; ct2.pz = cz;
    ct2.ry = yaw; ct2.rx = pitch;
  } else {
    S.camX = cx; S.camY = cy; S.camZ = cz; S.camYaw = yaw; S.camPitch = pitch;
  }

  // ── GAMEPLAY: no jogo os scripts rodam SEMPRE (não há botão Play/Pause) ────
  scene.update(dts);
  scene.resolveCollisions();
  scene.computeWorld();

  // ── RENDER pela câmera da cena ────────────────────────────────────────────
  // Depois do computeWorld: se a câmera for FILHA de outro objeto, a pose de
  // mundo já está resolvida (uma câmera presa a um veículo segue o veículo).
  let vx = cx; let vy = cy; let vz = cz;
  let vyaw = yaw; let vfov = FOV;
  if (hasCam !== 0) {
    const co = scene.objects[camIdx];
    const ct3 = co.transform;
    vx = ct3.wx; vy = ct3.wy; vz = ct3.wz;
    vyaw = ct3.wry;
    const ci = co.componentIdx(5);   // KIND_CAMERA
    if (ci >= 0) vfov = co.behaviors[ci].camFov();
  }
  setCam(WIN, vx, vy, vz, vyaw, pitch, vfov, W / H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);
  setShadow(WIN, 0.0 - 7.0, 0.0 - 12.0, 0.0 - 5.0, 0.0, 1.0, 0.0, 24.0);

  let oi = 0;
  let drawnN = 0;
  while (oi < scene.objects.length) {
    const o = scene.objects[oi];
    let meshKind = o.meshKind;
    let customMesh = o.customMesh;
    if (o.rendIdx >= 0) {
      const r = o.behaviors[o.rendIdx];
      meshKind = r.rMeshKind() | 0;
      customMesh = r.rCustomMesh() | 0;
    }
    if (o.active !== 0 && (meshKind !== 0 || customMesh > 0)) {
      let rmax: f64 = o.transform.sx;
      if (o.transform.sy > rmax) rmax = o.transform.sy;
      if (o.transform.sz > rmax) rmax = o.transform.sz;
      const vis = inFrustum(vx, vy, vz, vyaw, pitch, vfov, W / H,
        o.transform.wx, o.transform.wy, o.transform.wz, rmax * 0.87);
      if (vis !== 0) {
        const col = ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
        let texArg = o.tex;
        if (o.textureId > 0) texArg = o.textureId;
        let emisArg = o.emissive;
        if (o.matIdx >= 0) {
          const m = o.behaviors[o.matIdx];
          const tid = m.matTexId() | 0;
          if (tid > 0) texArg = tid; else texArg = m.matTexMode();
          emisArg = m.matEmissive();
        }
        if (customMesh > 0) {
          drawGPUMesh(WIN, customMesh, o.transform.wx, o.transform.wy, o.transform.wz,
            o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, emisArg, texArg);
        } else {
          drawGPU(WIN, meshKind, o.transform.wx, o.transform.wy, o.transform.wz,
            o.transform.wrx, o.transform.wry, o.transform.sx, o.transform.sy, o.transform.sz, col, emisArg, texArg);
        }
        drawnN = drawnN + 1;
      }
    }
    oi = oi + 1;
  }
  S.drawnLast = drawnN;
  app.endFrame();
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
}
io.print("[jogo] encerrado apos " + frames + " frames");
app.close();

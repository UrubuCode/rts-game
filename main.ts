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
import process from "rts:process";

import { GameObject } from "./engine/core/gameobject";
import { Transform } from "./engine/core/transform";
import { UIScene } from "./engine/ui/uiscene";
import { UIPanel, ANCHOR_TL, ANCHOR_BL, ANCHOR_BR } from "./engine/ui/uipanel";
import { numField, assetField, AXIS_X, AXIS_Y, AXIS_Z, subStr, nfEditing } from "./editor/widgets";
import { COMPONENT_NAMES, createComponent } from "./editor/components";
import { assetsInit, drawAssets, assetDragActive, assetDragPayload, assetDragName, assetDragClear, drawAssetDragGhost } from "./editor/assets";
import { initMeshes, setCam, setLgt, setShadow, drawGPU, drawGPUMesh, inFrustum, frustumBegin, inFrustumFast, winWidth, winHeight, loadTexture, loadObj } from "./engine/render/gpu3d";
import { scene, S } from "./editor/control/session";
import { pickAxis, axisMove, projPt, screenToPlane, screenToForward, snapv, TOOL_MOVE, TOOL_ROTATE, TOOL_SCALE } from "./editor/gizmo";
import { loadSceneFrom, instantiatePrefab, saveScene, cloneObject } from "./editor/sceneio";
import { instantiateAt, groundAt, pickAt, applyTexToObject, applyMeshToObject } from "./editor/dnd";
import { history } from "./editor/undo";
import { ctrlServe, ctrlPoll } from "./editor/control/server";
import { initAudio, pumpAudio } from "./engine/audio/audio";
import { logInfo, logTick } from "./engine/core/logger";

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

// carga inicial: prefere a cena SALVA pelo usuário (assets/scene.json, gravada pelo
// botão Salvar / savescene) pra persistir entre sessões; senão os demos.
let sceneFile = "scenes/solar.json";
if (fs.exists("scenes/shadowdemo.json")) sceneFile = "scenes/shadowdemo.json";
if (fs.exists("assets/scene.json")) sceneFile = "assets/scene.json";   // cena do usuário tem prioridade
// Se NENHUMA cena existe (bundle sem a pasta scenes/), avisa alto: antes o
// editor abria vazio sem dizer por quê — "cena 'Main' com 0 objetos".
if (!fs.exists(sceneFile)) {
  io.print("[AVISO] nenhuma cena encontrada (" + sceneFile + ") — a pasta 'scenes/'");
  io.print("        precisa ficar AO LADO do executavel. Abrindo cena vazia.");
} else {
  loadSceneFrom(sceneFile);
}

// ── estado do editor ────────────────────────────────────────────────────────
let frames = 0;
let spawnN = 0;
let dragging = 0;
let gizmoAxis = 0 - 1;   // eixo do gizmo que está sendo arrastado (-1 = nenhum)
let prevF = 0;           // estado anterior da tecla F (edge-detection do focus)
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
/// Cria um objeto pelo menu de contexto e o seleciona. `kind` é a malha
/// (0=vazio, 1=cubo, 2=pirâmide, 3=octaedro, 4=esfera) e `parentIdx` o pai
/// (-1 = raiz). Nasce à frente da câmera, não na origem: criar na origem faz o
/// objeto aparecer fora da tela quando a câmera já foi movida — o usuário clica
/// em "criar" e não vê nada acontecer.
function ctxCreate(name: string, kind: number, r: number, g: number, b: number,
                   parentIdx: number): GameObject {
  history.snapshot();
  const o = new GameObject(name + "." + spawnN);
  spawnN = spawnN + 1;
  if (kind > 0) o.setMesh(kind, r, g, b);
  const cy = math.cos(S.camYaw); const sy = math.sin(S.camYaw);
  const cp = math.cos(S.camPitch); const sp = math.sin(S.camPitch);
  o.transform.setPosition(S.camX + sy * cp * 8.0, S.camY + sp * 8.0, S.camZ + cy * cp * 8.0);
  scene.add(o);
  if (parentIdx >= 0 && parentIdx < scene.objects.length - 1) {
    o.parent = parentIdx;
    o.refreshCollide();
  }
  S.selected = scene.objects.length - 1;
  logInfo("criado " + o.name + " (#" + S.selected + ")" +
          (parentIdx >= 0 ? " filho de #" + parentIdx : " na raiz"));
  return o;
}

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

// Marca em cada objeto se ele está na multi-seleção (GameObject.selFlag). O
// render lê essa flag em O(1); sem ela, cada objeto visível varria S.selection
// inteira todo frame. Como a seleção é alterada em vários pontos (clique, ws,
// group/ungroup), sincronizar uma vez por frame é mais robusto que espalhar
// atualizações por todos eles.
let selFlagsDirtyN = 0;   // quantos objetos foram marcados no frame anterior
// 1 = algum transform mudou DEPOIS do computeWorld do início do frame (gizmo,
// arrasto, preview de drop) e o render precisa recomputá-lo. Sem isto o segundo
// computeWorld rodava todo frame à toa — um laço sobre a cena inteira.
let worldDirty = 0;

function syncSelFlags(): void {
  // limpa só o que foi marcado antes (evita varrer a cena quando nada mudou)
  if (selFlagsDirtyN > 0) {
    let i = 0;
    while (i < scene.objects.length) { scene.objects[i].selFlag = 0; i = i + 1; }
    selFlagsDirtyN = 0;
  }
  let k = 0;
  while (k < S.selection.length) {
    const idx = S.selection[k];
    if (idx >= 0 && idx < scene.objects.length) {
      scene.objects[idx].selFlag = 1;
      selFlagsDirtyN = selFlagsDirtyN + 1;
    }
    k = k + 1;
  }
}

// ── BUILD DO JOGO ───────────────────────────────────────────────────────────
// Dispara tools/build.bat, que compila game.ts (o RUNTIME — não este editor)
// num .exe e copia os assets pra build/. Roda em BACKGROUND (`start`) porque a
// compilação leva ~1 min e process.wait() bloquearia o editor inteiro.
let buildMsgFrames = 0;   // frames restantes do aviso na barra de status

function startBuild(): void {
  // SEM aspas no `start`: process.spawn não passa por shell, então as aspas
  // chegam literais e o cmd trata "Build do jogo" como o ARQUIVO a abrir
  // ("O sistema não pode encontrar o arquivo Build do jogo").
  process.spawn("cmd", "/c start cmd /c tools\\build.bat");
}

// formata um f64 com 1 casa decimal (só pro HUD do drop — nada de toFixed).
function fmt1(v: f64): string {
  const t = math.floor(v * 10.0 + (v >= 0.0 ? 0.5 : 0.0 - 0.5));
  const i = (t / 10.0) | 0;
  let f = t - i * 10;
  if (f < 0) f = 0 - f;
  return i + "." + f;
}

// índice da linha da HIERARQUIA sob a coordenada Y da tela (-1 = fora da lista).
function hierRowAt(sy: f64): number {
  const rel = sy - (BAR_H + 52);
  if (rel < 0.0) return 0 - 1;
  const idx = (rel / 26.0) | 0;
  if (idx >= scene.objects.length) return 0 - 1;
  return idx;
}

// DROP de um asset do Project na CENA. `sx/sy` é o cursor: quando sx>=0 o objeto
// nasce no ponto do CHÃO (plano Y=0) sob o cursor — como arrastar pra viewport na
// Unity; se o raio não bater no chão (mirando o céu), cai 12 unidades à frente.
// sx<0 = sem posição de tela (drop na hierarquia): usa a posição padrão do asset.
// Devolve o índice do objeto criado (-1 se o asset não gera objeto — cena/pasta).
// É reusado pelo PREVIEW do drag: instancia de verdade e depois só reposiciona.
// Delega pra editor/dnd.ts (mesma lógica usada pelos comandos WS `drop*`).
function dropAssetInWorld(kind: string, path: string, sx: f64, sy: f64,
                          cyw: f64, syw: f64, cpt2: f64, spt2: f64): number {
  let wx: f64 = 0.0; let wy: f64 = 0.0; let wz: f64 = 0.0;
  let placed = 0;
  if (sx >= 0.0) {
    const g = groundAt(sx, sy, focalW, W, H, cyw, syw, cpt2, spt2);
    wx = g[0]; wy = g[1]; wz = g[2]; placed = 1;
  }
  return instantiateAt(kind, path, wx, wy, wz, placed, WIN);
}

// Reposiciona o objeto-preview no ponto do chão sob o cursor (segue o mouse).
function movePreviewTo(sx: f64, sy: f64, cyw: f64, syw: f64, cpt2: f64, spt2: f64): void {
  if (previewIdx < 0 || previewIdx >= scene.objects.length) return;
  const g = groundAt(sx, sy, focalW, W, H, cyw, syw, cpt2, spt2);
  const t = scene.objects[previewIdx].transform;
  // mesma regra do instantiateAt: assenta SOBRE o chão (meia altura acima de Y=0)
  t.setPosition(g[0], g[1] + t.sy * 0.5, g[2]);
}

// Descarta o objeto-preview (arrasto saiu do viewport ou foi cancelado).
function killPreview(): void {
  if (previewIdx >= 0 && previewIdx < scene.objects.length) {
    scene.removeAt(previewIdx);
    // a seleção apontava pro preview (dropAssetInWorld seleciona o que cria):
    // volta pra algo válido, senão o inspector lê índice fora da lista.
    if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
    if (S.selected < 0 && scene.objects.length > 0) S.selected = 0;
  }
  previewIdx = 0 - 1;
  previewPay = "";
}

// Objeto sob o cursor — wrapper de pickAt (editor/dnd.ts), compartilhado com o
// comando WS `pickat`. Usado pelo drop de textura pra decidir entre "aplicar no
// objeto existente" e "criar um novo".
function pickObjectAt(sx: f64, sy: f64, cyw: f64, syw: f64, cpt2: f64, spt2: f64): number {
  return pickAt(sx, sy, focalW, W, H, cyw, syw, cpt2, spt2);
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
// ── MENU DE CONTEXTO da hierarquia (botão direito, como na Unity) ──────────
// Antes só dava para criar Cubo e Esfera, pelos dois botões fixos da barra:
// pirâmide, octaedro, luz e câmera só existiam via WebSocket. `ctxOn` = aberto,
// `ctxX/ctxY` = canto onde abriu, `ctxTarget` = linha clicada (-1 = área vazia,
// o que cria na raiz em vez de como filho).
/// Primeira linha visível da hierarquia. Sem isto a lista simplesmente cortava
/// em "+N objetos (fora da lista)" e não havia como CHEGAR neles: numa cena de
/// 500 objetos, 480 eram inalcançáveis pelo editor.
/// Espelhado em `S.hierScroll` para o controle por WebSocket poder lê-lo.
let hierScroll = 0;
/// 1 = arrastando o polegar da barra de scroll da hierarquia.
let hierBarDrag = 0;

let ctxOn = 0;
let ctxX = 0;
let ctxY = 0;
let ctxTarget = 0 - 1;

let hierLastClick = 0 - 1;      // duplo-clique na hierarquia (enquadra a câmera)
let hierLastClickFrame = 0 - 999;
let lastMx: f64 = 0.0;
let lastMy: f64 = 0.0;
// hover dos SLOTS de asset do inspector — escritos no desenho do inspector e
// lidos no handler de drop (que roda depois, no fim do frame).
let slotTexHot = 0;
let slotMeshHot = 0;
// PREVIEW VIVO do drag: o asset arrastado já é instanciado na cena e segue o
// cursor pelo chão (como na Unity). previewIdx = índice do objeto-preview na
// cena (-1 = nenhum); previewPay = payload que o gerou, pra não recriar por frame.
let previewIdx = 0 - 1;
let previewPay = "";

initMeshes(WIN);
assetsInit();
ctrlServe(7777);   // porta de controle da LLM (ws://127.0.0.1:7777)
S.win = WIN;
// áudio: se a máquina não tiver saída, `initAudio` devolve 0 e o editor segue mudo
initAudio();

// ── L3 (fundação "tudo é GameObject"): a UI-scene. Um HUD que é um GameObject
// com um component UIPanel, desenhado no mesmo frame que o resto. Prova o seam;
// os painéis do editor migram pra cá incrementalmente. ──
const uiScene = new UIScene();
// HUD com os stats da cena. Ancorado ao canto INFERIOR-esquerdo: no topo (TL,
// y=12) ele sobrepunha a toolbar e o cabeçalho da Hierarchy.
const hud = new GameObject("HUD");
hud.transform.px = 12.0;   // offset x do canto ancorado
hud.transform.py = 30.0;   // acima da barra de status (24px)
hud.addBehavior(new UIPanel(190.0, 24.0, 0x1E1E28E0, "HUD", ANCHOR_BL));
uiScene.add(hud);
// Painel de câmera ancorado ao canto BR — prova a ancoragem (segue o resize).
const camHud = new GameObject("CamHUD");
camHud.transform.px = 12.0;
camHud.transform.py = 12.0;
camHud.addBehavior(new UIPanel(210.0, 24.0, 0x1E1E28E0, "cam", ANCHOR_BR));
uiScene.add(camHud);

io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos");

// Corpo de 1 frame numa FUNÇÃO — no motor, métodos de singleton importado
// (scene/S) despacham corretamente em função, não no top-level do while.
function frame(): void {
  // ── layout RESPONSIVO: lê o tamanho lógico atual da janela (segue o resize) ──
  logTick();   // avança o contador de frames do log
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

  // ── ATALHOS DE TECLA (só quando NÃO digitando texto: numField/busca de comp) ──
  // Q=Move, E=Rotate, R=Scale (W conflita com a câmera fly, fica na toolbar/Q);
  // F=focus no selecionado (edge-detection). Não-destrutivos. Codes: A=100 → Q=116
  // E=104 R=117 F=105 (mapa do motor em rts-egui/render_backend.rs).
  if (addMenuOpen === 0 && nfEditing() === 0) {
    if (app.keyDown(116) !== 0) S.tool = 1;   // Q → Move
    if (app.keyDown(104) !== 0) S.tool = 2;   // E → Rotate
    if (app.keyDown(117) !== 0) S.tool = 3;   // R → Scale
    const kFo = app.keyDown(105);             // F → focus (frame selected)
    if (kFo !== 0 && prevF === 0 && S.selected >= 0 && S.selected < scene.objects.length) frameObject(S.selected);
    prevF = kFo;
  } else {
    prevF = 0;
  }

  // ── UPDATE da cena (só quando S.playing) ────────────────────────────────────
  if (S.playing !== 0) { scene.update(dts); scene.resolveCollisions(); }
  scene.computeWorld();

  // ── PICKING + DRAG: pressionar seleciona; segurando, ARRASTA o objeto ───────
  const mPressed = input.mousePressed(WIN, 0);
  // botão DIREITO: abre/fecha o menu de contexto da hierarquia
  const mRight = input.mousePressed(WIN, 1);
  const mDownNow = input.mouseDown(WIN, 0);
  const mx: f64 = input.mouseX(WIN);
  const my: f64 = input.mouseY(WIN);
  const inViewport = mx > HIER_W && mx < W - INSP_W && my > BAR_H && my < H - 24 - ASSET_H;
  // Arrastando um asset do Project? Então o botão esquerdo pertence AO DRAG:
  // nada de selecionar/mover objeto ou pegar eixo de gizmo neste frame.
  const dndOn = assetDragActive();
  const dndPay = assetDragPayload();
  const dndTex = dndOn !== 0 && dndPay.charCodeAt(0) === 116 ? 1 : 0;      // "tex:"
  const dndModel = dndOn !== 0 && dndPay.charCodeAt(0) === 109 ? 1 : 0;    // "model:"
  const cpt2 = math.cos(S.camPitch); const spt2 = math.sin(S.camPitch);

  // ── PREVIEW VIVO DO DRAG (estilo Unity): assim que o asset arrastado entra no
  // viewport ele é INSTANCIADO de verdade e passa a seguir o cursor pelo chão —
  // o usuário vê o objeto 3D renderizado, não um retângulo com o nome do arquivo.
  // Sair do viewport descarta o preview; soltar dentro apenas o "confirma".
  if (dndOn !== 0 && inViewport && dndTex === 0) {
    if (previewIdx < 0 || previewPay !== dndPay) {
      killPreview();
      const cut0 = dndPay.indexOf(":");
      const k0 = subStr(dndPay, 0, cut0);
      const p0 = subStr(dndPay, cut0 + 1, dndPay.length);
      // só assets que viram objeto ganham preview (cena/pasta/script não)
      if (k0 === "prefab" || k0 === "model") {
        const ni = dropAssetInWorld(k0, p0, mx, my, cyw, syw, cpt2, spt2);
        if (ni >= 0) { previewIdx = ni; previewPay = dndPay; }
      }
    } else {
      movePreviewTo(mx, my, cyw, syw, cpt2, spt2);
    }
    worldDirty = 1;   // o preview mudou de lugar: o render refaz o computeWorld
  } else if (previewIdx >= 0 && dndOn !== 0) {
    // ainda arrastando, mas o cursor saiu do viewport → descarta o preview.
    // (com dndOn===0 o preview é CONFIRMADO pelo handler de drop, mais abaixo.)
    killPreview();
  }

  // ── GIZMO: projeta o centro do selecionado + as pontas dos eixos X/Y/Z (tela) ──
  // gzLen = comprimento de mundo dos eixos, escalado pela profundidade → tamanho de
  // tela ~constante. Reaproveitado pro pick (abaixo) e pro desenho (após o render).
  let gzOK = 0;
  let gzOx: f64 = 0.0; let gzOy: f64 = 0.0;
  let gzXx: f64 = 0.0; let gzXy: f64 = 0.0;
  let gzYx: f64 = 0.0; let gzYy: f64 = 0.0;
  let gzZx: f64 = 0.0; let gzZy: f64 = 0.0;
  let gzLen: f64 = 1.0;
  let gzWx: f64 = 0.0; let gzWy: f64 = 0.0; let gzWz: f64 = 0.0;   // centro-mundo (p/ anéis)
  if (S.tool !== 0 && S.selected >= 0 && S.selected < scene.objects.length) {
    const go = scene.objects[S.selected];
    const owx = go.transform.wx; const owy = go.transform.wy; const owz = go.transform.wz;
    gzWx = owx; gzWy = owy; gzWz = owz;
    const cz1 = (owx - S.camX) * syw + (owz - S.camZ) * cyw;
    const cz2 = (owy - S.camY) * spt2 + cz1 * cpt2;
    if (cz2 > 0.5) {
      gzLen = cz2 * 0.16;
      { const dx = owx - S.camX; const dy = owy - S.camY; const dz = owz - S.camZ;
        const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
        const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
        gzOx = W * 0.5 + (x1 / z2) * focalW; gzOy = H * 0.5 - (y2 / z2) * focalW; }
      { const dx = (owx + gzLen) - S.camX; const dy = owy - S.camY; const dz = owz - S.camZ;
        const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
        const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
        gzXx = W * 0.5 + (x1 / z2) * focalW; gzXy = H * 0.5 - (y2 / z2) * focalW; }
      { const dx = owx - S.camX; const dy = (owy + gzLen) - S.camY; const dz = owz - S.camZ;
        const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
        const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
        gzYx = W * 0.5 + (x1 / z2) * focalW; gzYy = H * 0.5 - (y2 / z2) * focalW; }
      { const dx = owx - S.camX; const dy = owy - S.camY; const dz = (owz + gzLen) - S.camZ;
        const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
        const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
        gzZx = W * 0.5 + (x1 / z2) * focalW; gzZy = H * 0.5 - (y2 / z2) * focalW; }
      gzOK = 1;
    }
  }

  if (mPressed !== 0 && inViewport && dndOn === 0) {
    // 1) tenta pegar um EIXO do gizmo (prioridade sobre selecionar outro objeto)
    let ax = 0 - 1;
    if (gzOK !== 0) ax = pickAxis(mx, my, gzOx, gzOy, gzXx, gzXy, gzYx, gzYy, gzZx, gzZy);
    // 1b) HANDLES DE PLANO (só Move): arrastar 2 eixos. Checa se nenhum eixo foi pego.
    if (ax < 0 && gzOK !== 0 && S.tool === TOOL_MOVE) {
      const hxyX = gzOx + (gzXx - gzOx) * 0.4 + (gzYx - gzOx) * 0.4; const hxyY = gzOy + (gzXy - gzOy) * 0.4 + (gzYy - gzOy) * 0.4;
      const hxzX = gzOx + (gzXx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hxzY = gzOy + (gzXy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      const hyzX = gzOx + (gzYx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hyzY = gzOy + (gzYy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      if (mx > hxyX - 8.0 && mx < hxyX + 8.0 && my > hxyY - 8.0 && my < hxyY + 8.0) ax = 3;       // plano XY
      else if (mx > hxzX - 8.0 && mx < hxzX + 8.0 && my > hxzY - 8.0 && my < hxzY + 8.0) ax = 4;  // plano XZ
      else if (mx > hyzX - 8.0 && mx < hyzX + 8.0 && my > hyzY - 8.0 && my < hyzY + 8.0) ax = 5;  // plano YZ
    }
    if (ax >= 0) {
      gizmoAxis = ax;
    } else {
      // 2) senão, seleciona o objeto projetado mais perto do mouse
      let best = 0 - 1; let bestD: f64 = 1e30; let pi = 0;
      while (pi < scene.objects.length) {
        const po = scene.objects[pi];
        if (po.meshKind !== 0) {
          const dx = po.transform.wx - S.camX; const dy = po.transform.wy - S.camY; const dz = po.transform.wz - S.camZ;
          const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
          const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
          if (z2 > 0.2) {
            const psx = W * 0.5 + (x1 / z2) * focalW; const psy = H * 0.5 - (y2 / z2) * focalW;
            const ex = psx - mx; const ey = psy - my; const d2 = ex * ex + ey * ey;
            if (d2 < bestD && d2 < 4000) { bestD = d2; best = pi; }
          }
        }
        pi = pi + 1;
      }
      if (best >= 0) { S.selected = best; S.selection = []; dragging = 1; }   // clique = seleção única
    }
    lastMx = mx; lastMy = my;
  }
  if (mDownNow === 0) { dragging = 0; gizmoAxis = 0 - 1; }

  // ── ARRASTO RESTRITO AO EIXO/PLANO (Move/Rotate/Scale conforme S.tool) ──
  // seleção efetiva: a lista S.selection (multi) ou só [S.selected]. O delta do
  // gizmo é aplicado a TODOS (rotate/scale usam o centro de cada um — "pivot individual").
  const nsel = S.selection.length > 0 ? S.selection.length : 1;
  if (gizmoAxis >= 3 && mDownNow !== 0 && gzOK !== 0 && scene.objects.length > 0) {
    worldDirty = 1;   // o gizmo vai mover algo: refaz o computeWorld antes do render
    // PLANO (só Move): move nos DOIS eixos do plano (3=XY, 4=XZ, 5=YZ).
    const dmx: f64 = mx - lastMx; const dmy: f64 = my - lastMy;
    const mX = axisMove(dmx, dmy, gzOx, gzOy, gzXx, gzXy, gzLen);
    const mY = axisMove(dmx, dmy, gzOx, gzOy, gzYx, gzYy, gzLen);
    const mZ = axisMove(dmx, dmy, gzOx, gzOy, gzZx, gzZy, gzLen);
    let si = 0;
    while (si < nsel) {
      const idx = S.selection.length > 0 ? S.selection[si] : S.selected;
      if (idx >= 0 && idx < scene.objects.length) {
        const so = scene.objects[idx];
        if (gizmoAxis === 3) { so.transform.px = so.transform.px + mX; so.transform.py = so.transform.py + mY; }
        if (gizmoAxis === 4) { so.transform.px = so.transform.px + mX; so.transform.pz = so.transform.pz + mZ; }
        if (gizmoAxis === 5) { so.transform.py = so.transform.py + mY; so.transform.pz = so.transform.pz + mZ; }
        if (S.snap !== 0) { so.transform.px = snapv(so.transform.px, 0.5); so.transform.py = snapv(so.transform.py, 0.5); so.transform.pz = snapv(so.transform.pz, 0.5); }
      }
      si = si + 1;
    }
    lastMx = mx; lastMy = my;
  } else if (gizmoAxis >= 0 && mDownNow !== 0 && gzOK !== 0 && scene.objects.length > 0) {
    worldDirty = 1;
    let ex: f64 = gzXx; let ey: f64 = gzXy;
    if (gizmoAxis === 1) { ex = gzYx; ey = gzYy; }
    if (gizmoAxis === 2) { ex = gzZx; ey = gzZy; }
    const mv = axisMove(mx - lastMx, my - lastMy, gzOx, gzOy, ex, ey, gzLen);
    let si = 0;
    while (si < nsel) {
      const idx = S.selection.length > 0 ? S.selection[si] : S.selected;
      if (idx >= 0 && idx < scene.objects.length) {
        const so = scene.objects[idx];
        if (S.tool === TOOL_MOVE) {
          if (gizmoAxis === 0) so.transform.px = so.transform.px + mv;
          if (gizmoAxis === 1) so.transform.py = so.transform.py + mv;
          if (gizmoAxis === 2) so.transform.pz = so.transform.pz + mv;
        } else if (S.tool === TOOL_SCALE) {
          const sc: f64 = mv * 0.6;
          if (gizmoAxis === 0) so.transform.sx = so.transform.sx + sc;
          if (gizmoAxis === 1) so.transform.sy = so.transform.sy + sc;
          if (gizmoAxis === 2) so.transform.sz = so.transform.sz + sc;
          if (so.transform.sx < 0.05) so.transform.sx = 0.05;
          scene.colDirty = 1;   // a escala define o raio de colisão (cacheado)
          if (so.transform.sy < 0.05) so.transform.sy = 0.05;
          if (so.transform.sz < 0.05) so.transform.sz = 0.05;
        } else if (S.tool === TOOL_ROTATE) {
          const rt: f64 = mv * 0.5;
          if (gizmoAxis === 0) so.transform.rx = so.transform.rx + rt;
          if (gizmoAxis === 1) so.transform.ry = so.transform.ry + rt;
          if (gizmoAxis === 2) so.transform.rz = so.transform.rz + rt;
        }
        // SNAP to grid (move 0.5 / rotate 15°=~0.2618 rad)
        if (S.snap !== 0 && S.tool === TOOL_MOVE) {
          so.transform.px = snapv(so.transform.px, 0.5); so.transform.py = snapv(so.transform.py, 0.5); so.transform.pz = snapv(so.transform.pz, 0.5);
        } else if (S.snap !== 0 && S.tool === TOOL_ROTATE) {
          so.transform.rx = snapv(so.transform.rx, 0.2618); so.transform.ry = snapv(so.transform.ry, 0.2618); so.transform.rz = snapv(so.transform.rz, 0.2618);
        }
      }
      si = si + 1;
    }
    lastMx = mx; lastMy = my;
  } else if (dragging !== 0 && mDownNow !== 0 && inViewport && scene.objects.length > 0) {
    worldDirty = 1;
    // arrasto LIVRE no plano da tela (fallback: nenhum eixo pego)
    const so = scene.objects[S.selected];
    const z1o = (so.transform.wx - S.camX) * syw + (so.transform.wz - S.camZ) * cyw;
    let depth: f64 = (so.transform.wy - S.camY) * spt2 + z1o * cpt2;
    if (depth < 1.0) depth = 1.0;
    const perPx: f64 = depth / focalW;
    const mdx: f64 = (mx - lastMx) * perPx; const mdy: f64 = (my - lastMy) * perPx;
    so.transform.px = so.transform.px + cyw * mdx;
    so.transform.pz = so.transform.pz + (0 - syw) * mdx;
    so.transform.py = so.transform.py - mdy;
    lastMx = mx; lastMy = my;
  }

  // ── RENDER DE CENA (rasteriza no framebuffer, depois blita) ────────────────
  // ── RENDER 3D por GPU (pipeline wgpu no scene pass; a UI do egui compõe por
  //    cima). Só manda câmera/luz + 1 drawMesh por objeto — a GPU faz o resto. ──
  // computeWorld já rodou no início do frame; refazê-lo aqui só é necessário se
  // ALGO MOVEU depois (gizmo, arrasto, preview de drop). Antes era incondicional
  // — o segundo passe custava um laço sobre a cena inteira todo frame à toa.
  if (worldDirty !== 0) { scene.computeWorld(); worldDirty = 0; }
  setCam(WIN, S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);
  setLgt(WIN, S.lightX, S.lightY, S.lightZ, S.lightAmb);   // luz PONTUAL (posição) — controlável via ws `light`
  // Shadow map: a direção vem da POSIÇÃO REAL da luz (luz -> centro da cena).
  // Antes era um vetor fixo (-7,-12,-5) desconectado de S.light*, então mover a
  // luz mudava o sombreamento mas NÃO as sombras — elas caíam pro lado errado.
  setShadow(WIN, 0.0 - S.lightX, 0.0 - S.lightY, 0.0 - S.lightZ, 0.0, 1.0, 0.0, 24.0);
  // Frustum do frame calculado UMA vez (antes: 5 chamadas trig por objeto).
  frustumBegin(S.camX, S.camY, S.camZ, S.camYaw, S.camPitch, FOV, W / H);
  // Sincroniza a flag de seleção UMA vez por frame (custo O(n + |seleção|)),
  // em vez de o render varrer a lista inteira por objeto visível (O(n × |sel|)).
  // Feito aqui, num ponto só, porque a seleção é mexida em vários lugares.
  syncSelFlags();
  let oi = 0;
  let drawnN = 0;
  // HOISTA o array (não só o length): cada `scene.objects[i]` refaz o acesso à
  // propriedade do singleton importado, e num laço sobre centenas de objetos
  // isso domina o custo do frame.
  // Anotação DELIBERADA: com `GameObject[]` o compilador sabe o tipo do
  // elemento, então `const o = objs[oi]` vira um local de shape conhecido e cada
  // `o.campo` usa offset constante em vez do caminho dinâmico de propriedade
  // (medido: 3,9x mais rápido por leitura). Sem a anotação o tipo se perde.
  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;   // espelho paralelo (ver Scene.trs)
  const objsN = objs.length;
  while (oi < objsN) {
    const o = objs[oi];
    // ORDEM IMPORTA: descarte barato primeiro. Inativo sai já; a visibilidade é
    // testada ANTES do dispatch virtual do MeshRenderer/Material, que era pago
    // por objeto mesmo pros que nem seriam desenhados.
    if (o.active === 0) { oi = oi + 1; continue; }
    const tr: Transform = trs[oi];   // espelho: evita o hop `o.transform`
    let rmax: f64 = tr.sx;
    if (tr.sy > rmax) rmax = tr.sy;
    if (tr.sz > rmax) rmax = tr.sz;
    if (inFrustumFast(tr.wx, tr.wy, tr.wz, rmax * 0.87) === 0) { oi = oi + 1; continue; }

    // GEOMETRIA: do component MeshRenderer (rendIdx cacheado, O(1)) quando existe;
    // senão fallback pros campos legado do GameObject (cenas sem MeshRenderer).
    let meshKind = o.meshKind;
    let customMesh = o.customMesh;
    if (o.rendIdx >= 0) {
      const r = o.behaviors[o.rendIdx];
      meshKind = r.rMeshKind() | 0;
      customMesh = r.rCustomMesh() | 0;
    }
    if (meshKind !== 0 || customMesh > 0) {
      {
        // visibilidade e escala já resolvidas antes do dispatch (ver acima)
        let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
        // Selecionado (ou na multi-seleção) = dourado. O teste é O(1) via flag
        // no próprio objeto: antes varria S.selection INTEIRA por objeto
        // visível — O(n × |seleção|), 40k comparações/frame ao selecionar 200.
        if (o.selFlag !== 0 || oi === S.selected) { rr = 255; gg = 230; bbv = 120; }
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
        // Usa o `tr` já hoisted: `o.transform.wx` repetido 9x por objeto era
        // NOVE acessos aninhados de propriedade por desenho.
        if (customMesh > 0) {
          drawGPUMesh(WIN, customMesh, tr.wx, tr.wy, tr.wz,
            tr.wrx, tr.wry, tr.sx, tr.sy, tr.sz, col, emisArg, texArg);
        } else {
          drawGPU(WIN, meshKind, tr.wx, tr.wy, tr.wz,
            tr.wrx, tr.wry, tr.sx, tr.sy, tr.sz, col, emisArg, texArg);
        }
        drawnN = drawnN + 1;
      }
    }
    oi = oi + 1;
  }
  S.drawnLast = drawnN;   // nº de objetos desenhados neste frame (diagnóstico via ws 'dbg')

  // ── GIZMO 2D: eixos X/Y/Z coloridos sobre a viewport (over o 3D, sob a UI). O
  // eixo pego fica destacado (branco). Move/Rotate/Scale usam os mesmos eixos. ──
  if (gzOK !== 0) {
    const cX = gizmoAxis === 0 ? 0xFFFFFFFF : 0xE05A5AFF;   // X vermelho
    const cY = gizmoAxis === 1 ? 0xFFFFFFFF : 0x6ABF4BFF;   // Y verde
    const cZ = gizmoAxis === 2 ? 0xFFFFFFFF : 0x4B8FE0FF;   // Z azul
    // eixos = handles de pick (sempre visíveis)
    app.line(gzOx, gzOy, gzXx, gzXy, 3, cX);
    app.line(gzOx, gzOy, gzYx, gzYy, 3, cY);
    app.line(gzOx, gzOy, gzZx, gzZy, 3, cZ);
    if (S.tool === TOOL_SCALE) {
      // handles-CUBO grandes nas pontas (estilo Scale da Unity)
      app.box(gzXx - 5, gzXy - 5, 10, 10, cX, 0, 0, 1);
      app.box(gzYx - 5, gzYy - 5, 10, 10, cY, 0, 0, 1);
      app.box(gzZx - 5, gzZy - 5, 10, 10, cZ, 0, 0, 1);
    } else if (S.tool === TOOL_ROTATE) {
      // ANÉIS projetados: 1 círculo por eixo, no plano perpendicular a ele.
      // X-ring no plano YZ, Y-ring no XZ, Z-ring no XY. 24 segmentos cada.
      const rr: f64 = gzLen * 0.95;
      let seg = 0;
      while (seg < 24) {
        const a0: f64 = (seg / 24.0) * 6.2831853;
        const a1: f64 = ((seg + 1) / 24.0) * 6.2831853;
        const c0 = math.cos(a0); const s0 = math.sin(a0);
        const c1 = math.cos(a1); const s1 = math.sin(a1);
        // X-ring (plano YZ): (0, cos, sin)
        const xa = projPt(gzWx, gzWy + c0 * rr, gzWz + s0 * rr, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        const xb = projPt(gzWx, gzWy + c1 * rr, gzWz + s1 * rr, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        if (xa[2] > 0.5 && xb[2] > 0.5) app.line(xa[0], xa[1], xb[0], xb[1], 2, cX);
        // Y-ring (plano XZ): (cos, 0, sin)
        const ya = projPt(gzWx + c0 * rr, gzWy, gzWz + s0 * rr, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        const yb = projPt(gzWx + c1 * rr, gzWy, gzWz + s1 * rr, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        if (ya[2] > 0.5 && yb[2] > 0.5) app.line(ya[0], ya[1], yb[0], yb[1], 2, cY);
        // Z-ring (plano XY): (cos, sin, 0)
        const za = projPt(gzWx + c0 * rr, gzWy + s0 * rr, gzWz, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        const zb = projPt(gzWx + c1 * rr, gzWy + s1 * rr, gzWz, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
        if (za[2] > 0.5 && zb[2] > 0.5) app.line(za[0], za[1], zb[0], zb[1], 2, cZ);
        seg = seg + 1;
      }
    } else {
      // MOVE: pontas dos eixos + HANDLES DE PLANO (arrastar 2 eixos)
      app.box(gzXx - 3, gzXy - 3, 7, 7, cX, 0, 0, 1);
      app.box(gzYx - 3, gzYy - 3, 7, 7, cY, 0, 0, 1);
      app.box(gzZx - 3, gzZy - 3, 7, 7, cZ, 0, 0, 1);
      const hxyX = gzOx + (gzXx - gzOx) * 0.4 + (gzYx - gzOx) * 0.4; const hxyY = gzOy + (gzXy - gzOy) * 0.4 + (gzYy - gzOy) * 0.4;
      const hxzX = gzOx + (gzXx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hxzY = gzOy + (gzXy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      const hyzX = gzOx + (gzYx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hyzY = gzOy + (gzYy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      app.box(hxyX - 6, hxyY - 6, 12, 12, gizmoAxis === 3 ? 0xFFFFFFCC : 0xC8C860AA, 0, 0, 1);   // XY
      app.box(hxzX - 6, hxzY - 6, 12, 12, gizmoAxis === 4 ? 0xFFFFFFCC : 0xC860C8AA, 0, 0, 1);   // XZ
      app.box(hyzX - 6, hyzY - 6, 12, 12, gizmoAxis === 5 ? 0xFFFFFFCC : 0x60C8C8AA, 0, 0, 1);   // YZ
    }
    app.box(gzOx - 3, gzOy - 3, 6, 6, 0xCCCCCCFF, 0, 0, 1); // centro
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

  // — ferramentas de manipulação: Move / Rotate / Scale (gizmo na viewport) —
  const stMv = app.clickable(910, 260, 9, 46, 28);
  let fMv = 0x2D2D2DFF; if (S.tool === TOOL_MOVE) fMv = 0x4A75B0FF; else if (stMv === 1) fMv = 0x454545FF;
  app.box(260, 9, 46, 28, fMv, 1, 0x232323FF, 3);
  app.text(268, 15, "Move", 0xC8C8C8FF, 12);
  if (stMv === 3) S.tool = TOOL_MOVE;
  const stRo = app.clickable(911, 308, 9, 42, 28);
  let fRo = 0x2D2D2DFF; if (S.tool === TOOL_ROTATE) fRo = 0x4A75B0FF; else if (stRo === 1) fRo = 0x454545FF;
  app.box(308, 9, 42, 28, fRo, 1, 0x232323FF, 3);
  app.text(315, 15, "Rot", 0xC8C8C8FF, 12);
  if (stRo === 3) S.tool = TOOL_ROTATE;
  const stSc = app.clickable(912, 352, 9, 46, 28);
  let fSc = 0x2D2D2DFF; if (S.tool === TOOL_SCALE) fSc = 0x4A75B0FF; else if (stSc === 1) fSc = 0x454545FF;
  app.box(352, 9, 46, 28, fSc, 1, 0x232323FF, 3);
  app.text(360, 15, "Scale", 0xC8C8C8FF, 12);
  if (stSc === 3) S.tool = TOOL_SCALE;
  // toggle SNAP (grid) ao lado das ferramentas
  const stSnap = app.clickable(913, 404, 9, 46, 28);
  let fSnap = 0x2D2D2DFF; if (S.snap !== 0) fSnap = 0x4A75B0FF; else if (stSnap === 1) fSnap = 0x454545FF;
  app.box(404, 9, 46, 28, fSnap, 1, 0x232323FF, 3);
  app.text(410, 15, "Snap", 0xC8C8C8FF, 12);
  if (stSnap === 3) S.snap = S.snap !== 0 ? 0 : 1;

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

  // — BUILD: gera o .exe do JOGO (game.ts + assets), não o editor —
  // A compilação leva ~1min e process.wait BLOQUEIA, então dispara em background
  // (cmd /c start) e só reporta; o resultado aparece em build/.
  const bxBuild = W - 470;
  const stBuild = app.clickable(924, bxBuild, 9, 52, 28);
  let fBuild = 0x2D6A3AFF;                       // verde: é a ação de "publicar"
  if (stBuild === 1) fBuild = 0x3D8A4AFF;
  if (buildMsgFrames > 0) fBuild = 0x4A75B0FF;   // azul enquanto mostra o aviso
  app.box(bxBuild, 9, 52, 28, fBuild, 1, 0x232323FF, 3);
  app.text(bxBuild + 8, 15, "Build", 0xE8E8E8FF, 12);
  if (stBuild === 3) {
    saveScene("assets/scene.json");   // o jogo carrega esta cena: salva antes
    startBuild();
    buildMsgFrames = 420;             // ~7s de aviso na barra de status
  }

  // — CÂMERA: cria um GameObject com o component Camera na pose atual da view —
  const bxCam = W - 414;
  const stCamB = app.clickable(925, bxCam, 9, 40, 28);
  app.box(bxCam, 9, 40, 28, stCamB === 1 ? 0x454545FF : 0x2D2D2DFF, 1, 0x232323FF, 3);
  app.text(bxCam + 5, 15, "Cam", 0xC8C8C8FF, 11);
  if (stCamB === 3) {
    history.snapshot();
    const cam = new GameObject("Main Camera");
    cam.transform.setPosition(S.camX, S.camY, S.camZ);
    cam.transform.ry = S.camYaw;
    cam.transform.rx = S.camPitch;
    cam.addBehavior(createComponent("Camera"));
    scene.add(cam);
    S.selected = scene.objects.length - 1;
  }

  // — direita: Save / Dup / Undo / Redo + fps —
  const bxSave = W - 380;
  const stSave = app.clickable(920, bxSave, 9, 48, 28);
  app.box(bxSave, 9, 48, 28, stSave === 1 ? 0x454545FF : 0x2D2D2DFF, 1, 0x232323FF, 3);
  app.text(bxSave + 7, 15, "Salvar", 0xC8C8C8FF, 11);
  if (stSave === 3) saveScene("assets/scene.json");
  const bxDup = W - 328;
  const stDupB = app.clickable(921, bxDup, 9, 42, 28);
  app.box(bxDup, 9, 42, 28, stDupB === 1 ? 0x454545FF : 0x2D2D2DFF, 1, 0x232323FF, 3);
  app.text(bxDup + 8, 15, "Dup", 0xC8C8C8FF, 11);
  if (stDupB === 3 && S.selected >= 0 && S.selected < scene.objects.length) {
    history.snapshot();
    const g = cloneObject(scene.objects[S.selected]); g.transform.px = g.transform.px + 1.0;
    scene.add(g); S.selected = scene.objects.length - 1;
  }
  const bxUndo = W - 282;
  const stUndoB = app.clickable(922, bxUndo, 9, 34, 28);
  app.box(bxUndo, 9, 34, 28, stUndoB === 1 ? 0x454545FF : 0x2D2D2DFF, 1, 0x232323FF, 3);
  app.text(bxUndo + 11, 14, "<", 0xC8C8C8FF, 15);
  if (stUndoB === 3) history.undo();
  const bxRedo = W - 244;
  const stRedoB = app.clickable(923, bxRedo, 9, 34, 28);
  app.box(bxRedo, 9, 34, 28, stRedoB === 1 ? 0x454545FF : 0x2D2D2DFF, 1, 0x232323FF, 3);
  app.text(bxRedo + 11, 14, ">", 0xC8C8C8FF, 15);
  if (stRedoB === 3) history.redo();

  S.fpsLast = math.floor(app.fps());   // publica pro ws `dbg` (medir perf sem screenshot)
  app.text(W - 92, 15, "fps " + S.fpsLast, 0x909090FF, 13);

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
  // CULLING da lista: só as linhas que cabem no painel são processadas. Sem
  // isto o editor desenhava uma linha por objeto da cena inteira — com 500
  // objetos eram 500 caminhadas de árvore + 2000 chamadas de UI por frame,
  // fora da tela, e isso sozinho segurava o FPS em ~10 mesmo sem nada visível.
  // ── SCROLL ────────────────────────────────────────────────────────────────
  // `visRows` = quantas linhas cabem; `hierScroll` = a primeira visível. A roda
  // rola 3 linhas por clique (o passo que não desorienta), e o scroll é preso
  // ao intervalo válido TODO frame — a lista muda de tamanho quando se cria ou
  // deleta objeto, e um scroll velho apontaria para o vazio.
  const visRows = ((H - (BAR_H + 52)) / 26) | 0;
  S.hierVis = visRows;
  if (S.hierScroll !== hierScroll) hierScroll = S.hierScroll;   // veio do WS
  let maxScroll = scene.objects.length - visRows;
  if (maxScroll < 0) maxScroll = 0;
  const overHier = mx < HIER_W && my > BAR_H;
  if (overHier) {
    const wh: f64 = input.wheel(WIN);
    if (wh > 0.5) hierScroll = hierScroll - 3;
    else if (wh < 0.0 - 0.5) hierScroll = hierScroll + 3;
  }
  if (hierScroll > maxScroll) hierScroll = maxScroll;
  if (hierScroll < 0) hierScroll = 0;
  S.hierScroll = hierScroll;

  const hRowFirst = hierScroll;
  let hRowLast = hierScroll + visRows;
  if (hRowLast > scene.objects.length) hRowLast = scene.objects.length;
  let hi = hRowFirst;
  while (hi < hRowLast) {
    const obj = scene.objects[hi];
    let depth = 0;
    let pp = obj.parent;
    while (pp >= 0 && depth < 8) { depth = depth + 1; pp = scene.objects[pp].parent; }
    const indent = depth * 16;
    const ry0 = BAR_H + 52 + (hi - hierScroll) * 26;
    const inRow = mx < HIER_W && my >= ry0 && my < ry0 + 26;
    // botão DIREITO sobre a linha: abre o menu de contexto mirando este objeto
    if (mRight !== 0 && inRow && dndOn === 0) {
      ctxOn = 1; ctxX = mx | 0; ctxY = my | 0; ctxTarget = hi; S.selected = hi;
    }
    if (mPressed !== 0 && inRow && dndOn === 0) {
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
    // arrastando uma TEXTURA do Project sobre esta linha → alvo do drop
    if (dndOn !== 0 && inRow && dndTex !== 0) fill = 0x2E5A3AFF;
    app.box(8 + indent, ry0 + 1, HIER_W - 16 - indent, 24, fill, 0, 0, 5);
    if (depth > 0) app.text(8 + indent - 12, ry0 + 5, "└", 0x556377FF, 14);
    let icon = "[C]";
    if (obj.meshKind === 2) icon = "[P]";
    if (obj.meshKind === 3) icon = "[O]";
    if (obj.meshKind === 4) icon = "[S]";
    app.text(14 + indent, ry0 + 6, icon + " " + obj.name, 0xC8C8C8FF, 13);
    hi = hi + 1;
  }
  // clique DIREITO na área vazia da hierarquia: menu criando na RAIZ
  if (mRight !== 0 && mx < HIER_W && my > BAR_H + 52 && dndOn === 0) {
    let overRow = 0;
    if (my < BAR_H + 52 + hRowLast * 26) overRow = 1;
    if (overRow === 0) { ctxOn = 1; ctxX = mx | 0; ctxY = my | 0; ctxTarget = 0 - 1; }
  }
  // ── BARRA DE SCROLL ───────────────────────────────────────────────────────
  // Só aparece quando há o que rolar. Além de indicar a posição, ela é
  // ARRASTÁVEL: rolar 500 objetos de 3 em 3 na roda seria inviável.
  if (maxScroll > 0) {
    const trackY = BAR_H + 52;
    const trackH = visRows * 26;
    const bx = HIER_W - 10;
    app.box(bx, trackY, 6, trackH, 0x2A2A2AFF, 0, 0, 3);
    // altura proporcional ao quanto da lista está visível, com mínimo clicável
    let thumbH = (trackH * visRows / scene.objects.length) | 0;
    if (thumbH < 24) thumbH = 24;
    const thumbY = trackY + (((trackH - thumbH) * hierScroll / maxScroll) | 0);
    const stBar = app.clickable(1390, bx - 2, trackY, 10, trackH);
    let barCol = 0x5A5A5AFF;
    if (stBar === 1) barCol = 0x6E6E6EFF;
    if (stBar === 2 || hierBarDrag !== 0) barCol = 0x8AA0BFFF;
    app.box(bx, thumbY, 6, thumbH, barCol, 0, 0, 3);
    // arrasto: enquanto o botão estiver preso, a posição do mouse na trilha
    // define o scroll direto (mapeia o centro do polegar sob o cursor)
    if (stBar === 2) hierBarDrag = 1;
    if (mDownNow === 0) hierBarDrag = 0;
    if (hierBarDrag !== 0) {
      const rel: f64 = my - trackY - thumbH * 0.5;
      const span: f64 = trackH - thumbH;
      let f: f64 = span > 0.0 ? rel / span : 0.0;
      if (f < 0.0) f = 0.0;
      if (f > 1.0) f = 1.0;
      hierScroll = (f * maxScroll) | 0;
    }
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
  // nome EDITÁVEL (clicar pra digitar) — estilo campo de nome do Inspector Unity
  sel.name = app.textField(951, ix + 14, BAR_H + 28, INSP_W - 28, sel.name);
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
  if (sel.transform.sx !== nsx) scene.colDirty = 1;   // raio de colisão cacheado
  sel.transform.sx = nsx; sel.transform.sy = nsy; sel.transform.sz = nsz;

  // ── mesh + textura: SLOTS que aceitam DROP do Project (estilo Unity) ─────────
  // O slot de Mesh mostra o .obj carregado (ou o primitivo); o de Textura mostra
  // a imagem do Material. Arrastar um asset compatível de baixo acende a borda.
  let meshName = "Cubo";
  if (sel.meshKind === 2) meshName = "Piramide";
  if (sel.meshKind === 3) meshName = "Octaedro";
  if (sel.meshKind === 4) meshName = "Esfera";
  let meshShow = meshName;
  if (sel.customMesh > 0 && sel.meshPath.length > 0) meshShow = sel.meshPath;
  slotMeshHot = assetField(WIN, ix + 14, BAR_H + 176, INSP_W - 28, 20, "Mesh", meshShow, dndModel, mx, my);
  // path da textura atual (via Material, com fallback pro campo legado)
  let texShow = "";
  if (sel.matIdx >= 0) texShow = sel.behaviors[sel.matIdx].matTexPath();
  slotTexHot = assetField(WIN, ix + 14, BAR_H + 200, INSP_W - 28, 20, "Textura", texShow, dndTex, mx, my);

  const bMesh = app.button(ix + 14, BAR_H + 224, 104, 22, "Trocar");
  if (bMesh) {
    sel.meshKind = sel.meshKind + 1; if (sel.meshKind > 4) sel.meshKind = 1;
    sel.customMesh = 0; sel.meshPath = "";   // voltar pro primitivo descarta o .obj
  }
  {
    // Trocar "Estatico" muda quem PODE se mover, e isso é cacheado (Scene.cIdx):
    // sem invalidar, o objeto continuaria estático (ou móvel) até a próxima
    // mutação da cena.
    const wasStat = sel.stationary;
    sel.stationary = app.checkbox(ix + 134, BAR_H + 226, sel.stationary, "Estatico");
    if (sel.stationary !== wasStat) scene.colDirty = 1;
  }

  // ── componentes do objeto — cada um com CABEÇALHO + campos de CONFIG editáveis
  //    + botão remover; e a lista "Add Component" no fim (estilo Inspector Unity)
  app.text(ix + 14, BAR_H + 242, "COMPONENTES", 0xC8C8C8FF, 14);
  let bc = 0;
  let cyc = BAR_H + 266;
  let removeIdx = 0 - 1;
  while (bc < sel.behaviors.length) {
    // ── CABEÇALHO estilo foldout Unity: ▼/▶ colapsar + checkbox enabled + nome + X ──
    app.box(ix + 14, cyc, INSP_W - 28, 22, 0x414141FF, 1, 0x232323FF, 4);
    const collapsed = sel.behaviors[bc].collapsed;
    // triângulo de colapsar (clicável)
    const stTri = app.clickable(560 + bc, ix + 16, cyc, 18, 22);
    app.text(ix + 20, cyc + 3, collapsed !== 0 ? ">" : "v", 0xB0B0B0FF, 13);
    if (stTri === 3) sel.behaviors[bc].collapsed = collapsed !== 0 ? 0 : 1;
    // checkbox enabled
    const en = sel.behaviors[bc].enabled;
    const stCk = app.clickable(580 + bc, ix + 34, cyc + 4, 14, 14);
    app.box(ix + 34, cyc + 4, 14, 14, en !== 0 ? 0x5A7FB0FF : 0x2A2A2AFF, 1, 0x232323FF, 2);
    if (stCk === 3) sel.behaviors[bc].enabled = en !== 0 ? 0 : 1;
    app.text(ix + 54, cyc + 4, sel.behaviors[bc].typeName(), 0xD0D0D0FF, 13);
    const bDel = app.button(ix + INSP_W - 42, cyc + 2, 20, 18, "x");
    if (bDel) removeIdx = bc;
    cyc = cyc + 26;
    // campos de config — só quando EXPANDIDO
    if (sel.behaviors[bc].collapsed === 0) {
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
    }
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
  // Barra de status: normalmente a dica de controles; após clicar em Build,
  // o aviso do build por alguns segundos (a compilação roda em outra janela).
  if (buildMsgFrames > 0) {
    buildMsgFrames = buildMsgFrames - 1;
    app.text(W - INSP_W - 470, H - 19,
      "BUILD iniciado numa janela a parte (~1min) — sai em build/RTSGame.exe com os assets", 0x77DD99FF, 11);
  } else {
    app.text(W - INSP_W - 470, H - 19, "WASD voa | DIR gira camera | esq seleciona | arraste assets do Project pra ca", 0x808080FF, 11);
  }

  // ── PROJECT PANEL (asset browser) na base do viewport ───────────────────────
  const apX = HIER_W;
  const apY = H - 24 - ASSET_H;
  const apW = W - HIER_W - INSP_W;
  const assetAct = drawAssets(WIN, apX, apY, apW, ASSET_H, mx, my, mPressed, mDownNow, frames);
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

  // ── DROP do asset arrastado (estilo Unity) ─────────────────────────────────
  // O drag é iniciado/mantido pelo Project (assets.ts). Aqui, no frame em que o
  // botão é SOLTO, decidimos o alvo pela região do cursor:
  //   • viewport  → instancia o asset no MUNDO, no ponto do chão sob o cursor
  //   • hierarquia→ instancia (posição padrão) / aplica textura no objeto da linha
  //   • inspector → aplica no SLOT compatível sob o cursor (Mesh/Textura)
  // O drag é limpo logo após aplicar, então cada release é consumido uma vez só.
  if (dndOn !== 0 && mDownNow === 0) {
    // subStr (não `.substring` direto): a string vem de estado de MÓDULO do
    // assets.ts — fatiar sem passar por parâmetro devolve "undefined" no motor.
    const pay = assetDragPayload();
    const cut = pay.indexOf(":");
    const kind = subStr(pay, 0, cut);
    const dpath = subStr(pay, cut + 1, pay.length);

    if (inViewport) {
      if (previewIdx >= 0) {
        // já existe o PREVIEW no lugar certo: soltar apenas o confirma (vira
        // objeto definitivo) — nada de instanciar de novo.
        movePreviewTo(mx, my, cyw, syw, cpt2, spt2);
        S.selected = previewIdx;
        previewIdx = 0 - 1;
        previewPay = "";
      } else {
        // textura solta EM CIMA de um objeto → aplica nele (Unity); no vazio → cria
        const hitObj = kind === "tex" ? pickObjectAt(mx, my, cyw, syw, cpt2, spt2) : 0 - 1;
        if (hitObj >= 0) {
          if (applyTexToObject(hitObj, dpath, WIN) > 0) S.selected = hitObj;
        } else {
          dropAssetInWorld(kind, dpath, mx, my, cyw, syw, cpt2, spt2);
        }
      }
    } else if (mx < HIER_W && my > BAR_H) {
      // sobre a hierarquia: textura vai pro objeto da linha; resto instancia solto
      const hIdx = hierRowAt(my);
      if (kind === "tex" && hIdx >= 0 && hIdx < scene.objects.length) {
        applyTexToObject(hIdx, dpath, WIN);
      } else {
        dropAssetInWorld(kind, dpath, 0.0 - 1.0, 0.0, cyw, syw, cpt2, spt2);
      }
    } else if (mx > W - INSP_W && S.selected >= 0 && S.selected < scene.objects.length) {
      // sobre o inspector: só os slots aceitam (hit-test guardado no draw)
      if (kind === "tex" && slotTexHot !== 0) applyTexToObject(S.selected, dpath, WIN);
      else if (kind === "model" && slotMeshHot !== 0) applyMeshToObject(S.selected, dpath, WIN);
    }
    // Soltar de VOLTA no Project (ou em qualquer área não tratada) = CANCELAR:
    // nenhum ramo acima rodou, então o preview é descartado e a cena fica intacta.
    killPreview();      // no-op se o drop no viewport já consumiu o preview
    assetDragClear();
  }

  // ── UI-SCENE (L3): HUDs ao vivo como GameObjects, ancorados (RectTransform-like).
  // Títulos com dados reais da cena; os painéis seguem os cantos no resize.
  uiScene.setPanelTitle(0, "Objs " + scene.count() + "   Sel " + S.selected + "   Drawn " + S.drawnLast);
  uiScene.setPanelTitle(1, "cam " + (S.camX | 0) + "," + (S.camY | 0) + "," + (S.camZ | 0));
  uiScene.draw(WIN, W, H);

  // ── OVERLAY DO DRAG & DROP (por último: fica acima de tudo) ────────────────
  if (dndOn !== 0) {
    if (inViewport) {
      // alvo do drop: marca o objeto sob o cursor (textura) ou o ponto do chão
      const prevObj = dndTex !== 0 ? pickObjectAt(mx, my, cyw, syw, cpt2, spt2) : 0 - 1;
      if (prevObj >= 0) {
        const pp = projPt(scene.objects[prevObj].transform.wx, scene.objects[prevObj].transform.wy,
                          scene.objects[prevObj].transform.wz, S.camX, S.camY, S.camZ,
                          cyw, syw, cpt2, spt2, focalW, W, H);
        if (pp[2] !== 0.0) app.box(pp[0] - 22, pp[1] - 22, 44, 44, 0x77DD9955, 1, 0x77DD99FF, 6);
        app.text(mx + 12, my + 16, "aplicar textura", 0x77DD99FF, 12);
      } else {
        // marca o ponto do chão sob o preview (cruz + coordenadas do mundo)
        const gp = screenToPlane(mx, my, S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H, 0.0);
        if (gp[3] !== 0.0) {
          const sp = projPt(gp[0], gp[1], gp[2], S.camX, S.camY, S.camZ, cyw, syw, cpt2, spt2, focalW, W, H);
          if (sp[2] !== 0.0) {
            app.line(sp[0] - 14, sp[1], sp[0] + 14, sp[1], 1, 0x77DD99FF);
            app.line(sp[0], sp[1] - 8, sp[0], sp[1] + 8, 1, 0x77DD99FF);
            app.text(sp[0] + 8, sp[1] + 6, "(" + fmt1(gp[0]) + ", " + fmt1(gp[2]) + ")", 0x77DD99FF, 11);
          }
        }
      }
    }
    // o "fantasma" com o nome do arquivo só aparece quando NÃO há preview 3D:
    // dentro do viewport o próprio objeto renderizado já é a prévia.
    if (previewIdx < 0) drawAssetDragGhost(WIN, mx, my);
  }

  // ── MENU DE CONTEXTO (por último: fica ACIMA de tudo) ─────────────────────
  // Desenhado no fim do frame de propósito — a UI é imediata, então quem desenha
  // depois cobre. Um menu que aparecesse sob a lista seria inclicável.
  if (ctxOn !== 0) {
    const CW = 168;
    const items = 8;
    const CH = 12 + items * 24;
    let cx = ctxX;
    let cy = ctxY;
    if (cx + CW > W) cx = W - CW - 4;          // não vaza pela direita
    if (cy + CH > H) cy = H - CH - 4;          // nem por baixo
    app.box(cx, cy, CW, CH, 0x252525FF, 1, 0x3C3C3CFF, 4);
    // cabeçalho: mostra SE vai criar como filho, e de quem
    let head = "Criar na raiz";
    if (ctxTarget >= 0 && ctxTarget < scene.objects.length) {
      head = "Filho de " + subStr(scene.objects[ctxTarget].name, 0, 14);
    }
    app.text(cx + 10, cy + 6, head, 0x8AA0BFFF, 11);
    let iy = cy + 24;
    let clicked = 0 - 1;
    let n = 0;
    while (n < items) {
      const st = app.clickable(1400 + n, cx + 4, iy, CW - 8, 22);
      if (st === 1 || st === 2) app.box(cx + 4, iy, CW - 8, 22, 0x3A5A8AFF, 0, 0, 3);
      if (st === 3) clicked = n;
      iy = iy + 24;
      n = n + 1;
    }
    // rótulos (mesma ordem do índice tratado abaixo)
    let ly = cy + 24;
    app.text(cx + 12, ly + 4, "Cubo", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Esfera", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Piramide", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Octaedro", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Objeto vazio", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Camera", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Duplicar", 0xC8C8C8FF, 12); ly = ly + 24;
    app.text(cx + 12, ly + 4, "Deletar", 0xE08080FF, 12);

    if (clicked >= 0) {
      if (clicked === 0) ctxCreate("Cube", 1, 150, 180, 220, ctxTarget);
      else if (clicked === 1) ctxCreate("Sphere", 4, 220, 170, 150, ctxTarget);
      else if (clicked === 2) ctxCreate("Pyramid", 2, 170, 210, 170, ctxTarget);
      else if (clicked === 3) ctxCreate("Octa", 3, 200, 180, 230, ctxTarget);
      else if (clicked === 4) ctxCreate("Empty", 0, 0, 0, 0, ctxTarget);
      else if (clicked === 5) {
        const cam = ctxCreate("Camera", 0, 0, 0, 0, ctxTarget);
        cam.addBehavior(createComponent("Camera"));
      } else if (clicked === 6) {
        if (ctxTarget >= 0 && ctxTarget < scene.objects.length) {
          history.snapshot();
          const g = cloneObject(scene.objects[ctxTarget]);
          g.transform.px = g.transform.px + 1.0;
          scene.add(g);
          S.selected = scene.objects.length - 1;
        }
      } else if (clicked === 7) {
        if (ctxTarget >= 0 && ctxTarget < scene.objects.length) {
          history.snapshot();
          scene.removeAt(ctxTarget);
          if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
        }
      }
      ctxOn = 0;
    }
    // clique FORA (ou botão direito de novo) fecha sem fazer nada
    const overMenu = mx >= cx && mx < cx + CW && my >= cy && my < cy + CH;
    if ((mPressed !== 0 || mRight !== 0) && !overMenu) ctxOn = 0;
  }

  // mantém o ring de áudio cheio (ver engine/audio/audio.ts)
  pumpAudio();

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

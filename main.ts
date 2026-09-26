// ═══════════════════════════════════════════════════════════════════════════
// Engine RTS — editor + game loop + RENDER DE CENA (faces sólidas + z-buffer).
// Estilo Unity: tudo é GameObject, ciclo mount → update(dt) → render pass.
//   rts.exe run main.ts
// ═══════════════════════════════════════════════════════════════════════════
import io from "@compat/io.ts";
import math from "@compat/math.ts";
import buffer from "@compat/buffer.ts";
import render from "@compat/render.ts";
import { setVsync } from "rts:egui";
import input from "rts:input";
import fs from "@compat/fs.ts";
import process from "@compat/process.ts";
// `createAppAt` era um GLOBAL do motor antigo. No motor novo nada é global sem
// alguém instalar, então ele vira um import como qualquer outra coisa — e o que
// está do outro lado costura a janela (`rts:egui`), o input (`rts:input`), o
// relógio e os widgets posicionados, que lá eram uma coisa só.
import { createAppAt } from "@compat/app.ts";

import { GameObject } from "@engine/core/gameobject";
import { Scene } from "@engine/core/scene";
import { drawSceneObjects, fParams, fParams2, definirSegundaVista, prepararDesenho, DS_FLOATS } from "@engine/render/scenedraw";
import { Transform } from "@engine/core/transform";
import { subStr, nfEditing, nfCancel } from "@editor/widgets";
import { definirJanelaEntrada, definirEntradaAtiva } from "@engine/core/entrada";
import { Inspector } from "@editor/inspector";
import { previewFrame } from "@editor/skeleton_preview";
import { EditorUI } from "@editor/ui_controls";
import { dropScriptOnObject, scriptDropError } from "@editor/script_drop";
import { ScriptEditor } from "@editor/script_editor";
import { UI_SCRIPT_DROP, UI_CODE_EDITOR } from "@editor/ui_config";
import { PreferencesPanel } from "@editor/preferences_panel";
import { PlayToolbar } from "@editor/play_toolbar";
import { drawGameUI } from "@engine/ui/game_ui";
import { playMode } from "@editor/play_mode";
import { UI_PLAY } from "@editor/ui_config";
import { UI_WORKSPACE, UI_DOCUMENT } from "@editor/ui_config";
import { UI_GIZMO } from "@editor/ui_config";
import { gizmosBegin } from "@engine/core/gizmos";
import { gizmosDoEditor, coletarGizmos, pintarGizmos, gizmoIconAt } from "@editor/gizmo_pass";
import { ConsolePanel } from "@editor/console_panel";
import { WorkspaceViews } from "@editor/workspace_views";
import { sceneDocument } from "@editor/scene_document";
import { DocumentPanel, saveDocument } from "@editor/document_panel";
import { chooseSceneFile } from "@editor/scene_dialog";
import { EditorBuild } from "@editor/editor_build";
import { assetsInit, assetsOpenScenes, drawAssets, assetsArea, assetsMouse, assetDragActive, assetDragPayload, assetDragName, assetDragClear, drawAssetDragGhost } from "@editor/assets";
import { initMeshes, setCamBuf, frustumBeginBuf, CAM_FLOATS, FRUSTUM_NEAR_PADRAO, FRUSTUM_FAR_PADRAO, CAM_ORTO_PADRAO, frustumParams, winWidth, winHeight, loadTexture,
         setViewportBuf, setFundoCeu } from "@engine/render/gpu3d";
import { VistasDeCamera, coletarCameras, aplicarVistas, frustumDasVistas, posicaoDaVista, frustumDaVista } from "@engine/render/camera_views";
import { Camera } from "@engine/core/camera";
import type { Behavior } from "@engine/core/behavior";
import { areaComFaixas, prepararPrevia, restaurarPrevia } from "@editor/game_view";
import { aplicarLuzes, aplicarAmbiente } from "@engine/render/scene_lighting";
import { scene, S } from "@editor/control/session";
import { pickAxis, axisMove, projPt, screenToGround, snapv, TOOL_MOVE, TOOL_ROTATE, TOOL_SCALE, VISTA_FLOATS, GIZMO_FLOATS, GZ_LEN,
  GIZMO_ROTATE_PER_UNIT, SNAP_MOVE_STEP, SNAP_ROTATE_STEP } from "@editor/gizmo";
import { selectedBoneTarget, boneWorldOriginInto, boneDrag } from "@editor/bone_gizmo";
import { loadSceneFrom, instantiatePrefab, cloneObject } from "@editor/sceneio";
import { instantiateAt, groundAt, pickAt, applyTexToObject, applyMeshToObject, vistaDaSessao } from "@editor/dnd";
import { history } from "@editor/undo";
import { rigidStep, rigidBackendName } from "@engine/core/physics_backend";
import { stepsFor, stepMore, FIXED_DT, stepAlpha, stepsLastFrame, stepDiscards } from "@engine/core/fixedstep";
import { snapshotWorld, renderX, renderY, renderZ, interpolateReset, interpolateSync } from "@engine/core/interpolate";
import { clockTick, clockNow, DOUBLE_CLICK_MS } from "@engine/core/clock";
import { profEnable, profSection, profFrameBegin, profFrameEnd, secBegin, secEnd, profReport } from "@engine/core/profiler";
import { dcReport } from "@compat/drawcount.ts";
import { benchInit, benchFrameBegin, benchCpuEnd, benchFrameEnd } from "@engine/core/frame_bench";

// Seções do profiler — registradas uma vez, referidas por id no laço quente.
const P_FISICA = profSection("fisica");
const P_INPUT = profSection("input+camera");
const P_MUNDO3D = profSection("render 3D");
const P_UI = profSection("UI 2D");
const P_CTRL = profSection("controle ws");
// SUB-SEÇÕES da UI 2D. Estão aqui porque "UI 2D = 2,9 ms" não diz onde mexer, e
// a hipótese barata — "a hierarquia desenha uma linha por objeto da cena" —
// precisa ser CONFIRMADA antes de custar trabalho: ela já faz culling de scroll
// (`visRows`/`hRowLast`), então a suspeita óbvia pode perfeitamente ser a
// errada. Somam DENTRO da `UI 2D`, que continua sendo o total.
const P_UI_GIZ = profSection("  ui:gizmo");
const P_UI_BAR = profSection("  ui:toolbar");
const P_UI_HIER = profSection("  ui:hierarquia");
const P_UI_INSP = profSection("  ui:inspector");
const P_UI_PROJ = profSection("  ui:project");
// O "resto" era 2,11 ms NAO INSTRUMENTADOS — 29% do frame. E sempre no pedaço
// não medido que mora a surpresa: hoje isso já aconteceu três vezes.
const P_PRESENT = profSection("present/endFrame");
import { ctrlServe, ctrlPoll } from "@editor/control/server";
import { instalarEditorReal } from "@editor/editor_host";
// Pacotes @editorOnly (comandos, ganchos, ferramentas): só o editor carrega.
import "@engine/generated/editor_extensions";
import { initAudio, pumpAudio } from "@engine/audio/audio";
import { logInfo, logTick, logError } from "@engine/core/logger";
import { OBJECT_PRESETS, OBJECT_PRESET_LABELS } from "@editor/object_presets";
import { RotuloNumero, RotuloPar, RotulosDeLinha } from "@editor/rotulos";
import { UI_ROTULOS } from "@editor/ui_config";
import { menuDoCatalogo, executarItemDeMenu, MENU_CRIAR, MENU_JANELA } from "@editor/menu_items";
import { UI_MENU_H, UI_BAR_H, UI_STATUS_H, UI_HIER_DEFAULT, UI_INSP_DEFAULT, UI_PROJECT_DEFAULT,
         UI_HIER_MIN, UI_INSP_MIN, UI_PROJECT_MIN, UI_SCENE_MIN_W, UI_SCENE_MIN_H,
         UI_HIER_HEADER_H, UI_HIER_SEARCH_H, UI_HIER_ROW_H, UI_HIER_INDENT,
         UI_HIER_SCROLL_STEP, UI_HIER_DROP_EDGE, UI_SCROLL_THUMB_MIN_H,
         UI_CONTEXT_W, UI_CONTEXT_ROW_H,
         UI_MENU_W, UI_MENU_ROW_H, UI_MENU_PADDING, UI_MENU_START_X, UI_MENU_GAP,
         UI_SCENE_HEADER_H, UI_TOOL_X, UI_TOOL_Y, UI_TOOL_W, UI_TOOL_H,
         UI_TOOL_BUTTON_W, UI_TOOL_BUTTON_H, UI_TOOL_BUTTON_STEP, UI_CONTROL_Y, UI_CONTROL_H,
         UI_MENU_NAMES, UI_MENU_BUTTON_W, UI_TOOLS, UI_FILE_ACTIONS, UI_EDIT_ACTIONS,
         UI_CONTEXT_ACTIONS, UI_HELP_ACTIONS, UI_SETTINGS, UI_C, UI_WINDOW, UI_GAME_VIEW, UI_CAMERA_PREVIEW } from "@editor/ui_config";
import { caixa, estiloTexto, linha, pincel, texto, traco } from "@compat/draw2d.ts";
// Menu Criar (global e de contexto): presets fixos + itens @menuItem "Criar/…",
// montado uma vez. Configurações reaproveita o próprio array a cada frame.
const menuCriar = menuDoCatalogo(MENU_CRIAR, OBJECT_PRESET_LABELS);
const menuConfig: string[] = ["", "", UI_SETTINGS.resetLayout, UI_CODE_EDITOR.title];
// Menu Janela: a prévia da câmera (rótulo com o estado) + itens @menuItem "Janela/…".
const menuJanela = menuDoCatalogo(MENU_JANELA, [UI_WINDOW.previewOff]);
// Aba Jogo e prévia da câmera: vistas reaproveitadas (sem alocação por frame).
const vistasJogo = new VistasDeCamera(); const vistasPrevia = new VistasDeCamera();
const areaCena = new Float64Array(4);
/// Seleção, alpha e frustum de `drawSceneObjects` (ver `prepararDesenho`), reaproveitado.
const desenhoCfg = new Float64Array(DS_FLOATS);
/// Câmera do editor na tela (gizmo.VISTA_FLOATS), preenchida uma vez por quadro; projeções
/// do gizmo e do drop escrevem em buffers fixos (Task 10.5: sem array novo por chamada).
const vistaEditor = new Float64Array(VISTA_FLOATS);
const gizmoTela = new Float64Array(GIZMO_FLOATS);
const pontoMundo = new Float64Array(3);
const pontoDrop = new Float64Array(4);
const anelA = new Float64Array(3); const anelB = new Float64Array(3);
/// Câmera do editor para `setCamBuf`/`frustumBeginBuf` (CAM_FLOATS; near/far/orto padrão).
const camEditor = new Float64Array(CAM_FLOATS);
camEditor[7] = FRUSTUM_NEAR_PADRAO; camEditor[8] = FRUSTUM_FAR_PADRAO; camEditor[10] = CAM_ORTO_PADRAO;
/// Retângulo de runtime da câmera da prévia, guardado enquanto ela desenha no canto.
const retanguloPrevia = new Float64Array(4);
/// Viewport da janela inteira (x, y, w, h, limpar) da vista de Cena.
const VISTA_CHEIA = new Float64Array(5);
VISTA_CHEIA[2] = 1.0; VISTA_CHEIA[3] = 1.0; VISTA_CHEIA[4] = 1.0;
// "Câmera: <nome>" da prévia, refeito só quando o nome muda.
let previaTitulo = ""; let previaTituloDe = "";

// ── janela ────────────────────────────────────────────────────────────────
let W = 1200;   // tamanho LÓGICO da janela — atualizado a cada frame (segue o resize)
let H = 720;
const app = createAppAt(process.env("RTS_TITULO") !== "" ? process.env("RTS_TITULO") : "Engine RTS — editor", W, H, 120, 90);
const WIN = app._win;

// layout do editor
let HIER_W = UI_HIER_DEFAULT;        // painéis ajustáveis arrastando as divisórias
let INSP_W = UI_INSP_DEFAULT;
const BAR_H = UI_BAR_H;
let ASSET_H = UI_PROJECT_DEFAULT;
const HIER_LIST_TOP = BAR_H + UI_HIER_HEADER_H + UI_HIER_SEARCH_H;
let layoutDrag = 0;       // 1 hierarquia, 2 inspector, 3 Project
let menuOpen = 0;         // 1 Arquivo, 2 Editar, 3 Criar, 4 Janela, 5 Configurações, 6 Ajuda
let menuX = 0;
let helpOpen = 0;
let vsyncOn = 1;

// ── resolução do rasterizador por software — o que SOBROU dele ──────────────
//
// `RH` ainda alimenta `focalR` logo abaixo. O resto do bloco era o framebuffer
// daquele caminho — `fbuf` (RGBA), `zbuf` (profundidade) e `fptr` (o endereço
// cru para o blit) — e saiu porque já não era alcançado: o `gpu3d` assumiu o
// render, `fptr` não era lido por ninguém, e `fbuf`/`zbuf` só existiam para
// serem alocados no começo e liberados no fim.
//
// Deletado aqui em vez de mantido "por via das dúvidas": um `buffer.alloc` de
// 320×200 pixels que nada lê é memória e ruído, e `buffer.ptr` não existe mais
// de propósito (o coletor move células — ver `compat/buffer.ts`), então a linha
// nem podia sobreviver.
const RW = 320;
const RH = 200;

// ── câmera (fly) — estado top-level ─────────────────────────────────────────
const FOV: f64 = 1.05;
/// Pose da vista de Cena para os Gizmos (x, y, z, yaw, pitch, fov, largura, altura), reaproveitada.
const gizmoPose = new Float64Array(8);
const focalR: f64 = (RH * 0.5) / math.tan(FOV * 0.5);   // p/ framebuffer
let focalW: f64 = (H * 0.5) / math.tan(FOV * 0.5);      // p/ picking; recalc por frame

// ── cena (estilo Unity) ─────────────────────────────────────────────────────

// carga inicial: prefere a cena SALVA pelo usuário (assets/scene.json, gravada pelo
// botão Salvar / savescene) pra persistir entre sessões; senão os demos.
let sceneFile = "scenes/solar.json";
if (fs.exists("scenes/shadowdemo.json")) sceneFile = "scenes/shadowdemo.json";
if (fs.exists("assets/scene.json")) sceneFile = "assets/scene.json";   // cena do usuário tem prioridade
// RTS_SCENE tem prioridade sobre todas, e existe para uma demonstração poder ser
// aberta sem sobrescrever a cena de trabalho de ninguém. A alternativa era
// gravar por cima de `assets/scene.json`, que apagaria o que o usuário salvou.
{
  const pedida = process.env("RTS_SCENE");
  if (pedida !== "" && fs.exists(pedida)) sceneFile = pedida;
}
// Se NENHUMA cena existe (bundle sem a pasta scenes/), avisa alto: antes o
// editor abria vazio sem dizer por quê — "cena 'Main' com 0 objetos".
if (!fs.exists(sceneFile)) {
  io.print("[AVISO] nenhuma cena encontrada (" + sceneFile + ") — a pasta 'scenes/'");
  io.print("        precisa ficar AO LADO do executavel. Abrindo cena vazia.");
} else {
  try { loadSceneFrom(sceneFile); }
  catch (error) { logError("Falha ao abrir cena inicial: " + String(error)); sceneFile = ""; }
}

// ── estado do editor ────────────────────────────────────────────────────────
let frames = 0;
let spawnN = 0;
let dragging = 0;
let gizmoAxis = 0 - 1;   // eixo do gizmo que está sendo arrastado (-1 = nenhum)
// Origem do gizmo quando o alvo é um osso (posição de mundo do osso); buffer
// fixo, reaproveitado a cada frame.
const boneGizmoOrigin = new Float64Array(3);
const luzCam = new Float64Array(3); const luzLegada = new Float64Array(4);
let prevF = 0;           // estado anterior da tecla F (edge-detection do focus)
let addMenuOpen = 0;   // dropdown "Add Component" aberto?
const inspector = new Inspector(app);
const scriptDropUI = new EditorUI(app, "Editor/ScriptDrop");
const scriptEditor = new ScriptEditor();
const preferencesPanel = new PreferencesPanel(app);
let scriptNotice = "";
let scriptNoticeFrames = 0;
const playToolbar = new PlayToolbar(app);
const workspaceViews = new WorkspaceViews(app);
const consolePanel = new ConsolePanel(app);
const documentPanel = new DocumentPanel(app);
const editorBuild = new EditorBuild();
sceneDocument.initialize(fs.exists(sceneFile) ? sceneFile : "");
let documentPoll = 0;

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
  const o = scene.createGameObject(name + "." + spawnN, kind, r, g, b, parentIdx);
  spawnN = spawnN + 1;
  const cy = math.cos(S.camYaw); const sy = math.sin(S.camYaw);
  const cp = math.cos(S.camPitch); const sp = math.sin(S.camPitch);
  o.transform.setPosition(S.camX + sy * cp * 8.0, S.camY + sp * 8.0, S.camZ + cy * cp * 8.0);
  S.selected = scene.objects.length - 1;
  hierFilter = "";
  hierScroll = math.max(0, scene.objects.length - S.hierVis);
  S.hierScroll = hierScroll;
  logInfo("criado " + o.name + " (#" + S.selected + ")" +
          (parentIdx >= 0 ? " filho de #" + parentIdx : " na raiz"));
  return o;
}

// Uma unica implementação para as opções "Criar" do menu global e de contexto.
/// Linhas do menu global `menu` (1 Arquivo … 6 Ajuda): as mesmas no desenho e
/// na área clicável. Janela e Configurações trocam só os rótulos de estado, sem array novo.
function menuEntries(menu: number): string[] {
  let entries: string[] = UI_HELP_ACTIONS;
  if (menu === 1) entries = UI_FILE_ACTIONS;
  else if (menu === 2) entries = UI_EDIT_ACTIONS;
  else if (menu === 3) entries = menuCriar.rotulos;
  else if (menu === 4) {
    menuJanela.rotulos[0] = S.cameraPreview !== 0 ? UI_WINDOW.previewOn : UI_WINDOW.previewOff;
    entries = menuJanela.rotulos;
  } else if (menu === 5) {
    menuConfig[0] = S.snap !== 0 ? UI_SETTINGS.gridOn : UI_SETTINGS.gridOff;
    menuConfig[1] = vsyncOn !== 0 ? UI_SETTINGS.vsyncOn : UI_SETTINGS.vsyncOff;
    entries = menuConfig;
  }
  return entries;
}

function createMenuObject(choice: number, parentIdx: number): void {
  if (choice < 0 || choice >= OBJECT_PRESETS.length) return;
  const preset = OBJECT_PRESETS[choice];
  ctxCreate(preset.name, preset.meshKind, preset.r, preset.g, preset.b, parentIdx);
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
// Compila game.ts em segundo plano, a partir de um snapshot isolado da cena.

function startBuild(): void {
  editorBuild.start(); workspaceViews.console = true;
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
  const rel = sy - HIER_LIST_TOP;
  if (rel < 0.0) return 0 - 1;
  const row = ((rel / UI_HIER_ROW_H) | 0) + hierScroll;
  if (hierFilter.length > 0) {
    if (row >= hierShownN) return 0 - 1;
    return hierShown[row];
  }
  if (row >= scene.objects.length) return 0 - 1;
  return row;
}

// DROP de um asset do Project na CENA. `sx/sy` é o cursor: quando sx>=0 o objeto
// nasce no ponto do CHÃO (plano Y=0) sob o cursor — como arrastar pra viewport na
// Unity; se o raio não bater no chão (mirando o céu), cai 12 unidades à frente.
// sx<0 = sem posição de tela (drop na hierarquia): usa a posição padrão do asset.
// Devolve o índice do objeto criado (-1 se o asset não gera objeto — cena/pasta).
// É reusado pelo PREVIEW do drag: instancia de verdade e depois só reposiciona.
// Delega pra editor/dnd.ts (mesma lógica usada pelos comandos WS `drop*`).
// A câmera vem da `vistaEditor` do quadro (preenchida no início do frame).
function dropAssetInWorld(kind: string, path: string, sx: f64, sy: f64): number {
  if (sx < 0.0) return instantiateAt(kind, path, null);
  groundAt(pontoDrop, vistaEditor, sx, sy);
  return instantiateAt(kind, path, pontoDrop);
}

// Reposiciona o objeto-preview no ponto do chão sob o cursor (segue o mouse).
function movePreviewTo(sx: f64, sy: f64): void {
  if (previewIdx < 0 || previewIdx >= scene.objects.length) return;
  groundAt(pontoDrop, vistaEditor, sx, sy);
  const t = scene.objects[previewIdx].transform;
  // mesma regra do instantiateAt: assenta SOBRE o chão (meia altura acima de Y=0)
  t.setPosition(pontoDrop[0], pontoDrop[1] + t.sy * 0.5, pontoDrop[2]);
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
function pickObjectAt(sx: f64, sy: f64): number {
  return pickAt(vistaEditor, sx, sy);
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
let hierFilter = "";
let hierShown: number[] = [];
/// Quantos índices de `hierShown` valem neste quadro (o array é reaproveitado).
let hierShownN = 0;
// Rótulos refeitos só quando mudam (editor/rotulos.ts).
const rotTitulo = new RotuloPar(UI_ROTULOS.titlePrefix); const rotFps = new RotuloNumero(UI_ROTULOS.fpsPrefix, "");
const rotObjs = new RotuloNumero("", UI_ROTULOS.objCount); const rotResultados = new RotuloNumero("", UI_ROTULOS.results);
const rotStatusN = new RotuloNumero(UI_ROTULOS.statusSep, UI_ROTULOS.statusObjects); const rotStatus = new RotuloPar("");
const rotLinhas = new RotulosDeLinha(); let rotFilhoNome = ""; let rotFilhoTexto = "";
let fpsAtualizadoMs: f64 = 0.0 - 1.0e9;
/// 1 = arrastando o polegar da barra de scroll da hierarquia.
let hierBarDrag = 0;

let ctxOn = 0;
let ctxX = 0;
let ctxY = 0;
let ctxTarget = 0 - 1;

let hierLastClick = 0 - 1;      // duplo-clique na hierarquia (enquadra a câmera)
let hierLastClickMs: f64 = 0.0 - 999999.0;
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
ctrlServe(7777);
const host = instalarEditorReal();
// Editor.inspect(b, título) de um pacote abre `b` como janela no Inspector.
host.janela = (b: Behavior, titulo: string) => { inspector.abrirJanela(b, titulo); };
// Profiler LIGADO por padrão: o custo de medir é um `if` por seção, e a
// alternativa — descobrir onde o frame foi gasto adivinhando — já custou duas
// investigações erradas nesta engine. `prof off` desliga pela porta de controle.
profEnable(1);
// No uso interativo, limite a apresentação ao monitor: o editor não precisa
// renderizar centenas de frames idênticos por segundo. Benchmarks podem desligar
// o vsync explicitamente quando precisam medir o custo real do frame.
setVsync(WIN, 1);
// RTS_VSYNC=0 no ambiente: sem vsync desde o início, para medir o custo real do frame.
if (process.env("RTS_VSYNC") === "0") { vsyncOn = 0; setVsync(WIN, 0); }
S.win = WIN;
definirJanelaEntrada(WIN);
// áudio: se a máquina não tiver saída, `initAudio` devolve 0 e o editor segue mudo
initAudio();


io.print("[engine] cena '" + scene.name + "' com " + scene.count() + " objetos");
// Bench de quadro (RTS_BENCH=N, ver engine/core/frame_bench.ts); RTS_BENCH_SELECT
// escolhe o objeto selecionado, para medir o Inspector aberto.
if (benchInit() !== 0) {
  const sel = process.env("RTS_BENCH_SELECT");
  if (sel !== "") S.selected = parseInt(sel);
}

// Corpo de 1 frame numa FUNÇÃO — no motor, métodos de singleton importado
// (scene/S) despacham corretamente em função, não no top-level do while.
function frame(): void {
  // ── layout RESPONSIVO: lê o tamanho lógico atual da janela (segue o resize) ──
  logTick();   // avança o contador de frames do log
  // A aba vem da sessão: o clique na aba e o ws `gameview` escrevem S.gameView.
  workspaceViews.game = S.gameView !== 0;
  const nw = winWidth(WIN);
  const nh = winHeight(WIN);
  if (nw > 400) W = nw;
  if (nh > 300) H = nh;
  focalW = (H * 0.5) / math.tan(FOV * 0.5);
  // O RELÓGIO PRIMEIRO, antes de qualquer coisa do frame ler as horas. Uma
  // leitura do relógio do SO por frame, e todo mundo lê o mesmo instante — ver
  // engine/core/clock.ts para por que isso é correção e não só economia.
  clockTick();
  benchFrameBegin();
  profFrameBegin();
  secBegin(P_CTRL);
  ctrlPoll(W, H);   // ← controle da LLM por WebSocket (não-bloqueante)
  if (sceneDocument.pending.length > 0) helpOpen = 3;
  secEnd(P_CTRL);
  let dt: f64 = app.delta();
  if (dt > 100) dt = 100;
  const dts: f64 = dt / 1000.0;
  frames = frames + 1;

  if (INSP_W > W - UI_HIER_MIN - UI_SCENE_MIN_W) INSP_W = W - UI_HIER_MIN - UI_SCENE_MIN_W;
  if (INSP_W < UI_INSP_MIN) INSP_W = UI_INSP_MIN;
  if (HIER_W > W - INSP_W - UI_SCENE_MIN_W) HIER_W = W - INSP_W - UI_SCENE_MIN_W;
  if (HIER_W < UI_HIER_MIN) HIER_W = UI_HIER_MIN;
  if (ASSET_H > H - BAR_H - UI_SCENE_MIN_H - UI_STATUS_H) ASSET_H = H - BAR_H - UI_SCENE_MIN_H - UI_STATUS_H;
  if (ASSET_H < UI_PROJECT_MIN) ASSET_H = UI_PROJECT_MIN;

  // ── input de câmera (fly): WASD move, setas olham, espaço sobe ────────────
  const textEditing = app.hasTextFocus();
  const ctrlHeld = input.modCtrl(WIN);
  const flyInput = textEditing || ctrlHeld || addMenuOpen !== 0 || helpOpen !== 0 || workspaceViews.game ? 0 : 1;
  // Entrada dos scripts de jogo (controles de câmera): só com a aba Jogo ativa e
  // sem digitação/menus — senão disputariam o teclado com a navegação do editor
  // e com os campos do Inspector.
  definirEntradaAtiva(workspaceViews.game && !textEditing && addMenuOpen === 0 && helpOpen === 0 && menuOpen === 0);
  const kW = flyInput !== 0 ? app.keyDown(122) : 0;
  const kS = flyInput !== 0 ? app.keyDown(118) : 0;
  const kA = flyInput !== 0 ? app.keyDown(100) : 0;
  const kD = flyInput !== 0 ? app.keyDown(103) : 0;
  const kUp = flyInput !== 0 ? app.keyDown(5) : 0;
  const kDn = flyInput !== 0 ? app.keyDown(6) : 0;
  const kLf = flyInput !== 0 ? app.keyDown(7) : 0;
  const kRt = flyInput !== 0 ? app.keyDown(8) : 0;
  const kSp = flyInput !== 0 ? app.keyDown(3) : 0;

  const lookSpeed: f64 = 1.6 * dts;
  if (kLf !== 0) S.camYaw = S.camYaw - lookSpeed;
  if (kRt !== 0) S.camYaw = S.camYaw + lookSpeed;
  if (kUp !== 0) S.camPitch = S.camPitch - lookSpeed;
  if (kDn !== 0) S.camPitch = S.camPitch + lookSpeed;
  // olhar com o BOTÃO DIREITO do mouse (mouse-look estilo Unity fly)
  const mvdx: f64 = input.mouseDeltaX(WIN);
  const mvdy: f64 = input.mouseDeltaY(WIN);
  if (input.mouseDown(WIN, 1) && input.mouseX(WIN) > HIER_W &&
      input.mouseX(WIN) < W - INSP_W && input.mouseY(WIN) > BAR_H + 27 &&
      input.mouseY(WIN) < H - UI_STATUS_H - ASSET_H && menuOpen === 0 && helpOpen === 0 && !workspaceViews.game) {
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
  if (addMenuOpen === 0 && menuOpen === 0 && helpOpen === 0 && nfEditing() === 0 && !textEditing) {
    if (ctrlHeld) {
      if (app.keyPressed(118) !== 0 && S.simulating === 0) saveDocument();
      if (app.keyPressed(125) !== 0) history.undo();
      if (app.keyPressed(124) !== 0) history.redo();
      if (app.keyPressed(103) !== 0 && S.selected >= 0 && S.selected < scene.objects.length) {
        history.snapshot();
        const copy = cloneObject(scene.objects[S.selected]);
        copy.transform.px = copy.transform.px + 1.0;
        scene.add(copy);
        S.selected = scene.objects.length - 1;
      }
    } else {
      if (app.keyDown(116) !== 0) S.tool = 1;   // Q → Move
      if (app.keyDown(104) !== 0) S.tool = 2;   // E → Rotate
      if (app.keyDown(117) !== 0) S.tool = 3;   // R → Scale
      if (app.keyPressed(141) !== 0 && S.selected >= 0 && S.selected < scene.objects.length) app.focusAll(951);
      if (app.keyPressed(10) !== 0 && S.selected >= 0 && S.selected < scene.objects.length &&
          input.mouseX(WIN) < W - INSP_W && input.mouseY(WIN) > BAR_H &&
          input.mouseY(WIN) < H - UI_STATUS_H - ASSET_H) {
        history.snapshot();
        scene.removeAt(S.selected);
        if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
      }
    }
    const kFo = app.keyDown(105);             // F → focus (frame selected)
    if (kFo !== 0 && prevF === 0 && S.selected >= 0 && S.selected < scene.objects.length) frameObject(S.selected);
    prevF = kFo;
  } else {
    prevF = 0;
  }

  // ── UPDATE da cena (só quando S.playing) ────────────────────────────────────
  secBegin(P_FISICA);
  if (S.playing !== 0) {
    // PASSO FIXO: a física anda em 1/60 s, quantas vezes o tempo real pedir.
    // Antes ela andava com o `dts` do FRAME, o que a tornava não determinística
    // (máquina rápida e lenta divergem), sujeita a tunneling (a 7 fps o passo
    // era 100 ms, e um corpo em queda percorre meio metro nisso) e capaz de
    // criar energia do nada num frame travado. Ver engine/core/fixedstep.ts.
    const passos = stepsFor(dts);
    // O instantâneo é do estado NO INÍCIO do frame — e ele não custa um
    // `computeWorld`, porque o mundo já foi derivado no fim do frame anterior.
    // O render interpola entre esta foto e o estado final.
    if (passos > 0) snapshotWorld(scene);
    // `stepMore` e não `p < passos`: o teto de PASSOS não sabe quanto um passo
    // CUSTA, e a 4000 corpos na CPU um passo é 76 ms — cinco deles passam de 380
    // ms de frame com a defesa contra travamento ligada. O teto de
    // milissegundos corta os seguintes; o primeiro é intocável, senão o mundo
    // para e um mundo parado é indistinguível de um programa travado.
    let p = 0;
    while (stepMore(p, passos) !== 0) {
      // Num frame de 2+ passos o "anterior" da interpolação é o estado antes do
      // ÚLTIMO passo, não o do início do frame: `stepAlpha` é fração de UM
      // passo, e misturar por ela um intervalo de três faz o objeto andar a
      // velocidades diferentes conforme o frame — o tremor que a interpolação
      // existe para tirar. Custa um `computeWorld` a mais só nesses frames.
      if (p > 0 && p === passos - 1) { scene.computeWorld(); snapshotWorld(scene); }
      try { scene.update(FIXED_DT); }
      catch (error) { logError("Erro durante simulacao: " + String(error)); playMode.pause(); workspaceViews.console = true; break; }
      // A COLISÃO pode rodar na GPU. `rigidStep` responde 1 quando assumiu o
      // passo — e aí a varredura de pares da CPU não roda, porque seriam duas
      // físicas sobre o mesmo estado, a segunda vendo o que a primeira mexeu.
      //
      // A decisão fica AQUI, em quem dirige o frame, e não dentro da `Scene`: o
      // decisor precisa do tipo `Scene` para varrer os corpos, então a `Scene`
      // importá-lo de volta seria um ciclo. É a forma que o fluido já usa —
      // `decide.ts` é chamado pelo jogo, não pelo solver.
      //
      // Medido (release, headless, 500 corpos): 12,05 ms na CPU contra 0,35 ms
      // na GPU. Ver tools/claude-bench-gpu-vs-cpu.ts.
      if (rigidStep(scene, 0) === 0) scene.resolveCollisions();
      p = p + 1;
    }
    // O mundo final é derivado UMA vez, logo abaixo, depois de todos os passos.
    //
    // A primeira versão derivava o mundo e fotografava DENTRO do laço, uma vez
    // por passo. `computeWorld` custa 1,55 ms com 500 objetos, então com 2-3
    // passos num frame eram 3-5 ms de trabalho repetido — o editor caiu de 60
    // para 40-50 fps. Havia também um `computeWorld` AQUI, seguido do
    // incondicional lá embaixo: a mesma visita O(n) duas vezes por frame.
  }
  secEnd(P_FISICA);
  // PRÉVIA de animação do Inspector: fora do Play só avançam os players cuja
  // prévia está tocando (escrevem só a pose de trabalho; a cena salva não
  // muda). No Play, o `scene.update` acima já roda o AnimationPlayer normal, e
  // a prévia dos originais termina (pose de trabalho de volta à manual).
  previewFrame(dts);
  scene.computeWorld();
  // A fração de passo que sobrou, lida UMA vez por frame e DEPOIS do
  // `stepsFor`: lida no topo do frame ela era a fração do frame ANTERIOR, e o
  // desenho misturava o estado de agora com o alpha de um frame atrás.
  //
  // Parado, o desenho é o estado exato (alpha 1): o instantâneo é de quando a
  // física rodou pela última vez, e interpolar contra ele com o editor pausado
  // desenhava o objeto atrasado em relação ao gizmo que o arrasta.
  interpolateSync(scene);
  const alphaR: f64 = S.playing !== 0 ? stepAlpha() : 1.0;

  // ── PICKING + DRAG: pressionar seleciona; segurando, ARRASTA o objeto ───────
  const mPressed = input.mousePressed(WIN, 0) ? 1 : 0;
  // botão DIREITO: abre/fecha o menu de contexto da hierarquia
  const mRight = input.mousePressed(WIN, 1) ? 1 : 0;
  const mDownNow = input.mouseDown(WIN, 0) ? 1 : 0;
  const mx: f64 = input.mouseX(WIN);
  const my: f64 = input.mouseY(WIN);
  const inMenuSurface = menuOpen !== 0 && mx >= menuX && mx < menuX + UI_MENU_W &&
                        my >= UI_MENU_H && my < UI_MENU_H + UI_MENU_PADDING + menuEntries(menuOpen).length * UI_MENU_ROW_H;
  if (mPressed !== 0 && my > BAR_H && !inMenuSurface && helpOpen === 0) {
    if (mx >= HIER_W - 5 && mx <= HIER_W + 5) layoutDrag = 1;
    else if (mx >= W - INSP_W - 5 && mx <= W - INSP_W + 5) layoutDrag = 2;
    else if (mx > HIER_W && mx < W - INSP_W &&
             my >= H - UI_STATUS_H - ASSET_H - 5 && my <= H - UI_STATUS_H - ASSET_H + 5) layoutDrag = 3;
  }
  if (mDownNow === 0) layoutDrag = 0;
  if (layoutDrag === 1) HIER_W = math.max(UI_HIER_MIN, math.min(mx, W - INSP_W - UI_SCENE_MIN_W));
  if (layoutDrag === 2) INSP_W = math.max(UI_INSP_MIN, math.min(W - mx, W - HIER_W - UI_SCENE_MIN_W));
  if (layoutDrag === 3) ASSET_H = math.max(UI_PROJECT_MIN, math.min(H - UI_STATUS_H - my, H - BAR_H - UI_SCENE_MIN_H - UI_STATUS_H));
  let resizeCursor = 0;
  if (layoutDrag === 1 || layoutDrag === 2 ||
      (my > BAR_H && (math.abs(mx - HIER_W) <= 5 || math.abs(mx - (W - INSP_W)) <= 5))) resizeCursor = 5;
  else if (layoutDrag === 3 ||
           (mx > HIER_W && mx < W - INSP_W && math.abs(my - (H - UI_STATUS_H - ASSET_H)) <= 5)) resizeCursor = 6;
  input.setCursor(WIN, resizeCursor);
  const inSceneTools = mx >= HIER_W + UI_TOOL_X && mx < HIER_W + UI_TOOL_X + UI_TOOL_W + 12 &&
                       my >= BAR_H + UI_TOOL_Y && my < BAR_H + UI_TOOL_Y + UI_TOOL_H + 2;
  const inViewport = !workspaceViews.game && layoutDrag === 0 && helpOpen === 0 && !inMenuSurface && !inSceneTools &&
                     mx > HIER_W + 5 && mx < W - INSP_W - 5 &&
                     my > BAR_H + UI_SCENE_HEADER_H && my < H - UI_STATUS_H - ASSET_H - 5;
  // Arrastando um asset do Project? Então o botão esquerdo pertence AO DRAG:
  // nada de selecionar/mover objeto ou pegar eixo de gizmo neste frame.
  const dndOn = assetDragActive();
  const dndPay = assetDragPayload();
  const dndScript = dndOn !== 0 && dndPay.indexOf("script:") === 0;
  const scriptPath = dndScript ? subStr(dndPay, dndPay.indexOf(":") + 1, dndPay.length) : "";
  const dndTex = dndOn !== 0 && dndPay.charCodeAt(0) === 116 ? 1 : 0;      // "tex:"
  const dndModel = dndOn !== 0 && dndPay.charCodeAt(0) === 109 ? 1 : 0;    // "model:"
  const cpt2 = math.cos(S.camPitch); const spt2 = math.sin(S.camPitch);
  vistaDaSessao(vistaEditor, W, H, focalW);
  let scriptTarget = 0 - 1;
  if (dndScript && layoutDrag === 0 && helpOpen === 0 && menuOpen === 0 && ctxOn === 0 && addMenuOpen === 0) {
    if (inViewport) scriptTarget = pickObjectAt(mx, my);
    else if (mx >= 0 && mx < HIER_W && my >= HIER_LIST_TOP && my < H - UI_STATUS_H) scriptTarget = hierRowAt(my);
    else if (mx > W - INSP_W && mx < W && my > BAR_H && my < H - UI_STATUS_H) scriptTarget = S.selected;
  }
  const scriptError = dndScript ? scriptDropError(scriptPath, scriptTarget) : "";

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
        const ni = dropAssetInWorld(k0, p0, mx, my);
        if (ni >= 0) { previewIdx = ni; previewPay = dndPay; }
      }
    } else {
      movePreviewTo(mx, my);
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
  // OSSO selecionado no Inspector (Move/Rotate): o gizmo nasce no osso e o
  // arrasto mexe na pose manual dele. Scale continua escalando o objeto.
  // (selectedBoneTarget zera o osso se o selecionado não é mais o dono dele)
  const boneTarget = selectedBoneTarget();
  const boneSk = S.tool === TOOL_MOVE || S.tool === TOOL_ROTATE ? boneTarget : null;
  if (S.tool !== 0 && S.selected >= 0 && S.selected < scene.objects.length) {
    const go = scene.objects[S.selected];
    let owx: f64 = go.transform.wx; let owy: f64 = go.transform.wy; let owz: f64 = go.transform.wz;
    if (boneSk !== null && boneWorldOriginInto(boneGizmoOrigin, boneSk, S.selectedBone) !== 0) {
      owx = boneGizmoOrigin[0]; owy = boneGizmoOrigin[1]; owz = boneGizmoOrigin[2];
    }
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
      gizmoTela[0] = gzOx; gizmoTela[1] = gzOy; gizmoTela[2] = gzXx; gizmoTela[3] = gzXy;
      gizmoTela[4] = gzYx; gizmoTela[5] = gzYy; gizmoTela[6] = gzZx; gizmoTela[7] = gzZy; gizmoTela[GZ_LEN] = gzLen;
    }
  }

  if (mPressed !== 0 && inViewport && dndOn === 0) {
    // 1) tenta pegar um EIXO do gizmo (prioridade sobre selecionar outro objeto)
    let ax = 0 - 1;
    if (gzOK !== 0) ax = pickAxis(mx, my, gizmoTela);
    // 1b) HANDLES DE PLANO (só Move): arrastar 2 eixos. Checa se nenhum eixo foi pego.
    if (ax < 0 && gzOK !== 0 && S.tool === TOOL_MOVE) {
      const hxyX = gzOx + (gzXx - gzOx) * 0.4 + (gzYx - gzOx) * 0.4; const hxyY = gzOy + (gzXy - gzOy) * 0.4 + (gzYy - gzOy) * 0.4;
      const hxzX = gzOx + (gzXx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hxzY = gzOy + (gzXy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      const hyzX = gzOx + (gzYx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hyzY = gzOy + (gzYy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      if (mx > hxyX - 8.0 && mx < hxyX + 8.0 && my > hxyY - 8.0 && my < hxyY + 8.0) ax = 3;       // plano XY
      else if (mx > hxzX - 8.0 && mx < hxzX + 8.0 && my > hxzY - 8.0 && my < hxzY + 8.0) ax = 4;  // plano XZ
      else if (mx > hyzX - 8.0 && mx < hyzX + 8.0 && my > hyzY - 8.0 && my < hyzY + 8.0) ax = 5;  // plano YZ
    }
    // 1c) ÍCONE de gizmo (retângulo do frame anterior, o que está na tela): seleciona o dono
    const iconeDono = ax < 0 ? gizmoIconAt(gizmosDoEditor, mx, my) : 0 - 1;
    if (iconeDono >= 0) { S.selected = iconeDono; S.selection = [iconeDono]; }
    if (ax >= 0) {
      gizmoAxis = ax;
      // osso: 1 snapshot por arrasto (não por frame) e a prévia do objeto para
      if (boneSk !== null) boneDrag.begin(boneSk, S.selectedBone);
    } else if (iconeDono < 0) {
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
  if (mDownNow === 0) { dragging = 0; gizmoAxis = 0 - 1; boneDrag.end(); }

  // ── ARRASTO RESTRITO AO EIXO/PLANO (Move/Rotate/Scale conforme S.tool) ──
  // seleção efetiva: a lista S.selection (multi) ou só [S.selected]. O delta do
  // gizmo é aplicado a TODOS (rotate/scale usam o centro de cada um — "pivot individual").
  const nsel = S.selection.length > 0 ? S.selection.length : 1;
  if (boneDrag.active() && gizmoAxis >= 0 && mDownNow !== 0 && gzOK !== 0) {
    // OSSO: só o osso do objeto selecionado (a multi-seleção não se aplica)
    worldDirty = 1;
    const dmx: f64 = mx - lastMx; const dmy: f64 = my - lastMy;
    if (gizmoAxis >= 3) {
      const mX = gizmoAxis === 5 ? 0.0 : axisMove(dmx, dmy, gizmoTela, 0);
      const mY = gizmoAxis === 4 ? 0.0 : axisMove(dmx, dmy, gizmoTela, 1);
      const mZ = gizmoAxis === 3 ? 0.0 : axisMove(dmx, dmy, gizmoTela, 2);
      boneDrag.move(mX, mY, mZ);
    } else {
      const mv = axisMove(dmx, dmy, gizmoTela, gizmoAxis);
      if (S.tool === TOOL_MOVE) boneDrag.move(gizmoAxis === 0 ? mv : 0.0, gizmoAxis === 1 ? mv : 0.0, gizmoAxis === 2 ? mv : 0.0);
      else boneDrag.rotate(gizmoAxis, mv * GIZMO_ROTATE_PER_UNIT);
    }
    lastMx = mx; lastMy = my;
  } else if (gizmoAxis >= 3 && mDownNow !== 0 && gzOK !== 0 && scene.objects.length > 0) {
    worldDirty = 1;   // o gizmo vai mover algo: refaz o computeWorld antes do render
    // PLANO (só Move): move nos DOIS eixos do plano (3=XY, 4=XZ, 5=YZ).
    const dmx: f64 = mx - lastMx; const dmy: f64 = my - lastMy;
    const mX = axisMove(dmx, dmy, gizmoTela, 0);
    const mY = axisMove(dmx, dmy, gizmoTela, 1);
    const mZ = axisMove(dmx, dmy, gizmoTela, 2);
    let si = 0;
    while (si < nsel) {
      const idx = S.selection.length > 0 ? S.selection[si] : S.selected;
      if (idx >= 0 && idx < scene.objects.length) {
        const so = scene.objects[idx];
        if (gizmoAxis === 3) { so.transform.px = so.transform.px + mX; so.transform.py = so.transform.py + mY; }
        if (gizmoAxis === 4) { so.transform.px = so.transform.px + mX; so.transform.pz = so.transform.pz + mZ; }
        if (gizmoAxis === 5) { so.transform.py = so.transform.py + mY; so.transform.pz = so.transform.pz + mZ; }
        if (S.snap !== 0) { so.transform.px = snapv(so.transform.px, SNAP_MOVE_STEP); so.transform.py = snapv(so.transform.py, SNAP_MOVE_STEP); so.transform.pz = snapv(so.transform.pz, SNAP_MOVE_STEP); }
      }
      si = si + 1;
    }
    lastMx = mx; lastMy = my;
  } else if (gizmoAxis >= 0 && mDownNow !== 0 && gzOK !== 0 && scene.objects.length > 0) {
    worldDirty = 1;
    const mv = axisMove(mx - lastMx, my - lastMy, gizmoTela, gizmoAxis);
    let si = 0;
    while (si < nsel) {
      const idx = S.selection.length > 0 ? S.selection[si] : S.selected;
      if (idx >= 0 && idx < scene.objects.length) {
        const so = scene.objects[idx];
        if (S.tool === TOOL_MOVE) {
          if (gizmoAxis === 0) so.transform.px = so.transform.px + mv;
          if (gizmoAxis === 1) so.transform.py = so.transform.py + mv;
          if (gizmoAxis === 2) so.transform.pz = so.transform.pz + mv;
          if (so.stationary !== 0) scene.markCollidersDirty();
        } else if (S.tool === TOOL_SCALE) {
          const sc: f64 = mv * 0.6;
          if (gizmoAxis === 0) so.transform.sx = so.transform.sx + sc;
          if (gizmoAxis === 1) so.transform.sy = so.transform.sy + sc;
          if (gizmoAxis === 2) so.transform.sz = so.transform.sz + sc;
          if (so.transform.sx < 0.05) so.transform.sx = 0.05;
          scene.markCollidersDirty();   // a escala define o raio de colisão (cacheado)
          if (so.transform.sy < 0.05) so.transform.sy = 0.05;
          if (so.transform.sz < 0.05) so.transform.sz = 0.05;
        } else if (S.tool === TOOL_ROTATE) {
          const rt: f64 = mv * GIZMO_ROTATE_PER_UNIT;
          if (gizmoAxis === 0) so.transform.rx = so.transform.rx + rt;
          if (gizmoAxis === 1) so.transform.ry = so.transform.ry + rt;
          if (gizmoAxis === 2) so.transform.rz = so.transform.rz + rt;
          if (so.stationary !== 0) scene.markCollidersDirty();
        }
        // SNAP to grid (move 0.5 / rotate 15°=~0.2618 rad)
        if (S.snap !== 0 && S.tool === TOOL_MOVE) {
          so.transform.px = snapv(so.transform.px, SNAP_MOVE_STEP); so.transform.py = snapv(so.transform.py, SNAP_MOVE_STEP); so.transform.pz = snapv(so.transform.pz, SNAP_MOVE_STEP);
        } else if (S.snap !== 0 && S.tool === TOOL_ROTATE) {
          so.transform.rx = snapv(so.transform.rx, SNAP_ROTATE_STEP); so.transform.ry = snapv(so.transform.ry, SNAP_ROTATE_STEP); so.transform.rz = snapv(so.transform.rz, SNAP_ROTATE_STEP);
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
  // Aba Jogo: as câmeras da cena como no jogo exportado (game.ts), na área da
  // vista com faixas pela proporção; o retângulo de cada câmera (screenPointToRay)
  // passa a ser o da aba. Sem câmera, ou na aba Cena, a câmera do editor.
  const cenaX = HIER_W; const cenaY = BAR_H + UI_SCENE_HEADER_H;
  const cenaW = W - HIER_W - INSP_W; const cenaH = H - UI_STATUS_H - ASSET_H - cenaY;
  let nJogo = 0; let nPrevia = 0;
  if (workspaceViews.game) {
    areaCena[0] = cenaX; areaCena[1] = cenaY; areaCena[2] = cenaW; areaCena[3] = cenaH;
    areaComFaixas(areaCena, UI_GAME_VIEW.aspectRatios[S.gameAspect], vistasJogo.area);
    vistasJogo.tela[0] = W; vistasJogo.tela[1] = H;
    nJogo = coletarCameras(vistasJogo, scene, workspaceViews.cameraEscolhida());
    if (nJogo > 0) { aplicarVistas(WIN, vistasJogo); posicaoDaVista(vistasJogo, luzCam); frustumDasVistas(vistasJogo, fParams); }
  }
  workspaceViews.hasCamera = nJogo > 0;
  const selPrevia = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
  if (nJogo === 0) {
    workspaceViews.camera(FOV);
    setViewportBuf(WIN, VISTA_CHEIA); setFundoCeu(WIN);
    camEditor[0] = workspaceViews.x; camEditor[1] = workspaceViews.y; camEditor[2] = workspaceViews.z;
    camEditor[3] = workspaceViews.yaw; camEditor[4] = workspaceViews.pitch; camEditor[5] = workspaceViews.fov; camEditor[6] = W / H;
    setCamBuf(WIN, camEditor);
    luzCam[0] = workspaceViews.x; luzCam[1] = workspaceViews.y; luzCam[2] = workspaceViews.z;
    // Prévia: a câmera selecionada num quadro no canto da vista de Cena.
    // (só se o quadro cabe na vista de Cena com as margens)
    if (!workspaceViews.game && S.cameraPreview !== 0 && selPrevia !== null && selPrevia.camIdx >= 0 &&
        cenaW >= UI_CAMERA_PREVIEW.w + UI_CAMERA_PREVIEW.margin * 2 && cenaH >= UI_CAMERA_PREVIEW.h + UI_CAMERA_PREVIEW.margin * 2) {
      vistasPrevia.area[0] = cenaX + cenaW - UI_CAMERA_PREVIEW.w - UI_CAMERA_PREVIEW.margin;
      vistasPrevia.area[1] = cenaY + cenaH - UI_CAMERA_PREVIEW.h - UI_CAMERA_PREVIEW.margin;
      vistasPrevia.area[2] = UI_CAMERA_PREVIEW.w; vistasPrevia.area[3] = UI_CAMERA_PREVIEW.h;
      vistasPrevia.tela[0] = W; vistasPrevia.tela[1] = H;
      // o retângulo de runtime da câmera (screenPointToRay no Play) não vira o do canto
      nPrevia = prepararPrevia(vistasPrevia, scene, selPrevia.behaviors[selPrevia.camIdx] as Camera, retanguloPrevia);
      if (nPrevia > 0) { aplicarVistas(WIN, vistasPrevia); frustumDaVista(vistasPrevia.camBuf, fParams2); }
      restaurarPrevia(vistasPrevia, retanguloPrevia);
    }
  }
  luzLegada[0] = S.lightX; luzLegada[1] = S.lightY; luzLegada[2] = S.lightZ; luzLegada[3] = S.lightAmb;
  aplicarLuzes(WIN, scene, luzCam, luzLegada);
  aplicarAmbiente(WIN, scene);   // DEPOIS de aplicarLuzes: usa ultimaN/luzBuf de lá como fallback do sol
  // Frustum do frame calculado UMA vez (antes: 5 chamadas trig por objeto).
  secBegin(P_MUNDO3D);
  if (nJogo === 0) frustumBeginBuf(camEditor);
  // Sincroniza a flag de seleção UMA vez por frame (custo O(n + |seleção|)),
  // em vez de o render varrer a lista inteira por objeto visível (O(n × |sel|)).
  // Feito aqui, num ponto só, porque a seleção é mexida em vários lugares.
  syncSelFlags();
  if (workspaceViews.game) { let i = 0; while (i < scene.objects.length) { scene.objects[i].selFlag = 0; i = i + 1; } }
  // Sem `oi`/`drawnN` aqui: o laço inteiro virou UMA função livre tipada
  // (`drawSceneObjects`, no topo do módulo) e o contador volta pelo retorno.
  // A nota longa que estava aqui — hoistar o array, anotar `GameObject[]` para
  // o campo virar offset constante — continua valendo e mora lá, aplicada aos
  // PARÂMETROS, que é onde ela finalmente rende os 3× medidos.
  const objs: GameObject[] = scene.objects;
  // Os 9 números do frustum que `frustumBegin` acabou de preparar, lidos UMA vez
  // por frame para um array reaproveitado (ver `frustumParams` em gpu3d.ts).
  if (nJogo === 0) frustumParams(fParams);
  // duas vistas (Cena + prévia) numa fila só: desenha o que está em QUALQUER dos dois frustums
  definirSegundaVista(nPrevia > 0 ? 1 : 0);
  prepararDesenho(desenhoCfg, fParams, workspaceViews.game ? -1 : S.selected, alphaR);
  const drawnN = drawSceneObjects(scene, workspaceViews.game && !workspaceViews.hasCamera ? 0 : objs.length, WIN, desenhoCfg);
  // GIZMOS dos componentes (onDrawGizmos + desenhadores por tipo), por cima do 3D
  if (!workspaceViews.game) {
    gizmoPose[0] = S.camX; gizmoPose[1] = S.camY; gizmoPose[2] = S.camZ; gizmoPose[3] = S.camYaw; gizmoPose[4] = S.camPitch;
    gizmoPose[5] = FOV; gizmoPose[6] = W; gizmoPose[7] = H;
    gizmosBegin(gizmosDoEditor, gizmoPose);
    gizmosDoEditor.lado = UI_GIZMO.iconSize;
    coletarGizmos(gizmosDoEditor, scene, S.selected);
    pintarGizmos(app, WIN, gizmosDoEditor);
  }
  // Moldura (só contorno) e nome da câmera da prévia, por cima do 3D.
  if (nPrevia > 0 && selPrevia !== null) {
    const pa = vistasPrevia.area; const bd = UI_CAMERA_PREVIEW.border;
    pincel(0, bd, UI_C.previewBorder, 0); caixa(pa[0] - bd, pa[1] - bd, pa[2] + bd * 2, pa[3] + bd * 2);
    if (previaTitulo.length === 0 || previaTituloDe !== selPrevia.name) { previaTituloDe = selPrevia.name; previaTitulo = UI_CAMERA_PREVIEW.titlePrefix + selPrevia.name; }
    texto(pa[0] + UI_WORKSPACE.padding, pa[1] + UI_CAMERA_PREVIEW.titleY, previaTitulo, estiloTexto(UI_C.primaryText, UI_CAMERA_PREVIEW.font));
  }
  secEnd(P_MUNDO3D);
  secBegin(P_UI);
  secBegin(P_UI_GIZ);
  S.drawnLast = drawnN;   // nº de objetos desenhados neste frame (diagnóstico via ws 'dbg')
  // UI do JOGO (UIText/UIButton da cena) aparece no Play, como na build.
  if (S.simulating !== 0) drawGameUI(scene, WIN, W, H);

  // ── GIZMO 2D: eixos X/Y/Z coloridos sobre a viewport (over o 3D, sob a UI). O
  // eixo pego fica destacado (branco). Move/Rotate/Scale usam os mesmos eixos. ──
  if (gzOK !== 0 && !workspaceViews.game) {
    const cX = gizmoAxis === 0 ? UI_C.white : UI_C.axisX;   // X vermelho
    const cY = gizmoAxis === 1 ? UI_C.white : UI_C.axisY;   // Y verde
    const cZ = gizmoAxis === 2 ? UI_C.white : UI_C.axisZ;   // Z azul
    // eixos = handles de pick (sempre visíveis)
    traco(3, cX); linha(gzOx, gzOy, gzXx, gzXy);
    traco(3, cY); linha(gzOx, gzOy, gzYx, gzYy);
    traco(3, cZ); linha(gzOx, gzOy, gzZx, gzZy);
    if (S.tool === TOOL_SCALE) {
      // handles-CUBO grandes nas pontas (estilo Scale da Unity)
      { pincel(cX, 0, 0, 1); caixa(gzXx - 5, gzXy - 5, 10, 10); }
      pincel(cY, 0, 0, 1); caixa(gzYx - 5, gzYy - 5, 10, 10);
      pincel(cZ, 0, 0, 1); caixa(gzZx - 5, gzZy - 5, 10, 10);
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
        const xa = anelA; const xb = anelB;
        pontoMundo[0] = gzWx; pontoMundo[1] = gzWy + c0 * rr; pontoMundo[2] = gzWz + s0 * rr; projPt(xa, vistaEditor, pontoMundo);
        pontoMundo[0] = gzWx; pontoMundo[1] = gzWy + c1 * rr; pontoMundo[2] = gzWz + s1 * rr; projPt(xb, vistaEditor, pontoMundo);
        if (xa[2] > 0.5 && xb[2] > 0.5) { traco(2, cX); linha(xa[0], xa[1], xb[0], xb[1]); }
        // Y-ring (plano XZ): (cos, 0, sin)
        const ya = anelA; const yb = anelB;
        pontoMundo[0] = gzWx + c0 * rr; pontoMundo[1] = gzWy; pontoMundo[2] = gzWz + s0 * rr; projPt(ya, vistaEditor, pontoMundo);
        pontoMundo[0] = gzWx + c1 * rr; pontoMundo[1] = gzWy; pontoMundo[2] = gzWz + s1 * rr; projPt(yb, vistaEditor, pontoMundo);
        if (ya[2] > 0.5 && yb[2] > 0.5) { traco(2, cY); linha(ya[0], ya[1], yb[0], yb[1]); }
        // Z-ring (plano XY): (cos, sin, 0)
        const za = anelA; const zb = anelB;
        pontoMundo[0] = gzWx + c0 * rr; pontoMundo[1] = gzWy + s0 * rr; pontoMundo[2] = gzWz; projPt(za, vistaEditor, pontoMundo);
        pontoMundo[0] = gzWx + c1 * rr; pontoMundo[1] = gzWy + s1 * rr; pontoMundo[2] = gzWz; projPt(zb, vistaEditor, pontoMundo);
        if (za[2] > 0.5 && zb[2] > 0.5) { traco(2, cZ); linha(za[0], za[1], zb[0], zb[1]); }
        seg = seg + 1;
      }
    } else {
      // MOVE: pontas dos eixos + HANDLES DE PLANO (arrastar 2 eixos)
      { pincel(cX, 0, 0, 1); caixa(gzXx - 3, gzXy - 3, 7, 7); }
      pincel(cY, 0, 0, 1); caixa(gzYx - 3, gzYy - 3, 7, 7);
      pincel(cZ, 0, 0, 1); caixa(gzZx - 3, gzZy - 3, 7, 7);
      const hxyX = gzOx + (gzXx - gzOx) * 0.4 + (gzYx - gzOx) * 0.4; const hxyY = gzOy + (gzXy - gzOy) * 0.4 + (gzYy - gzOy) * 0.4;
      const hxzX = gzOx + (gzXx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hxzY = gzOy + (gzXy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      const hyzX = gzOx + (gzYx - gzOx) * 0.4 + (gzZx - gzOx) * 0.4; const hyzY = gzOy + (gzYy - gzOy) * 0.4 + (gzZy - gzOy) * 0.4;
      pincel(gizmoAxis === 3 ? UI_C.axisSelected : UI_C.axisXY, 0, 0, 1); caixa(hxyX - 6, hxyY - 6, 12, 12);   // XY
      pincel(gizmoAxis === 4 ? UI_C.axisSelected : UI_C.axisXZ, 0, 0, 1); caixa(hxzX - 6, hxzY - 6, 12, 12);   // XZ
      pincel(gizmoAxis === 5 ? UI_C.axisSelected : UI_C.axisYZ, 0, 0, 1); caixa(hyzX - 6, hyzY - 6, 12, 12);   // YZ
    }
    pincel(UI_C.gizmoCenter, 0, 0, 1); caixa(gzOx - 3, gzOy - 3, 6, 6); // centro
  }

  secEnd(P_UI_GIZ);
  secBegin(P_UI_BAR);
  // ═══ EDITOR UI (estilo Unity) ══════════════════════════════════════════════
  // toolbar
  pincel(UI_C.toolbar, 0, 0, 0); caixa(0, 0, W, BAR_H);
  pincel(UI_C.panelHeader, 0, 0, 0); caixa(0, 0, W, UI_MENU_H);
  traco(1, UI_C.border); linha(0, UI_MENU_H, W, UI_MENU_H);
  traco(1, UI_C.border); linha(0, BAR_H, W, BAR_H);
  let mt = 0;
  let menuButtonX = UI_MENU_START_X;
  while (mt < UI_MENU_NAMES.length) {
    const st = app.clickable(menuButtonX, 2, UI_MENU_BUTTON_W[mt], UI_MENU_H - 4);
    if (st === 1 || st === 2 || menuOpen === mt + 1) {
      pincel(menuOpen === mt + 1 ? UI_C.menuOpen : UI_C.controlHover, 0, 0, 3); caixa(menuButtonX, 2, UI_MENU_BUTTON_W[mt], UI_MENU_H - 4);
    }
    texto(menuButtonX + 7, 5, UI_MENU_NAMES[mt], estiloTexto(UI_C.menuText, 12));
    if (st === 3) {
      menuOpen = menuOpen === mt + 1 ? 0 : mt + 1;
      menuX = menuButtonX;
    }
    menuButtonX = menuButtonX + UI_MENU_BUTTON_W[mt] + UI_MENU_GAP;
    mt = mt + 1;
  }
  texto(14, 39, rotTitulo.de(scene.name, sceneDocument.dirty ? UI_ROTULOS.dirtyMark : ""), estiloTexto(UI_C.brandText, 16));

  playToolbar.render(W, menuOpen !== 0 || helpOpen !== 0 || addMenuOpen !== 0);

  // — BUILD: gera o .exe do JOGO (game.ts + assets), não o editor —
  // Acompanhe resultado e pasta do pacote pelo Console.
  const bxBuild = W - 260;
  const stBuild = S.simulating === 0 ? app.clickable(bxBuild, UI_CONTROL_Y, 52, UI_CONTROL_H) : 0;
  let fBuild = UI_C.buildIdle;                       // verde: é a ação de "publicar"
  if (stBuild === 1) fBuild = UI_C.buildHover;
  if (editorBuild.running) fBuild = UI_C.controlActive;
  if (S.simulating !== 0) fBuild = UI_C.controlIdle;
  pincel(fBuild, 1, UI_C.border, 3); caixa(bxBuild, UI_CONTROL_Y, 52, UI_CONTROL_H);
  texto(bxBuild + 8, 39, "Build", estiloTexto(S.simulating === 0 ? UI_C.buildText : UI_C.disabledText, 12));
  if (stBuild === 3 && menuOpen === 0 && helpOpen === 0 && S.simulating === 0) {
    startBuild();
  }

  // Ações de arquivo e histórico ficam juntas à direita.
  const bxSave = W - 204;
  const stSave = S.simulating === 0 ? app.clickable(bxSave, UI_CONTROL_Y, 48, UI_CONTROL_H) : 0;
  pincel(stSave === 1 ? UI_C.controlHover : UI_C.controlIdle, 1, UI_C.border, 3); caixa(bxSave, UI_CONTROL_Y, 48, UI_CONTROL_H);
  texto(bxSave + 7, 39, "Salvar", estiloTexto(S.simulating === 0 ? UI_C.primaryText : UI_C.disabledText, 11));
  if (stSave === 3 && menuOpen === 0 && helpOpen === 0 && S.simulating === 0) saveDocument();
  const bxUndo = W - 152;
  const stUndoB = app.clickable(bxUndo, UI_CONTROL_Y, 34, UI_CONTROL_H);
  pincel(stUndoB === 1 ? UI_C.controlHover : UI_C.controlIdle, 1, UI_C.border, 3); caixa(bxUndo, UI_CONTROL_Y, 34, UI_CONTROL_H);
  texto(bxUndo + 11, 38, "<", estiloTexto(UI_C.primaryText, 15));
  if (stUndoB === 3 && menuOpen === 0 && helpOpen === 0) history.undo();
  const bxRedo = W - 114;
  const stRedoB = app.clickable(bxRedo, UI_CONTROL_Y, 34, UI_CONTROL_H);
  pincel(stRedoB === 1 ? UI_C.controlHover : UI_C.controlIdle, 1, UI_C.border, 3); caixa(bxRedo, UI_CONTROL_Y, 34, UI_CONTROL_H);
  texto(bxRedo + 11, 38, ">", estiloTexto(UI_C.primaryText, 15));
  if (stRedoB === 3 && menuOpen === 0 && helpOpen === 0) history.redo();

  // publica pro ws `dbg` (medir perf sem screenshot); o rótulo muda a cada UI_ROTULOS.fpsMs, não por quadro
  if (clockNow() - fpsAtualizadoMs >= UI_ROTULOS.fpsMs) { fpsAtualizadoMs = clockNow(); S.fpsLast = math.floor(app.fps()); }
  texto(W - 74, 39, rotFps.de(S.fpsLast), estiloTexto(UI_C.secondaryText, 12));

  // Ferramentas de transformação pertencem à vista de cena, como um overlay.
  const sceneX = HIER_W;
  const sceneW = W - HIER_W - INSP_W;
  pincel(UI_C.sceneHeader, 0, 0, 0); caixa(sceneX, BAR_H, sceneW, UI_SCENE_HEADER_H);
  if (!workspaceViews.game) {
  pincel(UI_C.toolBack, 1, UI_C.toolBackBorder, 5); caixa(sceneX + UI_TOOL_X, BAR_H + UI_TOOL_Y, UI_TOOL_W, UI_TOOL_H);
  let ti = 0;
  while (ti < UI_TOOLS.length) {
    const tx = sceneX + UI_TOOL_X + 6 + ti * UI_TOOL_BUTTON_STEP;
    const ty = BAR_H + UI_TOOL_Y + 4;
    const st = app.clickable(tx, ty, UI_TOOL_BUTTON_W, UI_TOOL_BUTTON_H);
    let active = 0;
    if (ti === 0 && S.tool === TOOL_MOVE) active = 1;
    if (ti === 1 && S.tool === TOOL_ROTATE) active = 1;
    if (ti === 2 && S.tool === TOOL_SCALE) active = 1;
    if (ti === 3 && S.snap !== 0) active = 1;
    pincel(active !== 0 ? UI_C.controlActive : st === 1 ? UI_C.toolHover : UI_C.toolIdle, 1, UI_C.toolBorder, 3); caixa(tx, ty, UI_TOOL_BUTTON_W, UI_TOOL_BUTTON_H);
    texto(tx + 7, ty + 6, UI_TOOLS[ti], estiloTexto(UI_C.toolText, 12));
    if (st === 3 && menuOpen === 0 && helpOpen === 0) {
      if (ti === 0) S.tool = TOOL_MOVE;
      else if (ti === 1) S.tool = TOOL_ROTATE;
      else if (ti === 2) S.tool = TOOL_SCALE;
      else S.snap = S.snap !== 0 ? 0 : 1;
    }
    ti = ti + 1;
  }

  }
  secEnd(P_UI_BAR);
  secBegin(P_UI_HIER);
  // ── hierarquia (esquerda) ──────────────────────────────────────────────────
  pincel(UI_C.panel, 0, 0, 0); caixa(0, BAR_H, HIER_W, H - BAR_H);
  traco(1, UI_C.border); linha(HIER_W, BAR_H, HIER_W, H);
  // header/tab
  pincel(UI_C.panelHeader, 0, 0, 0); caixa(0, BAR_H, HIER_W, UI_HIER_HEADER_H);
  pincel(UI_C.panelTab, 0, 0, 3); caixa(4, BAR_H + 2, 88, 20);
  texto(12, BAR_H + 5, "Hierarquia", estiloTexto(UI_C.panelTitle, 12));
  texto(HIER_W - 52, BAR_H + 5, rotObjs.de(scene.objects.length), estiloTexto(UI_C.panelCount, 11));
  traco(1, UI_C.border); linha(0, BAR_H + UI_HIER_HEADER_H, HIER_W, BAR_H + UI_HIER_HEADER_H);

  app.at(8, BAR_H + 28, 72, 22);
  if (menuOpen === 0 && helpOpen === 0 && app.button("+ Criar")) {
    ctxOn = 1; ctxX = 8; ctxY = BAR_H + 28; ctxTarget = 0 - 1;
  }
  const oldFilter = hierFilter;
  app.at(86, BAR_H + 29, HIER_W - 114, 0);
  hierFilter = app.textField(952, hierFilter, menuOpen === 0 && helpOpen === 0);
  if (hierFilter.length === 0 && !app.isFocused(952)) texto(92, BAR_H + 33, "Buscar...", estiloTexto(UI_C.placeholder, 11));
  app.at(HIER_W - 25, BAR_H + 29, 20, 20);
  if (hierFilter.length > 0 && app.button("x")) {
    hierFilter = "";
    app.setFocus(0 - 1);
  }
  if (hierFilter !== oldFilter) { hierScroll = 0; S.hierScroll = 0; }
  hierShownN = 0;
  if (hierFilter.length > 0) {
    let fi = 0;
    while (fi < scene.objects.length) {
      if (containsCI(scene.objects[fi].name, hierFilter)) {
        if (hierShownN < hierShown.length) hierShown[hierShownN] = fi; else hierShown.push(fi);
        hierShownN = hierShownN + 1;
      }
      fi = fi + 1;
    }
  }
  const totalRows = hierFilter.length > 0 ? hierShownN : scene.objects.length;
  if (hierFilter.length > 0) texto(14, BAR_H + 60, rotResultados.de(totalRows), estiloTexto(UI_C.searchResult, 11));
  else texto(14, BAR_H + 60, "Duplo clique enquadra  •  arraste organiza", estiloTexto(UI_C.hint, 11));

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
  const visRows = ((H - HIER_LIST_TOP) / UI_HIER_ROW_H) | 0;
  S.hierVis = visRows;
  if (S.hierScroll !== hierScroll) hierScroll = S.hierScroll;   // veio do WS
  let maxScroll = totalRows - visRows;
  if (maxScroll < 0) maxScroll = 0;
  const overHier = mx < HIER_W && my >= HIER_LIST_TOP;
  if (overHier) {
    const wh: f64 = input.wheel(WIN);
    if (wh > 0.5) hierScroll = hierScroll - UI_HIER_SCROLL_STEP;
    else if (wh < 0.0 - 0.5) hierScroll = hierScroll + UI_HIER_SCROLL_STEP;
  }
  if (hierScroll > maxScroll) hierScroll = maxScroll;
  if (hierScroll < 0) hierScroll = 0;
  S.hierScroll = hierScroll;

  const hRowFirst = hierScroll;
  let hRowLast = hierScroll + visRows;
  if (hRowLast > totalRows) hRowLast = totalRows;
  let row = hRowFirst;
  while (row < hRowLast) {
    const hi = hierFilter.length > 0 ? hierShown[row] : row;
    const obj = scene.objects[hi];
    let depth = 0;
    let pp = obj.parent;
    while (pp >= 0 && depth < 8 && hierFilter.length === 0) { depth = depth + 1; pp = scene.objects[pp].parent; }
    const indent = depth * UI_HIER_INDENT;
    const ry0 = HIER_LIST_TOP + (row - hierScroll) * UI_HIER_ROW_H;
    const inRow = layoutDrag === 0 && menuOpen === 0 && helpOpen === 0 &&
                  mx < HIER_W - 10 && my >= ry0 && my < ry0 + UI_HIER_ROW_H;
    // botão DIREITO sobre a linha: abre o menu de contexto mirando este objeto
    if (mRight !== 0 && inRow && dndOn === 0) {
      ctxOn = 1; ctxX = mx | 0; ctxY = my | 0; ctxTarget = hi; S.selected = hi;
    }
    if (mPressed !== 0 && inRow && dndOn === 0) {
      // duplo-clique = enquadra a câmera no objeto (Unity "F"); simples = seleciona
      const nowClick = clockNow();
      const dbl = (hi === hierLastClick && nowClick - hierLastClickMs < DOUBLE_CLICK_MS) ? 1 : 0;
      hierDrag = hi; S.selected = hi;
      if (dbl !== 0) frameObject(hi);
      hierLastClick = hi; hierLastClickMs = nowClick;
    }
    // detecta a zona de drop enquanto arrasta
    if (hierDrag >= 0 && inRow) {
      const local: f64 = my - ry0;
      if (local < UI_HIER_DROP_EDGE) { dropIdx = hi; dropMode = 1; dropLineY = ry0; }
      else if (local >= UI_HIER_ROW_H - UI_HIER_DROP_EDGE) {
        dropIdx = hi; dropMode = 3; dropLineY = ry0 + UI_HIER_ROW_H;
      }
      else { dropIdx = hi; dropMode = 2; }
    }
    let fill = UI_C.rowIdle;
    if (hi === S.selected) fill = UI_C.controlActive;
    if (hierDrag < 0 && inRow) fill = UI_C.controlHover;
    if (hierDrag >= 0 && dropMode === 2 && dropIdx === hi && hi !== hierDrag) fill = UI_C.rowDropTarget; // vira filho
    // arrastando uma TEXTURA do Project sobre esta linha → alvo do drop
    if (dndOn !== 0 && inRow && dndTex !== 0) fill = UI_C.rowDropTarget;
    if (dndScript && scriptTarget === hi && scriptError.length === 0) fill = UI_C.rowDropTarget;
    pincel(fill, 0, 0, 5); caixa(8 + indent, ry0 + 1, HIER_W - 16 - indent, UI_HIER_ROW_H - 2);
    if (depth > 0) texto(8 + indent - 12, ry0 + 5, "└", estiloTexto(UI_C.hierarchyBranch, 14));
    let icon = "[C]";
    if (obj.meshKind === 2) icon = "[P]";
    if (obj.meshKind === 3) icon = "[O]";
    if (obj.meshKind === 4) icon = "[S]";
    texto(14 + indent, ry0 + 6, rotLinhas.de(hi, icon, obj.name, obj.meshKind), estiloTexto(UI_C.primaryText, 13));
    row = row + 1;
  }
  if (totalRows === 0) texto(14, HIER_LIST_TOP + 12, "Nenhum objeto encontrado", estiloTexto(UI_C.emptyText, 12));
  // clique DIREITO na área vazia da hierarquia: menu criando na RAIZ
  if (mRight !== 0 && mx < HIER_W && my > HIER_LIST_TOP && dndOn === 0) {
    let overRow = 0;
    if (my < HIER_LIST_TOP + (hRowLast - hierScroll) * UI_HIER_ROW_H) overRow = 1;
    if (overRow === 0) { ctxOn = 1; ctxX = mx | 0; ctxY = my | 0; ctxTarget = 0 - 1; }
  }
  // ── BARRA DE SCROLL ───────────────────────────────────────────────────────
  // Só aparece quando há o que rolar. Além de indicar a posição, ela é
  // ARRASTÁVEL: rolar 500 objetos de 3 em 3 na roda seria inviável.
  if (maxScroll > 0) {
    const trackY = HIER_LIST_TOP;
    const trackH = visRows * UI_HIER_ROW_H;
    const bx = HIER_W - 10;
    pincel(UI_C.scrollbarTrack, 0, 0, 3); caixa(bx, trackY, 6, trackH);
    // altura proporcional ao quanto da lista está visível, com mínimo clicável
    let thumbH = (trackH * visRows / totalRows) | 0;
    if (thumbH < 24) thumbH = 24;
    const thumbY = trackY + (((trackH - thumbH) * hierScroll / maxScroll) | 0);
    const stBar = app.clickable(bx - 2, trackY, 10, trackH);
    let barCol = UI_C.scrollbarThumb;
    if (stBar === 1) barCol = UI_C.scrollbarHover;
    if (stBar === 2 || hierBarDrag !== 0) barCol = UI_C.scrollbarDrag;
    pincel(barCol, 0, 0, 3); caixa(bx, thumbY, 6, thumbH);
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
    pincel(UI_C.dropMarker, 0, 0, 0); caixa(10, dropLineY - 1, HIER_W - 20, 3);
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
    pincel(UI_C.dragGhost, 1, UI_C.dragGhostBorder, 5); caixa(mx + 12, my - 9, 150, 22);
    texto(mx + 18, my - 5, ">> " + scene.objects[hierDrag].name, estiloTexto(UI_C.white, 13));
  }

  secEnd(P_UI_HIER);
  secBegin(P_UI_INSP);
  // Inspector: raiz e controles sao GameObjects de uma UIScene do editor.
  inspector.area(W - INSP_W, BAR_H, INSP_W, H - BAR_H);
  inspector.mouse(mx, my, mDownNow, mPressed);
  inspector.render(app, menuOpen !== 0 || helpOpen !== 0, dndModel, dndTex);
  addMenuOpen = inspector.opened;
  slotMeshHot = inspector.meshHot;
  slotTexHot = inspector.textureHot;
  secEnd(P_UI_INSP);
  // ── barra inferior (status bar estilo Unity) sobre a área do viewport ───────
  const vpx = HIER_W;
  const vpw = W - HIER_W - INSP_W;
  pincel(UI_C.controlIdle, 0, 0, 0); caixa(vpx, H - UI_STATUS_H, vpw, UI_STATUS_H);
  traco(1, UI_C.border); linha(vpx, H - UI_STATUS_H, vpx + vpw, H - UI_STATUS_H);
  let modeTxt = UI_PLAY.editing;
  if (S.simulating !== 0) modeTxt = S.playing !== 0 ? UI_PLAY.running : UI_PLAY.paused;
  if (playMode.error.length > 0) modeTxt = playMode.error;
  texto(vpx + 10, H - 19, rotStatus.de(modeTxt, rotStatusN.de(scene.objects.length)), estiloTexto(UI_C.statusText, 12));
  // O resultado detalhado do build fica no Console, sem cobrir o Inspector.
  if (editorBuild.status.length > 0) {
    if (vpw > 520 && S.simulating === 0) texto(vpx + 185, H - 19, editorBuild.running ? UI_WORKSPACE.buildRunning : UI_WORKSPACE.buildResult, estiloTexto(UI_C.dropMarker, 11));
  } else if (vpw > 600 && S.simulating === 0 && playMode.error.length === 0) {
    texto(vpx + 185, H - 19, "WASD câmera • F enquadra • arraste assets do Project", estiloTexto(UI_C.hint, 11));
  }

  // ── PROJECT PANEL (asset browser) na base do viewport ───────────────────────
  const apX = HIER_W;
  const apY = H - UI_STATUS_H - ASSET_H;
  const apW = W - HIER_W - INSP_W;
  secBegin(P_UI_PROJ);
  let assetAct = "";
  if (workspaceViews.console) { consolePanel.blocked = helpOpen !== 0 || menuOpen !== 0; consolePanel.render(apX, apY + UI_WORKSPACE.tabH, apW, ASSET_H - UI_WORKSPACE.tabH); }
  else {
    assetsArea(apX, apY, apW, ASSET_H); assetsMouse(mx, my, helpOpen === 0 ? mPressed : 0, mDownNow);
    assetAct = drawAssets(WIN);
  }
  pincel(workspaceViews.console ? UI_C.consoleToolbar : UI_C.sceneHeader, 0, 0, 0); caixa(apX, apY, workspaceViews.console ? apW : UI_WORKSPACE.padding + UI_WORKSPACE.bottomTabs.length * (UI_WORKSPACE.tabW + UI_WORKSPACE.gap), UI_WORKSPACE.tabH);
  workspaceViews.tabs(sceneX, BAR_H, apY, helpOpen !== 0 || menuOpen !== 0);
  if (workspaceViews.game) texto(sceneX + UI_WORKSPACE.padding, BAR_H + UI_SCENE_HEADER_H + UI_WORKSPACE.padding, workspaceViews.hasCamera ? UI_WORKSPACE.gameHint : UI_WORKSPACE.noCamera, estiloTexto(UI_C.primaryText, 12));
  secEnd(P_UI_PROJ);
  const splitLeft = layoutDrag === 1 || (mx >= HIER_W - 5 && mx <= HIER_W + 5 && my > BAR_H);
  const splitRight = layoutDrag === 2 || (mx >= W - INSP_W - 5 && mx <= W - INSP_W + 5 && my > BAR_H);
  const splitBottom = layoutDrag === 3 || (mx > HIER_W && mx < W - INSP_W && my >= apY - 5 && my <= apY + 5);
  pincel(splitLeft ? UI_C.splitterHover : UI_C.border, 0, 0, 0); caixa(HIER_W - 2, BAR_H, 4, H - BAR_H);
  pincel(splitRight ? UI_C.splitterHover : UI_C.border, 0, 0, 0); caixa(W - INSP_W - 2, BAR_H, 4, H - BAR_H);
  pincel(splitBottom ? UI_C.splitterHover : UI_C.border, 0, 0, 0); caixa(HIER_W, apY - 2, apW, 4);
  if (assetAct.length > 0) {
    const path = assetAct.substring(assetAct.indexOf(":") + 1);
    const c0 = assetAct.charCodeAt(0);
    if (assetAct.indexOf("script:") === 0) {
      scriptEditor.open(path);
    } else if (c0 === 115) {                          // "scene:" → recarrega a cena
      sceneDocument.request("open", path);
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

    if (kind === "scene") {
      if (inViewport || (mx < HIER_W && my > BAR_H)) sceneDocument.request("open", dpath);
    } else if (kind === "script") {
      const error = dropScriptOnObject(dpath, scriptTarget);
      scriptNotice = error.length > 0 ? error : "Componente adicionado em " + scene.objects[scriptTarget].name;
      scriptNoticeFrames = UI_SCRIPT_DROP.noticeFrames;
    } else if (inViewport) {
      if (previewIdx >= 0) {
        // já existe o PREVIEW no lugar certo: soltar apenas o confirma (vira
        // objeto definitivo) — nada de instanciar de novo.
        movePreviewTo(mx, my);
        S.selected = previewIdx;
        previewIdx = 0 - 1;
        previewPay = "";
      } else {
        // textura solta EM CIMA de um objeto → aplica nele (Unity); no vazio → cria
        const hitObj = kind === "tex" ? pickObjectAt(mx, my) : 0 - 1;
        if (hitObj >= 0) {
          if (applyTexToObject(hitObj, dpath, WIN) > 0) S.selected = hitObj;
        } else {
          dropAssetInWorld(kind, dpath, mx, my);
        }
      }
    } else if (mx < HIER_W && my > BAR_H) {
      // sobre a hierarquia: textura vai pro objeto da linha; resto instancia solto
      const hIdx = hierRowAt(my);
      if (kind === "tex" && hIdx >= 0 && hIdx < scene.objects.length) {
        applyTexToObject(hIdx, dpath, WIN);
      } else {
        dropAssetInWorld(kind, dpath, 0.0 - 1.0, 0.0);
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

  // ── OVERLAY DO DRAG & DROP (por último: fica acima de tudo) ────────────────
  if (dndOn !== 0) {
    if (inViewport && !dndScript) {
      // alvo do drop: marca o objeto sob o cursor (textura) ou o ponto do chão
      const prevObj = dndTex !== 0 ? pickObjectAt(mx, my) : 0 - 1;
      if (prevObj >= 0) {
        const pp = anelA;
        pontoMundo[0] = scene.objects[prevObj].transform.wx; pontoMundo[1] = scene.objects[prevObj].transform.wy;
        pontoMundo[2] = scene.objects[prevObj].transform.wz; projPt(pp, vistaEditor, pontoMundo);
        if (pp[2] !== 0.0) { pincel(UI_C.dropTint, 1, UI_C.dropMarker, 6); caixa(pp[0] - 22, pp[1] - 22, 44, 44); }
        texto(mx + 12, my + 16, "aplicar textura", estiloTexto(UI_C.dropMarker, 12));
      } else {
        // marca o ponto do chão sob o preview (cruz + coordenadas do mundo)
        const gp = pontoDrop; screenToGround(gp, vistaEditor, mx, my);
        if (gp[3] !== 0.0) {
          const sp = anelA; projPt(sp, vistaEditor, gp);
          if (sp[2] !== 0.0) {
            traco(1, UI_C.dropMarker); linha(sp[0] - 14, sp[1], sp[0] + 14, sp[1]);
            traco(1, UI_C.dropMarker); linha(sp[0], sp[1] - 8, sp[0], sp[1] + 8);
            texto(sp[0] + 8, sp[1] + 6, "(" + fmt1(gp[0]) + ", " + fmt1(gp[2]) + ")", estiloTexto(UI_C.dropMarker, 11));
          }
        }
      }
    }
    // o "fantasma" com o nome do arquivo só aparece quando NÃO há preview 3D:
    // dentro do viewport o próprio objeto renderizado já é a prévia.
    if (previewIdx < 0) drawAssetDragGhost(WIN, mx, my);
  }

  // Feedback controls are persistent GameObjects in the editor-only UI scene.
  scriptDropUI.begin(mx, my, 0, 0);
  if (scriptEditor.message.length > 0) {
    scriptNotice = scriptEditor.message; scriptEditor.message = "";
    scriptNoticeFrames = UI_SCRIPT_DROP.noticeFrames;
  }
  if (dndScript || scriptNoticeFrames > 0) {
    const caption = dndScript ? (scriptError.length > 0 ? scriptError : UI_SCRIPT_DROP.ready + scene.objects[scriptTarget].name) : scriptNotice;
    const width = Math.min(UI_SCRIPT_DROP.width, W - UI_SCRIPT_DROP.padding * 2);
    const x = dndScript ? Math.max(UI_SCRIPT_DROP.padding, Math.min(mx + UI_SCRIPT_DROP.cursorX, W - width - UI_SCRIPT_DROP.padding)) : HIER_W + UI_SCRIPT_DROP.noticeX;
    const y = dndScript ? Math.min(my + UI_SCRIPT_DROP.cursorY, H - UI_SCRIPT_DROP.height - UI_SCRIPT_DROP.padding) : BAR_H + UI_SCENE_HEADER_H + UI_SCRIPT_DROP.noticeY;
    scriptDropUI.at(x, y, width, UI_SCRIPT_DROP.height);
    const panel = scriptDropUI.control("Feedback", "panel", "", false);
    panel.fill = UI_C.popupDark; scriptDropUI.draw(panel);
    scriptDropUI.at(x + UI_SCRIPT_DROP.padding, y, width - UI_SCRIPT_DROP.padding * 2, UI_SCRIPT_DROP.height);
    const label = scriptDropUI.control("Caption", "label", caption, false);
    label.color = dndScript && scriptError.length > 0 ? UI_C.destructiveText : UI_C.dropMarker;
    scriptDropUI.draw(label);
    if (!dndScript) scriptNoticeFrames = scriptNoticeFrames - 1;
  }
  scriptDropUI.end();

  // ── MENU DE CONTEXTO (por último: fica ACIMA de tudo) ─────────────────────
  // Desenhado no fim do frame de propósito — a UI é imediata, então quem desenha
  // depois cobre. Um menu que aparecesse sob a lista seria inclicável.
  if (ctxOn !== 0) {
    const CW = UI_CONTEXT_W;
    const nCriar = menuCriar.rotulos.length;
    const items = nCriar + (ctxTarget >= 0 ? UI_CONTEXT_ACTIONS.length : 0);
    const CH = 12 + items * UI_CONTEXT_ROW_H;
    let cx = ctxX;
    let cy = ctxY;
    if (cx + CW > W) cx = W - CW - 4;          // não vaza pela direita
    if (cy + CH > H) cy = H - CH - 4;          // nem por baixo
    pincel(UI_C.popupDark, 1, UI_C.contextBorder, 4); caixa(cx, cy, CW, CH);
    // cabeçalho: mostra SE vai criar como filho, e de quem
    let head = "Criar na raiz";
    if (ctxTarget >= 0 && ctxTarget < scene.objects.length) {
      const nomeAlvo = scene.objects[ctxTarget].name;
      if (rotFilhoTexto.length === 0 || rotFilhoNome !== nomeAlvo) {
        rotFilhoNome = nomeAlvo; rotFilhoTexto = UI_ROTULOS.childOf + subStr(nomeAlvo, 0, UI_ROTULOS.childOfChars);
      }
      head = rotFilhoTexto;
    }
    texto(cx + 10, cy + 6, head, estiloTexto(UI_C.scrollbarDrag, 11));
    let iy = cy + UI_CONTEXT_ROW_H;
    let clicked = 0 - 1;
    let n = 0;
    while (n < items) {
      const st = app.clickable(cx + 4, iy, CW - 8, UI_CONTEXT_ROW_H - 2);
      if (st === 1 || st === 2) { pincel(UI_C.contextHover, 0, 0, 3); caixa(cx + 4, iy, CW - 8, UI_CONTEXT_ROW_H - 2); }
      if (st === 3) clicked = n;
      iy = iy + UI_CONTEXT_ROW_H;
      n = n + 1;
    }
    // A mesma lista de criação serve ao menu global e ao menu de contexto.
    let labelIdx = 0;
    while (labelIdx < items) {
      const label = labelIdx < nCriar ? menuCriar.rotulos[labelIdx] : UI_CONTEXT_ACTIONS[labelIdx - nCriar];
      texto(cx + 12, cy + UI_CONTEXT_ROW_H + labelIdx * UI_CONTEXT_ROW_H + 4, label, estiloTexto(labelIdx === items - 1 && ctxTarget >= 0 ? UI_C.destructiveText : UI_C.primaryText, 12));
      labelIdx = labelIdx + 1;
    }

    if (clicked >= 0) {
      if (clicked < menuCriar.fixos) createMenuObject(clicked, ctxTarget);
      else if (clicked < nCriar) executarItemDeMenu(menuCriar.itens[clicked - menuCriar.fixos], ctxTarget);
      else if (clicked === nCriar) {
        if (ctxTarget >= 0 && ctxTarget < scene.objects.length) {
          history.snapshot();
          const g = cloneObject(scene.objects[ctxTarget]);
          g.transform.px = g.transform.px + 1.0;
          scene.add(g);
          S.selected = scene.objects.length - 1;
        }
      } else if (clicked === nCriar + 1) {
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
  // Menus globais: comandos de projeto ficam separados das ferramentas da Cena.
  if (menuOpen !== 0) {
    const entries = menuEntries(menuOpen);
    const menuW = UI_MENU_W;
    const menuH = UI_MENU_PADDING + entries.length * UI_MENU_ROW_H;
    pincel(UI_C.menuPopup, 1, UI_C.menuPopupBorder, 4); caixa(menuX, UI_MENU_H, menuW, menuH);
    let chosen = 0 - 1;
    let mi = 0;
    while (mi < entries.length) {
      const ey = UI_MENU_H + 4 + mi * UI_MENU_ROW_H;
      const st = app.clickable(menuX + 4, ey, menuW - 8, 25);
      if (st === 1 || st === 2) { pincel(UI_C.menuItemHover, 0, 0, 3); caixa(menuX + 4, ey, menuW - 8, 25); }
      texto(menuX + 13, ey + 5, entries[mi], estiloTexto(UI_C.menuItemText, 12));
      if (st === 3) chosen = mi;
      mi = mi + 1;
    }
    if (chosen >= 0) {
      const activeMenu = menuOpen;
      menuOpen = 0;
      app.setFocus(0 - 1);
      if (activeMenu === 1) {
        if (chosen === 0) { try { const path = chooseSceneFile(false); if (path.length > 0) sceneDocument.request("open", path); } catch (error) { logError(String(error)); workspaceViews.console = true; } }
        else if (chosen === 1) {
          sceneDocument.request("new");
        } else if (chosen === 2) saveDocument();
        else if (chosen === 3 && S.simulating === 0) saveDocument(true);
        else if (chosen === 4 && S.simulating === 0) startBuild();
      } else if (activeMenu === 2) {
        if (chosen === 0) history.undo();
        else if (chosen === 1) history.redo();
        else if (S.selected >= 0 && S.selected < scene.objects.length) {
          history.snapshot();
          if (chosen === 2) {
            const copy = cloneObject(scene.objects[S.selected]);
            copy.transform.px = copy.transform.px + 1.0;
            scene.add(copy); S.selected = scene.objects.length - 1;
          } else if (chosen === 3) {
            scene.removeAt(S.selected);
            if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
            S.selection = [];
          }
        }
      } else if (activeMenu === 3) {
        if (chosen < menuCriar.fixos) createMenuObject(chosen, 0 - 1);
        else executarItemDeMenu(menuCriar.itens[chosen - menuCriar.fixos], 0 - 1);
      } else if (activeMenu === 4) {
        if (chosen === 0) S.cameraPreview = S.cameraPreview !== 0 ? 0 : 1;
        else executarItemDeMenu(menuJanela.itens[chosen - menuJanela.fixos], 0 - 1);
      } else if (activeMenu === 5) {
        if (chosen === 0) S.snap = S.snap !== 0 ? 0 : 1;
        else if (chosen === 1) { vsyncOn = vsyncOn !== 0 ? 0 : 1; setVsync(WIN, vsyncOn); }
        else if (chosen === 2) { HIER_W = UI_HIER_DEFAULT; INSP_W = UI_INSP_DEFAULT; ASSET_H = UI_PROJECT_DEFAULT; }
        else if (chosen === 3) { helpOpen = 2; preferencesPanel.open(); assetDragClear(); }
      } else if (activeMenu === 6) helpOpen = 1;
    }
    const overGlobalMenu = mx >= menuX && mx < menuX + menuW && my >= UI_MENU_H && my < UI_MENU_H + menuH;
    if (mPressed !== 0 && my >= UI_MENU_H && !overGlobalMenu) menuOpen = 0;
  }

  if (helpOpen === 2) { preferencesPanel.mouse(mx, my, mDownNow, mPressed); if (preferencesPanel.render(W, H)) helpOpen = 0; }
  if (helpOpen === 1) {
    const hw = math.min(370, W - HIER_W - INSP_W - 30);
    const hx = HIER_W + (W - HIER_W - INSP_W - hw) / 2;
    const hy = BAR_H + 90;
    pincel(UI_C.helpBackground, 1, UI_C.helpBorder, 5); caixa(hx, hy, hw, 210);
    texto(hx + 18, hy + 15, "Atalhos e navegacao", estiloTexto(UI_C.helpTitle, 16));
    texto(hx + 18, hy + 48, "Q / E / R     Mover / Girar / Escala", estiloTexto(UI_C.helpText, 12));
    texto(hx + 18, hy + 72, "F              Enquadrar selecao", estiloTexto(UI_C.helpText, 12));
    texto(hx + 18, hy + 96, "WASD + mouse direito   Camera livre", estiloTexto(UI_C.helpText, 12));
    texto(hx + 18, hy + 120, "Ctrl+S / Z / Y / D   Salvar / desfazer / refazer / duplicar", estiloTexto(UI_C.helpText, 11));
    texto(hx + 18, hy + 144, "Arraste um asset do Project para a Cena.", estiloTexto(UI_C.helpText, 12));
    app.at(hx + hw - 94, hy + 171, 76, 25);
    if (app.button("Fechar") || app.keyPressed(2) !== 0) helpOpen = 0;
  }
  if (menuOpen !== 0 && app.keyPressed(2) !== 0) menuOpen = 0;
  if (sceneDocument.pending.length > 0) { helpOpen = 3; documentPanel.render(W, H); }
  if (helpOpen === 3 && sceneDocument.pending.length === 0) helpOpen = 0;
  if (sceneDocument.error.length > 0) workspaceViews.console = true;
  if (Date.now() - documentPoll > UI_DOCUMENT.pollMs) { sceneDocument.refresh(); documentPoll = Date.now(); }
  editorBuild.poll();

  pumpAudio();

  secEnd(P_UI);
  benchCpuEnd();
  secBegin(P_PRESENT);
  // O `endFrame` inclui o PRESENT, e é ali que o vsync espera. Fica fora das
  // seções de propósito: contá-lo como "UI" faria a tabela dizer que a UI custa
  // 16 ms quando o que ela faz é esperar o monitor. Ele aparece no "resto".
  app.endFrame();
  secEnd(P_PRESENT);
  profFrameEnd();
  // A tabela vai para um ARQUIVO a cada ~5 s, porque o stdout do editor não
  // descarrega enquanto ele vive e a porta de controle não está entregando o
  // 'connection' (ver docs/bug-ws-editor.md). Um profiler que só se lê pela via
  // que está quebrada não serve para consertar nada.
  // A CONTAGEM de travessias vai junto da tabela: o tempo diz quanto custou, a
  // contagem diz por quê. Ler as duas lado a lado é o que evita otimizar a
  // seção certa pelo motivo errado.
  if (frames % 300 === 0) fs.write("prof.txt", profReport() + String.fromCharCode(10) + dcReport());
}

while (app.running()) {
  if (!app.beginFrame()) break;
  frame();
  if (benchFrameEnd() !== 0) break;
}


io.print("[engine] encerrado apos " + frames + " frames");
app.close();

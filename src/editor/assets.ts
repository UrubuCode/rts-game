// Editor RTS — ASSET BROWSER (Project panel, estilo Unity). Painel na base que
// navega a pasta `assets/` do disco (via fs.readdir/is_dir) e mostra os assets
// como tiles TIPADOS por extensão: pastas, cenas, prefabs, texturas, scripts,
// presets, models. Clique seleciona; duplo-clique entra na pasta ou "abre" o
// asset. Estado em vars de MÓDULO (ok desde o fix de gcell); desenha via render.*.

import input from "@compat/input";
import { clockNow, clockSince, DOUBLE_CLICK_MS } from "../engine/core/clock";
import fs from "../compat/fs.ts";

import { PANEL, PANEL_DK, HEADER, BORDER, FIELD, TEXT, TEXT_DIM, SEL, HOVER, button, subStr, widgetRect, widgetMouse } from "./widgets";
import { drawThumb, thumbAt } from "./thumbs";
import { ProjectTree } from "./project_tree";
import { AudioClip, clipInfo } from "../engine/audio/clip";
import { tocarPrevia, pararPrevia, vozTocando } from "../engine/audio/audio";
import { UI_C, UI_WORKSPACE, UI_PROJECT_HEADER_H, UI_PROJECT_PATH_Y, UI_PROJECT_PATH_H,
         UI_PROJECT_TOOL_W, UI_PROJECT_GRID_Y, UI_PROJECT_TILE_W, UI_PROJECT_TILE_H,
         UI_PROJECT_ICON_SIZE, UI_PROJECT_TILE_GAP, UI_PROJECT_DRAG_DISTANCE_SQ,
         UI_PROJECT_THUMB_MIN_H, UI_PROJECT_TREE_W, UI_PROJECT_TREE_FRACTION,
         UI_PROJECT_TREE_ROW_H, UI_PROJECT_TREE_INDENT, UI_PROJECT_TREE_PADDING,
         UI_PROJECT_TREE_TOGGLE_W, UI_PROJECT_TREE_ICON_SIZE, UI_PROJECT_TREE_ICON_GAP,
         UI_PROJECT_TREE_FONT, UI_PROJECT_TREE_CHAR_W, UI_PROJECT_TREE_SCROLL_STEP,
         UI_PROJECT_TREE_SCROLL_W, UI_PROJECT_TREE_ROOT_LABEL, UI_PROJECT_CONTENT_PADDING } from "./ui_config";

import { caixa, estiloTexto, pincel, texto } from "@compat/draw2d.ts";
// tipos de asset (cor + rótulo do ícone)
const T_FOLDER = 0;
const T_SCENE = 1;   // .json de cena
const T_PREFAB = 2;  // .prefab.json
const T_IMAGE = 3;   // .png/.jpg/.jpeg/.bmp
const T_SCRIPT = 4;  // .ts/.js
const T_PRESET = 5;  // .preset
const T_MODEL = 6;   // .obj/.gltf
const T_TEXT = 7;    // .txt/.md
const T_AUDIO = 8;   // .wav/.ogg
const T_OTHER = 9;

// ── estado do módulo ─────────────────────────────────────────────────────────
let root = "assets";
let curDir = "assets";
const folderTree = new ProjectTree(root);
let treeDirty = 1;
let treeRevealSelected = 1;
let treeScroll = 0;
let selIdx = 0 - 1;
let deleteArmed = 0;
let assetScroll = 0;
let scanned = 0;
let lastClickIdx = 0 - 1;
/// Quando o último clique aconteceu, em MILISSEGUNDOS de relógio.
///
/// Era um número de FRAME, e a janela era `frame - lastClickFrame < 24`. Isso
/// vale 400 ms a 60 fps e é razoável — mas o editor passou a rodar a 442 fps
/// nesta máquina, e ali 24 frames são 54 ms: rápido demais para uma mão humana.
/// O duplo-clique parou de funcionar em pasta nenhuma, e a causa foi o motor
/// ficar sete vezes mais rápido.
///
/// Uma janela de INTERAÇÃO é tempo de parede, nunca contagem de frame. Qualquer
/// limiar que descreva o que uma PESSOA faz — segurar, arrastar, clicar duas
/// vezes, esperar um tooltip — tem a mesma armadilha: um número de frame carrega
/// uma suposição escondida sobre o frame rate, e ela morre em silêncio quando o
/// desempenho muda. O sintoma nem parece desempenho.
let lastClickMs: f64 = 0.0 - 999999.0;

// Área e mouse do quadro (`assetsArea`/`assetsMouse`): as funções de desenho
// recebem no máximo 4 parâmetros (Task 10.5: 5+ alocam por chamada no RTS).
let aX: f64 = 0.0; let aY: f64 = 0.0; let aW: f64 = 0.0; let aH: f64 = 0.0;
let aMx: f64 = 0.0; let aMy: f64 = 0.0; let aPressed = 0; let aDown = 0;
let treeH: f64 = 0.0;

// ── DRAG & DROP (estilo Unity): arrastar um tile do Project pra fora do painel ─
// dragIdx  = índice do tile sendo arrastado (-1 = nenhum)
// dragArmed= 1 depois que o mouse saiu do tile de origem (evita "drag" em clique seco)
let dragIdx = 0 - 1;
let dragArmed = 0;
let dragX0: f64 = 0.0;
let dragY0: f64 = 0.0;

// entradas do diretório atual (arrays paralelos — nada de objetos aninhados)
let names: string[] = [];
let types: number[] = [];
// Por entrada, feitos uma vez no `rescan` (Task 10.5: nada de concatenar/cortar por
// tile por quadro): caminho completo, nome cortado do tile e do fantasma, payload do arrasto.
let fulls: string[] = [];
let curtos: string[] = [];
let curtosFantasma: string[] = [];
let payloads: string[] = [];
/// Legenda de duração dos áudios ("1,2 s"), uma vez por arquivo no `rescan`
/// (Task 10.5: nada de decodificar/formatar por quadro) — "" pros não-áudio.
let durLabels: string[] = [];
let count = 0;

// ── prévia de áudio (duplo-clique num tile T_AUDIO toca/para) ───────────────
let previewPath = "";
let previewVoz = 0;

// ── classificação por extensão ───────────────────────────────────────────────
function endsWith(s: string, suf: string): number {
  const n = s.length; const m = suf.length;
  if (m > n) return 0;
  let i = 0;
  while (i < m) { if (s.charCodeAt(n - m + i) !== suf.charCodeAt(i)) return 0; i = i + 1; }
  return 1;
}
function classify(name: string, isDir: number): number {
  if (isDir !== 0) return T_FOLDER;
  if (endsWith(name, ".prefab.json") !== 0) return T_PREFAB;
  if (endsWith(name, ".json") !== 0) return T_SCENE;
  if (endsWith(name, ".png") !== 0 || endsWith(name, ".jpg") !== 0 ||
      endsWith(name, ".jpeg") !== 0 || endsWith(name, ".bmp") !== 0) return T_IMAGE;
  if (endsWith(name, ".ts") !== 0 || endsWith(name, ".js") !== 0) return T_SCRIPT;
  if (endsWith(name, ".preset") !== 0) return T_PRESET;
  if (endsWith(name, ".obj") !== 0 || endsWith(name, ".gltf") !== 0 ||
      endsWith(name, ".glb") !== 0) return T_MODEL;
  if (endsWith(name, ".txt") !== 0 || endsWith(name, ".md") !== 0) return T_TEXT;
  if (endsWith(name, ".wav") !== 0 || endsWith(name, ".ogg") !== 0) return T_AUDIO;
  return T_OTHER;
}
function typeColor(t: number): number {
  if (t === T_FOLDER) return UI_C.assetFolder;   // amarelo pasta
  if (t === T_SCENE) return UI_C.assetScene;    // verde cena
  if (t === T_PREFAB) return UI_C.assetPrefab;   // ciano prefab
  if (t === T_IMAGE) return UI_C.assetImage;    // roxo imagem
  if (t === T_SCRIPT) return UI_C.assetScript;   // azul script
  if (t === T_PRESET) return UI_C.assetPreset;   // laranja preset
  if (t === T_MODEL) return UI_C.assetModel;    // cinza model
  if (t === T_TEXT) return UI_C.assetText;
  if (t === T_AUDIO) return UI_C.assetAudio;    // laranja-ouro áudio
  return UI_C.assetOther;
}
function typeTag(t: number): string {
  if (t === T_FOLDER) return "";
  if (t === T_SCENE) return "SCENE";
  if (t === T_PREFAB) return "PREFAB";
  if (t === T_IMAGE) return "IMG";
  if (t === T_SCRIPT) return "TS";
  if (t === T_PRESET) return "PRE";
  if (t === T_MODEL) return "3D";
  if (t === T_TEXT) return "TXT";
  if (t === T_AUDIO) return "AUD";
  return "?";
}

/// "1,2 s" — decodifica UMA VEZ (no rescan), nunca por quadro. "" se não carregar.
function duracaoLabel(path: string): string {
  const c = AudioClip.load(path);
  if (c === null) return "";
  return c.duracao.toFixed(1).replace(".", ",") + " s";
}
/// Toca/para a prévia 2D de um tile de áudio (duplo-clique, estilo Unity):
/// clicar de novo no MESMO arquivo enquanto toca para; em outro, troca.
function togglePreviewAudio(path: string): void {
  if (previewPath === path && vozTocando(previewVoz) !== 0) {
    pararPrevia();
    previewPath = ""; previewVoz = 0;
    return;
  }
  pararPrevia();
  const c = AudioClip.load(path);
  previewVoz = c !== null ? tocarPrevia(c, 1.0, 1.0) : 0;
  previewPath = previewVoz !== 0 ? path : "";
}

// ── varredura do diretório atual ─────────────────────────────────────────────
function rescan(): void {
  treeDirty = 1;
  assetDragClear();
  if (previewPath !== "") { pararPrevia(); previewPath = ""; previewVoz = 0; }
  lastClickIdx = 0 - 1;
  names = [];
  types = [];
  fulls = []; curtos = []; curtosFantasma = []; payloads = []; durLabels = [];
  count = 0;
  selIdx = 0 - 1;
  deleteArmed = 0;
  assetScroll = 0;
  let list: string[] = [];
  try { list = fs.readdir(curDir); } catch { scanned = 1; return; }
  // pastas primeiro, depois arquivos (dois passes). is_dir devolve 1/0 (número) —
  // usa TRUTHINESS (não `!== false`, que dá true até pra 0).
  let i = 0;
  while (i < list.length) {
    const nm = list[i];
    if (fs.is_dir(curDir + "/" + nm)) { names.push(nm); types.push(T_FOLDER); count = count + 1; }
    i = i + 1;
  }
  i = 0;
  while (i < list.length) {
    const nm = list[i];
    if (!fs.is_dir(curDir + "/" + nm)) { names.push(nm); types.push(classify(nm, 0)); count = count + 1; }
    i = i + 1;
  }
  i = 0;
  while (i < count) {
    const nm = names[i]; const t = types[i];
    const full = curDir + "/" + nm;
    fulls.push(full);
    curtos.push(nm.length > 12 ? subStr(nm, 0, 11) + "…" : nm);
    curtosFantasma.push(nm.length > 13 ? subStr(nm, 0, 12) + "…" : nm);
    let pay = "other:";
    if (t === T_FOLDER) pay = "dir:";
    else if (t === T_SCENE) pay = "scene:";
    else if (t === T_PREFAB) pay = "prefab:";
    else if (t === T_IMAGE) pay = "tex:";
    else if (t === T_MODEL) pay = "model:";
    else if (t === T_SCRIPT) pay = "script:";
    else if (t === T_AUDIO) pay = "audio:";
    payloads.push(pay + full);
    durLabels.push(t === T_AUDIO ? duracaoLabel(full) : "");
    i = i + 1;
  }
  selIdx = 0 - 1;
  deleteArmed = 0;
  assetScroll = 0;
  scanned = 1;
}

/// (re)inicializa o browser na pasta raiz de assets.
export function assetsInit(): void {
  curDir = root;
  folderTree.expanded = [root];
  treeScroll = 0;
  treeRevealSelected = 1;
  scanned = 0;
  rescan();
}

export function assetsOpenScenes(): void {
  navigateTo(fs.is_dir(root + "/scenes") ? root + "/scenes" : root);
}

function navigateTo(path: string): void {
  if (path !== root && path.indexOf(root + "/") !== 0) return;
  curDir = path;
  treeRevealSelected = 1;
  rescan();
}

// sobe um nível (não passa da raiz).
function goUp(): void {
  if (curDir.length <= root.length) return;
  let cut = 0 - 1;
  let i = 0;
  while (i < curDir.length) { if (curDir.charCodeAt(i) === 47) cut = i; i = i + 1; }  // '/'
  if (cut > 0) navigateTo(subStr(curDir, 0, cut));
}

/// A pasta aberta no Project agora (usada como destino padrão de importação
/// quando o alvo do drop/comando não é o Project panel nem áudio).
export function assetsCurrentDir(): string {
  return curDir;
}

/// nome do asset selecionado (ou "").
export function assetSelectedName(): string {
  if (selIdx < 0 || selIdx >= count) return "";
  return names[selIdx] + " [" + typeTag(types[selIdx]) + "]";
}

// ── API DE DRAG & DROP (consumida pelo main: viewport, hierarquia, inspector) ──
/// 1 quando há um asset sendo arrastado E o arrasto já "armou" (saiu do tile).
export function assetDragActive(): number {
  if (dragIdx < 0 || dragIdx >= count) return 0;
  return dragArmed;
}
/// Payload do arrasto no MESMO formato do retorno de drawAssets ("tex:<path>",
/// "prefab:<path>", "scene:<path>", "model:<path>", "dir:<path>"...). "" se nada.
export function assetDragPayload(): string {
  if (assetDragActive() === 0) return "";
  return payloads[dragIdx];
}
/// Nome do arquivo sendo arrastado (pra desenhar o "fantasma" que segue o mouse).
export function assetDragName(): string {
  if (assetDragActive() === 0) return "";
  return names[dragIdx];
}
/// Encerra o arrasto. O main chama isto no frame em que o botão é solto,
/// DEPOIS de já ter consultado o payload pra aplicar o drop.
export function assetDragClear(): void {
  dragIdx = 0 - 1;
  dragArmed = 0;
}
/// Desenha o "fantasma" do asset arrastado seguindo o cursor. Chamar por ÚLTIMO
/// no frame (fica por cima de tudo, como o overlay de drag do Unity).
export function drawAssetDragGhost(win: i64, mx: f64, my: f64): void {
  if (assetDragActive() === 0) return;
  const t = types[dragIdx];
  pincel(UI_C.assetDragGhost, 1, typeColor(t), 4); caixa(mx + 12, my - 10, 128, 26);
  pincel(typeColor(t), 0, 0, 3); caixa(mx + 16, my - 6, 18, 18);
  texto(mx + 40, my - 5, curtosFantasma[dragIdx], estiloTexto(TEXT, 12));
}

// ── OPERAÇÕES REAIS DE ARQUIVO (gerenciamento de pastas de verdade) ──────────
/// Cria uma pasta nova na pasta atual (nome único no disco) e re-scaneia.
function newFolder(): void {
  let name = "NovaPasta";
  let n = 0;
  while (fs.exists(curDir + "/" + name)) { n = n + 1; name = "NovaPasta" + n; }
  fs.create_dir(curDir + "/" + name);
  rescan();
}
/// Deleta o asset selecionado DO DISCO (pasta recursiva ou arquivo) e re-scaneia.
function deleteSelected(): void {
  if (selIdx < 0 || selIdx >= count) return;
  const full = curDir + "/" + names[selIdx];
  if (types[selIdx] === T_FOLDER) fs.remove_dir_all(full);
  else fs.remove_file(full);
  selIdx = 0 - 1;
  deleteArmed = 0;
  rescan();
}

// Desenha o ícone do asset num quadrado (x,y,s). Para IMAGEM e MODELO tenta
// primeiro o THUMBNAIL REAL (a própria imagem / um render 3D da malha); só cai
// no ícone genérico se não der pra gerar. `full` é o path do arquivo.
function drawIcon(x: number, y: number, s: number, i: number): void {
  const t = types[i];
  if (t === T_IMAGE || t === T_MODEL || t === T_PREFAB || t === T_SCENE) {
    thumbAt(x, y, s);
    if (drawThumb(fulls[i], t) !== 0) {
      pincel(0, 1, BORDER, 3); caixa(x, y, s, s);   // moldura por cima do preview
      const tg = typeTag(t);
      if (tg.length > 0) texto(x + 3, y + s - 13, tg, estiloTexto(UI_C.buildText, 10));
      return;
    }
  }
  const c = typeColor(t);
  if (t === T_FOLDER) {
    pincel(c, 0, 0, 3); caixa(x, y + 5, s, s - 8);
    pincel(c, 0, 0, 2); caixa(x + 3, y + 1, s * 0.45, 6);  // aba da pasta
  } else if (t === T_IMAGE) {
    pincel(c, 1, BORDER, 3); caixa(x, y, s, s);
    pincel(UI_C.assetThumbnailLight, 0, 0, 1); caixa(x + 5, y + s - 12, s - 10, 7);  // "montanha"
  } else if (t === T_SCENE || t === T_PREFAB || t === T_MODEL) {
    // cubinho 3D (losango)
    pincel(c, 1, UI_C.assetThumbnailShadow, 3); caixa(x + 6, y + 6, s - 12, s - 12);
  } else if (t === T_AUDIO) {
    // "equalizador": três barras de altura crescente, como um ícone de som
    const barW = (s - 12) / 3.0;
    pincel(c, 0, 0, 1); caixa(x + 5, y + s * 0.55, barW, s * 0.35);
    pincel(c, 0, 0, 1); caixa(x + 5 + barW + 2, y + s * 0.35, barW, s * 0.55);
    pincel(c, 0, 0, 1); caixa(x + 5 + (barW + 2) * 2, y + s * 0.2, barW, s * 0.7);
  } else {
    // "folha de arquivo"
    pincel(c, 1, BORDER, 3); caixa(x + 4, y + 2, s - 8, s - 4);
  }
  const tag = typeTag(t);
  if (tag.length > 0) texto(x + 3, y + s - 13, tag, estiloTexto(UI_C.assetThumbnailLabel, 10));
}

// Arvore de pastas com selecao e expansao independentes. Somente linhas inteiras
// sao desenhadas, pois o backend imediato nao recorta texto automaticamente.
function drawFolderTree(win: i64, x: number, y: number, w: number): string {
  const h = treeH; const mx = aMx; const my = aMy; const pressed = aPressed;
  if (treeDirty !== 0) {
    folderTree.reveal(curDir);
    treeDirty = 0;
  }
  pincel(PANEL_DK, 0, 0, 0); caixa(x, y, w, h);
  pincel(BORDER, 0, 0, 0); caixa(x + w - 1, y, 1, h);
  const rows = math_floor(h / UI_PROJECT_TREE_ROW_H);
  if (rows < 1) return "";
  let maxScroll = folderTree.paths.length - rows;
  if (maxScroll < 0) maxScroll = 0;
  if (treeRevealSelected !== 0) {
    const selectedRow = folderTree.paths.indexOf(curDir);
    if (selectedRow >= 0 && selectedRow < treeScroll) treeScroll = selectedRow;
    else if (selectedRow >= treeScroll + rows) treeScroll = selectedRow - rows + 1;
    treeRevealSelected = 0;
  }
  if (mx >= x && mx < x + w && my >= y && my < y + h) {
    const wheel = input.wheel(win);
    if (wheel > 0) treeScroll = treeScroll - UI_PROJECT_TREE_SCROLL_STEP;
    else if (wheel < 0) treeScroll = treeScroll + UI_PROJECT_TREE_SCROLL_STEP;
  }
  if (treeScroll > maxScroll) treeScroll = maxScroll;
  if (treeScroll < 0) treeScroll = 0;
  let chosen = "";
  let toggle = "";
  let row = treeScroll;
  while (row < folderTree.paths.length && row < treeScroll + rows) {
    const ry = y + (row - treeScroll) * UI_PROJECT_TREE_ROW_H;
    const rowW = w - UI_PROJECT_TREE_SCROLL_W - UI_PROJECT_TREE_PADDING;
    const over = mx >= x && mx < x + rowW && my >= ry && my < ry + UI_PROJECT_TREE_ROW_H;
    const path = folderTree.paths[row];
    if (path === curDir || over) {
      pincel(path === curDir ? SEL : HOVER, 0, 0, 0); caixa(x, ry, rowW, UI_PROJECT_TREE_ROW_H);
    }
    let indent = folderTree.depths[row] * UI_PROJECT_TREE_INDENT;
    const maxIndent = rowW - UI_PROJECT_TREE_PADDING - UI_PROJECT_TREE_TOGGLE_W -
                      UI_PROJECT_TREE_ICON_SIZE - UI_PROJECT_TREE_ICON_GAP - UI_PROJECT_TREE_CHAR_W;
    if (indent > maxIndent) indent = maxIndent;
    const arrowX = x + UI_PROJECT_TREE_PADDING + indent;
    const textY = ry + (UI_PROJECT_TREE_ROW_H - UI_PROJECT_TREE_FONT) / 2;
    if (folderTree.branches[row] !== 0) {
      texto(arrowX, textY, folderTree.isExpanded(path) ? "v" : ">", estiloTexto(TEXT_DIM, UI_PROJECT_TREE_FONT));
    }
    const iconX = arrowX + UI_PROJECT_TREE_TOGGLE_W;
    pincel(UI_C.assetFolder, 0, 0, 0); caixa(iconX, ry + (UI_PROJECT_TREE_ROW_H - UI_PROJECT_TREE_ICON_SIZE) / 2, UI_PROJECT_TREE_ICON_SIZE, UI_PROJECT_TREE_ICON_SIZE);
    const labelX = iconX + UI_PROJECT_TREE_ICON_SIZE + UI_PROJECT_TREE_ICON_GAP;
    const maxChars = math_floor((x + rowW - labelX) / UI_PROJECT_TREE_CHAR_W);
    let label = row === 0 ? UI_PROJECT_TREE_ROOT_LABEL : folderTree.labels[row];
    if (label.length > maxChars) label = subStr(label, 0, maxChars - 1) + "…";
    texto(labelX, textY, label, estiloTexto(TEXT, UI_PROJECT_TREE_FONT));
    if (over && pressed !== 0) {
      if (folderTree.branches[row] !== 0 && mx >= arrowX && mx < iconX) toggle = path;
      else chosen = path;
    }
    row = row + 1;
  }
  if (maxScroll > 0) {
    let thumbH = h * rows / folderTree.paths.length;
    if (thumbH < UI_PROJECT_THUMB_MIN_H) thumbH = UI_PROJECT_THUMB_MIN_H;
    const thumbY = y + (h - thumbH) * treeScroll / maxScroll;
    pincel(UI_C.componentScrollThumb, 0, 0, 0); caixa(x + w - UI_PROJECT_TREE_SCROLL_W, thumbY, UI_PROJECT_TREE_SCROLL_W, thumbH);
  }
  if (toggle !== "") folderTree.toggle(toggle);
  return chosen;
}

/// Desenha o Project panel em (px,py,pw,ph) e trata cliques. Retorna:
///   ""             — nada
///   "scene:<path>" — duplo-clique numa cena (main deve carregar)
///   "prefab:<path>"— duplo-clique num prefab (main deve instanciar)
///   "tex:<path>"   — duplo-clique numa imagem (main aplica no obj selecionado)
/// `mDown` é o estado ATUAL do botão esquerdo (segurando) — usado pra iniciar e
/// manter o DRAG dos tiles; o drop em si é tratado pelo main via assetDrag*().
/// Área do painel Project (chamar antes de `drawAssets`).
export function assetsArea(x: number, y: number, w: number, h: number): void { aX = x; aY = y; aW = w; aH = h; }
/// Mouse do quadro para o painel Project (chamar antes de `drawAssets`).
export function assetsMouse(mx: number, my: number, pressed: number, down: number): void {
  aMx = mx; aMy = my; aPressed = pressed; aDown = down;
}
export function drawAssets(win: i64): string {
  const px = aX; const py = aY; const pw = aW; const ph = aH;
  const mx = aMx; const my = aMy; const mPressed = aPressed; const mDown = aDown;
  if (scanned === 0) rescan();
  pincel(PANEL_DK, 0, 0, 0); caixa(px, py, pw, ph);
  // header
  pincel(HEADER, 0, 0, 0); caixa(px, py, pw, UI_PROJECT_HEADER_H);
  texto(px + 10, py + 5, "Project", estiloTexto(TEXT, 13));
  if (deleteArmed !== 0 && selIdx >= 0 && selIdx < count) {
    let target = names[selIdx];
    if (target.length > 22) target = subStr(target, 0, 21) + "…";
    texto(px + UI_WORKSPACE.padding + UI_WORKSPACE.bottomTabs.length * (UI_WORKSPACE.tabW + UI_WORKSPACE.gap), py + 5, "Excluir " + target + "?", estiloTexto(UI_C.assetDeleteWarning, 12));
  }
  // barra de caminho + botão subir
  const barY = py + UI_PROJECT_PATH_Y;
  pincel(PANEL, 0, 0, 0); caixa(px, barY, pw, UI_PROJECT_PATH_H);
  const upOver = mx >= px + 4 && mx < px + 30 && my >= barY + 2 && my < barY + 20;
  pincel(upOver !== false ? HOVER : PANEL_DK, 1, BORDER, 3); caixa(px + 4, barY + 2, 26, 18);
  texto(px + 12, barY + 4, "^", estiloTexto(TEXT, 13));
  if (upOver !== false && mPressed !== 0) goUp();
  let pathShow = curDir;
  let pathChars = math_floor((pw - 260) / 7);
  if (pathChars < 4) pathChars = 4;
  if (pathShow.length > pathChars) pathShow = "…" + subStr(pathShow, pathShow.length - pathChars + 1, pathShow.length);
  texto(px + 40, barY + 5, pathShow, estiloTexto(TEXT_DIM, 12));
  // toolbar de gerenciamento REAL: criar pasta / deletar selecionado / atualizar
  const bw = UI_PROJECT_TOOL_W;
  const delX = px + pw - bw * 2 - 8;
  if (deleteArmed !== 0 && mPressed !== 0 &&
      !(mx >= delX && mx < delX + bw && my >= barY + 1 && my < barY + 21)) deleteArmed = 0;
  widgetMouse(mx, my, 0, mPressed);
  widgetRect(px + pw - bw * 3 - 12, barY + 1, bw, 20);
  if (button("+ Pasta", PANEL_DK) !== 0) newFolder();
  widgetRect(delX, barY + 1, bw, 20);
  if (button(deleteArmed !== 0 ? "Apagar?" : "Excluir", deleteArmed !== 0 ? UI_C.assetDeleteArmed : PANEL_DK) !== 0) {
    if (deleteArmed !== 0) deleteSelected();
    else if (selIdx >= 0) deleteArmed = 1;
  }
  widgetRect(px + pw - bw - 4, barY + 1, bw, 20);
  if (button("Atualizar", PANEL_DK) !== 0) { scanned = 0; rescan(); }

  let action = "";

  // ── ARMA o drag: com o botão segurado, basta afastar ~5px do ponto de pressão
  //    pra virar arrasto (abaixo disso ainda é clique/duplo-clique).
  if (dragIdx >= 0 && mDown !== 0 && dragArmed === 0) {
    const ddx = mx - dragX0;
    const ddy = my - dragY0;
    if (ddx * ddx + ddy * ddy > UI_PROJECT_DRAG_DISTANCE_SQ) dragArmed = 1;
  }
  // soltou sem armar → foi só um clique; limpa o candidato.
  if (dragIdx >= 0 && mDown === 0 && dragArmed === 0) dragIdx = 0 - 1;

  // A arvore e o conteudo dividem a largura, mas cada um tem seu scroll.
  let treeW = math_floor(pw * UI_PROJECT_TREE_FRACTION);
  if (treeW > UI_PROJECT_TREE_W) treeW = UI_PROJECT_TREE_W;
  const gy0 = py + UI_PROJECT_GRID_Y;
  treeH = ph - UI_PROJECT_GRID_Y;
  const chosenFolder = drawFolderTree(win, px, gy0, treeW);
  if (chosenFolder !== "" && chosenFolder !== curDir) navigateTo(chosenFolder);
  const contentX = px + treeW;
  const contentW = pw - treeW;
  const gx0 = contentX + UI_PROJECT_CONTENT_PADDING;
  const tileW = UI_PROJECT_TILE_W;
  const tileH = UI_PROJECT_TILE_H;
  const iconS = UI_PROJECT_ICON_SIZE;
  const gap = UI_PROJECT_TILE_GAP;
  let cols = math_floor((contentW - UI_PROJECT_CONTENT_PADDING * 2 - UI_PROJECT_TREE_SCROLL_W + gap) / (tileW + gap));
  if (cols < 1) cols = 1;
  const rowCount = math_floor((count + cols - 1) / cols);
  let visRows = math_floor((ph - UI_PROJECT_GRID_Y + gap) / (tileH + gap));
  if (visRows < 1) visRows = 1;
  let maxScroll = rowCount - visRows;
  if (maxScroll < 0) maxScroll = 0;
  if (mx >= contentX && mx < px + pw && my >= gy0 && my < py + ph) {
    const wheel: f64 = input.wheel(win);
    if (wheel > 0.5) assetScroll = assetScroll - 1;
    else if (wheel < 0.0 - 0.5) assetScroll = assetScroll + 1;
  }
  if (assetScroll > maxScroll) assetScroll = maxScroll;
  if (assetScroll < 0) assetScroll = 0;
  let i = 0;
  while (i < count) {
    const cc = i % cols;
    const rr = (i - cc) / cols;
    const tx = gx0 + cc * (tileW + gap);
    const ty = gy0 + (rr - assetScroll) * (tileH + gap);
    if (ty >= gy0 && ty + tileH <= py + ph) {
      const over = mx >= tx && mx < tx + tileW && my >= ty && my < ty + tileH;
      let bg = PANEL;
      if (i === selIdx) bg = SEL;
      else if (over !== false) bg = HOVER;
      pincel(bg, 1, BORDER, 4); caixa(tx, ty, tileW, tileH);
      drawIcon(tx + (tileW - iconS) / 2, ty + 6, iconS, i);
      // nome (corta se longo)
      texto(tx + 5, ty + tileH - 15, curtos[i], estiloTexto(TEXT, 11));
      // legenda de duração do áudio (ex.: "1,2 s"), cacheada no rescan
      if (types[i] === T_AUDIO && durLabels[i] !== "") {
        texto(tx + 5, ty + tileH - 26, durLabels[i], estiloTexto(TEXT_DIM, 10));
      }

      // realce do tile que está sendo arrastado
      if (i === dragIdx && dragArmed !== 0) { pincel(UI_C.assetSelectionGhost, 0, 0, 4); caixa(tx, ty, tileW, tileH); }

      if (over !== false && mPressed !== 0) {
        // Do RELÓGIO, não do `performance.now()` direto: um valor por frame,
        // igual para todos, e a janela dita em milissegundos onde ela não tem
        // como voltar a ser contagem de frame.
        const agora: f64 = clockNow();
        const dbl = (i === lastClickIdx && clockSince(lastClickMs) < DOUBLE_CLICK_MS) ? 1 : 0;
        // Trocar a seleção pra outro arquivo para a prévia de áudio em curso
        // (a Unity faz o mesmo — a prévia é "do item selecionado").
        if (previewPath !== "" && fulls[i] !== previewPath) { pararPrevia(); previewPath = ""; previewVoz = 0; }
        selIdx = i;
        deleteArmed = 0;
        // pressionar num tile ARMA um possível drag (pastas não são arrastáveis
        // pra cena, mas mantemos o payload "dir:" — o main decide o que aceitar)
        dragIdx = i; dragArmed = 0; dragX0 = mx; dragY0 = my;
        if (dbl !== 0) {
          const t = types[i];
          const full = fulls[i];
          if (t === T_FOLDER) { navigateTo(full); return ""; }
          else if (t === T_SCENE) action = "scene:" + full;
          else if (t === T_PREFAB) action = "prefab:" + full;
          else if (t === T_IMAGE) action = "tex:" + full;   // aplica no obj selecionado
          else if (t === T_SCRIPT) { action = "script:" + full; assetDragClear(); }
          else if (t === T_AUDIO) { togglePreviewAudio(full); assetDragClear(); }
        }
        lastClickIdx = i;
        lastClickMs = agora;
      }
    }
    i = i + 1;
  }
  if (maxScroll > 0) {
    const trackY = gy0;
    const trackH = ph - UI_PROJECT_GRID_Y - 6;
    let thumbH = math_floor(trackH * visRows / rowCount);
    if (thumbH < UI_PROJECT_THUMB_MIN_H) thumbH = UI_PROJECT_THUMB_MIN_H;
    const thumbY = trackY + math_floor((trackH - thumbH) * assetScroll / maxScroll);
    pincel(FIELD, 0, 0, 2); caixa(px + pw - 9, trackY, 5, trackH);
    pincel(UI_C.componentScrollThumb, 0, 0, 2); caixa(px + pw - 9, thumbY, 5, thumbH);
  }
  if (count === 0) texto(gx0, gy0, "(pasta vazia)", estiloTexto(TEXT_DIM, 12));
  return action;
}

// floor local (evita importar math só pra isto)
function math_floor(v: f64): number {
  const n = v | 0;
  return n;
}

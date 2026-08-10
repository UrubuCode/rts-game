// Editor RTS — ASSET BROWSER (Project panel, estilo Unity). Painel na base que
// navega a pasta `assets/` do disco (via fs.readdir/is_dir) e mostra os assets
// como tiles TIPADOS por extensão: pastas, cenas, prefabs, texturas, scripts,
// presets, models. Clique seleciona; duplo-clique entra na pasta ou "abre" o
// asset. Estado em vars de MÓDULO (ok desde o fix de gcell); desenha via render.*.

import render from "../compat/render.ts";
import fs from "../compat/fs.ts";

import { PANEL, PANEL_DK, HEADER, BORDER, TEXT, TEXT_DIM, SEL, HOVER, button, subStr } from "./widgets";
import { drawThumb } from "./thumbs";

// tipos de asset (cor + rótulo do ícone)
const T_FOLDER = 0;
const T_SCENE = 1;   // .json de cena
const T_PREFAB = 2;  // .prefab.json
const T_IMAGE = 3;   // .png/.jpg/.jpeg/.bmp
const T_SCRIPT = 4;  // .ts/.js
const T_PRESET = 5;  // .preset
const T_MODEL = 6;   // .obj/.gltf
const T_TEXT = 7;    // .txt/.md
const T_OTHER = 8;

// ── estado do módulo ─────────────────────────────────────────────────────────
let root = "assets";
let curDir = "assets";
let selIdx = 0 - 1;
let scanned = 0;
let lastClickIdx = 0 - 1;
let lastClickFrame = 0 - 999;

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
let count = 0;

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
  return T_OTHER;
}
function typeColor(t: number): number {
  if (t === T_FOLDER) return 0xCBAF5AFF;   // amarelo pasta
  if (t === T_SCENE) return 0x66BB77FF;    // verde cena
  if (t === T_PREFAB) return 0x5AC8C8FF;   // ciano prefab
  if (t === T_IMAGE) return 0xB06AC8FF;    // roxo imagem
  if (t === T_SCRIPT) return 0x5A82C8FF;   // azul script
  if (t === T_PRESET) return 0xD2963EFF;   // laranja preset
  if (t === T_MODEL) return 0x9AA0A8FF;    // cinza model
  if (t === T_TEXT) return 0x808890FF;
  return 0x6A6A6AFF;
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
  return "?";
}

// ── varredura do diretório atual ─────────────────────────────────────────────
function rescan(): void {
  names = [];
  types = [];
  count = 0;
  const list = fs.readdir(curDir);
  if (list === undefined) { scanned = 1; return; }
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
  selIdx = 0 - 1;
  scanned = 1;
}

/// (re)inicializa o browser na pasta raiz de assets.
export function assetsInit(): void {
  curDir = root;
  scanned = 0;
  rescan();
}

// sobe um nível (não passa da raiz).
function goUp(): void {
  if (curDir.length <= root.length) return;
  let cut = 0 - 1;
  let i = 0;
  while (i < curDir.length) { if (curDir.charCodeAt(i) === 47) cut = i; i = i + 1; }  // '/'
  if (cut > 0) { curDir = subStr(curDir, 0, cut); rescan(); }
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
  const t = types[dragIdx];
  const full = curDir + "/" + names[dragIdx];
  if (t === T_FOLDER) return "dir:" + full;
  if (t === T_SCENE) return "scene:" + full;
  if (t === T_PREFAB) return "prefab:" + full;
  if (t === T_IMAGE) return "tex:" + full;
  if (t === T_MODEL) return "model:" + full;
  if (t === T_SCRIPT) return "script:" + full;
  return "other:" + full;
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
  render.rect(win, mx + 12, my - 10, 128, 26, 0x1E1E22EE, 1, typeColor(t), 4);
  render.rect(win, mx + 16, my - 6, 18, 18, typeColor(t), 0, 0, 3);
  let nm = names[dragIdx];
  if (nm.length > 13) nm = subStr(nm, 0, 12) + "…";
  render.text(win, mx + 40, my - 5, nm, TEXT, 12, 0);
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
  rescan();
}

// Desenha o ícone do asset num quadrado (x,y,s). Para IMAGEM e MODELO tenta
// primeiro o THUMBNAIL REAL (a própria imagem / um render 3D da malha); só cai
// no ícone genérico se não der pra gerar. `full` é o path do arquivo.
function drawIcon(win: i64, x: number, y: number, s: number, t: number, full: string): void {
  if (t === T_IMAGE || t === T_MODEL || t === T_PREFAB || t === T_SCENE) {
    if (drawThumb(win, full, t, x, y, s) !== 0) {
      render.rect(win, x, y, s, s, 0, 1, BORDER, 3);   // moldura por cima do preview
      const tg = typeTag(t);
      if (tg.length > 0) render.text(win, x + 3, y + s - 13, tg, 0xE8E8E8FF, 10, 0);
      return;
    }
  }
  const c = typeColor(t);
  if (t === T_FOLDER) {
    render.rect(win, x, y + 5, s, s - 8, c, 0, 0, 3);
    render.rect(win, x + 3, y + 1, s * 0.45, 6, c, 0, 0, 2);  // aba da pasta
  } else if (t === T_IMAGE) {
    render.rect(win, x, y, s, s, c, 1, BORDER, 3);
    render.rect(win, x + 5, y + s - 12, s - 10, 7, 0xFFFFFFAA, 0, 0, 1);  // "montanha"
  } else if (t === T_SCENE || t === T_PREFAB || t === T_MODEL) {
    // cubinho 3D (losango)
    render.rect(win, x + 6, y + 6, s - 12, s - 12, c, 1, 0x00000066, 3);
  } else {
    // "folha de arquivo"
    render.rect(win, x + 4, y + 2, s - 8, s - 4, c, 1, BORDER, 3);
  }
  const tag = typeTag(t);
  if (tag.length > 0) render.text(win, x + 3, y + s - 13, tag, 0x101014FF, 10, 0);
}

/// Desenha o Project panel em (px,py,pw,ph) e trata cliques. Retorna:
///   ""             — nada
///   "scene:<path>" — duplo-clique numa cena (main deve carregar)
///   "prefab:<path>"— duplo-clique num prefab (main deve instanciar)
///   "tex:<path>"   — duplo-clique numa imagem (main aplica no obj selecionado)
/// `mDown` é o estado ATUAL do botão esquerdo (segurando) — usado pra iniciar e
/// manter o DRAG dos tiles; o drop em si é tratado pelo main via assetDrag*().
export function drawAssets(win: i64, px: number, py: number, pw: number, ph: number,
                           mx: f64, my: f64, mPressed: number, mDown: number, frame: number): string {
  if (scanned === 0) rescan();
  render.rect(win, px, py, pw, ph, PANEL_DK, 0, 0, 0);
  // header
  render.rect(win, px, py, pw, 24, HEADER, 0, 0, 0);
  render.text(win, px + 10, py + 5, "Project", TEXT, 13, 0);
  // barra de caminho + botão subir
  const barY = py + 26;
  render.rect(win, px, barY, pw, 22, PANEL, 0, 0, 0);
  const upOver = mx >= px + 4 && mx < px + 30 && my >= barY + 2 && my < barY + 20;
  render.rect(win, px + 4, barY + 2, 26, 18, upOver !== false ? HOVER : PANEL_DK, 1, BORDER, 3);
  render.text(win, px + 12, barY + 4, "^", TEXT, 13, 0);
  if (upOver !== false && mPressed !== 0) goUp();
  render.text(win, px + 40, barY + 5, curDir, TEXT_DIM, 12, 0);
  // toolbar de gerenciamento REAL: criar pasta / deletar selecionado / atualizar
  const bw = 58;
  if (button(win, px + pw - bw * 3 - 12, barY + 1, bw, 20, "+ Pasta", PANEL_DK, mx, my, mPressed) !== 0) newFolder();
  if (button(win, px + pw - bw * 2 - 8, barY + 1, bw, 20, "Deletar", PANEL_DK, mx, my, mPressed) !== 0) deleteSelected();
  if (button(win, px + pw - bw - 4, barY + 1, bw, 20, "Atualizar", PANEL_DK, mx, my, mPressed) !== 0) { scanned = 0; rescan(); }

  let action = "";

  // ── ARMA o drag: com o botão segurado, basta afastar ~5px do ponto de pressão
  //    pra virar arrasto (abaixo disso ainda é clique/duplo-clique).
  if (dragIdx >= 0 && mDown !== 0 && dragArmed === 0) {
    const ddx = mx - dragX0;
    const ddy = my - dragY0;
    if (ddx * ddx + ddy * ddy > 25.0) dragArmed = 1;
  }
  // soltou sem armar → foi só um clique; limpa o candidato.
  if (dragIdx >= 0 && mDown === 0 && dragArmed === 0) dragIdx = 0 - 1;

  // grid de tiles
  const gx0 = px + 10;
  const gy0 = py + 54;
  const tileW = 84;
  const tileH = 78;
  const iconS = 46;
  const gap = 8;
  const cols = math_floor((pw - 20 + gap) / (tileW + gap));
  let i = 0;
  while (i < count) {
    const cc = i % cols;
    const rr = (i - cc) / cols;
    const tx = gx0 + cc * (tileW + gap);
    const ty = gy0 + rr * (tileH + gap);
    if (ty + tileH <= py + ph) {   // simples clip vertical
      const over = mx >= tx && mx < tx + tileW && my >= ty && my < ty + tileH;
      let bg = PANEL;
      if (i === selIdx) bg = SEL;
      else if (over !== false) bg = HOVER;
      render.rect(win, tx, ty, tileW, tileH, bg, 1, BORDER, 4);
      drawIcon(win, tx + (tileW - iconS) / 2, ty + 6, iconS, types[i], curDir + "/" + names[i]);
      // nome (corta se longo)
      let nm = names[i];
      if (nm.length > 12) nm = subStr(nm, 0, 11) + "…";
      render.text(win, tx + 5, ty + tileH - 15, nm, TEXT, 11, 0);

      // realce do tile que está sendo arrastado
      if (i === dragIdx && dragArmed !== 0) render.rect(win, tx, ty, tileW, tileH, 0x5A7FB055, 0, 0, 4);

      if (over !== false && mPressed !== 0) {
        const dbl = (i === lastClickIdx && frame - lastClickFrame < 24) ? 1 : 0;
        selIdx = i;
        // pressionar num tile ARMA um possível drag (pastas não são arrastáveis
        // pra cena, mas mantemos o payload "dir:" — o main decide o que aceitar)
        dragIdx = i; dragArmed = 0; dragX0 = mx; dragY0 = my;
        if (dbl !== 0) {
          const t = types[i];
          const full = curDir + "/" + names[i];
          if (t === T_FOLDER) { curDir = full; rescan(); }
          else if (t === T_SCENE) action = "scene:" + full;
          else if (t === T_PREFAB) action = "prefab:" + full;
          else if (t === T_IMAGE) action = "tex:" + full;   // aplica no obj selecionado
        }
        lastClickIdx = i;
        lastClickFrame = frame;
      }
    }
    i = i + 1;
  }
  if (count === 0) render.text(win, gx0, gy0, "(pasta vazia)", TEXT_DIM, 12, 0);
  return action;
}

// floor local (evita importar math só pra isto)
function math_floor(v: f64): number {
  const n = v | 0;
  return n;
}

// Editor RTS — widgets de UI imediata reutilizáveis, desenhando via render.*
// (namespace, despacha em função — ao contrário dos métodos de App). O estado de
// interação (scrub de campo numérico) vive em vars de MÓDULO, lidas/escritas
// pelas funções (ok desde o fix de gcell). Cada função recebe o handle da janela
// + o estado do mouse como PRIMITIVOS — nada de passar objetos/classes.

import render from "../compat/render.ts";
import math from "../compat/math.ts";
import input from "rts:input";
import { UI_C } from "./ui_config";

// ── cores do tema (Unity dark) ───────────────────────────────────────────────
export const PANEL = UI_C.panel;
export const PANEL_DK = UI_C.controlIdle;
export const HEADER = UI_C.widgetHeader;
export const BORDER = UI_C.border;
export const FIELD = UI_C.scrollbarTrack;
export const TEXT = UI_C.primaryText;
export const TEXT_DIM = UI_C.hint;
export const SEL = UI_C.fieldSelection;
export const HOVER = UI_C.controlHover;
export const AXIS_X = UI_C.widgetAxisX;
export const AXIS_Y = UI_C.widgetAxisY;
export const AXIS_Z = UI_C.widgetAxisZ;

// ── estado de scrub do campo numérico ────────────────────────────────────────
let sScrubId = 0 - 1;
let sScrubStart: f64 = 0.0;
let sScrubMx: f64 = 0.0;
// ── estado de EDIÇÃO por texto (clicar no valor pra digitar) ─────────────────
let nfEditId = 0 - 1;    // id do campo em modo digitação (-1 = nenhum)
let nfEditText = "";     // buffer do texto sendo digitado
let nfSelectAll = 0;

/// 1 se algum numField está em modo DIGITAÇÃO — pra gatear atalhos globais de tecla
/// (não trocar de ferramenta enquanto o usuário digita um valor).
export function nfEditing(): number {
  if (nfEditId >= 0) return 1;
  return 0;
}

export function nfCancel(): void {
  nfEditId = 0 - 1;
  nfSelectAll = 0;
  sScrubId = 0 - 1;
}

/// substring SEGURO: `.substring` direto num GCELL (module-let escrito por função)
/// volta "undefined" (leitura de gcell é Tagged sem shape de string). Passando por
/// PARAM o método despacha. Use isto pra fatiar strings de estado de módulo.
export function subStr(s: string, a: number, b: number): string {
  return s.substring(a, b);
}

// arredonda p/ 2 casas (evita floats gigantes na tela)
function r2(v: f64): f64 {
  return math.floor(v * 100.0 + 0.5) / 100.0;
}

/// Retângulo preenchido simples.
export function panel(win: i64, x: number, y: number, w: number, h: number, fill: number): void {
  render.rect(win, x, y, w, h, fill, 0, 0, 0);
}
export function line(win: i64, x1: number, y1: number, x2: number, y2: number, color: number): void {
  render.line(win, x1, y1, x2, y2, 1, color);
}
export function label(win: i64, x: number, y: number, s: string, color: number, size: number): void {
  render.text(win, x, y, s, color, size, 0);
}

/// Botão. Retorna 1 se foi clicado (pressionado sobre ele) neste frame.
export function button(win: i64, x: number, y: number, w: number, h: number, s: string,
                       base: number, mx: f64, my: f64, mPressed: number): number {
  const over = mx >= x && mx < x + w && my >= y && my < y + h;
  let fill = base;
  if (over) fill = HOVER;
  render.rect(win, x, y, w, h, fill, 1, BORDER, 3);
  render.text(win, x + 8, y + (h / 2 - 8), s, TEXT, 13, 0);
  if (over && mPressed !== 0) return 1;
  return 0;
}

/// SLOT DE ASSET estilo Unity ("object field"): retângulo que MOSTRA o asset
/// atualmente referenciado e ACEITA um asset arrastado do Project. Só desenha e
/// faz hit-test — quem aplica o drop é o chamador (o main sabe o payload).
///   `label`     — rótulo à esquerda ("Textura", "Mesh"...)
///   `cur`       — path/nome do asset atual ("" = vazio, mostra "None")
///   `dragOK`    — 1 se o asset sendo arrastado é COMPATÍVEL com este slot
/// Retorna 1 quando o cursor está sobre o slot (o chamador usa isso, junto com
/// o release do mouse, pra confirmar o drop).
export function assetField(win: i64, x: number, y: number, w: number, h: number,
                           lbl: string, cur: string, dragOK: number,
                           mx: f64, my: f64): number {
  const over = mx >= x && mx < x + w && my >= y && my < y + h ? 1 : 0;
  render.text(win, x, y + (h / 2 - 7), lbl, TEXT_DIM, 12, 0);
  const fx = x + 66;
  const fw = w - 66;
  // realce verde quando um drag COMPATÍVEL paira sobre o slot (feedback Unity)
  let fill = FIELD;
  let brd = BORDER;
  if (dragOK !== 0 && over !== 0) { fill = UI_C.rowDropTarget; brd = UI_C.dropMarker; }
  else if (dragOK !== 0) brd = UI_C.componentEnabled;   // slots compatíveis "acendem" durante o drag
  render.rect(win, fx, y, fw, h, fill, 1, brd, 3);
  // mostra só o nome do arquivo (o path inteiro não cabe)
  let show = cur;
  if (show.length === 0) show = "None";
  else {
    let cut = 0 - 1;
    let i = 0;
    while (i < show.length) { if (show.charCodeAt(i) === 47) cut = i; i = i + 1; }   // '/'
    if (cut >= 0) show = subStr(show, cut + 1, show.length);
  }
  const maxc = ((fw - 14) / 7) | 0;
  if (show.length > maxc && maxc > 1) show = subStr(show, 0, maxc - 1) + "…";
  render.text(win, fx + 7, y + (h / 2 - 7), show, cur.length === 0 ? TEXT_DIM : TEXT, 12, 0);
  return over;
}

/// Campo numérico estilo Unity: aba colorida (X/Y/Z) = ARRASTAR faz scrub; área
/// do VALOR = CLICAR entra em modo digitação (input de texto → parseFloat no
/// Enter/clique fora). `id` estável por campo. Devolve o valor atual.
export function numField(win: i64, id: number, x: number, y: number, w: number,
                         lbl: string, tab: number, value: f64,
                         mx: f64, my: f64, mDown: number, mPressed: number): f64 {
  const overTab = mx >= x && mx < x + 16 && my >= y && my < y + 20;
  const overVal = mx >= x + 16 && mx < x + w && my >= y && my < y + 20;
  let v = value;

  // clicar no VALOR → entra em edição de texto (semente = valor atual)
  if (mPressed !== 0 && overVal) { nfEditId = id; nfEditText = "" + r2(value); nfSelectAll = 1; }
  // clicar em qualquer outro lugar → confirma a edição deste campo
  if (mPressed !== 0 && !overVal && nfEditId === id) {
    const parsed = parseFloat(nfEditText);
    if (parsed === parsed && parsed > -1e30 && parsed < 1e30) v = parsed;
    nfEditId = 0 - 1;
    nfSelectAll = 0;
  }

  // scrub pela ABA (só quando NÃO está editando este campo)
  if (nfEditId !== id) {
    if (mPressed !== 0 && overTab) { sScrubId = id; sScrubStart = value; sScrubMx = mx; }
    if (sScrubId === id) {
      if (mDown !== 0) { v = sScrubStart + (mx - sScrubMx) * 0.02; }
      else { sScrubId = 0 - 1; }
    }
  }

  // ── desenho ──
  render.rect(win, x, y, w, 20, FIELD, 1, BORDER, 3);
  render.rect(win, x, y, 16, 20, tab, 0, 0, 3);       // aba colorida (scrub)
  render.text(win, x + 4, y + 3, lbl, UI_C.axisLabelText, 12, 0);

  if (nfEditId === id) {
    // modo digitação: acumula texto, backspace (tecla 4), Enter (tecla 1) confirma
    if (input.modCtrl(win) && input.key(win, 100, 1)) nfSelectAll = 1;
    const typed = input.modCtrl(win) ? "" : input.textInput(win);
    if (typed.length > 0) { nfEditText = nfSelectAll !== 0 ? typed : nfEditText + typed; nfSelectAll = 0; }
    if (input.key(win, 4, 1)) {
      nfEditText = nfSelectAll !== 0 || nfEditText.length === 0 ? "" : subStr(nfEditText, 0, nfEditText.length - 1);
      nfSelectAll = 0;
    }
    render.rect(win, x + 16, y, w - 16, 20, UI_C.numberEditor, 1, UI_C.numberEditorBorder, 3);
    if (nfSelectAll !== 0) render.rect(win, x + 19, y + 2, w - 22, 16, UI_C.fieldSelection, 0, 0, 1);
    render.text(win, x + 22, y + 3, nfEditText + "|", UI_C.white, 12, 0);
    if (input.key(win, 2, 1)) { nfCancel(); return value; }
    if (input.key(win, 1, 1)) {
      const parsed = parseFloat(nfEditText);
      nfCancel();
      if (parsed === parsed && parsed > -1e30 && parsed < 1e30) return parsed;
      return value;
    }
    return value;   // enquanto digita, mantém o valor até confirmar
  }
  render.text(win, x + 22, y + 3, "" + r2(v), UI_C.popupText, 12, 0);
  return v;
}

/// Checkbox. Recebe 0/1, devolve o novo estado (alterna ao clicar).
export function checkbox(win: i64, x: number, y: number, checked: number, lbl: string,
                         mx: f64, my: f64, mPressed: number): number {
  const over = mx >= x && mx < x + 18 && my >= y && my < y + 18;
  let r = checked;
  if (over && mPressed !== 0) { if (checked === 0) r = 1; else r = 0; }
  render.rect(win, x, y, 18, 18, FIELD, 1, BORDER, 3);
  if (r !== 0) render.rect(win, x + 4, y + 4, 10, 10, UI_C.checkboxMark, 0, 0, 2);
  render.text(win, x + 24, y + 1, lbl, TEXT, 13, 0);
  return r;
}

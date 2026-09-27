// Editor RTS — widgets de UI imediata reutilizáveis, desenhando via render.*
// (namespace, despacha em função — ao contrário dos métodos de App). O estado de
// interação (scrub de campo numérico) vive em vars de MÓDULO, lidas/escritas
// pelas funções (ok desde o fix de gcell). Cada função recebe o handle da janela
// + o estado do mouse como PRIMITIVOS — nada de passar objetos/classes.

import math from "../compat/math.ts";
import input from "@compat/input";
import { UI_C, UI_NUMERIC as N } from "./ui_config";

import { caixa, estiloTexto, pincel, texto, janelaAtual2D } from "@compat/draw2d.ts";
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

/// Texto que um campo mostra, refeito só quando o valor (ou a largura/o caminho) muda.
/// Um por controle (EditorControl.campo): sem `"" + valor` nem `subStr` por quadro.
export class CampoCache {
  id: number = 0;
  valor: f64 = 0.0; largura: number = 0 - 1; texto: string = "";
  caminho: string = ""; mostrado: string = "";
  rotulo: string = ""; rotuloN: number = 0 - 1; rotuloTexto: string = "";
}

// ── retângulo e mouse do próximo widget ──────────────────────────────────────
// Os widgets recebem no máximo 4 parâmetros (Task 10.5: 5+ parâmetros alocam
// por chamada no RTS). Quem desenha chama `widgetRect` e `widgetMouse` antes.
let wX: f64 = 0.0; let wY: f64 = 0.0; let wW: f64 = 0.0; let wH: f64 = 0.0;
let wMx: f64 = 0.0; let wMy: f64 = 0.0; let wDown = 0; let wPressed = 0;
/// Retângulo do próximo widget.
export function widgetRect(x: number, y: number, w: number, h: number): void { wX = x; wY = y; wW = w; wH = h; }
/// Mouse visto pelo próximo widget (down/pressed zerados = sem input).
export function widgetMouse(mx: number, my: number, down: number, pressed: number): void {
  wMx = mx; wMy = my; wDown = down; wPressed = pressed;
}

/// Botão. Retorna 1 se foi clicado (pressionado sobre ele) neste frame.
export function button(s: string, base: number): number {
  const x = wX; const y = wY; const w = wW; const h = wH; const mx = wMx; const my = wMy; const mPressed = wPressed;
  const over = mx >= x && mx < x + w && my >= y && my < y + h;
  let fill = base;
  if (over) fill = HOVER;
  pincel(fill, 1, BORDER, 3); caixa(x, y, w, h);
  texto(x + 8, y + (h / 2 - 8), s, estiloTexto(TEXT, 13));
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
export function assetField(c: CampoCache, lbl: string, cur: string, dragOK: number): number {
  const x = wX; const y = wY; const w = wW; const h = wH; const mx = wMx; const my = wMy;
  const over = mx >= x && mx < x + w && my >= y && my < y + h ? 1 : 0;
  texto(x, y + (h / 2 - 7), lbl, estiloTexto(TEXT_DIM, 12));
  const fx = x + 66;
  const fw = w - 66;
  // realce verde quando um drag COMPATÍVEL paira sobre o slot (feedback Unity)
  let fill = FIELD;
  let brd = BORDER;
  if (dragOK !== 0 && over !== 0) { fill = UI_C.rowDropTarget; brd = UI_C.dropMarker; }
  else if (dragOK !== 0) brd = UI_C.componentEnabled;   // slots compatíveis "acendem" durante o drag
  pincel(fill, 1, brd, 3); caixa(fx, y, fw, h);
  // mostra só o nome do arquivo (o path inteiro não cabe); refeito só quando o caminho ou a largura mudam
  const maxc = ((fw - 14) / 7) | 0;
  if (c.caminho !== cur || c.largura !== maxc || c.mostrado.length === 0) {
    c.caminho = cur; c.largura = maxc;
    let show = cur;
    if (show.length === 0) show = "None";
    else {
      let cut = 0 - 1;
      let i = 0;
      while (i < show.length) { if (show.charCodeAt(i) === 47) cut = i; i = i + 1; }   // '/'
      if (cut >= 0) show = subStr(show, cut + 1, show.length);
    }
    if (show.length > maxc && maxc > 1) show = subStr(show, 0, maxc - 1) + "…";
    c.mostrado = show;
  }
  texto(fx + 7, y + (h / 2 - 7), c.mostrado, estiloTexto(cur.length === 0 ? TEXT_DIM : TEXT, 12));
  return over;
}

/// Campo numérico estilo Unity: aba colorida (X/Y/Z) = ARRASTAR faz scrub; área
/// do VALOR = CLICAR entra em modo digitação (input de texto → parseFloat no
/// Enter/clique fora). `id` estável por campo. Devolve o valor atual.
export function numField(c: CampoCache, lbl: string, tab: number, value: f64): f64 {
  const id = c.id;
  const win = janelaAtual2D();
  const x = wX; const y = wY; const w = wW; const mx = wMx; const my = wMy; const mDown = wDown; const mPressed = wPressed;
  const tabWidth = lbl.length === 0 ? 0 : N.axisWidth;
  const valueX = x + tabWidth;
  const valueWidth = w - tabWidth;
  const overTab = mx >= x && mx < valueX && my >= y && my < y + N.height;
  const overVal = mx >= valueX && mx < x + w && my >= y && my < y + N.height;
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
  pincel(FIELD, 1, BORDER, 3); caixa(x, y, w, N.height);
  if (tabWidth > 0) {
    pincel(tab, 0, 0, 3); caixa(x, y, tabWidth, N.height);
    texto(x + 4, y + N.textY, lbl, estiloTexto(UI_C.axisLabelText, N.font));
  }

  if (nfEditId === id) {
    // modo digitação: acumula texto, backspace (tecla 4), Enter (tecla 1) confirma
    if (input.modCtrl(win) && input.key(win, 100, 1)) nfSelectAll = 1;
    const typed = input.modCtrl(win) ? "" : input.textInput(win);
    if (typed.length > 0) { nfEditText = nfSelectAll !== 0 ? typed : nfEditText + typed; nfSelectAll = 0; }
    if (input.key(win, 4, 1)) {
      nfEditText = nfSelectAll !== 0 || nfEditText.length === 0 ? "" : subStr(nfEditText, 0, nfEditText.length - 1);
      nfSelectAll = 0;
    }
    pincel(UI_C.numberEditor, 1, UI_C.numberEditorBorder, 3); caixa(valueX, y, valueWidth, N.height);
    if (nfSelectAll !== 0) { pincel(UI_C.fieldSelection, 0, 0, 1); caixa(valueX + N.textY, y + 2, valueWidth - N.padding, N.height - 4); }
    const editChars = math.max(1, ((valueWidth - N.padding * 2) / N.charWidth) | 0);
    const editingText = nfEditText;
    texto(valueX + N.padding, y + N.textY, subStr(editingText, math.max(0, editingText.length - editChars), editingText.length) + "|", estiloTexto(UI_C.white, N.font));
    if (input.key(win, 2, 1)) { nfCancel(); return value; }
    if (input.key(win, 1, 1)) {
      const parsed = parseFloat(nfEditText);
      nfCancel();
      if (parsed === parsed && parsed > -1e30 && parsed < 1e30) return parsed;
      return value;
    }
    return value;   // enquanto digita, mantém o valor até confirmar
  }
  const valueChars = math.max(1, ((valueWidth - N.padding * 2) / N.charWidth) | 0);
  // "" + r2(v) só quando o valor mostrado ou a largura mudam (não por quadro)
  if (c.valor !== v || c.largura !== valueChars || c.texto.length === 0) {
    c.valor = v; c.largura = valueChars;
    let valueText = "" + r2(v);
    if (valueText.length > valueChars) valueText = subStr(valueText, 0, valueChars - 1) + "…";
    c.texto = valueText;
  }
  texto(valueX + N.padding, y + N.textY, c.texto, estiloTexto(UI_C.popupText, N.font));
  return v;
}

// Propriedades de componentes: rotulo legivel em uma coluna, valor na outra.
// Reusa a edicao numerica sem a aba de eixo, que so comporta X/Y/Z.
export function propertyField(c: CampoCache, lbl: string, value: f64): f64 {
  const x = wX; const y = wY; const w = wW;
  const labelWidth = (w * N.labelFraction) | 0;
  const chars = math.max(1, ((labelWidth - N.labelGap) / N.charWidth) | 0);
  // rótulo cortado: o chamador passa o mesmo `lbl` a cada quadro; refeito só quando muda
  if (c.rotulo !== lbl || c.rotuloN !== chars) {
    c.rotulo = lbl; c.rotuloN = chars;
    c.rotuloTexto = lbl.length > chars ? subStr(lbl, 0, chars - 1) + "…" : lbl;
  }
  texto(x, y + N.textY, c.rotuloTexto, estiloTexto(TEXT, N.font));
  wX = x + labelWidth; wW = w - labelWidth;
  return numField(c, "", FIELD, value);
}

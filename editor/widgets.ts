// Editor RTS — widgets de UI imediata reutilizáveis, desenhando via render.*
// (namespace, despacha em função — ao contrário dos métodos de App). O estado de
// interação (scrub de campo numérico) vive em vars de MÓDULO, lidas/escritas
// pelas funções (ok desde o fix de gcell). Cada função recebe o handle da janela
// + o estado do mouse como PRIMITIVOS — nada de passar objetos/classes.

import render from "rts:render";
import math from "rts:math";
import input from "rts:input";

// ── cores do tema (Unity dark) ───────────────────────────────────────────────
export const PANEL = 0x383838FF;
export const PANEL_DK = 0x2D2D2DFF;
export const HEADER = 0x3C3C3CFF;   // casa o dark theme da Unity (header/toolbar)
export const BORDER = 0x232323FF;
export const FIELD = 0x2A2A2AFF;
export const TEXT = 0xC8C8C8FF;
export const TEXT_DIM = 0x8A8A8AFF;
export const SEL = 0x3A6C9FFF;      // azul de seleção da Unity (com foco)
export const HOVER = 0x454545FF;
export const AXIS_X = 0xC85A5AFF;   // eixos estilo Unity (X vermelho, Y verde, Z azul)
export const AXIS_Y = 0x88C05AFF;
export const AXIS_Z = 0x5A82C8FF;

// ── estado de scrub do campo numérico ────────────────────────────────────────
let sScrubId = 0 - 1;
let sScrubStart: f64 = 0.0;
let sScrubMx: f64 = 0.0;
// ── estado de EDIÇÃO por texto (clicar no valor pra digitar) ─────────────────
let nfEditId = 0 - 1;    // id do campo em modo digitação (-1 = nenhum)
let nfEditText = "";     // buffer do texto sendo digitado

/// 1 se algum numField está em modo DIGITAÇÃO — pra gatear atalhos globais de tecla
/// (não trocar de ferramenta enquanto o usuário digita um valor).
export function nfEditing(): number {
  if (nfEditId >= 0) return 1;
  return 0;
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
  if (dragOK !== 0 && over !== 0) { fill = 0x2E5A3AFF; brd = 0x77DD99FF; }
  else if (dragOK !== 0) brd = 0x5A7FB0FF;   // slots compatíveis "acendem" durante o drag
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
  if (mPressed !== 0 && overVal) { nfEditId = id; nfEditText = "" + r2(value); }
  // clicar em qualquer outro lugar → confirma a edição deste campo
  if (mPressed !== 0 && !overVal && nfEditId === id) {
    v = parseFloat(nfEditText);
    nfEditId = 0 - 1;
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
  render.text(win, x + 4, y + 3, lbl, 0x101010FF, 12, 0);

  if (nfEditId === id) {
    // modo digitação: acumula texto, backspace (tecla 4), Enter (tecla 1) confirma
    const typed = input.textInput(win);
    if (typed.length > 0) nfEditText = nfEditText + typed;
    if (input.key(win, 4, 1) !== 0 && nfEditText.length > 0) nfEditText = subStr(nfEditText, 0, nfEditText.length - 1);
    render.rect(win, x + 16, y, w - 16, 20, 0x1A1F28FF, 1, 0x3399FFFF, 3);
    render.text(win, x + 22, y + 3, nfEditText + "|", 0xFFFFFFFF, 12, 0);
    if (input.key(win, 1, 1) !== 0) { v = parseFloat(nfEditText); nfEditId = 0 - 1; return v; }
    return value;   // enquanto digita, mantém o valor até confirmar
  }
  render.text(win, x + 22, y + 3, "" + r2(v), 0xD4D4D4FF, 12, 0);
  return v;
}

/// Checkbox. Recebe 0/1, devolve o novo estado (alterna ao clicar).
export function checkbox(win: i64, x: number, y: number, checked: number, lbl: string,
                         mx: f64, my: f64, mPressed: number): number {
  const over = mx >= x && mx < x + 18 && my >= y && my < y + 18;
  let r = checked;
  if (over && mPressed !== 0) { if (checked === 0) r = 1; else r = 0; }
  render.rect(win, x, y, 18, 18, FIELD, 1, BORDER, 3);
  if (r !== 0) render.rect(win, x + 4, y + 4, 10, 10, 0x66BB66FF, 0, 0, 2);
  render.text(win, x + 24, y + 1, lbl, TEXT, 13, 0);
  return r;
}

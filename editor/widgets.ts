// Editor RTS — widgets de UI imediata reutilizáveis, desenhando via render.*
// (namespace, despacha em função — ao contrário dos métodos de App). O estado de
// interação (scrub de campo numérico) vive em vars de MÓDULO, lidas/escritas
// pelas funções (ok desde o fix de gcell). Cada função recebe o handle da janela
// + o estado do mouse como PRIMITIVOS — nada de passar objetos/classes.

import render from "rts:render";
import math from "rts:math";

// ── cores do tema (Unity dark) ───────────────────────────────────────────────
export const PANEL = 0x383838FF;
export const PANEL_DK = 0x2D2D2DFF;
export const HEADER = 0x303030FF;
export const BORDER = 0x232323FF;
export const FIELD = 0x2A2A2AFF;
export const TEXT = 0xC8C8C8FF;
export const TEXT_DIM = 0x8A8A8AFF;
export const SEL = 0x4A75B0FF;
export const HOVER = 0x454545FF;
export const AXIS_X = 0xC85A5AFF;   // eixos estilo Unity (X vermelho, Y verde, Z azul)
export const AXIS_Y = 0x88C05AFF;
export const AXIS_Z = 0x5A82C8FF;

// ── estado de scrub do campo numérico ────────────────────────────────────────
let sScrubId = 0 - 1;
let sScrubStart: f64 = 0.0;
let sScrubMx: f64 = 0.0;

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

/// Campo numérico estilo Unity: aba colorida (X/Y/Z) + valor; ARRASTAR na
/// horizontal faz scrub do valor. `id` estável por campo. Devolve o novo valor.
export function numField(win: i64, id: number, x: number, y: number, w: number,
                         lbl: string, tab: number, value: f64,
                         mx: f64, my: f64, mDown: number, mPressed: number): f64 {
  const over = mx >= x && mx < x + w && my >= y && my < y + 20;
  let v = value;
  if (mPressed !== 0 && over) { sScrubId = id; sScrubStart = value; sScrubMx = mx; }
  if (sScrubId === id) {
    if (mDown !== 0) { v = sScrubStart + (mx - sScrubMx) * 0.02; }
    else { sScrubId = 0 - 1; }
  }
  render.rect(win, x, y, w, 20, FIELD, 1, BORDER, 3);
  render.rect(win, x, y, 16, 20, tab, 0, 0, 3);
  render.text(win, x + 4, y + 3, lbl, 0x101010FF, 12, 0);
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

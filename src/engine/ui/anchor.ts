// Âncoras de UI (estilo RectTransform da Unity): a posição de um elemento é um
// offset a partir de um canto da janela, então segue o resize. Funções puras,
// sem janela, para o teste cobrir a conta.

export const ANCHOR_TL: number = 0;   // top-left (default)
export const ANCHOR_TR: number = 1;   // top-right
export const ANCHOR_BL: number = 2;   // bottom-left
export const ANCHOR_BR: number = 3;   // bottom-right

/// X em tela do elemento de largura `elemW`, com offset `ox` a partir do canto.
export function anchorX(anchor: number, ox: f64, winW: f64, elemW: f64): f64 {
  if (anchor === ANCHOR_TR || anchor === ANCHOR_BR) return winW - elemW - ox;
  return ox;
}

/// Y em tela do elemento de altura `elemH`, com offset `oy` a partir do canto.
export function anchorY(anchor: number, oy: f64, winH: f64, elemH: f64): f64 {
  if (anchor === ANCHOR_BL || anchor === ANCHOR_BR) return winH - elemH - oy;
  return oy;
}

/// 1 se (mx, my) está dentro do retângulo.
export function hitRect(mx: f64, my: f64, x: f64, y: f64, w: f64, h: f64): number {
  return (mx >= x && mx < x + w && my >= y && my < y + h) ? 1 : 0;
}

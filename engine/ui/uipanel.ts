// Engine RTS — UIPanel: um elemento de UI que é um COMPONENT (kind UI) de um
// GameObject. Desenha uma caixa + título em tela 2D, na posição do host Transform
// (px/py usados como x/y de tela). É o SEAM da visão "tudo é GameObject": um
// pedaço da UI do editor agora é um GameObject rodando no mesmo modelo do mundo.
//
// Desenha via render.* (mesmo backend imediato que a UI egui usa); o pass de
// UI-scene (main.ts) chama drawUI() de cada UI GameObject dentro do frame egui.

import { Behavior, KIND_UI } from "../core/behavior";
import render from "rts:render";

// Âncora estilo RectTransform da Unity: a qual canto da janela o offset é relativo.
export const ANCHOR_TL: number = 0;   // top-left (default)
export const ANCHOR_TR: number = 1;   // top-right
export const ANCHOR_BL: number = 2;   // bottom-left
export const ANCHOR_BR: number = 3;   // bottom-right

export class UIPanel extends Behavior {
  w: number;       // largura em px
  h: number;       // altura em px
  color: number;   // cor de fundo (0xRRGGBBAA)
  title: string;   // texto exibido (pode ser atualizado ao vivo via setUITitle)
  anchor: number;  // canto de ancoragem (ANCHOR_*); o offset é host.px/py a partir dele

  constructor(w: number, h: number, color: number, title: string, anchor: number) {
    super();
    this.w = w;
    this.h = h;
    this.color = color;
    this.title = title;
    this.anchor = anchor;
  }

  kind(): number { return KIND_UI; }
  typeName(): string { return "UIPanel"; }

  /// Desenha a caixa + título. A posição é o offset (host.px/py) A PARTIR do canto
  /// ancorado, calculado com o tamanho atual da janela (w/h) — segue o resize.
  drawUI(win: i64, w: f64, h: f64): void {
    const ox: f64 = this.host.px;
    const oy: f64 = this.host.py;
    let x: f64 = ox;
    let y: f64 = oy;
    if (this.anchor === ANCHOR_TR || this.anchor === ANCHOR_BR) x = w - this.w - ox;
    if (this.anchor === ANCHOR_BL || this.anchor === ANCHOR_BR) y = h - this.h - oy;
    render.rect(win, x, y, this.w, this.h, this.color, 1, 0x00000088, 5);
    render.text(win, x + 8, y + 6, this.title, 0xE8E8ECFF, 12, 0);
  }

  setUITitle(s: string): void { this.title = s; }

  toData(): any {
    return { type: "uiPanel", w: this.w, h: this.h, color: this.color, title: this.title };
  }
}

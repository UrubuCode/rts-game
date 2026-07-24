// Engine RTS — UIPanel: um elemento de UI que é um COMPONENT (kind UI) de um
// GameObject. Desenha uma caixa + título em tela 2D, na posição do host Transform
// (px/py usados como x/y de tela). É o SEAM da visão "tudo é GameObject": um
// pedaço da UI do editor agora é um GameObject rodando no mesmo modelo do mundo.
//
// Desenha via render.* (mesmo backend imediato que a UI egui usa); o pass de
// UI-scene (main.ts) chama drawUI() de cada UI GameObject dentro do frame egui.

import { Behavior, KIND_UI } from "../core/behavior";
import render from "rts:render";

export class UIPanel extends Behavior {
  w: number;       // largura em px
  h: number;       // altura em px
  color: number;   // cor de fundo (0xRRGGBBAA)
  title: string;   // texto exibido (pode ser atualizado ao vivo via setUITitle)

  constructor(w: number, h: number, color: number, title: string) {
    super();
    this.w = w;
    this.h = h;
    this.color = color;
    this.title = title;
  }

  kind(): number { return KIND_UI; }
  typeName(): string { return "UIPanel"; }

  /// Desenha a caixa + título em (host.px, host.py) — coords de tela 2D.
  drawUI(win: i64): void {
    const x: f64 = this.host.px;
    const y: f64 = this.host.py;
    render.rect(win, x, y, this.w, this.h, this.color, 1, 0x00000088, 5);
    render.text(win, x + 8, y + 6, this.title, 0xE8E8ECFF, 12, 0);
  }

  setUITitle(s: string): void { this.title = s; }

  toData(): any {
    return { type: "uiPanel", w: this.w, h: this.h, color: this.color, title: this.title };
  }
}

// Engine RTS — UIButton: botão 2D de UI do JOGO como componente de um
// GameObject da cena. Desenhado pelo pass de UI do jogo (`game_ui.ts`), que
// depois do desenho pergunta `uiClicked()` e, se 1, chama `onUIClick(label)`
// em todos os behaviors habilitados do MESMO GameObject — o script do botão é
// um irmão, como o OnClick da Unity aponta para um componente.
//
// O input é lido aqui (mouse da janela), não em callback: um clique é "mouse
// pressionado neste frame dentro do retângulo".

import { Behavior, KIND_UI } from "@engine/core/behavior";
import { anchorX, anchorY, hitRect, ANCHOR_TL } from "@engine/ui/anchor";
import render from "@compat/render.ts";
import input from "rts:input";

/**
 * @componentCategory UI
 * @componentDescription Botão na tela do jogo; o clique chega em onUIClick(label) dos scripts do mesmo objeto.
 * @componentKeywords ui botao button clique
 */
export class UIButton extends Behavior {
  label: string;
  w: number;
  h: number;
  color: number;       // fundo 0xRRGGBBAA
  hoverColor: number;
  textColor: number;
  anchor: number;
  /// 1 no frame em que foi clicado (lido por `game_ui.ts`), 0 nos demais.
  clicked: number;
  hot: number;

  constructor(label: string = "Botao", w: number = 160, h: number = 36, anchor: number = ANCHOR_TL) {
    super();
    this.label = label;
    this.w = w;
    this.h = h;
    this.anchor = anchor;
    this.color = 0x2E3440FF;
    this.hoverColor = 0x4C566AFF;
    this.textColor = 0xECEFF4FF;
    this.clicked = 0;
    this.hot = 0;
  }

  kind(): number { return KIND_UI; }
  typeName(): string { return "UIButton"; }

  drawUI(win: i64, w: f64, h: f64): void {
    const x = anchorX(this.anchor, this.host.px, w, this.w);
    const y = anchorY(this.anchor, this.host.py, h, this.h);
    const mx: f64 = input.mouseX(win);
    const my: f64 = input.mouseY(win);
    this.hot = hitRect(mx, my, x, y, this.w, this.h);
    this.clicked = (this.hot !== 0 && input.mousePressed(win, 0)) ? 1 : 0;
    render.rect(win, x, y, this.w, this.h, this.hot !== 0 ? this.hoverColor : this.color, 1, 0x00000088, 5);
    const size: f64 = 14;
    const tw: f64 = this.label.length * size * 0.6;
    render.text(win, x + (this.w - tw) * 0.5, y + (this.h - size) * 0.5, this.label, this.textColor, size, 0);
  }

  uiClicked(): number { return this.clicked; }
  uiName(): string { return this.label; }
  setUITitle(s: string): void { this.label = s; }

  fieldCount(): number { return 3; }
  fieldLabel(i: number): string {
    if (i === 0) return "Width";
    if (i === 1) return "Height";
    return "Anchor";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.w * 1.0;
    if (i === 1) return this.h * 1.0;
    return this.anchor * 1.0;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) { this.w = v | 0; return; }
    if (i === 1) { this.h = v | 0; return; }
    this.anchor = v | 0;
  }
  fieldStringGet(i: number): string { return this.label; }
  fieldStringSet(i: number, v: string): void { this.label = v; }

  toData(): any {
    return { t: "uiButton", label: this.label, w: this.w, h: this.h, anchor: this.anchor,
             color: this.color, hoverColor: this.hoverColor, textColor: this.textColor };
  }
}

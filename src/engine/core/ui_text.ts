// Engine RTS — UIText: texto 2D de UI do JOGO como componente de um GameObject
// da cena (serializa com ela e é desenhado pelo pass de UI do jogo em
// `src/engine/ui/game_ui.ts`, no jogo e no Play do editor). A posição é
// `host.px/py` como offset em pixels a partir do canto `anchor`.
//
// Caminho FRIO: uma chamada de desenho por elemento por frame; nada por objeto
// da cena. Ver docs/sobrecarga-de-operador.md sobre o que pertence a laços quentes.

import { Behavior, KIND_UI } from "@engine/core/behavior";
import { anchorX, anchorY, ANCHOR_TL } from "@engine/ui/anchor";
import render from "@compat/render.ts";

/**
 * @componentCategory UI
 * @componentDescription Texto na tela do jogo, ancorado a um canto da janela.
 * @componentKeywords ui texto hud label
 */
export class UIText extends Behavior {
  text: string;
  size: number;
  color: number;    // 0xRRGGBBAA
  anchor: number;   // ANCHOR_* (0 TL, 1 TR, 2 BL, 3 BR)

  constructor(text: string = "Texto", size: number = 16, color: number = 0xE8E8ECFF, anchor: number = ANCHOR_TL) {
    super();
    this.text = text;
    this.size = size;
    this.color = color;
    this.anchor = anchor;
  }

  kind(): number { return KIND_UI; }
  typeName(): string { return "UIText"; }

  drawUI(win: i64, w: f64, h: f64): void {
    // largura estimada pelo tamanho da fonte: só importa para âncoras à direita
    const estW: f64 = this.text.length * this.size * 0.6;
    const x = anchorX(this.anchor, this.host.px, w, estW);
    const y = anchorY(this.anchor, this.host.py, h, this.size);
    render.text(win, x, y, this.text, this.color, this.size, 0);
  }

  setUITitle(s: string): void { this.text = s; }

  fieldCount(): number { return 3; }
  fieldLabel(i: number): string {
    if (i === 0) return "Size";
    if (i === 1) return "Anchor";
    return "Color";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.size * 1.0;
    if (i === 1) return this.anchor * 1.0;
    return this.color * 1.0;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) { this.size = v | 0; return; }
    if (i === 1) { this.anchor = v | 0; return; }
    this.color = v | 0;
  }
  fieldStringGet(i: number): string { return this.text; }
  fieldStringSet(i: number, v: string): void { this.text = v; }

  toData(): any {
    return { t: "uiText", text: this.text, size: this.size, color: this.color, anchor: this.anchor };
  }
}

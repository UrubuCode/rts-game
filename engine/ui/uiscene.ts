// Engine RTS — UIScene: a lista de GameObjects de UI + o pass que os desenha.
// Espelha a Scene do mundo, mas pra UI 2D: cada painel/elemento é um GameObject
// com um component de UI (kind UI). Encapsulado num SINGLETON (o motor promove
// `const x = new UIScene()` com class-tracking → métodos despacham de dentro de
// funções, sem as pegadinhas de gcell de um array de módulo cru).
//
// É o primeiro passo concreto da visão "tudo é GameObject": um pedaço da UI do
// editor roda no mesmo modelo do mundo (GameObject + component), só num pass 2D.

import { GameObject } from "../core/gameobject";
import { KIND_UI } from "../core/behavior";

export class UIScene {
  panels: GameObject[];

  constructor() {
    this.panels = [];
  }

  /// Anexa um GameObject de UI à cena.
  add(go: GameObject): void {
    this.panels.push(go);
  }

  /// Desenha todos os elementos de UI (chama drawUI de cada component kind UI).
  /// `w`/`h` = tamanho lógico da janela (pras âncoras). Chamado DENTRO do frame
  /// egui (entre beginFrame e endFrame).
  draw(win: i64, w: f64, h: f64): void {
    let i = 0;
    while (i < this.panels.length) {
      const g = this.panels[i];
      const k = g.componentIdx(KIND_UI);
      if (k >= 0) g.behaviors[k].drawUI(win, w, h);
      i = i + 1;
    }
  }

  /// Atualiza o título do painel `idx` (HUD ao vivo).
  setPanelTitle(idx: number, s: string): void {
    if (idx < 0 || idx >= this.panels.length) return;
    const g = this.panels[idx];
    const k = g.componentIdx(KIND_UI);
    if (k >= 0) g.behaviors[k].setUITitle(s);
  }

  count(): number { return this.panels.length; }
}

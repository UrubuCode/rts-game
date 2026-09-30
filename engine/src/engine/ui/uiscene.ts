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
import { Scene } from "../core/scene";

export class UIScene {
  panels: GameObject[];
  scene: Scene;

  constructor() {
    this.scene = new Scene("UI");
    this.panels = this.scene.objects;
  }

  /// Anexa um GameObject de UI à cena.
  add(go: GameObject): void {
    this.scene.add(go);
  }

  createGameObject(name: string, parentIdx: number = 0 - 1): GameObject {
    return this.scene.createGameObject(name, 0, 0, 0, 0, parentIdx);
  }

  isVisible(index: number): boolean {
    if (index < 0 || index >= this.panels.length) return false;
    let current = index;
    let depth = 0;
    while (current >= 0 && current < this.panels.length && depth < this.panels.length) {
      const object = this.panels[current];
      if (object.active === 0) return false;
      current = object.parent;
      depth = depth + 1;
    }
    return current < 0; // parentes invalidos/ciclicos nao recebem input nem desenho
  }

  drawObject(index: number, win: i64, w: f64, h: f64): void {
    if (!this.isVisible(index)) return;
    const object = this.panels[index];
    let component = 0;
    while (component < object.behaviors.length) {
      const behavior = object.behaviors[component];
      if (behavior.kind() === KIND_UI && behavior.enabled !== 0) behavior.drawUI(win, w, h);
      component = component + 1;
    }
  }

  /// Desenha todos os elementos de UI (chama drawUI de cada component kind UI).
  /// `w`/`h` = tamanho lógico da janela (pras âncoras). Chamado DENTRO do frame
  /// egui (entre beginFrame e endFrame).
  draw(win: i64, w: f64, h: f64): void {
    let i = 0;
    while (i < this.panels.length) {
      this.drawObject(i, win, w, h);
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

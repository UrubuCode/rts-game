// Engine RTS — GameObject: a unidade da cena, estilo Unity. TUDO é GameObject.
// Tem Transform, um tipo de mesh pro render pass, cor, e uma lista de Behaviors
// (scripts). Ciclo: mount() (uma vez) → update(dt) (todo frame).

import { Transform } from "./transform";
import { Behavior } from "./behavior";

// meshKind: 0 = vazio (só nó), 1 = cubo. (grid/luz/câmera entram depois)
export class GameObject {
  name: string;
  transform: Transform;
  behaviors: Behavior[];
  meshKind: number;
  cr: number; cg: number; cb: number;  // cor do mesh (0..255)
  active: number;
  parent: number;      // índice do pai em scene.objects (-1 = raiz)
  stationary: number;  // 1 = estático (a colisão não o empurra) — tipo static/kinematic
  emissive: number;    // 1 = brilha (não sombreado) — ex.: o Sol
  tex: number;         // textura procedural: 0 = nenhuma, 1 = xadrez (chão)

  constructor(name: string) {
    this.name = name;
    this.transform = new Transform();
    this.behaviors = [];
    this.meshKind = 0;
    this.cr = 120; this.cg = 180; this.cb = 255;
    this.active = 1;
    this.parent = 0 - 1;
    this.stationary = 0;
    this.emissive = 0;
    this.tex = 0;
  }

  /// Anexa um script e liga-o ao transform deste objeto.
  addBehavior(b: Behavior): GameObject {
    b.attach(this.transform);
    this.behaviors.push(b);
    return this;
  }

  /// Remove o componente no índice `idx` (reconstrói o array sem ele).
  removeBehavior(idx: number): void {
    const next: Behavior[] = [];
    let i = 0;
    while (i < this.behaviors.length) {
      if (i !== idx) next.push(this.behaviors[i]);
      i = i + 1;
    }
    this.behaviors = next;
  }

  /// Define o mesh + cor (fluent).
  setMesh(kind: number, r: number, g: number, b: number): GameObject {
    this.meshKind = kind;
    this.cr = r; this.cg = g; this.cb = b;
    return this;
  }

  /// mount de todos os scripts (chamado pela cena ao adicionar).
  mount(): void {
    let i = 0;
    while (i < this.behaviors.length) {
      const b = this.behaviors[i];
      b.mount();
      i = i + 1;
    }
  }

  /// update de todos os scripts habilitados.
  update(dt: f64): void {
    let i = 0;
    while (i < this.behaviors.length) {
      const b = this.behaviors[i];
      if (b.enabled !== 0) b.update(dt);
      i = i + 1;
    }
  }
}

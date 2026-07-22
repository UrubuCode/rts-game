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

  constructor(name: string) {
    this.name = name;
    this.transform = new Transform();
    this.behaviors = [];
    this.meshKind = 0;
    this.cr = 120; this.cg = 180; this.cb = 255;
    this.active = 1;
  }

  /// Anexa um script e liga-o ao transform deste objeto.
  addBehavior(b: Behavior): GameObject {
    b.attach(this.transform);
    this.behaviors.push(b);
    return this;
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

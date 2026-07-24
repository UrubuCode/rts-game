// Engine RTS — GameObject: a unidade da cena, estilo Unity. TUDO é GameObject.
// Tem Transform, um tipo de mesh pro render pass, cor, e uma lista de Behaviors
// (scripts). Ciclo: mount() (uma vez) → update(dt) (todo frame).

import { Transform } from "./transform";
import { Behavior } from "./behavior";
import { Material } from "./material";

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
  textureId: number;   // (legado) id de textura de IMAGEM; 0 = sem. Preferir o component Material.
  customMesh: number;  // id de mesh carregada (.obj); 0 = usa o primitivo meshKind
  matIdx: number;      // índice do component Material em behaviors (-1 = nenhum). Cache O(1) pro render.

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
    this.textureId = 0;
    this.customMesh = 0;
    this.matIdx = 0 - 1;
  }

  /// Recalcula o índice cacheado do Material (chamado quando behaviors muda).
  /// O(nº de components), mas só nas MUTAÇÕES (add/remove), não por frame.
  refreshMatIdx(): void {
    this.matIdx = 0 - 1;
    let i = 0;
    while (i < this.behaviors.length) {
      if (this.behaviors[i].isMaterial() !== 0) { this.matIdx = i; return; }
      i = i + 1;
    }
  }

  /// Anexa um script e liga-o ao transform deste objeto.
  addBehavior(b: Behavior): GameObject {
    b.attach(this.transform);
    this.behaviors.push(b);
    if (b.isMaterial() !== 0) this.matIdx = this.behaviors.length - 1;
    return this;
  }

  /// Devolve o component Material do objeto, criando e anexando um se não houver.
  /// Retorna o tipo BASE (Behavior) — o caller usa só os métodos virtuais de
  /// material (setMatTexture/isMaterial), sem depender de cast pro subtipo.
  getOrAddMaterial(): Behavior {
    if (this.matIdx >= 0) return this.behaviors[this.matIdx];
    const m = new Material();
    this.addBehavior(m);   // addBehavior já atualiza matIdx
    return m;
  }

  /// Aplica uma textura de imagem (id da GPU + path) no Material do objeto
  /// (cria o Material se preciso). Usado pelo asset browser / ws `loadtex`.
  applyTexture(id: number, path: string): void {
    this.getOrAddMaterial().setMatTexture(id, path);
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
    this.refreshMatIdx();   // o índice mudou (array reconstruído) — recalcula
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

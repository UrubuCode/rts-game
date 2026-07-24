// Engine RTS — GameObject: a unidade da cena, estilo Unity. TUDO é GameObject.
// Tem Transform, um tipo de mesh pro render pass, cor, e uma lista de Behaviors
// (scripts). Ciclo: mount() (uma vez) → update(dt) (todo frame).

import { Transform } from "./transform";
import { Behavior, KIND_MATERIAL, KIND_RENDERER } from "./behavior";
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
  customMesh: number;  // (legado) id de mesh .obj; 0 = usa meshKind. Preferir o MeshRenderer.
  meshPath: string;    // path do modelo que gerou customMesh ("" = primitivo). Exibição + reload no load de cena.
  meshPart: number;    // qual SUBMESH do modelo (0 = a primeira/única). Modelos multi-material têm várias.
  selFlag: number;     // 1 = está na multi-seleção do editor. Cache O(1) pro render (evita varrer a lista por objeto).
  matIdx: number;      // índice do component Material em behaviors (-1 = nenhum). Cache O(1) pro render.
  rendIdx: number;     // índice do component MeshRenderer (-1 = nenhum). Cache O(1) pro render.

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
    this.meshPath = "";
    this.meshPart = 0;
    this.selFlag = 0;
    this.matIdx = 0 - 1;
    this.rendIdx = 0 - 1;
  }

  /// Primitivo do modelo uniforme: índice do PRIMEIRO component de tipo `kind`
  /// (-1 = nenhum). Systems/render acham qualquer tipo de component por aqui, sem
  /// cast nem string — `const i = o.componentIdx(KIND_X); if (i>=0) …`.
  componentIdx(kind: number): number {
    let i = 0;
    while (i < this.behaviors.length) {
      if (this.behaviors[i].kind() === kind) return i;
      i = i + 1;
    }
    return 0 - 1;
  }

  /// Recalcula os índices cacheados dos componentes consultados TODO frame pelo
  /// render (Material + MeshRenderer). Fast-path O(1) no render; só recalcula nas
  /// MUTAÇÕES (add/remove), não por frame. Novos componentes render-hot entram aqui.
  refreshComponentCache(): void {
    this.matIdx = this.componentIdx(KIND_MATERIAL);
    this.rendIdx = this.componentIdx(KIND_RENDERER);
  }

  /// Anexa um script e liga-o ao transform deste objeto.
  addBehavior(b: Behavior): GameObject {
    b.attach(this.transform);
    this.behaviors.push(b);
    this.refreshComponentCache();   // atualiza matIdx/rendIdx se o novo for render-hot
    return this;
  }

  /// Devolve o component Material do objeto, criando e anexando um se não houver.
  /// Retorna o tipo BASE (Behavior) — o caller usa só os métodos virtuais de
  /// material (setMatTexture/kind), sem depender de cast pro subtipo.
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
    this.refreshComponentCache();   // índices mudaram (array reconstruído) — recalcula
  }

  /// Clona o objeto copiando transform + campos de aparência (mesh/cor/tex/emissivo/
  /// customMesh/textureId). NÃO clona os behaviors ainda (a aparência renderiza pelo
  /// fallback de campos). Usado pelo "duplicar" (Ctrl+D). Behaviors: follow-up.
  cloneShallow(): GameObject {
    const g = new GameObject(this.name + " (copy)");
    g.meshKind = this.meshKind;
    g.cr = this.cr; g.cg = this.cg; g.cb = this.cb;
    g.tex = this.tex; g.emissive = this.emissive;
    g.textureId = this.textureId; g.customMesh = this.customMesh;
    g.meshPath = this.meshPath;
    g.meshPart = this.meshPart;
    g.stationary = this.stationary;
    const t = this.transform;
    g.transform.px = t.px; g.transform.py = t.py; g.transform.pz = t.pz;
    g.transform.rx = t.rx; g.transform.ry = t.ry; g.transform.rz = t.rz;
    g.transform.sx = t.sx; g.transform.sy = t.sy; g.transform.sz = t.sz;
    return g;
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

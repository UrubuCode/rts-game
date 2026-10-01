// Engine RTS — GameObject: a unidade da cena, estilo Unity. TUDO é GameObject.
// Tem Transform, um tipo de mesh pro render pass, cor, e uma lista de Behaviors
// (scripts). Ciclo: mount() (uma vez) → update(dt) (todo frame).

import { Transform } from "./transform";
import { Behavior, KIND_COLLIDER, KIND_MATERIAL, KIND_RENDERER, KIND_UI, KIND_LIGHT, KIND_CAMERA, KIND_AUDIO } from "./behavior";
import { Material } from "./material";
import { componentMetadata } from "./component_metadata";
// gizmos.ts só importa TIPOS do núcleo: sem ciclo.
import { gizmoDrawerIndex } from "./gizmos";

/// Formas de colisor (ver `GameObject.colShape`).
export const COL_SPHERE = 0;
export const COL_BOX = 1;

let nextGameObjectId: number = 1;

/// Define o próximo ID a ser atribuído a um GameObject.
export function setNextGameObjectId(next: number): void {
  nextGameObjectId = next;
}

/// Retorna o próximo ID a ser atribuído a um GameObject.
export function getNextGameObjectId(): number {
  return nextGameObjectId;
}

// meshKind: 0 = vazio (só nó), 1 = cubo. (grid/luz/câmera entram depois)
/// Quem quer saber quando um objeto ganha ou perde componente de UI: a Scene
/// mantém a lista de objetos com UI sem varrer a cena (ver `Scene.uiObjs`).
/// Interface e não `Scene` para não criar ciclo de import.
export interface UIOwner {
  uiChanged(go: GameObject): void;
  lightChanged(go: GameObject): void;
  cameraChanged(go: GameObject): void;
  audioChanged(go: GameObject): void;
}

export class GameObject {
  /// Identificador estável e monotônico do corpo na cena (Lote B, §5.4).
  id: number;
  name: string;
  transform: Transform;
  behaviors: Behavior[];
  meshKind: number;
  cr: number; cg: number; cb: number;  // cor do mesh (0..255)
  active: number;
  parent: number;      // índice do pai em scene.objects (-1 = raiz)
  stationary: number;  // 1 = estático (a colisão não o empurra) — tipo static/kinematic
  /// Bitmask de camada (default: 1 = `LAYER_DEFAULT`). Dois corpos colidem só se
  /// cada um aceita a camada do outro: `(a.mask & b.layer) != 0` E
  /// `(b.mask & a.layer) != 0`.
  ///
  /// MUDAR `layer`/`mask` DURANTE O PLAY: o solver da CPU (`Scene`) lê os
  /// campos a cada par e vê a mudança no mesmo passo. Os backends externos
  /// (GPU e Rust) NÃO: eles copiam layer/mask para a região de materiais do
  /// `world` só na sincronização de composição (`pbSync`/`pbSyncRust` em
  /// `physics_backend.ts`, disparada por `Scene.compVersion` ou por
  /// `rigidInvalidate()`). Até lá o filtro antigo continua valendo; quem muda a
  /// máscara por script e precisa do efeito no passo seguinte chama
  /// `rigidInvalidate()`.
  ///
  /// A flag `any_mask` do cabeçalho do `world` é CONSERVADORA: liga quando algum
  /// corpo ou estático sincronizado tem layer/mask fora do default e só volta a
  /// zero no próximo `rbInit`/`crInit` — que só acontece quando a contagem de
  /// corpos muda. Devolver todas as máscaras ao default não a desliga: o
  /// resultado continua correto, só se paga o filtro por candidato até lá.
  layer: number;
  /// Bitmask de colisão: quais camadas este corpo aceita (default: 0xFFFFFFFF =
  /// `MASK_ALL`). Mesmas regras de propagação de `layer`, acima.
  mask: number;
  emissive: number;    // 1 = brilha (não sombreado) — ex.: o Sol
  tex: number;         // textura procedural: 0 = nenhuma, 1 = xadrez (chão)
  textureId: number;   // (legado) id de textura de IMAGEM; 0 = sem. Preferir o component Material.
  customMesh: number;  // (legado) id de mesh .obj; 0 = usa meshKind. Preferir o MeshRenderer.
  meshPath: string;    // path do modelo que gerou customMesh ("" = primitivo). Exibição + reload no load de cena.
  meshPart: number;    // qual SUBMESH do modelo (0 = a primeira/única). Modelos multi-material têm várias.
  selFlag: number;     // 1 = está na multi-seleção do editor. Cache O(1) pro render (evita varrer a lista por objeto).
  /// 1 = participa da colisão: tem mesh E é raiz. Combina três leituras de
  /// campo (`meshKind`, `customMesh`, `parent`) numa só — a coleta de colisores
  /// roda sobre a cena inteira TODO frame, e cada acesso a campo custa ~2 µs.
  /// Recalculado por `refreshCollide()` nas mutações que o afetam.
  collideFlag: number;
  /// Forma do colisor: 0 = ESFERA (raio = metade da menor escala), 1 = CAIXA
  /// (AABB de meia-extensão = escala/2 em cada eixo).
  ///
  /// A esfera era a única opção e não serve para cenário: um chão 60x0.4x60
  /// vira uma esfera de raio 0.2 (metade da MENOR escala) e praticamente não
  /// colide — nada se apoia nele. A caixa cobre o volume real, que é o que um
  /// chão, uma parede ou uma plataforma precisam.
  ///
  /// Default por malha (`setMesh`): cubo -> CAIXA, esfera/pirâmide/octaedro ->
  /// ESFERA. É o palpite certo na maioria dos casos, e `colShape` fica exposto
  /// para o usuário sobrescrever.
  colShape: number;
  matIdx: number;      // índice do component Material em behaviors (-1 = nenhum). Cache O(1) pro render.
  rendIdx: number;     // índice do component MeshRenderer (-1 = nenhum). Cache O(1) pro render.
  /// Índice do component Collider (-1 = nenhum, e aí valem `colShape` + escala).
  ///
  /// Cacheado pelo mesmo motivo dos outros dois: a física pergunta por objeto
  /// por frame, e varrer a lista de behaviors atrás do kind seria O(behaviors)
  /// no laço mais quente. -1 é o caminho LEGADO, não um erro: cenas antigas não
  /// têm Collider e continuam colidindo pela escala.
  colIdx: number;
  /// Índice do primeiro component de UI (KIND_UI) em behaviors, -1 se nenhum.
  /// Cache para o pass de UI do jogo achar quem tem UI sem varrer behaviors.
  uiIdx: number;
  /// Índice do component Light (KIND_LIGHT) em behaviors, -1 se nenhum. Cache
  /// para `Scene.lightObjs` saber quem tem luz sem varrer behaviors.
  lightIdx: number;
  /// Índice do component Camera (KIND_CAMERA) em behaviors, -1 se nenhum. Cache
  /// para `Scene.camObjs` saber quem tem câmera sem varrer behaviors.
  camIdx: number;
  /// Índice do primeiro component KIND_AUDIO (AudioListener/AudioSource), −1 se
  /// nenhum. Cache para `Scene.audioObjs`.
  audioIdx: number;
  /// A cena que registra este objeto na lista de UI (null fora de cena).
  uiOwner: UIOwner | null;
  /// Índice deste objeto nas tabelas paralelas do índice espacial (sObjs), ou -1 se não indexado.
  spatialSlot: number;
  /// Índice deste objeto no array sDynamicIndices do índice espacial, ou -1 se não dinâmico normal.
  spatialDynSlot: number;
  /// Índice deste objeto em `scene.objects`, escrito por `collectColliders`
  /// (que roda quando a composição muda) e zerado (-1) em `removeAt`. Quem lê
  /// confere `objects[i] === o` antes de confiar. Ver contact_events.ts.
  sceneIndex: number;
  /// Raio envolvente do renderer que se desenha sozinho (Skeleton), em
  /// unidades do objeto; 0 = usar o da malha. Cache O(1) pro culling do render.
  boundRadius: f64;
  /// 1 = algum component desenha gizmos (sobrescreve onDrawGizmos(Selected) ou
  /// tem desenhador registrado por tipo). Cache O(1) para o passe de gizmos do editor.
  gizmoFlag: number;

  constructor(name: string) {
    this.id = nextGameObjectId;
    nextGameObjectId = nextGameObjectId + 1;
    this.name = name;
    this.transform = new Transform();
    this.behaviors = [];
    this.meshKind = 0;
    this.cr = 120; this.cg = 180; this.cb = 255;
    this.active = 1;
    this.parent = 0 - 1;
    this.stationary = 0;
    this.layer = 1;
    this.mask = 0xFFFFFFFF;
    this.emissive = 0;
    this.tex = 0;
    this.textureId = 0;
    this.customMesh = 0;
    this.meshPath = "";
    this.meshPart = 0;
    this.selFlag = 0;
    this.collideFlag = 0;
    this.colShape = COL_SPHERE;
    this.matIdx = 0 - 1;
    this.rendIdx = 0 - 1;
    this.colIdx = 0 - 1;
    this.uiIdx = 0 - 1;
    this.lightIdx = 0 - 1;
    this.camIdx = 0 - 1;
    this.audioIdx = 0 - 1;
    this.uiOwner = null;
    this.spatialSlot = 0 - 1;
    this.spatialDynSlot = 0 - 1;
    this.sceneIndex = 0 - 1;
    this.boundRadius = 0.0;
    this.gizmoFlag = 0;
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
    this.rendIdx = this.rendererIdx();
    this.boundRadius = this.rendIdx >= 0 ? this.behaviors[this.rendIdx].rBoundRadius() : 0.0;
    this.colIdx = this.componentIdx(KIND_COLLIDER);
    const hadUI = this.uiIdx;
    this.uiIdx = this.componentIdx(KIND_UI);
    if (this.uiOwner !== null && (hadUI >= 0) !== (this.uiIdx >= 0)) this.uiOwner.uiChanged(this);
    const hadLight = this.lightIdx;
    this.lightIdx = this.componentIdx(KIND_LIGHT);
    if (this.uiOwner !== null && (hadLight >= 0) !== (this.lightIdx >= 0)) this.uiOwner.lightChanged(this);
    const hadCam = this.camIdx;
    this.camIdx = this.componentIdx(KIND_CAMERA);
    if (this.uiOwner !== null && (hadCam >= 0) !== (this.camIdx >= 0)) this.uiOwner.cameraChanged(this);
    const hadAudio = this.audioIdx;
    this.audioIdx = this.componentIdx(KIND_AUDIO);
    if (this.uiOwner !== null && (hadAudio >= 0) !== (this.audioIdx >= 0)) this.uiOwner.audioChanged(this);
    let gz = 0;
    let bi = 0;
    while (bi < this.behaviors.length) {
      const b = this.behaviors[bi];
      if (componentMetadata.provider.drawsGizmos(b) || gizmoDrawerIndex(b.typeName()) >= 0) gz = 1;
      bi = bi + 1;
    }
    this.gizmoFlag = gz;
  }

  /// Renderer do objeto: um que se desenha sozinho (Skeleton) tem prioridade
  /// sobre os demais (um preset já traz MeshRenderer); senão o primeiro.
  rendererIdx(): number {
    let first = 0 - 1;
    let i = 0;
    while (i < this.behaviors.length) {
      const b = this.behaviors[i];
      if (b.kind() === KIND_RENDERER) {
        if (b.drawsSelf() !== 0) return i;
        if (first < 0) first = i;
      }
      i = i + 1;
    }
    return first;
  }

  /// Anexa um script e liga-o ao transform deste objeto.
  addBehavior(b: Behavior): GameObject {
    b.attach(this.transform);
    b.owner = this;
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
      else { this.behaviors[i].releaseResources(); this.behaviors[i].owner = null; }
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
    g.layer = this.layer;
    g.mask = this.mask;
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
    // Palpite de colisor pela malha: um cubo quase sempre é cenário (chão,
    // parede, caixa) e quer volume; as demais primitivas são arredondadas.
    // Quem quiser outra coisa escreve `o.colShape = COL_BOX` depois.
    if (kind === 1) this.colShape = COL_BOX;
    else this.colShape = COL_SPHERE;
    this.refreshCollide();
    return this;
  }

  /// Recalcula `collideFlag` (mesh + raiz). Chamar após mudar `meshKind`,
  /// `customMesh` ou `parent`.
  refreshCollide(): void {
    if ((this.meshKind !== 0 || this.customMesh > 0) && this.parent < 0) this.collideFlag = 1;
    else this.collideFlag = 0;
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

/// Profundidade máxima de hierarquia percorrida (a mesma guarda de `moveSubtree`).
export const MAX_PROFUNDIDADE_HIERARQUIA: number = 128;
/// `o` e todos os ancestrais ativos (`parent` indexa `objs`).
export function activeInScene(objs: GameObject[], o: GameObject): boolean {
  let atual: GameObject = o;
  let passo = 0;
  let ativo = true;
  while (passo < MAX_PROFUNDIDADE_HIERARQUIA) {
    if (atual.active === 0) { ativo = false; break; }
    const p = atual.parent;
    if (p < 0 || p >= objs.length) break;
    atual = objs[p];
    passo = passo + 1;
  }
  return ativo;
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLIDER — o component que diz QUAL FORMA colide.
//
// Estilo Unity: `BoxCollider`, `SphereCollider`, `MeshCollider` são componentes,
// não campos do objeto. É um Behavior de DADOS (sem `update`), como o
// `MeshRenderer`: a física pergunta ao component qual forma usar, e cai nos
// campos legado do `GameObject` quando não há um.
//
// ── O QUE ISTO CONSERTA ────────────────────────────────────────────────────
//
// Antes, a forma que colide vinha de dois lugares que não eram dela:
//
//   `o.colShape`   — esfera ou caixa, um campo solto no GameObject
//   `t.sx/sy/sz`   — a ESCALA do transform virava a meia-extensão do colisor
//
// A segunda é a que dói. A escala é da GEOMETRIA VISUAL: um modelo carregado de
// `.obj` tem escala 1 e pode ter dois metros de largura, ou escala 3 e ser um
// palito. O colisor herdava a escala e não tinha relação com a forma real — e
// não havia como corrigir, porque não existia onde escrever "o colisor é ISTO".
//
// Agora existe, e ele carrega três coisas que a escala não podia dar:
//
//   CENTRO   um deslocamento local. Um personagem cujo pivô está nos pés precisa
//            do colisor um metro acima, e isso não é escala.
//   TAMANHO  próprio, em unidades de mundo, independente do quanto o modelo foi
//            esticado para caber na cena.
//   FORMA    incluindo a que ACOMPANHA A GEOMETRIA (`COL_HULL`), que é o motivo
//            deste arquivo existir.
//
// ── POR QUE CASCA CONVEXA E NÃO A MALHA EXATA ──────────────────────────────
//
// Colisão triângulo-a-triângulo entre corpos DINÂMICOS é proibitiva em qualquer
// engine. A Unity nem permite: um `MeshCollider` com `Rigidbody` exige
// `convex = true`. A razão não é só custo — malha côncava contra côncava não tem
// normal de contato bem definida, então o solver oscila e a pilha "respira", que
// é exatamente o ciclo-limite que a campanha do castelo deste projeto combateu.
//
// Então `COL_HULL` é a CASCA CONVEXA da malha: acompanha a geometria de verdade
// (um cristal alongado colide alongado, uma pedra chanfrada colide chanfrada) e
// tem normal de contato definida em todo ponto.
//
// Para côncavo de verdade — uma casa com vão, um arco — a resposta é composição:
// vários colisores no mesmo objeto, que é como Unity e Godot resolvem, e é
// possível aqui porque um `GameObject` tem uma LISTA de behaviors.
//
// ── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
//
// Não colide nada. Ele DESCREVE a forma; quem resolve contato é
// `Scene.resolveCollisions` (CPU) e o kernel de `gpurigid` (GPU). A separação é
// o que permite os dois backends lerem a mesma descrição — e é a condição para
// que eles terminem no mesmo lugar, que é o criterio de aceite de qualquer
// mudança aqui.
// ═══════════════════════════════════════════════════════════════════════════

import { Behavior, KIND_COLLIDER } from "./behavior";

/// As formas. Os dois primeiros valores são os mesmos de `GameObject.colShape`
/// DE PROPÓSITO — `COL_SPHERE = 0` e `COL_BOX = 1` lá também — para que o
/// caminho legado e o component não precisem de tradução. Um mapeamento entre
/// dois números que significam a mesma coisa é onde eles divergem.
export const SHAPE_SPHERE = 0;
export const SHAPE_BOX = 1;
/// A casca convexa da malha do objeto. O `hullId` diz qual.
export const SHAPE_HULL = 2;
/// Cápsula — dois pontos e um raio. Ainda NÃO implementada nos solvers; está
/// declarada aqui porque um personagem quase sempre quer uma, e deixar o número
/// reservado evita que alguém use o 3 para outra coisa e depois colida.
export const SHAPE_CAPSULE = 3;

export class Collider extends Behavior {
  /// Uma das `SHAPE_*`.
  shape: number;

  /// Deslocamento do centro, em espaço LOCAL do objeto. Some ao `wx/wy/wz` do
  /// transform depois de rotacionado — um colisor deslocado num objeto que gira
  /// tem de girar junto, senão ele desgruda ao virar.
  cx: f64; cy: f64; cz: f64;

  /// Meia-extensão para `SHAPE_BOX`, e RAIO (em `hx`) para `SHAPE_SPHERE`.
  ///
  /// Em unidades de MUNDO já multiplicadas pela escala? NÃO: em unidades locais,
  /// e o solver multiplica pela escala do transform. É a convenção da Unity, e a
  /// razão é que redimensionar um objeto na cena deve mexer no colisor junto —
  /// se fosse mundo, escalar um objeto faria o colisor ficar para trás.
  hx: f64; hy: f64; hz: f64;

  /// Qual casca, para `SHAPE_HULL`. 0 = nenhuma (cai para caixa).
  ///
  /// Um ID e não a casca em si porque a casca é da MALHA, não do corpo: mil
  /// instâncias do mesmo modelo compartilham uma casca e diferem só na
  /// transformação. Guardar a casca aqui subiria mil cópias dela para a GPU.
  hullId: number;

  /// `1` = detecta contato mas não empurra ninguém. É o `isTrigger` da Unity, e
  /// serve para zonas de gatilho — o objeto passa através e o jogo fica sabendo.
  trigger: number;

  constructor(shape: number) {
    super();
    this.shape = shape;
    this.cx = 0.0; this.cy = 0.0; this.cz = 0.0;
    // 0,5 e não 1,0: uma caixa unitária tem meia-extensão 0,5, e o default tem
    // de casar com a escala 1 do transform — senão todo objeto novo nasce com um
    // colisor do dobro do tamanho e ninguém entende por quê.
    this.hx = 0.5; this.hy = 0.5; this.hz = 0.5;
    this.hullId = 0;
    this.trigger = 0;
  }

  kind(): number { return KIND_COLLIDER; }
  typeName(): string { return "Collider"; }

  // ── leitura pela física, por despacho virtual e sem cast ────────────────
  //
  // A mesma forma que o `MeshRenderer` usa (`rMeshKind`/`rCustomMesh`): o solver
  // acha o component por `kind()` e pergunta, sem saber que classe é. Medido no
  // módulo de análise deste projeto: um despacho de método custa 860 ns contra
  // 600 ns de ler campo direto — a diferença não paga um cast e um cache.
  cShape(): number { return this.shape; }
  cHullId(): number { return this.hullId; }
  cTrigger(): number { return this.trigger; }
  cCenterX(): f64 { return this.cx; }
  cCenterY(): f64 { return this.cy; }
  cCenterZ(): f64 { return this.cz; }
  cHalfX(): f64 { return this.hx; }
  cHalfY(): f64 { return this.hy; }
  cHalfZ(): f64 { return this.hz; }

  // ── inspector ──────────────────────────────────────────────────────────
  fieldCount(): number { return 7; }
  fieldLabel(i: number): string {
    if (i === 0) return "Shape";
    if (i === 1) return "Center X";
    if (i === 2) return "Center Y";
    if (i === 3) return "Center Z";
    if (i === 4) return "Size X";
    if (i === 5) return "Size Y";
    return "Size Z";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.shape * 1.0;
    if (i === 1) return this.cx;
    if (i === 2) return this.cy;
    if (i === 3) return this.cz;
    if (i === 4) return this.hx;
    if (i === 5) return this.hy;
    return this.hz;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) { this.shape = v | 0; return; }
    if (i === 1) { this.cx = v; return; }
    if (i === 2) { this.cy = v; return; }
    if (i === 3) { this.cz = v; return; }
    if (i === 4) { this.hx = v; return; }
    if (i === 5) { this.hy = v; return; }
    this.hz = v;
  }

  toData(): any {
    return { t: "Collider", shape: this.shape, cx: this.cx, cy: this.cy, cz: this.cz,
             hx: this.hx, hy: this.hy, hz: this.hz, hullId: this.hullId, trigger: this.trigger };
  }
}

/// Um colisor de caixa com meia-extensão dada.
export function boxCollider(hx: f64, hy: f64, hz: f64): Collider {
  const c = new Collider(SHAPE_BOX);
  c.hx = hx; c.hy = hy; c.hz = hz;
  return c;
}

/// Um colisor de esfera de raio dado. O raio vai em `hx` — os outros dois ficam
/// iguais para que um leitor que olhe `hy` não conclua que a esfera é achatada.
export function sphereCollider(raio: f64): Collider {
  const c = new Collider(SHAPE_SPHERE);
  c.hx = raio; c.hy = raio; c.hz = raio;
  return c;
}

/// Um colisor que ACOMPANHA a geometria: a casca convexa da malha `hullId`.
///
/// A caixa em `hx/hy/hz` continua sendo preenchida e não é decoração — é o AABB
/// da casca, e é o que a broadphase usa para descartar pares distantes ANTES de
/// pagar o teste convexo. Sem ela, um solver O(n²) pagaria SAT contra todo mundo.
export function hullCollider(hullId: number, hx: f64, hy: f64, hz: f64): Collider {
  const c = new Collider(SHAPE_HULL);
  c.hullId = hullId;
  c.hx = hx; c.hy = hy; c.hz = hz;
  return c;
}

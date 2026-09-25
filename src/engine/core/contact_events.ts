// Eventos de contato (Lote B2): begin/stay/end e gatilhos, entregues DEPOIS do
// passo de física, em ordem determinística, sem alocação por passo.
//
// Desenho em docs/superpowers/specs/2026-09-25-eventos-de-contato-design.md.
// Em resumo, o que a pesquisa (Box2D v3, Jolt, Rapier, PhysX) fixou:
// - só pares com um colisor INSCRITO (`Collider.events`) são registrados;
// - `Stay` é opt-in (events = 2): Box2D e Rapier nem o emitem;
// - a narrow phase só REGISTRA; nenhum script roda dentro dela;
// - o conjunto de pares tocando é PERSISTENTE: a narrow phase CPU pula corpos
//   dormindo e parados, então recalcular "quem toca" por passo emitiria Exit
//   falso assim que um corpo parasse. Aqui um par entra quando a narrow phase
//   o vê e sai quando o re-teste geométrico (scene.ts, `pairOverlaps`) diz que
//   separou — ou quando um dos corpos deixou a cena (Box2D faz o mesmo).
//
// Forma do código, pelo que o RTS pede (ver os comentários de scene.ts e
// rts#2760): os laços vivem em FUNÇÕES LIVRES com parâmetros tipados — dentro
// de um método, `this.arr[k]` cai no caminho dinâmico de propriedade —, os
// helpers têm até 4 parâmetros, e o estado é um conjunto de arrays paralelos
// de números (um objeto por par seria uma alocação por par).

import { GameObject } from "./gameobject";
import { Behavior } from "./behavior";

export const CONTACT_EVENTS_NONE = 0;
export const CONTACT_EVENTS_ENTER_EXIT = 1;
export const CONTACT_EVENTS_STAY = 2;

export const CONTACT_ENTER = 1;
export const CONTACT_STAY = 2;
export const CONTACT_EXIT = 3;

/// O que um hook recebe. UMA instância por `ContactEvents`, mutada a cada
/// entrega (Unity "Reuse Collision Callbacks"): quem precisar guardar, copia.
export class ContactInfo {
  self: GameObject;
  other: GameObject;
  /// 1 quando um dos colisores é gatilho (o par não foi empurrado).
  trigger: number;
  /// Passo em que o evento foi produzido (contagem de `resolveCollisions`).
  stepId: number;

  constructor(placeholder: GameObject) {
    this.self = placeholder;
    this.other = placeholder;
    this.trigger = 0;
    this.stepId = 0;
  }
}

/// `pEnd` por par: 0 vivo, 1 encerra neste passo, -1 nasceu neste passo.
const END_NONE = 0;
const END_NOW = 1;
const END_BORN = 0 - 1;

export class ContactEvents {
  /// Contador de passos: incrementa a cada `beginStep`.
  step: number = 0;

  // ── conjunto persistente de pares tocando, ordenado por (minId, maxId) ──
  pA: number[] = [];
  pB: number[] = [];
  pObjA: GameObject[] = [];
  pObjB: GameObject[] = [];
  pTrig: number[] = [];
  pStay: number[] = [];
  pSeen: number[] = [];
  pEnd: number[] = [];
  pCount: number = 0;

  // ── pares vistos pela narrow phase neste passo (índices na cena) ──────
  sIa: number[] = [];
  sIb: number[] = [];
  sTrig: number[] = [];
  sStay: number[] = [];

  // ── eventos produzidos neste passo ─────────────────────────────────────
  evA: GameObject[] = [];
  evB: GameObject[] = [];
  evKind: number[] = [];
  evTrig: number[] = [];
  evCount: number = 0;

  placeholder: GameObject;
  info: ContactInfo;

  constructor() {
    this.placeholder = new GameObject("(sem contato)");
    this.info = new ContactInfo(this.placeholder);
  }

  beginStep(): void {
    this.step = this.step + 1;
    this.sIa.length = 0;
    this.sIb.length = 0;
    this.sTrig.length = 0;
    this.sStay.length = 0;
    this.evCount = 0;
  }

  /// Chamado pela narrow phase quando um par com inscrição se toca. Pode vir
  /// duas vezes (uma por lado/passada); `absorb` deduplica.
  record(ia: number, ib: number, trig: number, stay: number): void {
    this.sIa.push(ia);
    this.sIb.push(ib);
    this.sTrig.push(trig);
    this.sStay.push(stay);
  }

  count(): number { return this.pCount; }
  seen(k: number): number { return this.pSeen[k] === this.step ? 1 : 0; }
  objA(k: number): GameObject { return this.pObjA[k]; }
  objB(k: number): GameObject { return this.pObjB[k]; }
  confirm(k: number): void { this.pSeen[k] = this.step; }
  markEnd(k: number): void { this.pEnd[k] = END_NOW; }

  absorb(objs: GameObject[]): void {
    const n = this.sIa.length;
    let i = 0;
    while (i < n) {
      absorbOne(this, objs, i);
      i = i + 1;
    }
  }

  /// Produz os eventos do passo varrendo o conjunto ordenado: Enter, depois
  /// Stay, depois Exit; compacta os pares encerrados.
  emitOrdered(): void {
    emitEnter(this);
    emitStay(this);
    this.pCount = emitExitAndCompact(this);
  }

  /// Entrega os eventos aos `behaviors` habilitados dos dois objetos. Roda
  /// fora da narrow phase: um script pode criar ou remover objetos aqui.
  dispatch(): void {
    this.info.stepId = this.step;
    dispatchAll(this.evA, this.evB, this.evKind, this.evTrig, this.evCount, this.info);
  }
}

// ── busca e inserção no conjunto ordenado ─────────────────────────────────

/// Posição do par (a, b) no conjunto (busca binária), ou -1.
function findPair(pA: number[], pB: number[], n: number, a: number, b: number): number {
  let lo = 0;
  let hi = n - 1;
  let found = 0 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ma = pA[mid];
    if (ma < a || (ma === a && pB[mid] < b)) lo = mid + 1;
    else if (ma > a || pB[mid] > b) hi = mid - 1;
    else { found = mid; lo = hi + 1; }
  }
  return found;
}

/// Um par visto: acha ou insere (ordenado; deslocamento O(T), T pequeno por
/// construção) e marca como visto neste passo.
function absorbOne(c: ContactEvents, objs: GameObject[], i: number): void {
  let oa: GameObject = objs[c.sIa[i]];
  let ob: GameObject = objs[c.sIb[i]];
  if (oa.id > ob.id) { const t = oa; oa = ob; ob = t; }
  const a = oa.id;
  const b = ob.id;
  const pA: number[] = c.pA;
  const pB: number[] = c.pB;
  let k = findPair(pA, pB, c.pCount, a, b);
  if (k < 0) {
    k = insertSlot(c, a, b);
    c.pObjA[k] = oa; c.pObjB[k] = ob;
    c.pTrig[k] = c.sTrig[i];
    c.pStay[k] = c.sStay[i];
    c.pEnd[k] = END_BORN;
  }
  c.pSeen[k] = c.step;
}

/// Abre um slot na posição ordenada de (a, b) e devolve o índice dele.
function insertSlot(c: ContactEvents, a: number, b: number): number {
  const pA: number[] = c.pA;
  const pB: number[] = c.pB;
  const pObjA: GameObject[] = c.pObjA;
  const pObjB: GameObject[] = c.pObjB;
  const pTrig: number[] = c.pTrig;
  const pStay: number[] = c.pStay;
  const pSeen: number[] = c.pSeen;
  const pEnd: number[] = c.pEnd;
  let k = c.pCount;
  if (pA.length <= k) {
    pA.push(0); pB.push(0); pObjA.push(c.placeholder); pObjB.push(c.placeholder);
    pTrig.push(0); pStay.push(0); pSeen.push(0); pEnd.push(0);
  }
  while (k > 0 && (pA[k - 1] > a || (pA[k - 1] === a && pB[k - 1] > b))) {
    pA[k] = pA[k - 1]; pB[k] = pB[k - 1];
    pObjA[k] = pObjA[k - 1]; pObjB[k] = pObjB[k - 1];
    pTrig[k] = pTrig[k - 1]; pStay[k] = pStay[k - 1];
    pSeen[k] = pSeen[k - 1]; pEnd[k] = pEnd[k - 1];
    k = k - 1;
  }
  pA[k] = a; pB[k] = b;
  c.pCount = c.pCount + 1;
  return k;
}

// ── produção dos eventos ──────────────────────────────────────────────────

function pushEvent(c: ContactEvents, k: number, kind: number): void {
  const n = c.evCount;
  if (c.evA.length <= n) {
    c.evA.push(c.pObjA[k]); c.evB.push(c.pObjB[k]); c.evKind.push(kind); c.evTrig.push(c.pTrig[k]);
  } else {
    c.evA[n] = c.pObjA[k]; c.evB[n] = c.pObjB[k]; c.evKind[n] = kind; c.evTrig[n] = c.pTrig[k];
  }
  c.evCount = n + 1;
}

function emitEnter(c: ContactEvents): void {
  const pEnd: number[] = c.pEnd;
  const n = c.pCount;
  let k = 0;
  while (k < n) {
    if (pEnd[k] === END_BORN) { pushEvent(c, k, CONTACT_ENTER); pEnd[k] = END_NONE; }
    k = k + 1;
  }
}

function emitStay(c: ContactEvents): void {
  const pEnd: number[] = c.pEnd;
  const pStay: number[] = c.pStay;
  const pSeen: number[] = c.pSeen;
  const step = c.step;
  const n = c.pCount;
  let k = 0;
  while (k < n) {
    if (pStay[k] !== 0 && pEnd[k] === END_NONE && pSeen[k] === step) pushEvent(c, k, CONTACT_STAY);
    k = k + 1;
  }
}

/// Emite Exit para os marcados e compacta o conjunto. Devolve o novo tamanho.
function emitExitAndCompact(c: ContactEvents): number {
  const pA: number[] = c.pA;
  const pB: number[] = c.pB;
  const pObjA: GameObject[] = c.pObjA;
  const pObjB: GameObject[] = c.pObjB;
  const pTrig: number[] = c.pTrig;
  const pStay: number[] = c.pStay;
  const pSeen: number[] = c.pSeen;
  const pEnd: number[] = c.pEnd;
  const n = c.pCount;
  let k = 0;
  let w = 0;
  while (k < n) {
    if (pEnd[k] === END_NOW) {
      pushEvent(c, k, CONTACT_EXIT);
    } else {
      if (w !== k) {
        pA[w] = pA[k]; pB[w] = pB[k];
        pObjA[w] = pObjA[k]; pObjB[w] = pObjB[k];
        pTrig[w] = pTrig[k]; pStay[w] = pStay[k];
        pSeen[w] = pSeen[k]; pEnd[w] = pEnd[k];
      }
      w = w + 1;
    }
    k = k + 1;
  }
  // Solta as referências dos slots que sobraram: um par encerrado não deve
  // manter o objeto vivo até o próximo reuso do slot.
  const alive = w;
  while (w < n) { pObjA[w] = c.placeholder; pObjB[w] = c.placeholder; w = w + 1; }
  return alive;
}

// ── entrega ───────────────────────────────────────────────────────────────

function dispatchAll(evA: GameObject[], evB: GameObject[], evKind: number[], evTrig: number[],
                     n: number, info: ContactInfo): void {
  let i = 0;
  while (i < n) {
    const kind = evKind[i];
    info.trigger = evTrig[i];
    deliverTo(evA[i], evB[i], kind, info);
    deliverTo(evB[i], evA[i], kind, info);
    i = i + 1;
  }
}

function deliverTo(self: GameObject, other: GameObject, kind: number, info: ContactInfo): void {
  info.self = self;
  info.other = other;
  const bs: Behavior[] = self.behaviors;
  const nb = bs.length;
  let j = 0;
  while (j < nb) {
    const b: Behavior = bs[j];
    if (b.enabled !== 0) callHook(b, kind, info);
    j = j + 1;
  }
}

function callHook(b: Behavior, kind: number, info: ContactInfo): void {
  if (info.trigger !== 0) {
    if (kind === CONTACT_ENTER) b.onTriggerEnter(info);
    else if (kind === CONTACT_STAY) b.onTriggerStay(info);
    else b.onTriggerExit(info);
  } else {
    if (kind === CONTACT_ENTER) b.onCollisionEnter(info);
    else if (kind === CONTACT_STAY) b.onCollisionStay(info);
    else b.onCollisionExit(info);
  }
}

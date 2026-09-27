// ═══════════════════════════════════════════════════════════════════════════
// CORROTINAS — o "StartCoroutine" da Unity, sobre async/await de verdade.
//
// ── POR QUE ISTO NÃO É SÓ "await numa Promise" ─────────────────────────────
//
// O runtime deste motor (rts-cranelift) é cooperativo: uma `Promise` que já
// resolveu NÃO retoma quem fez `await` nela sozinha — o motor só drena a fila
// de continuações num CHECKPOINT de verdade (um `await` que realmente suspende
// a pilha até o topo do módulo). Provado por sonda direta (`scratch/probe-
// microtask*.ts`, branch `feat/corrotinas`): um `Promise.resolve().then(...)`
// dentro de um laço síncrono nunca roda, nem depois de várias chamadas
// nativas (`io.print`, `process.env`) — só quando o laço faz um `await` de
// verdade (mesmo que trivial) é que a continuação pendente roda, ANTES do
// `await` devolver.
//
// Por isso este módulo tem DUAS metades:
//
//   1. `coroutineTick(dt)` — SÍNCRONA, chamada por `Scene.update` (o mesmo
//      laço que atualiza os behaviors — dá pausa/step/timescale de graça,
//      porque é exatamente quando `scene.update` roda ou não). Desconta o
//      tempo/quadros de cada espera pendente e, quando uma fica pronta, só a
//      MOVE para uma fila de pendentes — não resolve a Promise ainda.
//
//   2. `coroutineResume()` — ASSÍNCRONA, chamada UMA vez por quadro pelo laço
//      de fora (main.ts/game.ts, DEPOIS de `scene.update`), MAS só quando
//      `coroutineHasReady()` (flag barata, sem alocar) diz que há algo pronto.
//      Resolve/rejeita as promises da fila UMA DE CADA VEZ, com um `await` de
//      verdade entre cada uma — isso dá ao motor a chance de rodar a
//      continuação daquela corrotina especificamente antes de passar pra
//      próxima, o que é o que permite identificar "qual corrotina está
//      rodando agora" (`currentId`) sem precisar de um parâmetro extra em
//      `waitForSeconds`/`nextFrame`/etc. O laço externo NÃO chama
//      `coroutineResume` incondicionalmente todo quadro: `frame()` fica
//      síncrona e só o laço de fora, já num contexto `await` (top-level),
//      paga o checkpoint quando `coroutineHasReady()` é verdadeiro — chamar/
//      `await`ar uma `async function` todo quadro aloca neste runtime mesmo
//      sem nenhum `await` interno (medido: ~2,5 µs/quadro incondicional vs.
//      ~0,4 µs condicional, igual ao laço 100% síncrono — ver
//      tests/claude-test-frame-async-timing.ts e
//      tests/claude-test-frame-async-gc.ts vs. -fix-gc.ts).
//
// Consequência observável: uma corrotina retoma no PRÓXIMO quadro do laço que
// chama `coroutineResume` — nunca no meio do mesmo `scene.update` que a
// programou. Isso é a granularidade de quadro da Unity (uma corrotina com
// `yield return null` retoma depois do Update, antes do próximo), só que aqui
// o "depois do Update" é literal: precisa do checkpoint de fora.
//
// Um comando `step N` (tempo.ts) roda os N passos SEM checkpoint entre eles
// (são todos síncronos, dentro de uma única chamada) — os temporizadores
// descontam certo a cada passo, mas os corpos só retomam no quadro seguinte
// do editor (a próxima vez que o laço principal chamar `coroutineResume`, que
// é logo em seguida: a porta de controle é lida uma vez por quadro).
//
// ── CANCELAMENTO (Unity: disable/destroy PARAM a corrotina, não pausam) ────
//
// Uma espera pendente cujo dono (Behavior) está desligado (`enabled=0`) ou cujo
// objeto está inativo é CANCELADA (rejeitada com `COROUTINE_CANCELLED`), nunca
// só pulada — como no Unity, ela não retoma se o componente for religado depois.
// A checagem é feita a cada `coroutineTick` (até 1 quadro de atraso depois de
// desligar — documentado, não instantâneo). Destruir o objeto (`Scene.removeAt`)
// e sair do Play (`Scene.clear`) cancelam na hora (síncrono, sem esperar o
// próximo `coroutineTick`) via `stopAllCoroutinesOf`/`stopAllCoroutinesEverywhere`.
//
// O sinal de cancelamento é um `Promise.reject(COROUTINE_CANCELLED)`: o
// `await` do usuário lança, a função async se desenrola (nenhum código do
// corpo roda depois disso — nunca toca no objeto original restaurado), e
// `startCoroutine` engole esse erro específico sem logar (é sinal, não bug).
// Qualquer OUTRO erro lançado pelo corpo é logado, como uma exceção normal
// de script.
//
// ── CUSTO POR QUADRO ────────────────────────────────────────────────────────
//
// `coroutineTick` NÃO aloca quando não há corrotinas esperando (sai cedo) e,
// com N esperando, só decrementa arrays já alocados e move índices entre listas
// dense dele mesmo (sem push/splice) — ver "Custo por quadro" no CLAUDE.md.
// Criar uma corrotina (`startCoroutine`) aloca (é uma Promise) — está OK, só
// o TICK não pode.
// ═══════════════════════════════════════════════════════════════════════════

import type { Behavior } from "./behavior";
import { logError } from "./logger";

/// Rejeitado quando uma corrotina é cancelada (stopCoroutine/stopAllCoroutines,
/// disable, destroy, saída do Play). `startCoroutine` engole ESTE valor
/// específico sem logar; qualquer outro erro do corpo do usuário é logado
/// normalmente.
export const COROUTINE_CANCELLED: symbol = Symbol("coroutine-cancelled");

// ── tipos de espera ──────────────────────────────────────────────────────
const KIND_TIME = 0;       // segundos de JOGO (pausa/step/timescale — dt de Scene.update)
const KIND_REALTIME = 1;   // segundos REAIS (unscaled — performance.now())
const KIND_FRAMES = 2;     // N quadros (um "quadro" = uma chamada de Scene.update)
const KIND_UNTIL = 3;      // predicado checado 1x por quadro

// ── slots de espera (arrays paralelos, preallocados) ────────────────────────
let cap = 64;
let waitKind = new Int32Array(cap);
let waitRemaining = new Float64Array(cap);
let waitOwner: (Behavior | null)[] = new Array(cap).fill(null);
let waitPredicate: (Array<(() => boolean) | null>) = new Array(cap).fill(null);
let waitResolve: (Array<(() => void) | null>) = new Array(cap).fill(null);
let waitReject: (Array<((e: any) => void) | null>) = new Array(cap).fill(null);
let waitCoroutineId = new Int32Array(cap).fill(0 - 1);

let freeW = new Int32Array(cap);
let freeWN = 0;
let activeW = new Int32Array(cap);
let activeWN = 0;

// filas de "prontas este quadro" (preenchidas por coroutineTick, drenadas por
// coroutineResume) — dense, reaproveitadas, nunca realocadas por quadro.
let pendingResolve = new Int32Array(cap);
let pendingResolveN = 0;
let pendingCancel = new Int32Array(cap);
let pendingCancelN = 0;

function growW(): void {
  const nova = cap * 2;
  const k2 = new Int32Array(nova); k2.set(waitKind); waitKind = k2;
  const r2 = new Float64Array(nova); r2.set(waitRemaining); waitRemaining = r2;
  const c2 = new Int32Array(nova); c2.fill(0 - 1); c2.set(waitCoroutineId); waitCoroutineId = c2;
  const l2 = new Int32Array(nova); l2.set(freeW); freeW = l2;
  const a2 = new Int32Array(nova); a2.set(activeW); activeW = a2;
  const pr2 = new Int32Array(nova); pr2.set(pendingResolve); pendingResolve = pr2;
  const pc2 = new Int32Array(nova); pc2.set(pendingCancel); pendingCancel = pc2;
  const owner2: (Behavior | null)[] = new Array(nova).fill(null);
  const pred2: Array<(() => boolean) | null> = new Array(nova).fill(null);
  const res2: Array<(() => void) | null> = new Array(nova).fill(null);
  const rej2: Array<((e: any) => void) | null> = new Array(nova).fill(null);
  let i = 0;
  while (i < cap) { owner2[i] = waitOwner[i]; pred2[i] = waitPredicate[i]; res2[i] = waitResolve[i]; rej2[i] = waitReject[i]; i = i + 1; }
  waitOwner = owner2; waitPredicate = pred2; waitResolve = res2; waitReject = rej2;
  i = cap;
  while (i < nova) { freeW[freeWN] = i; freeWN = freeWN + 1; i = i + 1; }
  cap = nova;
}

function allocSlotW(): number {
  if (freeWN === 0) growW();
  freeWN = freeWN - 1;
  return freeW[freeWN];
}

function removeActiveW(pos: number): void {
  activeWN = activeWN - 1;
  activeW[pos] = activeW[activeWN];
}

function freeSlotW(slot: number): void {
  const cid = waitCoroutineId[slot];
  if (cid >= 0 && coCurrentSlot[cid] === slot) coCurrentSlot[cid] = 0 - 1;
  waitOwner[slot] = null; waitPredicate[slot] = null; waitResolve[slot] = null; waitReject[slot] = null;
  waitCoroutineId[slot] = 0 - 1;
  freeW[freeWN] = slot; freeWN = freeWN + 1;
}

// ── tabela de corrotinas (handles de startCoroutine) ─────────────────────
let coCap = 32;
let coAlive = new Uint8Array(coCap);
let coCancelled = new Uint8Array(coCap);
let coOwner: (Behavior | null)[] = new Array(coCap).fill(null);
let coCurrentSlot = new Int32Array(coCap).fill(0 - 1);
let freeC = new Int32Array(coCap);
let freeCN = 0;
let activeC = new Int32Array(coCap);
let activeCN = 0;

function growC(): void {
  const nova = coCap * 2;
  const v2 = new Uint8Array(nova); v2.set(coAlive); coAlive = v2;
  const cc2 = new Uint8Array(nova); cc2.set(coCancelled); coCancelled = cc2;
  const s2 = new Int32Array(nova); s2.fill(0 - 1); s2.set(coCurrentSlot); coCurrentSlot = s2;
  const l2 = new Int32Array(nova); l2.set(freeC); freeC = l2;
  const a2 = new Int32Array(nova); a2.set(activeC); activeC = a2;
  const b2: (Behavior | null)[] = new Array(nova).fill(null);
  let i = 0;
  while (i < coCap) { b2[i] = coOwner[i]; i = i + 1; }
  coOwner = b2;
  i = coCap;
  while (i < nova) { freeC[freeCN] = i; freeCN = freeCN + 1; i = i + 1; }
  coCap = nova;
}

function allocCoroutineId(owner: Behavior): number {
  if (freeCN === 0) growC();
  freeCN = freeCN - 1;
  const cid = freeC[freeCN];
  coAlive[cid] = 1; coCancelled[cid] = 0; coOwner[cid] = owner; coCurrentSlot[cid] = 0 - 1;
  activeC[activeCN] = cid; activeCN = activeCN + 1;
  return cid;
}

function finishCoroutineId(cid: number): void {
  if (coAlive[cid] === 0) return;
  coAlive[cid] = 0; coOwner[cid] = null;
  let i = 0;
  while (i < activeCN) {
    if (activeC[i] === cid) { activeCN = activeCN - 1; activeC[i] = activeC[activeCN]; break; }
    i = i + 1;
  }
  freeC[freeCN] = cid; freeCN = freeCN + 1;
}

/// A corrotina "correndo agora", entre o início/retomada síncrona de seu corpo
/// e o próximo `await` — é assim que `waitForSeconds`/`nextFrame`/etc. sabem a
/// QUEM associar o slot novo, sem precisar de um parâmetro extra em cada
/// chamada (ver o cabeçalho do arquivo: um checkpoint por vez em
/// `coroutineResume` garante que só uma corrotina roda entre dois checkpoints).
let currentId = 0 - 1;

// ── registro de uma espera (usado por waitForSeconds/waitForSecondsRealtime/etc.) ──
function registerWait(owner: Behavior, kind: number, remaining: f64, predicate: (() => boolean) | null): Promise<void> {
  const cid = currentId;
  if (cid >= 0 && coCancelled[cid] !== 0) return Promise.reject(COROUTINE_CANCELLED);
  return new Promise<void>((resolve, reject) => {
    const slot = allocSlotW();
    waitKind[slot] = kind; waitRemaining[slot] = remaining; waitOwner[slot] = owner;
    waitPredicate[slot] = predicate; waitResolve[slot] = resolve; waitReject[slot] = reject;
    waitCoroutineId[slot] = cid;
    if (cid >= 0) coCurrentSlot[cid] = slot;
    activeW[activeWN] = slot; activeWN = activeWN + 1;
  });
}

export function coroutineWaitForSeconds(owner: Behavior, seconds: f64): Promise<void> {
  return registerWait(owner, KIND_TIME, seconds, null);
}
export function coroutineWaitForSecondsRealtime(owner: Behavior, seconds: f64): Promise<void> {
  return registerWait(owner, KIND_REALTIME, seconds, null);
}
export function coroutineWaitForFrames(owner: Behavior, n: number): Promise<void> {
  return registerWait(owner, KIND_FRAMES, n < 1 ? 1 : n, null);
}
export function coroutineWaitUntil(owner: Behavior, cond: () => boolean): Promise<void> {
  return registerWait(owner, KIND_UNTIL, 0.0, cond);
}

/// `this.startCoroutine(fn)` — `fn` roda até o 1º `await` NA HORA (síncrono),
/// como `StartCoroutine` na Unity. Devolve um handle numérico pra
/// `stopCoroutine`.
export function coroutineStart(owner: Behavior, fn: () => Promise<void>): number {
  const cid = allocCoroutineId(owner);
  const previousId = currentId;
  currentId = cid;
  let result: Promise<void>;
  try {
    result = fn();
  } finally {
    currentId = previousId;
  }
  result.then(
    () => { finishCoroutineId(cid); },
    (err: any) => {
      finishCoroutineId(cid);
      if (err !== COROUTINE_CANCELLED) {
        const name = owner.owner !== null ? owner.owner.name : "?";
        logError("Corrotina de " + owner.typeName() + " (" + name + ") lancou: " + String(err));
      }
    }
  );
  return cid;
}

/// Move o slot da posição `pos` de `activeW` (SEM liberá-lo ainda) pra qual
/// fila de pendentes — resolver ou cancelar.
function markPending(pos: number, cancel: number): void {
  const slot = activeW[pos];
  removeActiveW(pos);
  if (cancel !== 0) { pendingCancel[pendingCancelN] = slot; pendingCancelN = pendingCancelN + 1; }
  else { pendingResolve[pendingResolveN] = slot; pendingResolveN = pendingResolveN + 1; }
}

/// 1 se o dono do slot está desligado/destruído (Unity: disable/destroy PARAM
/// a corrotina — não é um "pula esta rodada").
function ownerInvalid(b: Behavior | null): number {
  if (b === null) return 1;
  if (b.enabled === 0) return 1;
  if (b.owner === null || b.owner.active === 0) return 1;
  return 0;
}

/// Metade SÍNCRONA — chamada por `Scene.update` (uma vez por passo simulado:
/// respeita pausa por não ser chamada, `step` por ser chamada manualmente,
/// timescale porque mais/menos passos rodam por segundo real). `dt` é o
/// MESMO dt que os behaviors recebem (game time; em `game.ts` é o dt real do
/// frame, sem conceito de timescale — que é exatamente "tempo de jogo" lá).
export function coroutineTick(dt: f64): void {
  if (activeWN === 0) return;
  const now = performance.now();
  let realDt = (now - lastRealMs) / 1000.0;
  lastRealMs = now;
  if (!(realDt >= 0.0) || realDt > 1.0) realDt = 0.0;
  let i = 0;
  while (i < activeWN) {
    const slot = activeW[i];
    if (ownerInvalid(waitOwner[slot]) !== 0) { markPending(i, 1); continue; }
    const k = waitKind[slot];
    let ready = false;
    if (k === KIND_TIME) { waitRemaining[slot] = waitRemaining[slot] - dt; ready = waitRemaining[slot] <= 0.0; }
    else if (k === KIND_REALTIME) { waitRemaining[slot] = waitRemaining[slot] - realDt; ready = waitRemaining[slot] <= 0.0; }
    else if (k === KIND_FRAMES) { waitRemaining[slot] = waitRemaining[slot] - 1.0; ready = waitRemaining[slot] <= 0.0; }
    else { ready = waitPredicate[slot] !== null ? (waitPredicate[slot] as () => boolean)() : true; }
    if (ready) { markPending(i, 0); continue; }
    i = i + 1;
  }
}
let lastRealMs: f64 = 0.0;

/// Checagem BARATA (sem alocar) pro laço externo (main.ts/game.ts) decidir se
/// vale a pena pagar o checkpoint assíncrono este quadro: 1 quando
/// `coroutineTick` deixou pelo menos uma continuação pronta (resolver ou
/// cancelar) nesta rodada. Chamar `coroutineResume()` sem nenhuma pronta é
/// inofensivo (as duas filas ficam vazias, o laço nem entra), mas o próprio
/// `await` de uma `async function` chamada por quadro aloca no runtime deste
/// motor mesmo sem nenhum `await` interno — por isso o laço externo só chama
/// `coroutineResume` quando isto for 1 (ver CLAUDE.md § Custo por quadro).
export function coroutineHasReady(): boolean {
  return pendingResolveN > 0 || pendingCancelN > 0;
}

/// Metade ASSÍNCRONA — chamada uma vez por quadro pelo laço de fora (main.ts,
/// game.ts), DEPOIS de `scene.update`. Resolve/cancela as pendências desta
/// rodada UMA DE CADA VEZ, com um `await` de verdade entre elas: é esse
/// `await` que dá ao motor a chance de rodar a continuação da corrotina
/// específica (ver o cabeçalho do arquivo) antes de seguir pra próxima —
/// `currentId` fica certo mesmo com várias corrotinas do MESMO objeto
/// pendentes no mesmo quadro.
export async function coroutineResume(): Promise<void> {
  let i = 0;
  while (i < pendingCancelN) {
    const slot = pendingCancel[i];
    const fn = waitReject[slot];
    const cid = waitCoroutineId[slot];
    freeSlotW(slot);
    currentId = cid;
    if (fn !== null) fn(COROUTINE_CANCELLED);
    await CHECKPOINT;
    i = i + 1;
  }
  pendingCancelN = 0;
  i = 0;
  while (i < pendingResolveN) {
    const slot = pendingResolve[i];
    const fn = waitResolve[slot];
    const cid = waitCoroutineId[slot];
    freeSlotW(slot);
    currentId = cid;
    if (fn !== null) fn();
    await CHECKPOINT;
    i = i + 1;
  }
  pendingResolveN = 0;
  currentId = 0 - 1;
}
const CHECKPOINT: Promise<void> = Promise.resolve();

/// `stopCoroutine(handle)` — cancela UMA corrotina pelo handle de
/// `startCoroutine`. Sem efeito se já terminou/não existe. O corpo desenrola
/// no próximo `coroutineResume` (ver cabeçalho do arquivo).
export function coroutineStop(handle: number): void {
  if (handle < 0 || handle >= coCap || coAlive[handle] === 0) return;
  coCancelled[handle] = 1;
  const slot = coCurrentSlot[handle];
  if (slot < 0) return;
  let pos = 0;
  while (pos < activeWN && activeW[pos] !== slot) pos = pos + 1;
  if (pos < activeWN) markPending(pos, 1);
}

/// `stopAllCoroutines()` de UM Behavior — todas as corrotinas vivas cujo dono
/// é `owner`.
export function coroutineStopAllOf(owner: Behavior): void {
  let i = 0;
  while (i < activeCN) {
    const cid = activeC[i];
    if (coOwner[cid] === owner) coroutineStop(cid);
    i = i + 1;
  }
}

/// Cancela TUDO — saída do Play (`Scene.clear`) e destruição de objeto
/// (`Scene.removeAt`, que chama isto só pros behaviors do objeto removido via
/// `coroutineStopAllOf` por behavior; isto aqui é o "clear geral").
export function coroutineStopEverywhere(): void {
  while (activeWN > 0) markPending(activeWN - 1, 1);
  let i = 0;
  while (i < activeCN) { coCancelled[activeC[i]] = 1; i = i + 1; }
}

// ── introspecção (WS `contexto`, sem nada hardcoded — lido do escalonador) ──

/// Quantas corrotinas estão vivas agora (iniciadas e não terminadas/canceladas).
export function coroutineActiveCount(): number { return activeCN; }

/// Uma entrada por objeto DONO com corrotinas vivas: `{name, count}`. Não é
/// caminho por quadro (só a porta de controle chama) — pode alocar.
export function coroutineActiveByOwner(): any[] {
  const names: string[] = [];
  const counts: number[] = [];
  let i = 0;
  while (i < activeCN) {
    const b = coOwner[activeC[i]];
    const name = b !== null && b.owner !== null ? b.owner.name : "?";
    const k = names.indexOf(name);
    if (k < 0) { names.push(name); counts.push(1); } else counts[k] = counts[k] + 1;
    i = i + 1;
  }
  const out: any[] = [];
  i = 0;
  while (i < names.length) { out.push({ name: names[i], count: counts[i] }); i = i + 1; }
  return out;
}

// Isola qual parte exata do wrapper async do laço principal aloca:
// (A) chamar uma `async function` vazia (sem nenhum `await` dentro) e dar
//     `await` no resultado, por quadro;
// (B) `await` num `Promise.resolve()` NOVO por quadro (o que `coroutineResume`
//     faz sozinho, sem corrotina nenhuma pendente, além do early-return);
// (C) `await` numa Promise JÁ RESOLVIDA e REAPROVEITADA (módulo-level,
//     alocada uma vez) — candidato a correção;
// (D) nenhum await, só um `if` checando uma flag barata (candidato a correção
//     preferido: só paga o checkpoint quando há continuação pronta).
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-frame-async-isolate-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));

// ── A: async function vazia, await no resultado ────────────────────────────
async function vazia(): Promise<void> {}
await vazia();
io.print("FASE A-async-vazia " + n);
let i = 0;
while (i < n) { await vazia(); i = i + 1; }

// ── B: Promise.resolve() NOVO por quadro ────────────────────────────────────
io.print("FASE B-promise-novo " + n);
i = 0;
while (i < n) { await Promise.resolve(); i = i + 1; }

// ── C: Promise já resolvida, REAPROVEITADA (alocada uma vez, fora do laço) ──
const REUSED: Promise<void> = Promise.resolve();
io.print("FASE C-promise-reaproveitada " + n);
i = 0;
while (i < n) { await REUSED; i = i + 1; }

// ── D: sem await nenhum — só uma flag checada (custo zero esperado) ────────
let flag = false;
io.print("FASE D-so-flag " + n);
i = 0;
while (i < n) { if (flag) { await REUSED; } i = i + 1; }

io.print("FASE fim");

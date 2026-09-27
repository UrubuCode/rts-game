// Bench de tempo (ns/quadro) do wrapper async do laço principal: ANTES
// (async function frame() + await coroutineResume() incondicional, o
// formato original do commit abb9a8c) vs. DEPOIS (frame() síncrona +
// await coroutineResume() só quando coroutineHasReady(), o formato corrigido
// em game.ts/main.ts) vs. um laço 100% síncrono (sem async/await nenhum,
// referência).
//
//   rts.exe run tests/claude-test-frame-async-timing.ts
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineResume, coroutineHasReady } from "@engine/core/coroutine_scheduler";

const n = parseInt(process.env("BENCH_N") === "" ? "200000" : process.env("BENCH_N"));
const FDT: f64 = 1.0 / 60.0;
class Vazia extends Behavior {}

function novaCena(nome: string): Scene {
  const cena = new Scene(nome);
  const go = new GameObject("v");
  go.addBehavior(new Vazia());
  cena.add(go);
  return cena;
}

// ── ANTES: async function frame() + await coroutineResume() incondicional ──
const cenaAntes = novaCena("antes");
async function frameAntes(): Promise<void> {
  cenaAntes.update(FDT);
  await coroutineResume();
}
await frameAntes(); // aquece
{
  const t0 = performance.now();
  let i = 0;
  while (i < n) { await frameAntes(); i = i + 1; }
  const t1 = performance.now();
  const ns = ((t1 - t0) * 1e6) / n;
  io.print("ANTES  (async frame + await incondicional): " + ns.toFixed(1) + " ns/quadro");
}

// ── DEPOIS: frame() sincrona + await coroutineResume() só se hasReady ──────
const cenaDepois = novaCena("depois");
function frameDepois(): void {
  cenaDepois.update(FDT);
}
frameDepois();
if (coroutineHasReady()) await coroutineResume(); // aquece
{
  const t0 = performance.now();
  let i = 0;
  while (i < n) {
    frameDepois();
    if (coroutineHasReady()) await coroutineResume();
    i = i + 1;
  }
  const t1 = performance.now();
  const ns = ((t1 - t0) * 1e6) / n;
  io.print("DEPOIS (frame sincrona + await condicional): " + ns.toFixed(1) + " ns/quadro");
}

// ── REFERÊNCIA: 100% síncrono, sem async/await nenhum ───────────────────────
const cenaSync = novaCena("sync");
function frameSync(): void { cenaSync.update(FDT); }
frameSync();
{
  const t0 = performance.now();
  let i = 0;
  while (i < n) { frameSync(); i = i + 1; }
  const t1 = performance.now();
  const ns = ((t1 - t0) * 1e6) / n;
  io.print("SYNC   (referencia, sem async/await): " + ns.toFixed(1) + " ns/quadro");
}

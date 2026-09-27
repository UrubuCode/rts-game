// Sonda de ALOCAÇÃO do FORMATO do laço principal introduzido pelas
// corrotinas (Task corrotinas): `async function frame()` + `await
// coroutineResume()` por quadro, chamado de fora como `await frame()`
// (main.ts/game.ts). Isola exatamente esse wrapper — sem desenho, física ou
// UI — para responder: o `async`/`await` de per-frame aloca sozinho, e
// quanto custa `coroutineResume` quando não há corrotina nenhuma pendente
// (o caso comum: jogo/editor sem corrotinas ativas)?
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-frame-async-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em cada fase, mesmo padrão de claude-test-frame-gc.ts.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineResume } from "@engine/core/coroutine_scheduler";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const FDT: f64 = 1.0 / 60.0;

class Vazia extends Behavior {}

// ── FASE async-sem-corrotinas: reproduz o formato exato do laço externo
// (main.ts/game.ts) — `async function frame()` chamando `scene.update` e
// `await coroutineResume()` — mas SEM nenhuma corrotina viva. É o caso comum.
const cena = new Scene("sem-corrotinas");
const go = new GameObject("v");
go.addBehavior(new Vazia());
cena.add(go);

async function frameSemCorrotinas(): Promise<void> {
  cena.update(FDT);
  await coroutineResume();
}

await frameSemCorrotinas(); // aquece (1a chamada pode alocar o módulo/promise inicial)

io.print("FASE async-sem-corrotinas " + n);
let i = 0;
while (i < n) { await frameSemCorrotinas(); i = i + 1; }

// ── FASE async-com-pendentes: mesmo formato, com N corrotinas pendentes
// (nenhuma pronta ainda nesta fase — só paga o tick + o coroutineResume
// vazio, já que pendingResolveN/pendingCancelN ficam em 0).
const N_PEND = 200;
const cena2 = new Scene("com-pendentes");
const go2 = new GameObject("alvo");
class Marcador extends Behavior {}
const b = new Marcador();
go2.addBehavior(b);
cena2.add(go2);
let j = 0;
while (j < N_PEND) {
  b.startCoroutine(async () => { await b.waitForSeconds(1.0e9); });
  j = j + 1;
}

async function frameComPendentes(): Promise<void> {
  cena2.update(FDT);
  await coroutineResume();
}

await frameComPendentes(); // aquece

io.print("FASE async-com-pendentes " + n);
i = 0;
while (i < n) { await frameComPendentes(); i = i + 1; }

io.print("FASE fim " + N_PEND);

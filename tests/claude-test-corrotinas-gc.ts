// Sonda de ALOCAÇÃO do caminho por quadro do escalonador de corrotinas
// (`coroutineTick`, chamado por `Scene.update`). Rodar com RTS_GC_DEBUG=1 e
// contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as coletas antes do
// primeiro marcador são do setup) — mesmo padrão de claude-test-frame-gc.ts.
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-corrotinas-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em cada fase. `coroutineResume` (a metade que RESOLVE e
// deixa os corpos rodarem) fica de fora do portão de propósito: ela usa
// `await` para o checkpoint, e criar/resolver uma corrotina já é admitido
// como alocação (é uma Promise) — só o TICK (a metade síncrona) precisa ser
// zero-alocação. A fase "vazio" mede exatamente isso: nenhuma corrotina
// pendente, só o `if (activeWN === 0) return;` de saída rápida.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineResume } from "@engine/core/coroutine_scheduler";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const FDT: f64 = 1.0 / 60.0;

class Vazia extends Behavior {}

// ── FASE vazio: Scene.update com a lista de corrotinas pendentes vazia ──────
const cenaVazia = new Scene("vazia-corrotinas");
const goVazio = new GameObject("v");
goVazio.addBehavior(new Vazia());
cenaVazia.add(goVazio);
cenaVazia.update(FDT); // aquece

io.print("FASE vazio " + n);
let i = 0;
while (i < n) { cenaVazia.update(FDT); i = i + 1; }

// ── FASE pendentes: N_PEND corrotinas esperando (tempo/quadros/ate),
// nenhuma pronta ainda neste trecho — só o desconto por quadro custa.
const N_PEND = 500;
const cena = new Scene("pendentes");
const go = new GameObject("alvo");
class Marcador extends Behavior {}
const b = new Marcador();
go.addBehavior(b);
cena.add(go);
let j = 0;
while (j < N_PEND) {
  const k = j % 3;
  if (k === 0) b.startCoroutine(async () => { await b.waitForSeconds(1.0e9); });
  else if (k === 1) b.startCoroutine(async () => { await b.waitForFrames(2000000000); });
  else b.startCoroutine(async () => { await b.waitUntil(() => false); });
  j = j + 1;
}
cena.update(FDT); // aquece (a 1a chamada aloca os slots)

io.print("FASE pendentes " + n);
i = 0;
while (i < n) { cena.update(FDT); i = i + 1; }

io.print("FASE fim " + N_PEND);

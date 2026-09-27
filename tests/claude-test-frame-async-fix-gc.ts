// Verifica a CORREÇÃO proposta antes de aplicá-la ao laço principal: só paga
// o checkpoint assíncrono (`await coroutineResume()`) quando o escalonador
// tem pelo menos uma continuação PRONTA neste quadro (`coroutineHasReady()`,
// uma checagem de flag — sem alocar). Com zero corrotinas OU com corrotinas
// pendentes mas nenhuma pronta ainda, o quadro fica 100% síncrono.
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-frame-async-fix-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineResume, coroutineHasReady } from "@engine/core/coroutine_scheduler";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const FDT: f64 = 1.0 / 60.0;

class Vazia extends Behavior {}

function frameSincronoComChecagem(cena: Scene): void {
  cena.update(FDT);
}

// ── FASE sem corrotina nenhuma ──────────────────────────────────────────────
const cena = new Scene("sem-corrotinas");
const go = new GameObject("v");
go.addBehavior(new Vazia());
cena.add(go);

frameSincronoComChecagem(cena);
if (coroutineHasReady()) await coroutineResume();

io.print("FASE fix-sem-corrotinas " + n);
let i = 0;
while (i < n) {
  frameSincronoComChecagem(cena);
  if (coroutineHasReady()) await coroutineResume();
  i = i + 1;
}

// ── FASE com corrotinas pendentes, nenhuma pronta (espera gigante) ──────────
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
frameSincronoComChecagem(cena2);
if (coroutineHasReady()) await coroutineResume();

io.print("FASE fix-pendentes-nao-prontas " + n);
i = 0;
while (i < n) {
  frameSincronoComChecagem(cena2);
  if (coroutineHasReady()) await coroutineResume();
  i = i + 1;
}

io.print("FASE fim " + N_PEND);

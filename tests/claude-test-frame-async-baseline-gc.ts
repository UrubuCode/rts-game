// Baseline de comparação para claude-test-frame-async-gc.ts: o MESMO
// `scene.update` por quadro, mas SEM `async function`/`await` nenhum — para
// isolar se a alocação medida lá vem do wrapper async/await em si, e não do
// `Scene.update`/`coroutineTick` (já provados zero-alocação em
// claude-test-corrotinas-gc.ts).
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-frame-async-baseline-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineTick } from "@engine/core/coroutine_scheduler";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const FDT: f64 = 1.0 / 60.0;

class Vazia extends Behavior {}

const cena = new Scene("sem-corrotinas-sync");
const go = new GameObject("v");
go.addBehavior(new Vazia());
cena.add(go);

function frameSincrono(): void {
  cena.update(FDT);
  coroutineTick(FDT); // metade sincrona equivalente (scene.update ja chama isto internamente; chamado 2x aqui so pra igualar o numero de "toques" por quadro do outro teste — sem custo de await)
}

frameSincrono(); // aquece

io.print("FASE sync-sem-corrotinas " + n);
let i = 0;
while (i < n) { frameSincrono(); i = i + 1; }

io.print("FASE fim 0");

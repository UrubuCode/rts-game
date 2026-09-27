// Sonda de ALOCAÇÃO do relógio DSP (ritmo): 200 000 chamadas de `pumpAudio`
// (que atualiza o relógio audível a cada volta — `auAtualizarRelogio`, dentro
// de `auAtualizarAlvo`) e de `tempoDsp`/`amostrasDsp`/`vozTempoAudivel`, 0
// coletas entre os marcadores "FASE" (CLAUDE.md "Custo por quadro").
//
//   RTS_GC_DEBUG=1 GC_N=200000 $RTS run tests/claude-test-audio-relogio-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { initAudio, AUDIO_NULO, pumpAudio, tocarClipe, tempoDsp, amostrasDsp, vozTempoAudivel } from "@engine/audio/audio";
import { toneClip, FORMA_SENO } from "@engine/audio/clip";
import { novoPedido, PEDIDO_LACO } from "@engine/audio/vozes";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
initAudio(AUDIO_NULO);
const pedido = novoPedido();
pedido[PEDIDO_LACO] = 1.0;
const id = tocarClipe(toneClip(220.0, 5.0, FORMA_SENO), pedido);

let f = 0;
while (f < 50) { pumpAudio(); f = f + 1; } // regime estável antes de medir

io.print("FASE pump " + n);
let acc: f64 = 0.0;
f = 0;
while (f < n) {
  pumpAudio();
  // Lê o relógio (o caminho que `agendarEm`/scripts de ritmo chamam por
  // quadro): soma num acumulador só pra não deixar o compilador descartar a
  // chamada como morta.
  acc = acc + tempoDsp() + amostrasDsp() + vozTempoAudivel(id);
  f = f + 1;
}
io.print("FASE fim " + acc);

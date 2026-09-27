// Sonda de ALOCAÇÃO do mixer (Task 6). Rodar com RTS_GC_DEBUG=1 e contar as
// linhas "rts-gc" ENTRE os marcadores "FASE". Portão: 0 coletas nas fases
// `mixar` e `pump` com 200 000 iterações (as de antes do 1º marcador são setup).
//
//   RTS_GC_DEBUG=1 GC_N=200000 $RTS run tests/claude-test-audio-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// 32 vozes: 8 em laço mono, 8 com pitch 1,3 em estéreo, 8 3D em laço se
// movendo e 8 3D além do máximo (virtuais).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { initAudio, AUDIO_NULO, mixarBloco, pumpAudio, tocarClipe, moverVoz } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido, PEDIDO_LACO, PEDIDO_PITCH, PEDIDO_FLAGS, PEDIDO_X, PEDIDO_BLEND, PEDIDO_MIN, PEDIDO_MAX, FLAG_3D } from "@engine/audio/vozes";
import { setListener, setRolloff } from "@engine/audio/spatial";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
initAudio(AUDIO_NULO);
setListener(new Float64Array(8)); setRolloff(1.0, 60.0);
const mono = new Float32Array(48000); let i = 0;
while (i < mono.length) { mono[i] = Math.sin(i * 0.05) * 0.1; i = i + 1; }
const est = new Float32Array(96000); i = 0;
while (i < est.length) { est[i] = Math.sin(i * 0.03) * 0.1; i = i + 1; }
const cm = AudioClip.fromSamples("m", mono, 1);
const ce = AudioClip.fromSamples("e", est, 2);
const p = novoPedido();
const ids: number[] = [];
let k = 0;
while (k < 32) {
  p[PEDIDO_LACO] = 1.0; p[PEDIDO_PITCH] = k >= 8 && k < 16 ? 1.3 : 1.0;
  p[PEDIDO_FLAGS] = k >= 16 ? FLAG_3D : 0; p[PEDIDO_BLEND] = k >= 16 ? 1.0 : 0.0;
  p[PEDIDO_MIN] = 1.0; p[PEDIDO_MAX] = 60.0; p[PEDIDO_X] = k >= 24 ? 500.0 : 3.0;
  ids.push(tocarClipe(k >= 8 && k < 16 ? ce : cm, p));
  k = k + 1;
}
const pos = new Float64Array(3);
let f = 0;
while (f < 50) { mixarBloco(64); f = f + 1; }
io.print("FASE mixar " + n);
f = 0;
while (f < n) {
  pos[0] = (f % 100) * 0.5 - 25.0;
  moverVoz(ids[16 + (f & 7)], pos);
  mixarBloco(64);
  f = f + 1;
}
io.print("FASE pump " + n);
f = 0;
while (f < n) { pumpAudio(); f = f + 1; }
io.print("FASE fim");

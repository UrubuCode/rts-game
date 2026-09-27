// Bench do mixer: 8, 16, 24 e 32 vozes de clipe, blocos de 800 amostras, com o
// kernel TS de referência ("antes") e o nativo `mix_add` ("depois"), na MESMA
// sessão. Portão (spec §3.8): 32 vozes nativas ≤ 0,5 ms por bloco.
//   RTS_VSYNC=0 $RTS run bench/claude-bench-audio.ts
import io from "@compat/io.ts";
import { initAudio, AUDIO_NULO, mixarBloco, tocarClipe, pararTodas, definirKernelMix, KERNEL_TS, KERNEL_NATIVO } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido, PEDIDO_LACO, PEDIDO_PITCH, PEDIDO_FLAGS, PEDIDO_X, PEDIDO_BLEND, PEDIDO_MIN, PEDIDO_MAX, FLAG_3D } from "@engine/audio/vozes";
import { setListener, setRolloff } from "@engine/audio/spatial";

const REPS = 500;
initAudio(AUDIO_NULO);
setListener(new Float64Array(8)); setRolloff(1.0, 60.0);
const a = new Float32Array(96000); let i = 0;
while (i < a.length) { a[i] = Math.sin(i * 0.02) * 0.05; i = i + 1; }
const clipe = AudioClip.fromSamples("b", a, 2);
const p = novoPedido();
function medir(kernel: number, vozes: number): f64 {
  pararTodas(); definirKernelMix(kernel);
  let k = 0;
  while (k < vozes) {
    p[PEDIDO_LACO] = 1.0; p[PEDIDO_PITCH] = 0.9 + (k % 5) * 0.05;
    p[PEDIDO_FLAGS] = (k & 1) !== 0 ? FLAG_3D : 0; p[PEDIDO_BLEND] = (k & 1) !== 0 ? 1.0 : 0.0;
    p[PEDIDO_MIN] = 1.0; p[PEDIDO_MAX] = 60.0; p[PEDIDO_X] = 2.0 + k;
    tocarClipe(clipe, p);
    k = k + 1;
  }
  let w = 0;
  while (w < 20) { mixarBloco(800); w = w + 1; }
  const t0 = Date.now();
  let r = 0;
  while (r < REPS) { mixarBloco(800); r = r + 1; }
  return (Date.now() - t0) / REPS;
}
const nomes = ["ts", "nativo"];
let kk = 0;
while (kk < 2) {
  let v = 8;
  while (v <= 32) {
    io.print("kernel=" + nomes[kk] + " vozes=" + v + " ms/bloco=" + medir(kk === 0 ? KERNEL_TS : KERNEL_NATIVO, v).toFixed(3));
    v = v + 8;
  }
  kk = kk + 1;
}
const nat32 = medir(KERNEL_NATIVO, 32);
io.print(nat32 <= 0.5 ? "[PASSOU] 32 vozes nativas em " + nat32.toFixed(3) + " ms (meta 0,5)" : "[FALHOU] 32 vozes nativas em " + nat32.toFixed(3) + " ms (meta 0,5)");

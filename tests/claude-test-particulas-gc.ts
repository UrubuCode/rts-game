// Sonda de ALOCAÇÃO do caminho por quadro das partículas (Task 2 — Fix round
// 1; Task 3 acrescenta a fase `velocidade`). Rodar com RTS_GC_DEBUG=1 e
// contar as linhas "rts-gc" ENTRE os marcadores "FASE". Portão: 0 coletas em
// cada fase com 200 000 iterações (as de antes do 1º marcador são setup).
//
//   RTS_GC_DEBUG=1 GC_N=200000 $RTS run tests/claude-test-particulas-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// FASE emitir: `emitirN` (emissão por taxa, uma chamada por quadro) seguido
// de `atualizarVidas` (envelhecer/reciclar), num pool de max 1000 — o par que
// um ParticleSystem chamaria de `update()` a cada quadro.
//
// FASE velocidade: `aplicarVelocidade` (vento constante + arrasto) sobre o
// mesmo pool, já com partículas vivas em regime — a chamada por quadro que um
// ParticleSystem faria antes de `atualizarVidas`.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { aplicarVelocidade } from "@engine/particles/curvas";
import { FORMA_ESFERA, D_FORMA, D_RAIO, D_VEL_MIN, D_VEL_MAX, D_VIDA_MIN, D_VIDA_MAX } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));

fixarSementeAleatorio(42);
const pool = criarPool(1000);
const desc = new Float64Array(16);
desc[D_FORMA] = FORMA_ESFERA; desc[D_RAIO] = 3.0;
desc[D_VEL_MIN] = 1.0; desc[D_VEL_MAX] = 4.0;
desc[D_VIDA_MIN] = 0.05; desc[D_VIDA_MAX] = 0.1; // vida curta: mantém emissão+reciclagem em regime, sem lotar o pool

// aquece o caminho uma vez (1ª chamada de cada função, caches de módulo)
emitirN(pool, desc, 4);
atualizarVidas(pool, 0.016);

io.print("FASE emitir " + n);
let f = 0;
while (f < n) {
  emitirN(pool, desc, 4);
  atualizarVidas(pool, 0.016);
  f = f + 1;
}
io.print("FIM emitir " + n);

// pool novo, com vida longa: mantém partículas vivas ao longo de toda a fase,
// para exercitar o laço completo de `aplicarVelocidade` (todas as 1000 vivas).
const poolVento = criarPool(1000);
const descVento = new Float64Array(16);
descVento[D_FORMA] = FORMA_ESFERA; descVento[D_RAIO] = 3.0;
descVento[D_VEL_MIN] = 1.0; descVento[D_VEL_MAX] = 4.0;
descVento[D_VIDA_MIN] = 1000.0; descVento[D_VIDA_MAX] = 1000.0;
emitirN(poolVento, descVento, 1000);
const ventoXYZ = new Float64Array([1.0, 0.0, -0.5]);

// aquece o caminho uma vez
aplicarVelocidade(poolVento, ventoXYZ, 0.5, 0.016);

io.print("FASE velocidade " + n);
let v = 0;
while (v < n) {
  aplicarVelocidade(poolVento, ventoXYZ, 0.5, 0.016);
  v = v + 1;
}
io.print("FIM velocidade " + n);
io.print("[PASSOU] claude-test-particulas-gc (vivas=" + pool.vivas + ", vivasVento=" + poolVento.vivas + ")");

// Sonda de ALOCAÇÃO do caminho por quadro das partículas (Task 2 — Fix round
// 1). Rodar com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os
// marcadores "FASE". Portão: 0 coletas na fase `emitir` com 200 000
// iterações (as de antes do 1º marcador são setup).
//
//   RTS_GC_DEBUG=1 GC_N=200000 $RTS run tests/claude-test-particulas-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// FASE emitir: `emitirN` (emissão por taxa, uma chamada por quadro) seguido
// de `atualizarVidas` (envelhecer/reciclar), num pool de max 1000 — o par que
// um ParticleSystem chamaria de `update()` a cada quadro.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
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
io.print("[PASSOU] claude-test-particulas-gc (vivas=" + pool.vivas + ")");

// Repro mínimo: escrita de propriedade num elemento de array dentro de um
// bloco que também faz `return` aloca por chamada. Rodar com RTS_GC_DEBUG=1.
import io from "@compat/io.ts";
interface Hit { hit: boolean; id: number; }
const hits: Hit[] = [];
let i = 0;
while (i < 16) { hits.push({ hit: false, id: 0 }); i = i + 1; }

// ALOCA (~2 células por chamada): 100.000 chamadas -> 3 coletas, ~188k células
function writeEarlyReturn(arr: Hit[], slot: number, max: number): number {
  if (slot < max) {
    arr[slot].hit = true;
    return slot + 1;
  }
  return slot;
}
// NÃO aloca: mesma escrita, retorno único
function writeSingleReturn(arr: Hit[], slot: number, max: number): number {
  let r = slot;
  if (slot < max) {
    arr[slot].hit = true;
    r = slot + 1;
  }
  return r;
}
let s = 0; i = 0;
while (i < 100000) { if (s >= 16) s = 0; s = writeEarlyReturn(hits, s, 16); i = i + 1; }
io.print("[A] early return: " + s);
s = 0; i = 0;
while (i < 100000) { if (s >= 16) s = 0; s = writeSingleReturn(hits, s, 16); i = i + 1; }
io.print("[B] single return: " + s);

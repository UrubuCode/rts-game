import io from "@compat/io.ts";
class Idx {
  a: number = 1; b: number = 2; c: number = 3; d: number = 4; e: number = 5; f: number = 6; g: number = 7; h: number = 8;
  i: number = 9; j: number = 10; k: number = 11; l: number = 12; m: number = 13; n: number = 14; o: number = 15; p: number = 16; q: number = 17;
  xs: number[] = [];
  passes(k: number): boolean { return (k & 1) === 0 && this.a > 0; }
  fill(k: number): number { this.xs[k] = k * 2; return k; }
}
function passesFree(idx: Idx, k: number): boolean { return (k & 1) === 0 && idx.a > 0; }
const idx = new Idx();
let acc = 0;
let i = 0;
while (i < 3000000) { if (idx.passes(i)) acc = acc + 1; i = i + 1; }
io.print("[m] metodos: " + acc);
i = 0;
while (i < 3000000) { if (passesFree(idx, i)) acc = acc + 1; i = i + 1; }
io.print("[m] livres: " + acc);
i = 0;
while (i < 3000000) { idx.fill(i & 1023); i = i + 1; }
io.print("[m] fill: " + idx.xs.length);

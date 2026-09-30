import io from "@compat/io.ts";
class Idx {
  v: number = 1;
  viaThis(n: number): number { let a = 0; let i = 0; while (i < n) { a = a + usa(this, i); i = i + 1; } return a; }
  viaLocal(n: number): number { const eu: Idx = this; let a = 0; let i = 0; while (i < n) { a = a + usa(eu, i); i = i + 1; } return a; }
}
function usa(x: Idx, k: number): number { return x.v + k; }
const o = new Idx();
io.print("[t] inicio");
let acc = 0;
acc = acc + o.viaThis(200000);
io.print("[t] passando this (" + acc + ")");
acc = acc + o.viaLocal(200000);
io.print("[t] passando const eu = this (" + acc + ")");
let i = 0;
while (i < 200000) { acc = acc + usa(o, i); i = i + 1; }
io.print("[t] passando variavel de fora (" + acc + ")");

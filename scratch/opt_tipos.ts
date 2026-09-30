import io from "@compat/io.ts";
interface H { hit: boolean; }
const hs: H[] = [{ hit: false }];
class C {
  a: number = 1;
  numOpt(x: number, y: number, z: number, r: number, o: H[], m: number, ma?: number, la?: number): number { const mm = ma !== undefined ? ma : 1; return x + mm; }
  boolOpt(x: number, y: number, z: number, r: number, o: H[], m: number, ta?: boolean): number { const t = ta !== undefined ? ta : false; return t ? x : y; }
  semOpt(x: number, y: number, z: number, r: number, o: H[], m: number, t: boolean): number { return t ? x : y; }
}
const c = new C();
function f(nome: string, k: number): void {
  let acc = 0; let i = 0;
  while (i < 200000) {
    if (k === 0) acc = acc + c.numOpt(1, 2, 3, 4, hs, 6, 7, 8);
    else if (k === 1) acc = acc + c.boolOpt(1, 2, 3, 4, hs, 6, false);
    else acc = acc + c.semOpt(1, 2, 3, 4, hs, 6, false);
    i = i + 1;
  }
  io.print("[o] " + nome + " (" + acc + ")");
}
io.print("[o] inicio");
f("opcionais number", 0);
f("opcional boolean", 1);
f("boolean obrigatorio", 2);

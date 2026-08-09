import io from "rts:io";
import math from "rts:math";

const N = 100000;
const gArr: f64[] = [];
let k = 0;
while (k < 64) { gArr.push(k * 1.0); k = k + 1; }

function somaGlobal(n: number): f64 {
  let a: f64 = 0.0; let i = 0;
  while (i < n) { a = a + gArr[i % 64]; i = i + 1; }
  return a;
}
/// o MESMO laço, com o array chegando por PARÂMETRO
function somaParam(arr: f64[], n: number): f64 {
  let a: f64 = 0.0; let i = 0;
  while (i < n) { a = a + arr[i % 64]; i = i + 1; }
  return a;
}
/// e com uma cópia local da referência de módulo (o truque mais barato de todos)
function somaCopiaLocal(n: number): f64 {
  const arr: f64[] = gArr;
  let a: f64 = 0.0; let i = 0;
  while (i < n) { a = a + arr[i % 64]; i = i + 1; }
  return a;
}

somaGlobal(1000); somaParam(gArr, 1000); somaCopiaLocal(1000);

const t0 = performance.now(); const a1 = somaGlobal(N);
const t1 = performance.now(); const a2 = somaParam(gArr, N);
const t2 = performance.now(); const a3 = somaCopiaLocal(N);
const t3 = performance.now();

io.print("[custo] array de MODULO      : " + math.floor((t1 - t0) * 1000000.0 / N) + " ns/acesso");
io.print("[custo] array por PARAMETRO  : " + math.floor((t2 - t1) * 1000000.0 / N) + " ns/acesso");
io.print("[custo] copia LOCAL da ref   : " + math.floor((t3 - t2) * 1000000.0 / N) + " ns/acesso");
io.print("(" + math.floor(a1) + " " + math.floor(a2) + " " + math.floor(a3) + ")");

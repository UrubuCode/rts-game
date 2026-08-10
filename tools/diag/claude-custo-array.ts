import io from "../../compat/io.ts";
import math from "../../compat/math.ts";

const N = 200000;
const arr: f64[] = [];
let k = 0;
while (k < 64) { arr.push(k * 1.0); k = k + 1; }

// leitura de array
let a: f64 = 0.0;
const t0 = performance.now();
let i = 0;
while (i < N) { a = a + arr[i % 64]; i = i + 1; }
const t1 = performance.now();

// escrita de array
let j = 0;
const t2 = performance.now();
while (j < N) { arr[j % 64] = j * 1.0; j = j + 1; }
const t3 = performance.now();

// math.sin
let s: f64 = 0.0;
let m = 0;
const t4 = performance.now();
while (m < N) { s = s + math.sin(m * 0.001); m = m + 1; }
const t5 = performance.now();

io.print("[custo] leitura arr[i] : " + math.floor((t1 - t0) * 1000000.0 / N) + " ns");
io.print("[custo] escrita arr[i] : " + math.floor((t3 - t2) * 1000000.0 / N) + " ns");
io.print("[custo] math.sin       : " + math.floor((t5 - t4) * 1000000.0 / N) + " ns");
io.print("(a=" + math.floor(a) + " s=" + math.floor(s) + ")");

// Uma variável por vez: a ANOTAÇÃO do array e o VALOR que entra nele.
const N = 500;
function medir(nome: string, f: () => f64): void {
  let q: f64 = 0.0; for (let i = 0; i < 3; i++) q = q + f();
  const t0 = Date.now();
  let acc: f64 = 0.0; for (let i = 0; i < 2000; i++) acc = acc + f();
  println("  " + nome.padEnd(42) + ((Date.now() - t0) * 1000000.0 / (2000 * N)).toFixed(1).padStart(8) + " ns/elem");
}
const a1: f64[] = [];    for (let i = 0; i < N; i++) a1.push(i);        // f64[]    + inteiro
const a2: f64[] = [];    for (let i = 0; i < N; i++) a2.push(i * 1.0);  // f64[]    + float
const a3: number[] = []; for (let i = 0; i < N; i++) a3.push(i);        // number[] + inteiro
const a4: number[] = []; for (let i = 0; i < N; i++) a4.push(i * 1.0);  // number[] + float

medir("f64[]    push(i)      [inteiro]", () => { let s: f64 = 0.0; let i = 0; while (i < N) { s = s + a1[i]; i = i + 1; } return s; });
medir("f64[]    push(i*1.0)  [float]", () => { let s: f64 = 0.0; let i = 0; while (i < N) { s = s + a2[i]; i = i + 1; } return s; });
medir("number[] push(i)      [inteiro]", () => { let s: f64 = 0.0; let i = 0; while (i < N) { s = s + a3[i]; i = i + 1; } return s; });
medir("number[] push(i*1.0)  [float]", () => { let s: f64 = 0.0; let i = 0; while (i < N) { s = s + a4[i]; i = i + 1; } return s; });

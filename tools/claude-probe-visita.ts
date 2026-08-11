// A visita de `computeWorld`, decomposta — 1,6 µs por objeto não fecha.
//
//   rts.exe run tools/claude-probe-visita.ts
//
// ── O NÚMERO QUE NÃO FECHA ─────────────────────────────────────────────────
//
// `computeWorld` custa 12,90 ms para 8000 objetos numa cena onde NADA se move.
// São 1,6 µs por objeto, para um trabalho que lê `parent`, lê o transform e
// compara cinco campos — umas sete leituras.
//
// `engine/core/analysis.ts` mede leitura de campo em 11-23 ns nesta máquina.
// Sete leituras deveriam custar ~100 ns, e não 1600. O fator de 16 tem de estar
// em algum lugar, e adivinhar onde é como esta sessão errou cinco vezes.
//
// ── O QUE CADA DEGRAU ACRESCENTA ───────────────────────────────────────────
//
// Cada caso acrescenta UMA coisa ao anterior, então a diferença entre dois
// vizinhos é o custo daquela coisa e de mais nada:
//
//   1. laço vazio                    o piso do `while`
//   2. + ler objs[i]                 indexar array de objetos
//   3. + ler o.parent                um campo de GameObject
//   4. + ler trs[i]                  indexar o espelho paralelo
//   5. + ler os 5 campos e comparar  o `if` real de computeWorldInto
//   6. + escrever os 5 campos        o corpo, quando algo mudou
//
// Se o salto estiver entre 4 e 5, o custo é ler Transform. Se estiver entre 2 e
// 3, é ler GameObject. Se o piso do laço já for caro, nenhuma das duas.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "./../engine/core/transform";

const N = 8000;

const sc = new Scene("P");
let b = 0;
while (b < N) {
  const g = new GameObject("b" + b);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition((b % 100) * 1.5, 2.0, ((b / 100) | 0) * 1.5);
  sc.add(g);
  b = b + 1;
}
sc.computeWorld();

const objs: GameObject[] = sc.objects;
const trs: Transform[] = sc.trs;
const n = objs.length;

/// Cronometra `corpo` e devolve ns por OBJETO. O acumulador volta para que o
/// laço não possa ser descartado como morto — sem isso, um caso rápido demais
/// seria um caso apagado, e o número bom significaria "não fez".
function ns(rep: number, corpo: () => number): f64 {
  let q = 0;
  let w = 0;
  while (w < 3) { q = q + corpo(); w = w + 1; }
  const t0 = performance.now();
  let acc = 0;
  let f = 0;
  while (f < rep) { acc = acc + corpo(); f = f + 1; }
  const ms = performance.now() - t0;
  if (acc === 0x7FFFFFFF) io.print("");
  return (ms * 1000000.0) / (rep * n);
}

const REP = 40;

const c1 = ns(REP, () => { let s = 0; let i = 0; while (i < n) { s = s + i; i = i + 1; } return s > 0 ? 1 : 0; });
const c2 = ns(REP, () => { let s = 0; let i = 0; while (i < n) { const o: GameObject = objs[i]; s = s + 1; i = i + 1; } return s > 0 ? 1 : 0; });
const c3 = ns(REP, () => { let s = 0; let i = 0; while (i < n) { const o: GameObject = objs[i]; s = s + o.parent; i = i + 1; } return s !== 0 ? 1 : 0; });
const c4 = ns(REP, () => {
  let s = 0; let i = 0;
  while (i < n) { const o: GameObject = objs[i]; const t: Transform = trs[i]; s = s + o.parent; i = i + 1; }
  return s !== 0 ? 1 : 0;
});
const c5 = ns(REP, () => {
  let s = 0; let i = 0;
  while (i < n) {
    const o: GameObject = objs[i]; const t: Transform = trs[i];
    if (o.parent < 0) {
      if (t.wx !== t.px || t.wy !== t.py || t.wz !== t.pz || t.wrx !== t.rx || t.wry !== t.ry) s = s + 1;
    }
    i = i + 1;
  }
  return s >= 0 ? 1 : 0;
});
const c6 = ns(REP, () => {
  let s = 0; let i = 0;
  while (i < n) {
    const o: GameObject = objs[i]; const t: Transform = trs[i];
    if (o.parent < 0) { t.wx = t.px; t.wy = t.py; t.wz = t.pz; t.wrx = t.rx; t.wry = t.ry; s = s + 1; }
    i = i + 1;
  }
  return s >= 0 ? 1 : 0;
});

const nl = String.fromCharCode(10);
let out = "[visita] ns por OBJETO, n=" + n + ", release" + nl;
out = out + "  1 laco vazio                  " + c1.toFixed(1).padStart(8) + nl;
out = out + "  2 + objs[i]                   " + c2.toFixed(1).padStart(8) + "   (+" + (c2 - c1).toFixed(1) + ")" + nl;
out = out + "  3 + o.parent                  " + c3.toFixed(1).padStart(8) + "   (+" + (c3 - c2).toFixed(1) + ")" + nl;
out = out + "  4 + trs[i]                    " + c4.toFixed(1).padStart(8) + "   (+" + (c4 - c3).toFixed(1) + ")" + nl;
out = out + "  5 + ler 5 campos e comparar   " + c5.toFixed(1).padStart(8) + "   (+" + (c5 - c4).toFixed(1) + ")" + nl;
out = out + "  6 + escrever os 5 campos      " + c6.toFixed(1).padStart(8) + "   (+" + (c6 - c5).toFixed(1) + ")" + nl;
out = out + nl + "  computeWorld real mede ~1600 ns/objeto. O que a soma acima nao";
out = out + nl + "  explicar esta FORA deste laco.";
io.print(out);

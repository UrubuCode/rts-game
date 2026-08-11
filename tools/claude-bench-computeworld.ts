// ONDE `computeWorld` gasta — a medida antes de mexer.
//
//   rts.exe run tools/claude-bench-computeworld.ts
//
// ── POR QUE ESTA MEDIDA VEM ANTES DE QUALQUER OTIMIZAÇÃO ────────────────────
//
// `computeWorld` estoura os 8 ms/frame sozinho entre 2000 e 4000 corpos, e a
// 8000 custa 14 ms — quase o dobro do orçamento inteiro. Isso está medido. O que
// NÃO está medido é em que ele gasta, e a campanha que produziu este número teve
// cinco premissas mortas sobre onde o custo estava — quatro delas dentro de
// instrumentos. Adivinhar aqui seria o sexto.
//
// ── A HIPÓTESE A MATAR ─────────────────────────────────────────────────────
//
// "Um bit de sujo corta o custo, porque a maior parte dos objetos não muda."
//
// Ela já nasce comprometida por uma leitura do código: `computeWorldInto` NÃO
// escreve quando nada mudou — o `if` compara os cinco campos antes de copiar. O
// que ele faz de qualquer jeito é VISITAR: zerar `done` sobre todo n, ler
// `parent`, ler o transform, comparar.
//
// Então o bit de sujo só paga se o custo estiver na VISITA. Se estiver na
// escrita, ele não corta nada — o `if` já cortou.
//
// A medida que separa: a mesma cena, o mesmo número de objetos, com tudo se
// movendo e com nada se movendo.
//
//   PARADA   ninguém muda. Paga a visita inteira e ZERO escrita.
//   MOVENDO  todos mudam. Paga visita e escrita.
//
// Se as duas custarem quase o mesmo, o custo é a visita e o bit de sujo é a
// resposta. Se a parada for muito mais barata, a escrita domina e um bit não
// compra nada, porque o `if` já está fazendo o trabalho dele.
//
// A terceira coluna isola o laço que zera `done`, que é O(n) puro e não depende
// de nada ter mudado — é o piso que nenhum bit remove sem mudar a estrutura.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";

/// `n` objetos raiz, sem hierarquia — o caminho rápido, que é o caso dominante
/// (o comentário do próprio `computeWorldInto` diz que a esmagadora maioria é
/// raiz). Medir com hierarquia mediria outra função.
function montar(n: number): Scene {
  const sc = new Scene("CW");
  let i = 0;
  while (i < n) {
    const g = new GameObject("b" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % 100) * 1.5, 2.0, ((i / 100) | 0) * 1.5);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();   // a primeira passada escreve tudo; medir isso mediria o warm-up
  return sc;
}

function cronometrar(sc: Scene, frames: number, mover: number): f64 {
  const objs: GameObject[] = sc.objects;
  const n = objs.length;
  let f = 0;
  while (f < 3) { sc.computeWorld(); f = f + 1; }
  const t0 = performance.now();
  f = 0;
  while (f < frames) {
    if (mover !== 0) {
      // Move TODO objeto uma fração — o suficiente para o `if` disparar em todos.
      let i = 0;
      while (i < n) { const t = objs[i].transform; t.py = t.py + 0.001; i = i + 1; }
    }
    sc.computeWorld();
    f = f + 1;
  }
  const total = performance.now() - t0;
  // O custo de MOVER é do bench e não de `computeWorld`; medido à parte abaixo
  // e subtraído, senão a coluna "movendo" cobraria o laço do próprio bench.
  return total / frames;
}

/// Só o laço que o bench usa para mover, para poder descontá-lo.
function custoDeMover(sc: Scene, frames: number): f64 {
  const objs: GameObject[] = sc.objects;
  const n = objs.length;
  const t0 = performance.now();
  let f = 0;
  while (f < frames) {
    let i = 0;
    while (i < n) { const t = objs[i].transform; t.py = t.py + 0.001; i = i + 1; }
    f = f + 1;
  }
  return (performance.now() - t0) / frames;
}

io.print("[computeWorld] ms/frame, release. Onde o custo esta.");
io.print("");
io.print("  n    | PARADA | MOVENDO | so o mover | movendo-mover | parada % ");
io.print("-------+--------+---------+------------+---------------+----------");

const tamanhos: number[] = [1000, 2000, 4000, 8000];
let k = 0;
while (k < tamanhos.length) {
  const n = tamanhos[k];
  const sc = montar(n);
  const parada = cronometrar(sc, 60, 0);
  const mover = custoDeMover(sc, 60);
  const movendo = cronometrar(sc, 60, 1);
  const liquido = movendo - mover;
  const pct = liquido > 0.0 ? (parada / liquido * 100.0) : 0.0;
  io.print("  " + (n + "").padEnd(5) + "|" + parada.toFixed(2).padStart(7) +
           " |" + movendo.toFixed(2).padStart(8) + " |" + mover.toFixed(2).padStart(11) +
           " |" + liquido.toFixed(2).padStart(14) + " |" + pct.toFixed(0).padStart(8) + "%");
  k = k + 1;
}

io.print("");
io.print("  'parada %' e quanto do custo sobra quando NADA muda. Perto de 100%");
io.print("  significa que o custo e a VISITA e um bit de sujo corta quase tudo;");
io.print("  baixo significa que a escrita domina e o `if` ja fazia o trabalho.");

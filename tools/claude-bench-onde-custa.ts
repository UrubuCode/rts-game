// Onde o custo da física na CPU está, e a pergunta que ele responde:
//
//   run_fixture.exe tools/claude-bench-onde-custa.ts
//
// ── O FALSIFICADOR ─────────────────────────────────────────────────────────
//
// A afirmação a matar é "descer o solver para o Rust com N threads dá ~N× de
// ganho". Ela só vale se o custo for a CONTA — aritmética sobre pares, que
// paraleliza. Se for TRAVESSIA (ler campo de objeto JS, andar na lista, montar
// o grid), o solver em Rust ainda precisa dos dados atravessando a fronteira, e
// as threads compram pouco.
//
// A medida que separa os dois: a MESMA cena, com o mesmo número de objetos,
// espalhada de dois jeitos.
//
//   ESPALHADA   ninguém se toca. Paga travessia e grid, e ZERO conta de par.
//   DENSA       todos se tocam. Paga travessia, grid e a conta de par.
//
// A diferença é a conta. O que a espalhada custa é o piso que nenhuma thread
// de solver remove — porque não é solver.
//
// `computeWorld` entra na tabela porque a medida anterior mostrou que ele é 39%
// do total a 1000 objetos, e ele NÃO é o solver: roda igual com a física na GPU.
// Uma tabela que só mede colisão faria alguém otimizar 48% do problema achando
// que era o todo.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";

/// Uma cena de `n` corpos. `passo` é a distância entre eles: grande espalha,
/// pequeno amontoa. O tamanho do corpo é o mesmo nos dois — o que muda é só
/// quantos pares existem, que é a variável isolada.
function montar(n: number, passo: f64): Scene {
  const sc = new Scene("Bench");
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0.0, 0.0 - 1.0, 0.0);
  chao.transform.sx = 400.0; chao.transform.sy = 1.0; chao.transform.sz = 400.0;
  chao.stationary = 1;
  sc.add(chao);

  const lado = Math.ceil(Math.sqrt(n * 1.0)) | 0;
  let i = 0;
  while (i < n) {
    const g = new GameObject("B" + i);
    g.setMesh(1, 200, 200, 200);
    const cx = (i % lado) * passo;
    const cz = ((i / lado) | 0) * passo;
    g.transform.setPosition(cx, 2.0, cz);
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  return sc;
}

function cronometrarColisao(sc: Scene, frames: number): f64 {
  let f = 0;
  while (f < 5) { sc.resolveCollisions(); f = f + 1; }   // aquecimento
  const t0 = performance.now();
  f = 0;
  while (f < frames) { sc.resolveCollisions(); f = f + 1; }
  return (performance.now() - t0) / frames;
}

function cronometrarMundo(sc: Scene, frames: number): f64 {
  let f = 0;
  while (f < 5) { sc.computeWorld(); f = f + 1; }
  const t0 = performance.now();
  f = 0;
  while (f < frames) { sc.computeWorld(); f = f + 1; }
  return (performance.now() - t0) / frames;
}

io.print("[onde custa] ms/frame, release, headless");
io.print("");
io.print("  n   | espalhada | densa | a CONTA | computeWorld | conta % da colisao");
io.print("------+-----------+-------+---------+--------------+-------------------");

const tamanhos: number[] = [500, 1000, 2000];
let k = 0;
while (k < tamanhos.length) {
  const n = tamanhos[k];
  // 8 unidades separa corpos de 1 unidade com folga: zero pares, e o grid ainda
  // é montado sobre todos eles — que é exatamente o piso que se quer medir.
  const espalhada = cronometrarColisao(montar(n, 8.0), 60);
  // 0,6 sobrepõe corpos de 1 unidade: todo vizinho é um par de verdade.
  const densa = cronometrarColisao(montar(n, 0.6), 60);
  const mundo = cronometrarMundo(montar(n, 8.0), 60);
  const conta = densa - espalhada;
  const pct = densa > 0.0 ? (conta / densa * 100.0) : 0.0;
  io.print("  " + (n + "").padEnd(4) + "|" + espalhada.toFixed(2).padStart(10) +
           " |" + densa.toFixed(2).padStart(6) + " |" + conta.toFixed(2).padStart(8) +
           " |" + mundo.toFixed(2).padStart(13) + " |" + pct.toFixed(0).padStart(13) + "%");
  k = k + 1;
}

io.print("");
io.print("  A coluna 'a CONTA' e o que um solver em Rust com threads pode dividir.");
io.print("  A coluna 'espalhada' e o piso: travessia e grid, que ficam onde estao");
io.print("  ate os DADOS mudarem de lado — nao o codigo.");

// ── CORREÇÃO, 2026-08-11 ───────────────────────────────────────────────────
//
// A leitura que este arquivo publicou — "98-99% do custo é ARITMÉTICA de par" —
// está ERRADA, e o erro é de interpretação, não de medida. Os números acima
// continuam válidos.
//
// `densa − espalhada` isola o trabalho que só existe QUANDO HÁ PAR. Isso não é a
// mesma coisa que a aritmética do par: ler a posição do vizinho `j` atravessa
// `GameObject` e `Transform`, e essa travessia também só acontece quando há par,
// então ela caiu inteira na coluna rotulada "a CONTA".
//
// O que matou a leitura foi o solver equivalente em Rust: os MESMOS 27,7
// candidatos por corpo custam 0,82 ms a 2000 corpos numa thread, ou ~9 ns por
// candidato. Para o lado TypeScript custar 157 ms, cada candidato teria de
// custar ~2,8 µs — 300× algumas dezenas de operações de ponto flutuante. Não é
// aritmética; é travessia por par.
//
// A decomposição real do ganho, medida com a máquina a 4% de carga:
//
//   layout achatado (Float32Array plano, sem objeto por corpo)   ~195x
//   threads (16 lógicas), em cima disso                            3,9x
//
// Isso NÃO invalida o desenho gather/Jacobi — é ele que torna as threads
// possíveis. Revisa a expectativa: o ganho veio de ONDE OS DADOS MORAM, não de
// quantos núcleos rodam. Um solver em Rust sequencial sobre arrays planos já
// entrega quase tudo.
//
// Fica escrito aqui em vez de o arquivo ser corrigido em silêncio porque o
// commit `bafd316` publicou a leitura errada, e uma medida que muda de sentido
// depois é exatamente o que a regra "um número medido continua real" protege.

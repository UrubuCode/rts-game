// CPU contra GPU, na MESMA cena e no MESMO número de frames.
//
// A pergunta é uma só: quanto custa um frame de física com N corpos em
// movimento, em cada backend. Headless — nenhuma janela, nenhum `drawMesh` —
// para que o número seja da física e de mais nada.
//
// O caminho GPU é medido pelo `rbService`, que é como o jogo o usa de verdade:
// LÊ o resultado do frame anterior e SUBMETE este sem esperar (1 frame de
// latência, como o fluido). Medir com espera daria um número que ninguém paga.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { Rigidbody } from "../scripts/rigidbody";
import { rbAvailable, rbInit, rbSetBody, rbUpload, rbService, rbStep, rbSyncStatics, rbY } from "../engine/rigid/gpurigid";
// O terceiro backend. Entra nesta tabela e nao numa propria porque a pergunta e
// a mesma — quanto custa um frame com N corpos — e duas tabelas com a mesma
// cena sao duas cenas que podem divergir.
import { crInit, crSetBody, crSyncStatics, crStep, crThreads, crY } from "../engine/rigid/cpurigid";

const DT = 1.0 / 60.0;

// Testemunhas: quanto o corpo 0 desceu em cada backend, e quantos frames a GPU
// entregou estado novo. Sem elas a tabela nao distingue "rapido" de "nao fez".
let gpuFresh = 0;
let gpuY: f64 = 0.0;
let rustY: f64 = 0.0;

function cpu(n: number, frames: number): number {
  scene.clear();
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75);
    g.transform.setScale(0.5);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.5));
    scene.add(g);
  }
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { scene.update(DT); scene.resolveCollisions(); scene.computeWorld(); }
  return (Date.now() - t0) / frames;
}

// SO a passada de colisao, que e o que o `rigidStep` do decisor substitui.
//
// A coluna `cpu` acima e um FRAME inteiro — update + colisao + computeWorld — e
// esse e o numero certo para "quanto custa a fisica". E o numero ERRADO para a
// decisao de backend: ligar a GPU nao remove `update` nem `computeWorld`, so a
// colisao. Comparar o frame inteiro contra o custo da GPU superestima o que a
// troca economiza, e superestima justamente a favor da GPU.
function cpuColisao(n: number, frames: number): number {
  scene.clear();
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75);
    g.transform.setScale(0.5);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.5));
    scene.add(g);
  }
  scene.computeWorld();
  for (let f = 0; f < 5; f++) scene.resolveCollisions();
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { scene.resolveCollisions(); }
  return (Date.now() - t0) / frames;
}

function gpu(n: number, frames: number): number {
  rbInit(n);
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    rbSetBody(i, (i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75,
              0.25, 0.25, 0.25, 1.0);
  }
  rbUpload();
  rbSyncStatics(scene);
  const t0 = Date.now();
  let novos = 0;
  for (let f = 0; f < frames; f++) { if (rbService(1) !== 0) novos = novos + 1; }
  gpuFresh = novos;
  gpuY = rbY(0);
  return (Date.now() - t0) / frames;
}

// A MESMA GPU, sincrona. Existe como TESTEMUNHA e nao como opcao: `rbService` e
// pipelined e NAO despacha quando a leitura anterior ainda nao chegou, entao ele
// pode custar pouco por frame por ter feito MENOS passos. Um numero que parece
// bom porque trabalhou menos e o modo mais facil de um benchmark mentir. O
// caminho sincrono garante um passo por frame, e a diferenca entre as duas
// colunas e o quanto o pipelining escondeu.
function gpuSync(n: number, frames: number): number {
  rbInit(n);
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    rbSetBody(i, (i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75,
              0.25, 0.25, 0.25, 1.0);
  }
  rbUpload();
  rbSyncStatics(scene);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { rbStep(1); }
  return (Date.now() - t0) / frames;
}

function rust(n: number, frames: number): number {
  crInit(n);
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    crSetBody(i, (i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75,
              0.25, 0.25, 0.25, 1.0);
  }
  crSyncStatics(scene);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { crStep(1); }
  rustY = crY(0);
  return (Date.now() - t0) / frames;
}

io.print("GPU disponivel: " + (rbAvailable() !== 0 ? "sim" : "NAO — so o numero da CPU vale"));
io.print("");
io.print("threads do backend rust: " + crThreads());
io.print("");
// Os n PEQUENOS existem por causa do decisor: o joelho dele esta em ~192 nesta
// maquina, e uma tabela que comeca em 250 nao pode dizer se esse joelho esta no
// lugar certo. Medir so onde a resposta ja e obvia e como um modelo errado
// sobrevive a uma bancada.
io.print("   n   | CPU frame  | CPU colisao| GPU pipe   | GPU sync   | RUST       | testemunhas");
io.print("-------+------------+------------+------------+------------+------------+------------");
for (const n of [32, 64, 128, 192, 250, 500, 1000, 2000, 4000]) {
  const c = cpu(n, 60);
  const g = gpu(n, 60);
  const r = rust(n, 60);
  const gs = gpuSync(n, 60);
  const cc = cpuColisao(n, 60);
  const ganho = g > 0.001 ? (c / g).toFixed(1) + "x" : "—";
  io.print(("" + n).padEnd(7) + "|" + c.toFixed(2).padStart(11) + " |" + cc.toFixed(2).padStart(11) +
           " |" + g.toFixed(2).padStart(11) + " |" + gs.toFixed(2).padStart(11) +
           " |" + r.toFixed(2).padStart(11) + " |  " + gpuFresh + "/60 y_gpu=" + gpuY.toFixed(1) +
           " y_rust=" + rustY.toFixed(1));
}

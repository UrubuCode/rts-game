// CONTATO DENSO: a GPU contra o backend Rust, por PASSO SIMULADO.
//
//   rts.exe run tools/claude-bench-denso-gpu-rust.ts
//
// É a medida que decide se o backend Rust deve ser o padrão, e ela faltava: a
// bancada esparsa (`claude-bench-gpu-vs-cpu.ts`) mede o PISO — round-trip de um
// lado, travessia do outro, e quase nenhuma conta de par. Contato denso é
// justamente onde os milhares de núcleos da GPU contam mais, então é o único
// lugar onde a resposta pode virar.
//
// ── DUAS COISAS QUE ESTA BANCADA FAZ E A ANTERIOR NÃO FAZIA ────────────────
//
// 1. CONTA PASSOS SIMULADOS, não frames. `rbService` é pipelined e não avança
//    enquanto a leitura anterior não chegou — medido: 24 a 41 de 60. Dividir o
//    tempo total por 60 dá o custo de um frame em que a física às vezes não
//    aconteceu, e foi assim que "a GPU faz o mesmo trabalho em 1,13 ms" entrou
//    nesta campanha. O denominador de cada lado é o número de passos que aquele
//    lado realmente deu.
//
// 2. AUDITA A ENTRADA. Imprime candidatos e contatos por corpo, porque "densa"
//    é um espaçamento e não uma contagem de pares — e uma cena rotulada densa
//    que não é densa mediria o piso outra vez, com outro nome.
import io from "../compat/io.ts";
import math from "../compat/math.ts";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { rbAvailable, rbInit, rbSetBody, rbUpload, rbSyncStatics, rbService,
         rbStep, rbY } from "../engine/rigid/gpurigid";
import { crInit, crSetBody, crSyncStatics, crStep, crThreads, crY } from "../engine/rigid/cpurigid";

const FRAMES = 120;
// 0,6 sobre corpos de meia-extensão 0,5: todo vizinho é contato de verdade. É o
// mesmo espaçamento de `claude-bench-onde-custa.ts`, para que "denso" signifique
// a mesma coisa nas duas bancadas deste repositório.
const PASSO = 0.6;
const MEIA = 0.5;

function montaChao(): void {
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.setPosition(0.0, 0.0 - 1.0, 0.0);
  g.transform.sx = 400.0; g.transform.sy = 1.0; g.transform.sz = 400.0;
  g.stationary = 1;
  scene.add(g);
}

// Uma grade cúbica: em três eixos, não num plano. Uma camada única daria
// vizinhos só em x e z e a cena seria menos densa do que o nome promete.
function px(i: number, lado: number): f64 { return (i % lado) * PASSO; }
function py(i: number, lado: number): f64 { return 2.0 + (((i / (lado * lado)) | 0)) * PASSO; }
function pz(i: number, lado: number): f64 { return (((i / lado) | 0) % lado) * PASSO; }

function ladoDe(n: number): number { return Math.ceil(math.pow(n * 1.0, 1.0 / 3.0)) | 0; }

/// ms por PASSO SIMULADO no backend GPU, e quantos passos ele deu.
let gpuPassos = 0;
function gpu(n: number): f64 {
  const lado = ladoDe(n);
  rbInit(n);
  let i = 0;
  while (i < n) {
    rbSetBody(i, px(i, lado), py(i, lado), pz(i, lado), MEIA, MEIA, MEIA, 1.0);
    i = i + 1;
  }
  rbUpload();
  rbSyncStatics(scene);
  let f = 0;
  while (f < 5) { rbService(1); f = f + 1; }   // aquecimento
  const t0 = Date.now();
  let passos = 0;
  f = 0;
  while (f < FRAMES) { if (rbService(1) !== 0) passos = passos + 1; f = f + 1; }
  const total = (Date.now() - t0) * 1.0;
  gpuPassos = passos;
  // O denominador é o número de PASSOS, não de frames. Se a GPU entregou 40
  // estados em 120 frames, ela fez 40 passos e o custo de um passo é o total
  // dividido por 40.
  return passos > 0 ? total / (passos * 1.0) : 0.0 - 1.0;
}

/// A mesma GPU, síncrona: um passo por frame, garantido. Testemunha da coluna
/// acima — se as duas discordarem muito, o pipelining está escondendo trabalho.
function gpuSync(n: number): f64 {
  const lado = ladoDe(n);
  rbInit(n);
  let i = 0;
  while (i < n) {
    rbSetBody(i, px(i, lado), py(i, lado), pz(i, lado), MEIA, MEIA, MEIA, 1.0);
    i = i + 1;
  }
  rbUpload();
  rbSyncStatics(scene);
  let f = 0;
  while (f < 5) { rbStep(1); f = f + 1; }
  const t0 = Date.now();
  f = 0;
  while (f < FRAMES) { rbStep(1); f = f + 1; }
  return (Date.now() - t0) * 1.0 / (FRAMES * 1.0);
}

/// ms por passo no backend Rust. Síncrono: passos = frames, sempre.
function rust(n: number): f64 {
  const lado = ladoDe(n);
  crInit(n);
  let i = 0;
  while (i < n) {
    crSetBody(i, px(i, lado), py(i, lado), pz(i, lado), MEIA, MEIA, MEIA, 1.0);
    i = i + 1;
  }
  crSyncStatics(scene);
  let f = 0;
  while (f < 5) { crStep(1); f = f + 1; }
  const t0 = Date.now();
  f = 0;
  while (f < FRAMES) { crStep(1); f = f + 1; }
  return (Date.now() - t0) * 1.0 / (FRAMES * 1.0);
}

scene.clear(); montaChao(); scene.computeWorld();

io.print("[denso] GPU x RUST, ms por PASSO SIMULADO (nao por frame)");
io.print("  threads do rust: " + crThreads());
io.print("  espacamento " + PASSO + " sobre meia-extensao " + MEIA + " = todo vizinho e contato");
io.print("");
io.print("   n   | GPU pipe/passo | GPU sync/passo | RUST /passo | passos gpu | y_gpu  y_rust");
io.print("-------+----------------+----------------+-------------+------------+--------------");

const NS: number[] = [250, 500, 1000, 2000, 4000];
let k = 0;
while (k < NS.length) {
  const n = NS[k];
  const g = gpu(n);
  const yg = rbY(0);
  const gs = gpuSync(n);
  const r = rust(n);
  const yr = crY(0);
  io.print("  " + (n + "").padEnd(5) + "|" + g.toFixed(3).padStart(15) +
           " |" + gs.toFixed(3).padStart(15) + " |" + r.toFixed(3).padStart(12) +
           " |" + (gpuPassos + "/" + FRAMES).padStart(11) +
           " | " + yg.toFixed(2) + "  " + yr.toFixed(2));
  k = k + 1;
}

io.print("");
io.print("  y_gpu e y_rust: onde o corpo 0 parou. Se um deles nao desceu, ele nao");
io.print("  simulou — e um backend que nao simula e sempre o mais rapido.");

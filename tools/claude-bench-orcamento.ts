// ORÇAMENTO: em que n cada backend estoura os 8 ms/FRAME — e o teto que
// nenhum deles remove.
//
//   rts.exe run tools/claude-bench-orcamento.ts
//
// A pergunta que esta bancada responde não é "qual backend é mais rápido", que
// as outras duas já respondem. É a que um desenvolvedor de jogo usa para
// dimensionar uma cena: **até quantos corpos eu posso ir?**
//
// ── POR QUE POR FRAME E NÃO POR PASSO ──────────────────────────────────────
//
// Porque o orçamento é do frame. O editor submete `PB_SUBSTEPS` sub-passos por
// frame, então um backend que custa 1 ms por passo custa 2 ms por frame, e é o
// segundo número que compete com o desenho, a lógica e o resto. Medir por passo
// e comparar com 8 ms seria contar metade do custo — o mesmo erro de
// denominador que esta campanha já cometeu quatro vezes, e o quarto foi meu.
//
// ── O TETO QUE NENHUM BACKEND REMOVE ───────────────────────────────────────
//
// `update` e `computeWorld` rodam na thread do JS qualquer que seja o backend:
// trocar a colisão para a GPU ou para o Rust não tira um nem outro do frame.
// Então existe um n em que o gargalo deixa de ser a colisão e passa a ser
// derivar transform de mundo — e a partir dali trocar de backend de física para
// de comprar qualquer coisa.
//
// Este arquivo mede esse ponto em vez de supô-lo, porque supô-lo é como se
// otimiza a metade errada do problema com números corretos na mão.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Rigidbody } from "../scripts/rigidbody";
import { PB_SUBSTEPS } from "../engine/core/physics_backend";
import { rbAvailable, rbInit, rbSetBody, rbUpload, rbSyncStatics, rbStep } from "../engine/rigid/gpurigid";
import { crInit, crSetBody, crSyncStatics, crStep, crThreads } from "../engine/rigid/cpurigid";

const DT = 1.0 / 60.0;
const ORCAMENTO = 8.0;
// A mesma cena densa cúbica das outras bancadas: espaçamento 0,6 sobre
// meia-extensão 0,5. Repetida e não inventada, para que "denso" continue
// significando a mesma coisa em todo este repositório.
const PASSO = 0.6;
const MEIA = 0.5;

function ladoDe(n: number): number {
  let l = 1;
  while (l * l * l < n) l = l + 1;
  return l;
}

function frames(n: number): number { return n > 8000 ? 20 : 60; }

/// A cena com GameObjects de verdade — é o que `update` e `computeWorld` pedem.
function montar(sc: Scene, n: number): void {
  const lado = ladoDe(n);
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0.0, 0.0 - 1.0, 0.0);
  chao.transform.sx = 400.0; chao.transform.sy = 1.0; chao.transform.sz = 400.0;
  chao.stationary = 1;
  sc.add(chao);
  let i = 0;
  while (i < n) {
    const g = new GameObject("b" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % lado) * PASSO,
                            2.0 + (((i / (lado * lado)) | 0)) * PASSO,
                            ((((i / lado) | 0) % lado)) * PASSO);
    g.transform.setScale(MEIA * 2.0);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.0));
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
}

io.print("[orcamento] em que n cada backend estoura " + ORCAMENTO + " ms/FRAME");
io.print("  sub-passos por frame (PB_SUBSTEPS): " + PB_SUBSTEPS +
         "  => teto por passo = " + (ORCAMENTO / (PB_SUBSTEPS * 1.0)).toFixed(1) + " ms");
io.print("  threads do rust: " + crThreads());
io.print("  gpu disponivel: " + (rbAvailable() !== 0 ? "sim" : "NAO"));
io.print("");
io.print("  ms/FRAME (ja com os " + PB_SUBSTEPS + " sub-passos na fisica)");
io.print("   n    | update | computeW | FIXO   || cpu col | rust   | gpu    || fixo+rust | fixo+gpu");
io.print("--------+--------+----------+--------++---------+--------+--------++-----------+---------");

const NS: number[] = [1000, 2000, 4000, 8000, 16000, 32000];
let k = 0;
while (k < NS.length) {
  const n = NS[k];
  const F = frames(n);
  const sc = new Scene("Orc");
  montar(sc, n);

  // ── o teto que nenhum backend remove ──────────────────────────────────────
  let f = 0;
  while (f < 3) { sc.update(DT); f = f + 1; }
  let t0 = Date.now();
  f = 0;
  while (f < F) { sc.update(DT); f = f + 1; }
  const upd = (Date.now() - t0) * 1.0 / (F * 1.0);

  f = 0;
  while (f < 3) { sc.computeWorld(); f = f + 1; }
  t0 = Date.now();
  f = 0;
  while (f < F) { sc.computeWorld(); f = f + 1; }
  const cw = (Date.now() - t0) * 1.0 / (F * 1.0);

  // ── a colisão, nos três backends, por FRAME ───────────────────────────────
  f = 0;
  while (f < 3) { sc.resolveCollisions(); f = f + 1; }
  t0 = Date.now();
  f = 0;
  while (f < F) { sc.resolveCollisions(); f = f + 1; }
  // `resolveCollisions` já é a passada inteira que o frame faz uma vez — ela
  // não se multiplica por sub-passos, porque o caminho CPU não os tem.
  const cpu = (Date.now() - t0) * 1.0 / (F * 1.0);

  const lado = ladoDe(n);
  crInit(n);
  let i = 0;
  while (i < n) {
    crSetBody(i, (i % lado) * PASSO, 2.0 + (((i / (lado * lado)) | 0)) * PASSO,
              ((((i / lado) | 0) % lado)) * PASSO, MEIA, MEIA, MEIA, 1.0);
    i = i + 1;
  }
  crSyncStatics(sc);
  f = 0;
  while (f < 3) { crStep(1); f = f + 1; }
  t0 = Date.now();
  f = 0;
  while (f < F) { crStep(1); f = f + 1; }
  const rust = (Date.now() - t0) * 1.0 / (F * 1.0) * (PB_SUBSTEPS * 1.0);

  let gpu = 0.0 - 1.0;
  if (rbAvailable() !== 0) {
    rbInit(n);
    i = 0;
    while (i < n) {
      rbSetBody(i, (i % lado) * PASSO, 2.0 + (((i / (lado * lado)) | 0)) * PASSO,
                ((((i / lado) | 0) % lado)) * PASSO, MEIA, MEIA, MEIA, 1.0);
      i = i + 1;
    }
    rbUpload();
    rbSyncStatics(sc);
    f = 0;
    while (f < 3) { rbStep(1); f = f + 1; }
    t0 = Date.now();
    f = 0;
    // `rbStep` (síncrono) e não `rbService`: um passo por frame garantido. O
    // pipelined custaria menos por ter avançado menos, e num orçamento isso
    // seria creditar folga que a simulação não teve.
    while (f < F) { rbStep(1); f = f + 1; }
    gpu = (Date.now() - t0) * 1.0 / (F * 1.0) * (PB_SUBSTEPS * 1.0);
  }

  const fixo = upd + cw;
  io.print("  " + (n + "").padEnd(6) + "|" + upd.toFixed(2).padStart(7) +
           " |" + cw.toFixed(2).padStart(9) + " |" + fixo.toFixed(2).padStart(7) +
           " ||" + cpu.toFixed(2).padStart(8) + " |" + rust.toFixed(2).padStart(7) +
           " |" + gpu.toFixed(2).padStart(7) +
           " ||" + (fixo + rust).toFixed(2).padStart(10) + " |" + (fixo + gpu).toFixed(2).padStart(9));
  k = k + 1;
}

io.print("");
io.print("  FIXO = update + computeWorld. Roda na thread do JS em QUALQUER backend:");
io.print("  trocar a colisao nao remove um nem outro. Se a coluna FIXO sozinha passa");
io.print("  de " + ORCAMENTO + " ms, o backend de fisica deixou de ser o gargalo e trocar de");
io.print("  backend nao compra mais nada — que e a pergunta que esta tabela existe");
io.print("  para responder antes de alguem otimizar a metade errada.");

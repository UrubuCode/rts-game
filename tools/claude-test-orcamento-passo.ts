// Teste do TETO DE MILISSEGUNDOS do passo fixo (engine/core/fixedstep.ts).
//
//   run_fixture.exe tools/claude-test-orcamento-passo.ts
//
// O que ele pina, e por que cada um é um invariante e não uma preferência:
//
//   1. o PRIMEIRO passo sempre roda, mesmo com o orçamento estourado. Sem isso
//      uma máquina lenta para o mundo, e um mundo parado é indistinguível de um
//      programa travado — que é o que este teto existe para evitar;
//   2. um passo caro corta os SEGUINTES, em vez de deixar o frame estourar;
//   3. o tempo cortado é DESCARTADO. Guardá-lo é a espiral da morte entrando
//      pela outra porta: cortar agora para pagar no frame seguinte faz a dívida
//      crescer exatamente como se não houvesse teto;
//   4. desligar o teto devolve o comportamento antigo, sem resíduo — é o que um
//      benchmark precisa, porque medir com o teto ligado mede o teto.
import io from "../compat/io.ts";

import {
  FIXED_DT, stepsFor, stepMore, stepSetBudgetMs, stepBudgetMs,
  stepBudgetCuts, stepStepsDropped, stepsLastFrame, stepReset,
} from "../engine/core/fixedstep";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

/// Queima tempo de parede de verdade. O teto compara `performance.now()`, então
/// um passo "caro" simulado com um contador não o acionaria — o custo tem de ser
/// tempo mesmo.
function queimar(ms: f64): void {
  const t0 = performance.now();
  let x: f64 = 0.0;
  while (performance.now() - t0 < ms) {
    let i = 0;
    while (i < 2000) { x = x + i * 0.5; i = i + 1; }
  }
  if (x === 0.0 - 1.0) io.print("");   // impede que o laço seja considerado morto
}

io.print("[orcamento do passo fixo]");

// ── 1) o primeiro passo é intocável ────────────────────────────────────────
stepReset();
stepSetBudgetMs(1.0);            // um orçamento que qualquer passo estoura
const planejados = stepsFor(0.1); // 100 ms de atraso: pede o teto de 5 passos
check("o frame atrasado pediu varios passos", planejados >= 2 ? 1 : 0);

queimar(5.0);                     // já estourou o orçamento ANTES de qualquer passo
check("o primeiro passo roda mesmo com o orcamento estourado",
      stepMore(0, planejados));

// ── 2) e os seguintes são cortados ─────────────────────────────────────────
check("o segundo passo e cortado", stepMore(1, planejados) === 0 ? 1 : 0);
check("o corte foi contabilizado", stepBudgetCuts() === 1 ? 1 : 0);
check("os passos perdidos foram contados",
      stepStepsDropped() === planejados - 1 ? 1 : 0);
check("stepsLastFrame diz o que REALMENTE rodou, nao o que foi planejado",
      stepsLastFrame() === 1 ? 1 : 0);

// ── 3) a dívida não sobrevive ao frame ─────────────────────────────────────
//
// Se o tempo cortado fosse acumulado, o frame seguinte — que chega em dia —
// pediria passos EXTRA para pagá-lo. Pedir exatamente um é a prova de que não
// há dívida guardada.
const seguinte = stepsFor(FIXED_DT);
check("o frame seguinte nao herda divida do corte", seguinte === 1 ? 1 : 0);

// ── 4) desligado, nada é cortado ───────────────────────────────────────────
stepReset();
stepSetBudgetMs(0.0);
check("orcamento 0 desliga o teto", stepBudgetMs() > 1000.0 ? 1 : 0);
const cortesAntes = stepBudgetCuts();
const p2 = stepsFor(0.1);
let rodados = 0;
while (stepMore(rodados, p2) !== 0) {
  queimar(3.0);                   // cada passo é caro, e nenhum pode ser cortado
  rodados = rodados + 1;
}
check("sem teto, TODOS os passos planejados rodam", rodados === p2 ? 1 : 0);
check("sem teto, nenhum corte e contado", stepBudgetCuts() === cortesAntes ? 1 : 0);

// ── 5) o caso normal não paga nada ─────────────────────────────────────────
//
// O teto tem de ser invisível quando a máquina alcança o relógio: se um frame em
// dia acionasse o corte, a física ficaria em câmera lenta sem motivo.
stepReset();
stepSetBudgetMs(8.0);
const cortes0 = stepBudgetCuts();
let f = 0;
while (f < 120) {
  const p = stepsFor(FIXED_DT);
  let i = 0;
  while (stepMore(i, p) !== 0) i = i + 1;
  f = f + 1;
}
check("120 frames em dia nao acionam o teto nenhuma vez",
      stepBudgetCuts() === cortes0 ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

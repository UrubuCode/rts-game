// O TETO DA CENA que não é desempenho: 65536 CÉLULAS.
//
//   RTS_TETO_N=13000 rts.exe run tools/claude-probe-teto-cena.ts
//
// Achado ao medir orçamento: em n grande o programa não fica lento, ele MORRE —
// "heap exhausted: the region holds 65536 cells". Isso é um limite do motor e
// não da física, e vale mais que qualquer número de ms: uma discussão sobre qual
// backend ganha em 32000 corpos é vazia se a cena não pode ser CONSTRUÍDA.
//
// ── O NÚMERO É EM CÉLULAS, E DIZÊ-LO EM OBJETOS É UM ERRO ───────────────────
//
// Esta sonda mediu "morre em 13000" e a primeira redação disse "o teto é ~12500
// objetos". ERRADO como constante: um `GameObject` mínimo (`new` + `setMesh` +
// `add` + `computeWorld`) passa de 13000 folgado. Os objetos DESTA sonda
// carregam transform, rigidbody, malha e nome — cerca de 5 células cada — e é
// isso que os põe no teto tão cedo.
//
// Então o teto é **65536 células**, e quantos objetos cabem depende de quantas
// células cada um gasta: um objeto gordo cabe menos, um magro cabe mais. Dito em
// objetos, o número viaja para uma cena de outra composição e mente lá — que é o
// mesmo erro de denominador que esta campanha cometeu quatro vezes, agora pelo
// divisor "células por objeto".
//
// O que esta sonda responde, então, não é "o teto do motor" — é "quantos objetos
// DESTA composição cabem no teto do motor". As duas coisas são diferentes e só a
// primeira é constante.
//
// ── UM PROCESSO POR n ──────────────────────────────────────────────────────
//
// A primeira versão varreu a lista dentro de um processo só e mediu 13000 — e
// aquilo era o teto de 50 000 objetos ACUMULADOS, porque as cenas anteriores
// continuavam alcançáveis. O motor já dizia: "all of them are in use even after
// a collection". `RTS_TETO_N` diz qual n testar e quem varre é o shell, que é a
// disciplina do `suite_run` deste projeto, pela mesma razão: um processo que
// morre leva o resto da medida com ele.
//
// Note o que isto separa: a bancada GPU x Rust chega a 32000 porque só aloca
// `Float32Array` — nenhum GameObject, nenhum Transform, nenhum Rigidbody. É a
// MESMA física sobre os mesmos corpos, com e sem a representação de cena em
// volta. O teto é da representação.
import io from "../compat/io.ts";
import proc from "node:process";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Rigidbody } from "../scripts/rigidbody";

const PASSO = 0.6;

/// O n a testar, de `RTS_TETO_N`. Sem a variavel, 12000 — o ultimo que coube na
/// varredura acumulada, que serve de ponto de partida e nao de resposta.
function teto(): number {
  const v = proc.env.RTS_TETO_N;
  const n = parseInt(v, 10);
  return n > 0 ? n : 12000;
}

function ladoDe(n: number): number {
  let l = 1;
  while (l * l * l < n) l = l + 1;
  return l;
}

io.print("[teto] quantos GameObjects a cena aguenta antes do heap acabar");
io.print("  cada tentativa imprime ANTES de construir; o ultimo impresso e o que coube");
io.print("");

// UM n POR PROCESSO. A primeira versao desta sonda varria a lista dentro de um
// processo so e mediu 13000 — numero ERRADO, e o erro e o mesmo que o motor
// avisa: "all of them are in use even after a collection". As cenas anteriores
// continuavam alcancaveis, entao o teto medido era o de 8000+9000+10000+11000+
// 12000 objetos ACUMULADOS, nao o de uma cena.
//
// `RTS_TETO_N` diz qual n testar, e quem varre e o shell — a mesma disciplina de
// "um processo por arquivo" que o `suite_run` deste projeto usa, e pela mesma
// razao: um processo que morre leva o resto da medida com ele.
const NS: number[] = [teto()];
let k = 0;
while (k < NS.length) {
  const n = NS[k];
  io.print("  tentando n = " + n + " ...");
  const sc = new Scene("Teto");
  const lado = ladoDe(n);
  let i = 0;
  while (i < n) {
    const g = new GameObject("b" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % lado) * PASSO,
                            2.0 + (((i / (lado * lado)) | 0)) * PASSO,
                            ((((i / lado) | 0) % lado)) * PASSO);
    g.transform.setScale(1.0);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.0));
    sc.add(g);
    i = i + 1;
  }
  sc.computeWorld();
  io.print("    ok: " + n + " objetos construidos e computeWorld rodou");
  k = k + 1;
}

io.print("");
io.print("  chegou ao fim da lista sem morrer");

// A CASCA CHEGA À ENGINE: o decisor de backend a respeita em vez de engolir.
//
//   rts.exe run tools/claude-test-casca-na-engine.ts
//
// ── O DEFEITO QUE ISTO IMPEDE ──────────────────────────────────────────────
//
// O colisor de casca é resolvido por `solvePair` — o caminho da CPU. Nem o
// kernel WGSL nem o solver em Rust foram ensinados a fazer casca, e o padrão do
// motor é a GPU. Sem uma pergunta de capacidade, a sequência é esta:
//
//   1. alguém põe um `hullCollider` numa pedra chanfrada;
//   2. `rigidStep` manda a cena para a GPU, que lê `vel.w` e vê um código de
//      forma que não conhece;
//   3. o corpo colide como CAIXA, e nada em lugar nenhum diz que isso aconteceu.
//
// A pedra fica no ar, o programador olha o colisor, olha o código, e o colisor
// está certo. É a falha mais cara que este arranjo pode produzir, e é a razão de
// `rts-physics` ter ganhado `supports()`.
//
// O que este arquivo pina é que a pergunta é feita e que a resposta MUDA O
// RESULTADO — não só que uma flag existe.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { boxCollider, sphereCollider, hullCollider } from "../engine/core/collider";
import { hullFromMesh } from "../engine/core/hull";
import { hullRegisterGeo, hullResetRegistry } from "../engine/core/hullreg";
import {
  rigidSetMode, rigidStep, rigidNeedsFallback, rigidHullCount, rigidInvalidate,
} from "../engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

hullResetRegistry();

// A mesma rampa do teste do colisor: um prisma cortado na diagonal, cuja caixa
// e cuja casca discordam por mais de uma unidade no lado vazio.
const rampa: f64[] = [
  0.0 - 1.0, 0.0 - 0.5, 0.0 - 1.0,   1.0, 0.0 - 0.5, 0.0 - 1.0,   0.0 - 1.0, 0.5, 0.0 - 1.0,
  0.0 - 1.0, 0.0 - 0.5,       1.0,   1.0, 0.0 - 0.5,       1.0,   0.0 - 1.0, 0.5,       1.0,
];
const idRampa = hullRegisterGeo(hullFromMesh(rampa, 3));
check("a rampa virou casca", idRampa > 0 ? 1 : 0);

/// Monta a cena. `comCasca = 0` põe caixa no mesmo lugar — o controle.
function cena(comCasca: number): Scene {
  const sc = new Scene("Casca");

  const chao = new GameObject("Chao");
  chao.setMesh(1, 90, 90, 90);
  chao.transform.setPosition(0.0, 0.0 - 3.0, 0.0);
  chao.transform.sx = 40.0; chao.transform.sy = 1.0; chao.transform.sz = 40.0;
  chao.stationary = 1;
  chao.addBehavior(boxCollider(0.5, 0.5, 0.5));
  sc.add(chao);

  const r = new GameObject("Rampa");
  r.setMesh(1, 180, 140, 90);
  r.transform.setPosition(0.0, 0.0, 0.0);
  r.stationary = 1;
  r.addBehavior(comCasca !== 0
    ? hullCollider(idRampa, 1.0, 0.5, 1.0)
    : boxCollider(1.0, 0.5, 1.0));
  sc.add(r);

  const b = new GameObject("Bola");
  b.setMesh(2, 240, 240, 240);
  b.transform.setPosition(0.6, 4.0, 0.0);
  b.transform.sx = 0.4; b.transform.sy = 0.4; b.transform.sz = 0.4;
  b.addBehavior(sphereCollider(0.5));
  sc.add(b);

  sc.computeWorld();
  return sc;
}

/// Roda a cena como o EDITOR roda: `rigidStep` primeiro, e a CPU só quando ele
/// devolve 0. É essa ordem que o teste precisa exercitar — chamar
/// `resolveCollisions` direto testaria o solver e não o decisor.
function rodar(sc: Scene, frames: number): f64 {
  const tb: Transform = sc.trs[2];
  let assumidos = 0;
  let f = 0;
  while (f < frames) {
    sc.computeWorld();
    // QUEM INTEGRA É QUEM RESOLVE, e a primeira versão disto errava aqui: ela
    // integrava a gravidade à mão TODO frame e depois deixava o backend rodar.
    // Quando a GPU assume o passo ela é dona da posição — os dois escrevendo o
    // mesmo campo davam um resultado que dependia de quantos frames a GPU tinha
    // entregue (ela é pipelined), e o teste falhava em 2 de 6 execuções com a
    // bola parando em -3,68 ou -0,43 em vez de 0,66.
    //
    // Um teste intermitente é pior que um teste que falha: ele ensina a ignorar
    // o vermelho. E o defeito era do teste, não do motor — vale dizer, porque a
    // primeira suspeita foi a GPU.
    if (rigidStep(sc, 0) !== 0) {
      assumidos = assumidos + 1;
    } else {
      const dt: f64 = 1.0 / 60.0;
      tb.vy = tb.vy - 9.8 * dt;
      tb.py = tb.py + tb.vy * dt;
      sc.resolveCollisions();
    }
    f = f + 1;
  }
  sc.computeWorld();
  assumidosUltimo = assumidos;
  return sc.objects[2].transform.py;
}
let assumidosUltimo = 0;

// ── 1) com casca, o backend rápido NÃO assume ─────────────────────────────
rigidSetMode(1);          // GPU: o padrão do motor
rigidInvalidate();
const scCasca = cena(1);
const yCasca = rodar(scCasca, 400);
const assumidosCasca = assumidosUltimo;

io.print("");
io.print("  cena COM casca, modo GPU:");
io.print("    cascas vistas        : " + rigidHullCount());
io.print("    precisa de fallback  : " + rigidNeedsFallback());
io.print("    frames que a GPU pegou: " + assumidosCasca + " de 400");
io.print("    y final da bola      : " + yCasca.toFixed(3));

check("o decisor VIU a casca", rigidHullCount() > 0 ? 1 : 0);
check("o decisor pede fallback", rigidNeedsFallback());
check("o backend rapido NAO assumiu nenhum frame", assumidosCasca === 0 ? 1 : 0);

// ── 2) sem casca, ele volta a assumir ─────────────────────────────────────
//
// A metade que impede o teste de passar com um decisor que simplesmente
// desligou a GPU: sem casca na cena, ela tem de voltar a rodar.
rigidSetMode(1);
rigidInvalidate();
const scCaixa = cena(0);
const yCaixa = rodar(scCaixa, 400);
const assumidosCaixa = assumidosUltimo;

io.print("");
io.print("  cena SEM casca (caixa no mesmo lugar), modo GPU:");
io.print("    cascas vistas        : " + rigidHullCount());
io.print("    frames que a GPU pegou: " + assumidosCaixa + " de 400");
io.print("    y final da bola      : " + yCaixa.toFixed(3));

check("sem casca o decisor nao pede fallback", rigidNeedsFallback() === 0 ? 1 : 0);
check("sem casca o backend rapido volta a assumir", assumidosCaixa > 0 ? 1 : 0);

// ── 3) e a FORMA mudou o resultado, que é o ponto de tudo isto ────────────
io.print("");
io.print("  a diferenca que o jogador ve: " + (yCaixa - yCasca).toFixed(3) + " unidades");
check("a bola termina MAIS BAIXA com a casca (a geometria foi respeitada)",
      yCasca < yCaixa - 0.15 ? 1 : 0);

io.print("");
io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

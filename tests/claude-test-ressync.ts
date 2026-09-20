// Teste de INTEGRAÇÃO cena ↔ backend de rígidos: o que acontece quando a cena
// MUDA no meio do play.
//
//   rts.exe run tests/claude-test-ressync.ts
//
// Os outros testes de backend montam a cena, sincronizam uma vez e simulam. O
// editor não faz isso: ele chama `rigidStep(scene, 0)` para sempre, e a cena
// ganha e perde objetos enquanto a física roda. O que este arquivo pina:
//
//   1. um objeto ADICIONADO no meio do play passa a ser simulado — sem ninguém
//      chamar `rigidInvalidate()`, que o editor nunca chamou;
//   2. a ressincronização PRESERVA a velocidade de quem já caía (um spawn não
//      pode parar o mundo no ar);
//   3. um objeto REMOVIDO não faz o backend escrever nos vizinhos errados (os
//      índices da cena deslocam no `removeAt`);
//   4. com um backend externo no comando, o `Rigidbody` NÃO integra por cima —
//      duas integrações sobre o mesmo corpo;
//   5. o tempo simulado por `rigidStep` é UM passo fixo (1/60 s), não dois.
import io from "@compat/io.ts";

import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import {
  rigidSetMode, rigidStep, rigidBodyCount, rigidBackendName,
} from "@engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

function bloco(nome: string, x: f64, y: f64): GameObject {
  const g = new GameObject(nome);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition(x, y, 0.0);
  g.addBehavior(new Rigidbody(0.0 - 9.8, 0.0));
  return g;
}

function cena(): Scene {
  const sc = new Scene("Ressync");
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.sx = 80.0; chao.transform.sy = 1.0; chao.transform.sz = 80.0;
  chao.stationary = 1;
  sc.add(chao);
  // Espaçados de 3: ninguém se toca, então cada X é a IDENTIDADE do bloco — um
  // backend que escreva no objeto errado aparece como um X trocado.
  let b = 0;
  while (b < 4) { sc.add(bloco("Bloco" + b, b * 3.0 - 6.0, 40.0)); b = b + 1; }
  sc.computeWorld();
  return sc;
}

/// O laço do editor, sem tirar nem pôr (`main.ts`): scripts, depois o backend,
/// e a CPU só se ele recusar.
function passos(sc: Scene, n: number): void {
  let i = 0;
  while (i < n) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    i = i + 1;
  }
  sc.computeWorld();
}

function porNome(sc: Scene, nome: string): GameObject {
  let i = 0;
  while (i < sc.objects.length) {
    if (sc.objects[i].name === nome) return sc.objects[i];
    i = i + 1;
  }
  return sc.objects[0];
}

// ═══ RUST: síncrono e determinístico, então as contas são exatas ════════════
io.print("── backend RUST ──");
rigidSetMode(2);
{
  const sc = cena();
  const b0 = porNome(sc, "Bloco0");

  // 5) o TEMPO. Queda livre de 30 passos = 0,5 s. Euler semi-implícito:
  //    g·dt²·n(n+1)/2 = 9,8/3600 × 465 ≈ 1,27. Com o tempo dobrado seria ~4,9.
  const y0: f64 = b0.transform.py;
  passos(sc, 30);
  const queda: f64 = y0 - b0.transform.py;
  io.print("  queda em 30 passos: " + queda + " (" + rigidBackendName() + ")");
  check("30 passos simulam 0,5 s (queda entre 1,0 e 1,6)", queda > 1.0 && queda < 1.6 ? 1 : 0);

  // 2) a velocidade sobrevive ao spawn de OUTRO objeto.
  const yA: f64 = b0.transform.py;
  passos(sc, 5);
  const antes: f64 = yA - b0.transform.py;
  sc.add(bloco("Novo", 20.0, 40.0));
  const yB: f64 = b0.transform.py;
  passos(sc, 5);
  const depois: f64 = yB - b0.transform.py;
  io.print("  queda do Bloco0 em 5 passos: " + antes + " antes do spawn, " + depois + " depois");
  check("o spawn nao zera a velocidade de quem ja caia", depois >= antes ? 1 : 0);

  // 1) o novo é simulado sem `rigidInvalidate()`.
  const novo = porNome(sc, "Novo");
  check("o backend recebeu o corpo novo", rigidBodyCount() === 5 ? 1 : 0);
  check("o corpo novo CAI", novo.transform.py < 40.0 - 0.05 ? 1 : 0);

  // 3) remover o Bloco0 desloca os índices de todo mundo depois dele.
  sc.removeAt(1);
  passos(sc, 10);
  check("apos remover, o backend tem um corpo a menos", rigidBodyCount() === 4 ? 1 : 0);
  check("Bloco1 continua no X dele", porNome(sc, "Bloco1").transform.px === 0.0 - 3.0 ? 1 : 0);
  check("Bloco3 continua no X dele", porNome(sc, "Bloco3").transform.px === 3.0 ? 1 : 0);
  check("Novo continua no X dele", porNome(sc, "Novo").transform.px === 20.0 ? 1 : 0);

  // 4) em repouso sobre o chão, a velocidade da CPU não pode ser a de uma
  //    queda livre que o `Rigidbody` integrou sozinho.
  passos(sc, 400);
  const b1 = porNome(sc, "Bloco1");
  io.print("  Bloco1 em repouso: y=" + b1.transform.py + " vy=" + b1.transform.vy);
  check("o corpo REPOUSA sobre o chao", b1.transform.py > 0.8 && b1.transform.py < 1.1 ? 1 : 0);
  check("o Rigidbody nao acumulou queda por cima do backend", b1.transform.vy > 0.0 - 1.0 ? 1 : 0);

  // teleporte: o gizmo do editor escreve `px` direto. O backend tem de ACEITAR
  // — antes ele devolvia o corpo ao lugar antigo no passo seguinte.
  b1.transform.px = 10.0; b1.transform.py = 5.0;
  passos(sc, 5);
  io.print("  apos teleporte: x=" + b1.transform.px + " y=" + b1.transform.py);
  check("o corpo teleportado fica onde foi posto (X)", b1.transform.px === 10.0 ? 1 : 0);
  check("e volta a cair DALI", b1.transform.py < 5.0 && b1.transform.py > 4.5 ? 1 : 0);
  passos(sc, 200);

  // handoff: voltar para a CPU não pode teleportar nem disparar ninguém.
  const yRep: f64 = b1.transform.py;
  rigidSetMode(0);
  passos(sc, 30);
  io.print("  apos handoff para CPU: y=" + b1.transform.py);
  check("handoff para a CPU mantem o repouso", b1.transform.py > yRep - 0.2 && b1.transform.py < yRep + 0.2 ? 1 : 0);
}

// ═══ GPU: pipelined, então só os invariantes que não dependem de latência ═══
io.print("── backend GPU ──");
rigidSetMode(1);
{
  const sc = cena();
  passos(sc, 1);
  if (rigidBackendName().indexOf("gpu") === 0 && rigidBackendName().indexOf("caiu") < 0) {
    passos(sc, 120);
    const b0 = porNome(sc, "Bloco0");
    const queda: f64 = 40.0 - b0.transform.py;
    io.print("  queda em 121 passos: " + queda);
    // 2,02 s de queda livre = ~20; nunca MAIS que isso. O dobro do tempo daria ~39.
    check("a GPU nao simula mais rapido que o relogio", queda < 22.0 ? 1 : 0);
    sc.add(bloco("Novo", 20.0, 40.0));
    passos(sc, 60);
    check("a GPU recebeu o corpo novo", rigidBodyCount() === 5 ? 1 : 0);
    sc.removeAt(1);
    passos(sc, 60);
    check("a GPU tem um corpo a menos", rigidBodyCount() === 4 ? 1 : 0);
    check("GPU: Bloco1 continua no X dele", porNome(sc, "Bloco1").transform.px === 0.0 - 3.0 ? 1 : 0);
    check("GPU: Novo continua no X dele", porNome(sc, "Novo").transform.px === 20.0 ? 1 : 0);
    const g1 = porNome(sc, "Bloco1");
    g1.transform.px = 10.0;
    passos(sc, 60);
    check("GPU: o corpo teleportado fica onde foi posto", g1.transform.px === 10.0 ? 1 : 0);
    check("GPU: o Rigidbody nao acumulou queda por cima",
          porNome(sc, "Bloco1").transform.vy > 0.0 - 30.0 ? 1 : 0);
  } else {
    io.print("  sem GPU nesta maquina (" + rigidBackendName() + ") — bloco pulado");
  }
}

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

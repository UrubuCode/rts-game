// Teste de sistema do DECISOR de backend dos rígidos (engine/core/physics_backend.ts).
//
//   run_fixture.exe tools/claude-test-physics-backend.ts
//
// O que ele pina — e são invariantes de INTEGRAÇÃO, não de física (a física em
// si é `tools/test_gpurigid.ts`):
//   1. o padrão é GPU e cai para a CPU sem placa (a decisão do cabeçalho);
//   2. pedir GPU sem GPU cai para a CPU sem lançar — o editor tem de abrir;
//   3. com GPU, o passo assume o frame e os corpos DESCEM (a física chegou aos
//      transforms da cena, que é o único ponto onde a integração pode falhar
//      silenciosamente);
//   4. o nome do backend ativo distingue "cpu" de "gpu" de "gpu caiu".
import io from "@compat/io.ts";

import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import {
  rigidReport,
  rigidSetMode, rigidMode, rigidBackendName, rigidStep,
  rigidInvalidate, rigidBodyCount, rigidFreshFrames, rigidFrames,
} from "@engine/core/physics_backend";
import { crThreads } from "@engine/rigid/cpurigid";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

rigidReport();

const sc = new Scene("BackendTest");
{
  const chao = new GameObject("Chao");
  chao.setMesh(1, 100, 100, 100);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 40.0; chao.transform.sy = 1.0; chao.transform.sz = 40.0;
  chao.stationary = 1;
  sc.add(chao);
}
let b = 0;
while (b < 24) {
  const g = new GameObject("Bloco" + b);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition((b % 4) * 1.4 - 2.1, 8.0 + ((b / 4) | 0) * 1.4, 0.0);
  g.transform.sx = 1.3; g.transform.sy = 1.3; g.transform.sz = 1.3;
  // O INTEGRADOR, que este teste não tinha e precisava ter.
  //
  // Ele caía sem um: o kernel aplicava gravidade a todo corpo que recebia,
  // enquanto no caminho da CPU um objeto sem `Rigidbody` fica parado porque
  // ninguém o move. A mesma cena caía ou não conforme o backend, e este teste
  // pinava o lado errado dessa divergência. Agora a gravidade é do CORPO (ver
  // `engine/rigid/materials.ts`) e quem não tem integrador não cai em backend
  // nenhum — o que o bloco no fim deste arquivo passa a pinar.
  g.addBehavior(new Rigidbody(0.0 - 9.8, 0.0));
  sc.add(g);
  b = b + 1;
}
sc.computeWorld();

check("o padrao e AUTO", rigidMode() === 3 ? 1 : 0);

// ── 1) a queda para a CPU nao depende do calibrador ────────────────────────
//
// `pbTemGpu = gpu.available()` era escrito SO dentro de `rigidCalibrate`, e
// `pbAlvo` o lia para decidir se havia placa. Remover o calibrador sem mover
// essa deteccao tiraria a queda para a CPU que o cabecalho deste modulo chama
// de "nao opcional".
rigidSetMode(1);
const assumiuGpu = rigidStep(sc, 0) !== 0 ? 1 : 0;
io.print("  modo gpu: assumiu=" + assumiuGpu + " nome=" + rigidBackendName());
check("pedir GPU nao lanca, com ou sem placa", 1);
check("sem placa, o nome EXPLICA a queda",
      assumiuGpu === 1 || rigidBackendName() !== "gpu" ? 1 : 0);

// ── 2) opt-in explícito ────────────────────────────────────────────────────
rigidSetMode(1);
rigidInvalidate();
check("modo depois do opt-in = GPU", rigidMode() === 1 ? 1 : 0);

const alturaAntes: f64 = sc.objects[1].transform.py;
let f = 0;
let assumidos = 0;
while (f < 180) {
  if (rigidStep(sc, 0) !== 0) assumidos = assumidos + 1;
  f = f + 1;
}
const alturaDepois: f64 = sc.objects[1].transform.py;
io.print("  backend ativo: " + rigidBackendName() + " | corpos=" + rigidBodyCount() +
         " frames=" + rigidFrames() + " comEstadoNovo=" + rigidFreshFrames());
io.print("  bloco 0: y " + alturaAntes + " -> " + alturaDepois);

if (rigidBackendName() === "gpu") {
  check("a GPU assumiu todos os 180 frames", assumidos === 180 ? 1 : 0);
  check("a GPU devolveu estado novo em algum frame", rigidFreshFrames() > 0 ? 1 : 0);
  check("os corpos CAIRAM (a fisica chegou nos transforms)", alturaDepois < alturaAntes - 1.0 ? 1 : 0);
  check("os corpos PARARAM sobre o chao (nao atravessaram)", alturaDepois > 0.0 ? 1 : 0);
  check("todos os 24 dinamicos foram entregues", rigidBodyCount() === 24 ? 1 : 0);
} else {
  // Sem GPU o teste vira o teste do FALLBACK, que é o invariante que importa
  // numa máquina sem placa: nada lançou e o nome diz por quê.
  check("sem GPU: o passo nao assume o frame", assumidos === 0 ? 1 : 0);
  check("sem GPU: o nome explica a queda", rigidBackendName().length > 3 ? 1 : 0);
  check("sem GPU: os transforms ficaram intactos", alturaDepois === alturaAntes ? 1 : 0);
}

// ── 3) voltar para a CPU ───────────────────────────────────────────────────
rigidSetMode(0);
check("voltar para CPU: nome = 'cpu'", rigidBackendName() === "cpu" ? 1 : 0);
check("voltar para CPU: o passo devolve 0", rigidStep(sc, 0) === 0 ? 1 : 0);

// ── 4) um corpo SEM integrador não cai em backend nenhum ───────────────────
//
// A regra que os três solvers passaram a compartilhar. Vale a pena um teste
// próprio porque a violação era invisível: só aparecia ao TROCAR de backend, que
// é a coisa que este arquivo existe para vigiar.
{
  const parado = new Scene("SemIntegrador");
  const g = new GameObject("Solto");
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition(0.0, 20.0, 0.0);
  parado.add(g);
  parado.computeWorld();
  rigidSetMode(2);   // o Rust: síncrono, sem depender de placa
  let f = 0;
  while (f < 120) { rigidStep(parado, 0); f = f + 1; }
  io.print("  sem Rigidbody: y = " + parado.objects[0].transform.py);
  check("sem integrador, o corpo NAO cai", parado.objects[0].transform.py === 20.0 ? 1 : 0);
  rigidSetMode(0);
}

// ── 5) o modo AUTO consulta o perfil medido ───────────────────────────────
//
// O modo 3 e novo. O 2 continua sendo "Rust sempre" (escolha manual); o 3 diz
// "escolha por medicao", e e o que o editor usa por padrao.
rigidSetMode(3);
check("modo auto fica em 3", rigidMode() === 3 ? 1 : 0);
const nomeAuto = rigidBackendName();
io.print("  auto escolheu: " + nomeAuto + " (threads=" + crThreads() + ")");
check("auto escolhe rust ou gpu, nunca vazio", nomeAuto.length > 2 ? 1 : 0);
// Nesta maquina (>=16 threads) e nesta cena (24 corpos), o perfil diz Rust.
check("com muitas threads e cena pequena, auto = rust",
      crThreads() < 4 || nomeAuto.indexOf("rust") === 0 ? 1 : 0);

// ── 6) Histerese no modo AUTO (margem >= 20% sustentada por 10 passos) ────
import { rigidAutoHysteresis } from "@engine/core/physics_backend";
import { profSetTable, profResetFactoryDefaults } from "@engine/core/backend_profile";

rigidSetMode(3); // AUTO
rigidStep(sc, 0);
const h0 = rigidAutoHysteresis();
check("histerese inicializada com backend ativo", h0.ativo === 1 || h0.ativo === 2 ? 1 : 0);

// Força uma tabela onde o outro backend é 10% melhor (margem < 20%):
const ativoOriginal = h0.ativo;
if (ativoOriginal === 2) {
  profSetTable([24], [0.90], [1], [[1.00]]);
} else {
  profSetTable([24], [1.00], [1], [[0.90]]);
}

for (let s = 0; s < 15; s = s + 1) {
  rigidStep(sc, 0);
}
const h1 = rigidAutoHysteresis();
check("margem < 20%: nao troca de backend e streak = 0", h1.ativo === ativoOriginal && h1.streak === 0 ? 1 : 0);

// Agora força o candidato a ser 30% mais rápido (margem >= 20%):
if (ativoOriginal === 2) {
  profSetTable([24], [0.70], [1], [[1.00]]);
} else {
  profSetTable([24], [1.00], [1], [[0.70]]);
}

// 5 passos: streak deve subir para 5, mas ativo NÃO troca ainda
for (let s = 0; s < 5; s = s + 1) {
  rigidStep(sc, 0);
}
const h2 = rigidAutoHysteresis();
check("margem >= 20%: streak avança e ativo mantido", h2.ativo === ativoOriginal && h2.streak === 5 ? 1 : 0);

// Mais 5 passos (total 10): deve trocar o ativo!
for (let s = 0; s < 5; s = s + 1) {
  rigidStep(sc, 0);
}
const h3 = rigidAutoHysteresis();
check("apos 10 passos sustentados: troca de backend concretizada", h3.ativo !== ativoOriginal ? 1 : 0);

profResetFactoryDefaults();

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

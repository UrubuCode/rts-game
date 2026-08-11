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
import io from "../compat/io.ts";

import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import {
  rigidCalibrate, rigidReport, rigidBackendFor, rigidBand,
  rigidSetMode, rigidMode, rigidBackendName, rigidStep,
  rigidInvalidate, rigidBodyCount, rigidFreshFrames, rigidFrames,
} from "../engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

rigidCalibrate();
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
  sc.add(g);
  b = b + 1;
}
sc.computeWorld();

// ── 1) o padrão é GPU, com queda para a CPU ────────────────────────────────
//
// Era CPU, e as três asserções aqui diziam isso. A decisão mudou em 2026-08-11
// — "default gpu e fallback cpu" — e este teste FALHOU, que é exatamente o que
// ele existe para fazer. O que ele pina agora é a queda: numa máquina sem placa
// o padrão GPU não pode lançar nem travar o editor, e a prova disso é o nome do
// backend explicar por que caiu.
check("modo padrao = GPU", rigidMode() === 1 ? 1 : 0);

const temPlaca = rigidBackendFor(24) >= 0 ? 1 : 0;
// O passo vem ANTES de olhar o nome: o backend só se resolve ao ser usado, e
// perguntar o nome antes disso mede a inicialização e não a decisão.
const assumiuNoPadrao = rigidStep(sc, 0) !== 0 ? 1 : 0;
io.print("  padrao: placa=" + temPlaca + " assumiu=" + assumiuNoPadrao +
         " nome=" + rigidBackendName());
check("no padrao, quem assume o frame e a GPU — e so ela",
      assumiuNoPadrao === temPlaca ? 1 : 0);
check("sem placa, o nome do backend EXPLICA a queda",
      temPlaca === 1 || rigidBackendName() !== "gpu" ? 1 : 0);

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

if (rigidBackendFor(24) >= 0 && rigidBackendName() === "gpu") {
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

// ── 4) a faixa é coerente ──────────────────────────────────────────────────
const faixa = rigidBand();
check("faixa coerente (lo <= hi)", faixa[0] <= faixa[1] ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

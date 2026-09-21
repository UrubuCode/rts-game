// Teste do campo de nível em Needs e recusa nos backends rápidos (Fase 1, §6 e §7.1.1).
//
//   rts.exe run tests/claude-test-needs-nivel.ts
//
import io from "@compat/io.ts";
import rigid, {
  NEED_LEVEL_BASE,
  NEED_LEVEL_SIMPLES,
  NEED_LEVEL_ORIENTADA,
  NEED_LEVEL_COMPLETA,
  needForLevel,
} from "@compat/rigid.ts";
import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import {
  PHYSICS_LEVEL_SIMPLES,
  PHYSICS_LEVEL_ORIENTADA,
  PHYSICS_LEVEL_COMPLETA,
  profBest,
  profGpuMs,
  profRustMs,
  PROF_RUST,
  PROF_DESCONHECIDO,
} from "@engine/core/backend_profile";
import {
  rigidSetLevel,
  rigidLevel,
  rigidSetMode,
  rigidStep,
  rigidBackendName,
} from "@engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) {
    ok = ok + 1;
    io.print("  [ok] " + nome);
  } else {
    fail = fail + 1;
    io.print("  [FALHOU] " + nome);
  }
}

io.print("=== TESTE DE NÍVEL EM NEEDS E RECUSA DE BACKENDS ===");

// 1. Superfície Rust rts:rigid.supports(need) com constantes nomeadas
const supSimples = rigid.supports(NEED_LEVEL_SIMPLES);
const supOrientada = rigid.supports(NEED_LEVEL_ORIENTADA);
const supCompleta = rigid.supports(NEED_LEVEL_COMPLETA);

check("Rust suporta nível Simples (NEED_LEVEL_SIMPLES)", supSimples === 1 ? 1 : 0);
check("Rust recusa nível Orientada (NEED_LEVEL_ORIENTADA, ainda não implementado)", supOrientada === 0 ? 1 : 0);
check("Rust recusa nível Completa (NEED_LEVEL_COMPLETA, ainda não implementado)", supCompleta === 0 ? 1 : 0);
check("needForLevel deriva o código correto", needForLevel(PHYSICS_LEVEL_ORIENTADA) === NEED_LEVEL_ORIENTADA ? 1 : 0);

// 2. backend_profile: profBest, profGpuMs, profRustMs com nível
check(
  "profGpuMs(1000, SIMPLES) > 0",
  profGpuMs(1000, PHYSICS_LEVEL_SIMPLES) > 0 ? 1 : 0
);
check(
  "profGpuMs(1000, ORIENTADA) == -1 (recusa)",
  profGpuMs(1000, PHYSICS_LEVEL_ORIENTADA) < 0 ? 1 : 0
);
check(
  "profRustMs(1000, 16, SIMPLES) > 0",
  profRustMs(1000, 16, PHYSICS_LEVEL_SIMPLES) > 0 ? 1 : 0
);
check(
  "profRustMs(1000, 16, ORIENTADA) == -1 (recusa)",
  profRustMs(1000, 16, PHYSICS_LEVEL_ORIENTADA) < 0 ? 1 : 0
);
check(
  "profBest(1000, 16, SIMPLES) == PROF_RUST",
  profBest(1000, 16, PHYSICS_LEVEL_SIMPLES) === PROF_RUST ? 1 : 0
);
check(
  "profBest(1000, 16, ORIENTADA) == PROF_DESCONHECIDO (recusa)",
  profBest(1000, 16, PHYSICS_LEVEL_ORIENTADA) === PROF_DESCONHECIDO ? 1 : 0
);
check(
  "profBest(1000, 16, COMPLETA) == PROF_DESCONHECIDO (recusa)",
  profBest(1000, 16, PHYSICS_LEVEL_COMPLETA) === PROF_DESCONHECIDO ? 1 : 0
);

// 3. Recusa de nível em rigidSetLevel e preservação do nível
const retOrientada = rigidSetLevel(PHYSICS_LEVEL_ORIENTADA);
check("rigidSetLevel(ORIENTADA) retorna 0 (recusado)", retOrientada === 0 ? 1 : 0);
check("rigidLevel() permanece SIMPLES apos recusa de ORIENTADA", rigidLevel() === PHYSICS_LEVEL_SIMPLES ? 1 : 0);

const retCompleta = rigidSetLevel(PHYSICS_LEVEL_COMPLETA);
check("rigidSetLevel(COMPLETA) retorna 0 (recusado)", retCompleta === 0 ? 1 : 0);
check("rigidLevel() permanece SIMPLES apos recusa de COMPLETA", rigidLevel() === PHYSICS_LEVEL_SIMPLES ? 1 : 0);

const retSimples = rigidSetLevel(PHYSICS_LEVEL_SIMPLES);
check("rigidSetLevel(SIMPLES) retorna 1 (aceito)", retSimples === 1 ? 1 : 0);
check("rigidLevel() e SIMPLES", rigidLevel() === PHYSICS_LEVEL_SIMPLES ? 1 : 0);

// 4. Execução do passo no nível simples
const sc = new Scene("TestNeedsNivel");
const chao = new GameObject("Chao");
chao.setMesh(1, 100, 100, 100);
chao.colShape = COL_BOX;
chao.stationary = 1;
chao.transform.setScale(10.0);
sc.add(chao);

const caixa = new GameObject("Caixa");
caixa.setMesh(1, 200, 200, 200);
caixa.colShape = COL_BOX;
caixa.transform.setPosition(0.0, 5.0, 0.0);
caixa.addBehavior(new Rigidbody(-9.8, 0.0));
sc.add(caixa);
sc.computeWorld();

rigidSetMode(2); // Forçar Rust
const assumiuSimples = rigidStep(sc, 0);
check("No nível SIMPLES, backend rápido assume o passo", assumiuSimples !== 0 ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

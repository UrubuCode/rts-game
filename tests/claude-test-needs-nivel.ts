// Teste do campo de nível em Needs e recusa nos backends rápidos (Fase 1, §6 e §7.1.1).
//
//   rts.exe run tests/claude-test-needs-nivel.ts
//
import io from "@compat/io.ts";
import rigid from "@compat/rigid.ts";
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

// 1. Superfície Rust rts:rigid.supports(need)
// 9 = Simples, 10 = Orientada, 11 = Completa
const supSimples = rigid.supports(9);
const supOrientada = rigid.supports(10);
const supCompleta = rigid.supports(11);

check("Rust suporta nível Simples (código 9)", supSimples === 1 ? 1 : 0);
check("Rust recusa nível Orientada (código 10, ainda não implementado)", supOrientada === 0 ? 1 : 0);
check("Rust recusa nível Completa (código 11, ainda não implementado)", supCompleta === 0 ? 1 : 0);

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

// 3. Fallback no decisor (physics_backend):
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
rigidSetLevel(PHYSICS_LEVEL_SIMPLES);
check("rigidLevel() == SIMPLES", rigidLevel() === PHYSICS_LEVEL_SIMPLES ? 1 : 0);
const assumiuSimples = rigidStep(sc, 0);
check("No nível SIMPLES, backend rápido assume o passo", assumiuSimples !== 0 ? 1 : 0);

rigidSetLevel(PHYSICS_LEVEL_ORIENTADA);
check("rigidLevel() == ORIENTADA", rigidLevel() === PHYSICS_LEVEL_ORIENTADA ? 1 : 0);
const assumiuOrientada = rigidStep(sc, 0);
check(
  "No nível ORIENTADA, backend rápido NÃO assume (cai para CPU)",
  assumiuOrientada === 0 ? 1 : 0
);

// Restaura para SIMPLES
rigidSetLevel(PHYSICS_LEVEL_SIMPLES);
check("Restauração de nível para SIMPLES", rigidLevel() === PHYSICS_LEVEL_SIMPLES ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

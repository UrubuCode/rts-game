// UM passo fixo da simulação do Play: scripts (`scene.update(FIXED_DT)`) e a
// física (GPU quando o backend assume, senão a varredura da CPU). É o mesmo
// passo para o laço de quadros do main.ts e para o `step N` da porta de
// controle — dois caminhos que divergissem dariam resultados diferentes para
// "rodar 10 quadros" e "step 10".
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { FIXED_DT, stepDone } from "@engine/core/fixedstep";
import { rigidStep } from "@engine/core/physics_backend";
import { logError } from "@engine/core/logger";

/// Chamado quando um script lança durante a simulação (o main.ts abre o
/// Console). null = só registra.
let aoFalhar: any = null;
export function definirAoFalharSimulacao(f: any): void { aoFalhar = f; }

// `try/catch` fora do laço por quadro: no RTS a função que contém `try` aloca a
// cada chamada, mesmo sem entrar nele (Task 10.5).
/// Um passo de `scene.update`; 0 se um script lançou (a simulação pausa).
function atualizarCenaProtegido(): number {
  try { scene.update(FIXED_DT); return 1; }
  catch (error) {
    logError("Erro durante simulacao: " + String(error)); playMode.pause();
    if (aoFalhar !== null) aoFalhar();
    return 0;
  }
}

/// Um passo completo; 0 se um script lançou (a simulação foi pausada e a
/// física deste passo não roda).
export function passoDaSimulacao(): number {
  if (atualizarCenaProtegido() === 0) return 0;
  // A COLISÃO pode rodar na GPU. `rigidStep` responde 1 quando assumiu o
  // passo — e aí a varredura de pares da CPU não roda, porque seriam duas
  // físicas sobre o mesmo estado, a segunda vendo o que a primeira mexeu.
  //
  // A decisão fica AQUI, em quem dirige o passo, e não dentro da `Scene`: o
  // decisor precisa do tipo `Scene` para varrer os corpos, então a `Scene`
  // importá-lo de volta seria um ciclo. Medido (release, headless, 500
  // corpos): 12,05 ms na CPU contra 0,35 ms na GPU (tools/claude-bench-gpu-vs-cpu.ts).
  if (rigidStep(scene, 0) === 0) scene.resolveCollisions();
  stepDone();
  return 1;
}

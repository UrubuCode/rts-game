// `rts:egui` — fallback de `drawParticles` (Task 1, repo `rts`, PR ainda em
// andamento em `feat/particulas-nativo`).
//
// A primitiva pode faltar em binários mais antigos do `rts.exe`. Sem ela a
// SIMULAÇÃO continua normalmente (o pool de partículas não depende de
// desenho, ver `engine/particles/*`); só o desenho é pulado, com um aviso
// ÚNICO no log — o mesmo padrão de `compat/gpu.ts`/`compat/rigid.ts`
// (`typeof fn === "function"` sobre um `import * as`), não o de `nativo` do
// `compat/audio.ts` (chamada direta com try/catch): um `import { x } from
// "rts:egui"` de um membro ausente não lança (o bundler devolve `undefined`),
// então a detecção não precisa invocar o nativo nenhuma vez — só olhar o tipo.
import * as egui from "rts:egui";
import { logWarn } from "@engine/core/logger";

const AVISO_SEM_NATIVO: string = "Partículas: drawParticles ausente neste binário do rts; simulação continua, sem desenho.";
let avisou: number = 0;
/// -1 = ainda não checado, 0 = ausente, 1 = presente. Checado uma vez (não por
/// quadro) — "Custo por quadro" proíbe `try/catch` em caminho por quadro, e
/// aqui nem `try/catch` é preciso: só `typeof`.
let disponivel: number = -1;

function calcularDisponivel(): number {
  return typeof (egui as any).drawParticles === "function" ? 1 : 0;
}

/// 1 se o binário atual do rts expõe `drawParticles` (Task 1). Resultado
/// calculado uma vez e reaproveitado — nunca refeito por quadro.
export function temDrawParticles(): boolean {
  if (disponivel < 0) disponivel = calcularDisponivel();
  return disponivel !== 0;
}

/// Caminho por quadro: SEM `try/catch` aqui — a checagem de presença já foi
/// feita (e fica em cache) em `temDrawParticles`. `buf` tem `PART_FLOATS` (9)
/// floats por partícula (layout da Task 1); devolve o número de partículas
/// desenhadas (0 = recusado ou nativo ausente).
export function drawParticlesSeguro(win: number, buf: Float32Array, n: number, modo: number): number {
  if (!temDrawParticles()) {
    if (avisou === 0) { logWarn(AVISO_SEM_NATIVO); avisou = 1; }
    return 0;
  }
  return (egui as any).drawParticles(win, buf, n, modo);
}

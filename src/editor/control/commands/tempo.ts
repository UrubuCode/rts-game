// CONTROLE DE TEMPO pela porta de controle: `resume`, `step [N]`,
// `timescale [x]` e `seed [n]` (o `pause` mora em scene.ts, com play/stop).
//
// `step N` roda N passos fixos com o Play pausado, pelo MESMO passo do laço de
// quadros (editor/sim_step.ts), e responde na hora com a contagem e o tempo
// simulado. Nada disto custa por quadro quando não é usado: o `timescale` é
// uma multiplicação dentro do `stepsFor`, e o `step` só roda quando chamado.
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { passoDaSimulacao } from "@editor/sim_step";
import { erroUso } from "@editor/control/builtin_commands";
import { argInt, argNum } from "@editor/control/args";
import { FIXED_DT, stepManual, stepSimSteps, stepSimTime, stepSetTimeScale, stepTimeScale } from "@engine/core/fixedstep";
import { interpolateReset } from "@engine/core/interpolate";
import { fixarSementeAleatorio, sementeAleatorio } from "@engine/core/aleatorio";

/// Maior N de um `step`: os passos rodam dentro de UM quadro do editor, e
/// 6000 passos (100 s simulados) já seguram a janela por segundos numa cena
/// pesada. Para mais, repita o comando.
export const STEP_MAX: number = 6000;
/// Maior escala de tempo aceita.
export const TIMESCALE_MAX: number = 100;

const ERRO_FORA_DO_PLAY: string = "fora do Play (use play)";

function segundos(t: f64): string { return t.toFixed(4) + "s"; }

/// resume — retoma a simulação pausada (sem sair do Play).
export function cmdResume(): string {
  if (S.simulating === 0) return "[erro] resume: " + ERRO_FORA_DO_PLAY;
  if (S.playing !== 0) return "[ok] resume (ja estava rodando)";
  return playMode.play() ? "[ok] resume" : "[erro] " + playMode.error;
}

/// step [N] — N passos fixos (padrão 1) com o Play pausado.
export function cmdStep(parts: string[]): string {
  if (parts.length > 2) return erroUso("step");
  const n = parts.length > 1 ? argInt(parts, 1) : 1;
  if (!(n >= 1 && n <= STEP_MAX)) return erroUso("step") + " (N inteiro 1.." + STEP_MAX + " por comando; para mais, repita o step)";
  if (S.simulating === 0) return "[erro] step: " + ERRO_FORA_DO_PLAY;
  const pausou = S.playing !== 0;
  if (pausou) playMode.pause();
  const t0 = stepSimTime();
  let k = 0;
  while (k < n) {
    stepManual();
    if (passoDaSimulacao() === 0) {
      scene.computeWorld();
      return "[erro] step: um script lancou no passo " + (k + 1) + " de " + n + " (ver log erro); simulacao pausada";
    }
    // como um quadro de 1 passo: o mundo derivado fica em dia para o próximo
    scene.computeWorld();
    k = k + 1;
  }
  interpolateReset();
  return "[ok] step " + n + (pausou ? " (pausou o Play)" : "") + " | passos=" + n + " dt=" + FIXED_DT.toFixed(6) +
    " avancou=" + segundos(stepSimTime() - t0) + " | desde o play: passos=" + stepSimSteps() + " t=" + segundos(stepSimTime());
}

/// timescale [x] — escala do tempo da simulação (0 = parado, 1 = real).
export function cmdTimescale(parts: string[]): string {
  if (parts.length === 1) return "[timescale] " + stepTimeScale();
  if (parts.length > 2) return erroUso("timescale");
  const x = argNum(parts, 1);
  if (!(x >= 0.0 && x <= TIMESCALE_MAX)) return erroUso("timescale") + " (x numero 0.." + TIMESCALE_MAX + ")";
  stepSetTimeScale(x);
  return "[ok] timescale " + stepTimeScale();
}

/// seed [n] — semente do gerador aleatório central (@engine/core/aleatorio).
export function cmdSeed(parts: string[]): string {
  if (parts.length === 1) return "[seed] " + sementeAleatorio();
  if (parts.length > 2) return erroUso("seed");
  const n = argInt(parts, 1);
  if (n !== n) return erroUso("seed") + " (n inteiro)";
  fixarSementeAleatorio(n);
  return "[ok] seed " + sementeAleatorio() + " (reaplicada a cada play)";
}

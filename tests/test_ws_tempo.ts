// Teste SEM JANELA do CONTROLE DE TEMPO pela porta de controle: `step N` avança
// exatamente N passos fixos (tempo simulado = N x FIXED_DT), `timescale 0.5`
// dá metade dos passos por quadro, a mesma `seed` reproduz as posições depois
// de N passos (componente Vagar, que sorteia pelo gerador central), e
// pause/resume/step validam o estado do Play.
//
//   rts.exe run tests/test_ws_tempo.ts
import io from "@compat/io.ts";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene, S } from "@editor/control/session";
import { FIXED_DT, stepsFor, stepReset, stepSimTime, stepSimSteps, stepSetTimeScale } from "@engine/core/fixedstep";
import { aleatorio, semearAleatorio } from "@engine/core/aleatorio";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function ok(cmd: string): string {
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[erro]") !== 0, cmd + ": " + out);
  return out;
}
function erro(cmd: string): string {
  const out = execCommand(800, 600, cmd);
  check(out.indexOf("[erro]") === 0, cmd + " deveria ser [erro]: " + out);
  return out;
}
instalarEditorReal();

// ── gerador central ────────────────────────────────────────────────────────
semearAleatorio(42); const a1 = aleatorio(); const a2 = aleatorio();
semearAleatorio(42); check(aleatorio() === a1 && aleatorio() === a2, "mesma semente, mesma sequencia");
check(a1 >= 0.0 && a1 < 1.0 && a1 !== a2, "faixa [0,1)");
semearAleatorio(0); check(aleatorio() >= 0.0, "semente 0 nao trava o gerador");

// ── fora do Play ───────────────────────────────────────────────────────────
scene.clear();
ok("spawn Unidade 0 1 0 1");
ok("addcomp Unidade Vagar");
ok("spawn Outra 4 1 0 1");
ok("addcomp Outra Vagar");
erro("step"); erro("step 5"); erro("resume");
erro("step 0"); erro("step -2"); erro("step 6001"); erro("step abc"); erro("step 1.5"); erro("step 1 2");
erro("timescale -1"); erro("timescale x"); erro("timescale 1000"); erro("seed x"); erro("seed 1.5");
check(ok("timescale").indexOf("[timescale] 1") === 0, "timescale padrao 1");

// ── step N: exatamente N passos fixos ──────────────────────────────────────
ok("seed 42");
ok("play");
check(S.simulating === 1 && S.playing === 1, "play rodando");
const t0 = stepSimTime(); const p0 = stepSimSteps();
const r10 = ok("step 10");
check(S.simulating === 1 && S.playing === 0, "step pausou sem sair do Play: " + r10);
check(stepSimSteps() - p0 === 10, "10 passos: " + (stepSimSteps() - p0));
check(Math.abs((stepSimTime() - t0) - 10.0 * FIXED_DT) < 1e-12, "tempo = 10 x dt: " + (stepSimTime() - t0));
check(r10.indexOf("passos=10") > 0 && r10.indexOf("avancou=0.1667s") > 0 && r10.indexOf("(pausou o Play)") > 0, "resposta: " + r10);
const r1 = ok("step");
check(r1.indexOf("[ok] step 1 ") === 0 && r1.indexOf("(pausou") < 0 && stepSimSteps() - p0 === 11, "step sem N = 1: " + r1);
check(ok("pause").indexOf("[ok]") === 0 && S.playing === 0, "pause");
check(ok("resume") === "[ok] resume" && S.playing === 1 && S.simulating === 1, "resume retoma");
check(ok("resume").indexOf("ja estava") > 0, "resume rodando");

// ── mesma semente, mesmas posições depois de N passos ─────────────────────
function posicoesDepois(semente: number, n: number): string {
  ok("stop");
  ok("seed " + semente);
  ok("play");
  ok("step " + n);
  let s = "";
  let i = 0;
  while (i < scene.objects.length) { const t = scene.objects[i].transform; s = s + t.px + "," + t.pz + ";"; i = i + 1; }
  return s;
}
const a = posicoesDepois(42, 90);
const b = posicoesDepois(42, 90);
const c = posicoesDepois(7, 90);
// a semente fixada é reaplicada a cada play: sem `seed` de novo, o mesmo caminho
ok("stop"); ok("play"); ok("step 90");
let semSeed = "";
let si = 0;
while (si < scene.objects.length) { const t = scene.objects[si].transform; semSeed = semSeed + t.px + "," + t.pz + ";"; si = si + 1; }
check(semSeed === c, "play seguinte repete a semente 7: " + semSeed + " vs " + c);
check(a === b, "mesma semente, mesmas posicoes: " + a + " vs " + b);
check(a !== c, "semente diferente, caminho diferente");
check(a !== "0,0;4,0;", "Vagar andou: " + a);
ok("stop");
check(S.simulating === 0 && scene.objects[0].transform.px === 0.0, "stop restaura a cena de edicao");

// ── timescale: metade dos passos por quadro ────────────────────────────────
function passosEm(quadros: number): number {
  stepReset();
  let total = 0; let q = 0;
  while (q < quadros) { total = total + stepsFor(1.0 / 60.0); q = q + 1; }
  return total;
}
const normal = passosEm(120);
check(ok("timescale 0.5") === "[ok] timescale 0.5", "timescale 0.5");
const metade = passosEm(120);
check(ok("timescale 0") === "[ok] timescale 0", "timescale 0");
const parado = passosEm(120);
check(ok("timescale 2").indexOf("[ok]") === 0, "timescale 2");
const dobro = passosEm(120);
ok("timescale 1");
check(Math.abs(normal - 120) <= 1 && Math.abs(metade - 60) <= 1 && parado === 0 && Math.abs(dobro - 240) <= 1,
  "passos por 120 quadros: normal=" + normal + " metade=" + metade + " parado=" + parado + " dobro=" + dobro);
stepSetTimeScale(1.0); stepReset();

check(execCommand(800, 600, "doc json").indexOf("\"name\":\"step\"") > 0, "step no manifesto");
io.print("[PASSOU] ws tempo: step N = N x dt, pause/resume no Play, timescale escala os passos, seed reproduz as posicoes");

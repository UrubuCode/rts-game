// Teste SEM JANELA do `rot <obj> <yaw> <pitch> [roll]` (graus; yaw = Y,
// pitch = X, roll = Z: a convenção do `pose rot` e dos campos do Inspector) e
// da leitura `rot <obj>`. Definir entra no Desfazer uma vez; ler, não.
//
//   rts.exe run tests/test_ws_rot.ts
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene } from "@editor/control/session";
import { DEG2RAD } from "@editor/bone_gizmo";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: f64, b: f64): boolean { return Math.abs(a - b) < 1e-9; }
scene.clear(); history.u = []; history.r = [];
check(execCommand(800, 600, "spawn A 0 0 0").indexOf("[ok]") === 0, "spawn");
history.u = []; history.r = [];
const t = scene.objects[0].transform;

check(execCommand(800, 600, "rot 0 90 -30 15").indexOf("[ok]") === 0, "rot com roll");
check(perto(t.ry, 90 * DEG2RAD) && perto(t.rx, 0 - 30 * DEG2RAD) && perto(t.rz, 15 * DEG2RAD), "yaw->ry, pitch->rx, roll->rz em radianos");
check(history.undoDepth() === 1, "rot entra no Desfazer uma vez");
const lido = execCommand(800, 600, "rot 0");
check(lido.indexOf("[rot] #0 A yaw=90 pitch=-30 roll=15") === 0, "leitura em graus: " + lido);
check(history.undoDepth() === 1 && history.redoDepth() === 0, "ler nao mexe no Desfazer");
check(execCommand(800, 600, "rot 0 45 10").indexOf("[ok]") === 0 && perto(t.rz, 0.0) && perto(t.ry, 45 * DEG2RAD), "sem roll: roll 0");
check(history.undoDepth() === 2, "segundo rot: 2 no Desfazer");
check(execCommand(800, 600, "undo").indexOf("[ok]") === 0, "undo");
check(perto(scene.objects[0].transform.ry, 90 * DEG2RAD) && perto(scene.objects[0].transform.rz, 15 * DEG2RAD), "undo volta a rotacao anterior");
// o state mostra a mesma convenção
check(execCommand(800, 600, "state").indexOf("rot(90,-30,15)") > 0, "state em yaw,pitch,roll");

const ruins: string[] = ["rot", "rot 9 1 2", "rot 0 x 2", "rot 0 1", "rot 0 1 2 y", "rot 0 1 2 3 4"];
let i = 0;
while (i < ruins.length) {
  const u = history.undoDepth(); const r = history.redoDepth();
  const out = execCommand(800, 600, ruins[i]);
  check(out.indexOf("[erro]") === 0, ruins[i] + " deveria ser [erro]: " + out);
  check(history.undoDepth() === u && history.redoDepth() === r, ruins[i] + " mexeu no Desfazer");
  i = i + 1;
}
println("[PASSOU] ws rot: define em graus (yaw/pitch/roll), le de volta, Desfazer so ao definir");

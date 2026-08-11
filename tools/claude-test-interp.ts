// A interpolação de render: o que ela conserta e o que ela NÃO pode quebrar.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { snapshotWorld, renderY, interpolateReset, hasSnapshot } from "../engine/core/interpolate";

let pass = 0; let fail = 0;
function ok(n: string, c: number): void {
  if (c !== 0) { pass = pass + 1; io.print("  [ok] " + n); }
  else { fail = fail + 1; io.print("  [FALHOU] " + n); }
}

scene.clear();
const g = new GameObject("corpo");
g.setMesh(4, 200, 200, 200);
g.transform.setPosition(0, 10, 0);
scene.add(g);
scene.computeWorld();

interpolateReset();
ok("sem instantaneo, render = posicao exata", renderY(scene, 0, 0.5) === 10.0 ? 1 : 0);
ok("hasSnapshot=0 antes do primeiro snapshot", hasSnapshot() === 0 ? 1 : 0);

// Um passo de física: 10 -> 8.
snapshotWorld(scene);
g.transform.setPosition(0, 8, 0);
scene.computeWorld();

ok("alpha=0 devolve o estado ANTERIOR", Math.abs(renderY(scene, 0, 0.0) - 10.0) < 1e-9 ? 1 : 0);
ok("alpha=1 devolve o estado ATUAL", Math.abs(renderY(scene, 0, 1.0) - 8.0) < 1e-9 ? 1 : 0);
ok("alpha=0.5 devolve o MEIO (9)", Math.abs(renderY(scene, 0, 0.5) - 9.0) < 1e-9 ? 1 : 0);
ok("alpha=0.25 -> 9.5", Math.abs(renderY(scene, 0, 0.25) - 9.5) < 1e-9 ? 1 : 0);

// O ponto que mais importa: a SIMULAÇÃO não foi tocada.
ok("a posicao da SIMULACAO segue intacta (py=8)", g.transform.py === 8.0 ? 1 : 0);
ok("a posicao de MUNDO segue intacta (wy=8)", g.transform.wy === 8.0 ? 1 : 0);

// Teleporte: sem reset, o objeto atravessaria a tela interpolando entre dois
// mundos sem relação.
g.transform.setPosition(0, 500, 0);
scene.computeWorld();
interpolateReset();
ok("depois de teleportar + reset, render = destino", renderY(scene, 0, 0.5) === 500.0 ? 1 : 0);

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

// PROVA (revisão do Claude): `rbUploadPosVel` sobe o espelho INTEIRO quando mais
// de 16 corpos se movem por fora num frame. O espelho de velocidade só é
// atualizado em `rbReadState` (saída de posse), então o upload devolve a todos
// os corpos DINÂMICOS a velocidade do último handoff.
//
// Mesma cena, duas vezes: um dinâmico em queda livre + K cinemáticos movidos por
// "script" a cada frame. Com K = 5 (caminho por corpo) e K = 20 (caminho em
// lote). A queda do dinâmico não pode depender de K.

import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Rigidbody } from "@scripts/rigidbody";
import { rbAvailable } from "@engine/rigid/gpurigid";
import { rigidStep, rigidSetMode, rigidBackendName } from "@engine/core/physics_backend";

function queda(k: number): f64 {
  scene.clear();
  rigidSetMode(1);
  const dyn = new GameObject("Cai");
  dyn.setMesh(1, 100, 100, 100);
  dyn.transform.setPosition(0.0, 200.0, 0.0);
  dyn.transform.mass = 1.0;
  dyn.stationary = 0; dyn.collideFlag = 1;
  dyn.addBehavior(new Rigidbody(-9.8, 0.0));
  scene.add(dyn);
  const kins: GameObject[] = [];
  let i = 0;
  while (i < k) {
    const g = new GameObject("Kin" + i);
    g.setMesh(1, 100, 100, 100);
    g.transform.setPosition(50.0 + i * 3.0, 0.0, 50.0);
    g.transform.mass = 0.0;
    g.stationary = 0; g.collideFlag = 1;
    scene.add(g);
    kins.push(g);
    i = i + 1;
  }
  scene.computeWorld();
  let s = 0;
  while (s < 120) {
    // o "script de navegação": move cada cinemático por fora, todo frame
    let j = 0;
    while (j < k) { kins[j].transform.px = kins[j].transform.px + 0.05; j = j + 1; }
    rigidStep(scene, 0);
    s = s + 1;
  }
  io.print("  K=" + k + " backend=" + rigidBackendName() + "  y final do dinamico = " + dyn.transform.py);
  return dyn.transform.py;
}

if (rbAvailable() === 0) { io.print("[skip] sem GPU"); }
else {
  const y5 = queda(5);
  const y20 = queda(20);
  const d = y5 - y20; const ad = d < 0.0 ? 0.0 - d : d;
  io.print("  diferenca = " + ad);
  io.print(ad < 0.5 ? "[PASSOU] a queda nao depende de K" : "[FALHOU] o upload em lote mudou a fisica dos dinamicos");
}

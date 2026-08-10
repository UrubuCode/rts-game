// Os 13.77ms de 500 objetos, quebrados nas TRÊS partes.
//
// Sem isto a otimização é um chute entre três candidatos plausíveis. Medido
// separando as chamadas, não estimando: cada laço roda o MESMO número de frames
// sobre a MESMA cena, e a diferença entre eles é o custo da parte.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { Rigidbody } from "../scripts/rigidbody";

const DT = 1.0 / 60.0;

function montar(n: number): void {
  scene.clear();
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(4, 200, 200, 200);
    g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75);
    g.transform.setScale(0.5);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.5));
    scene.add(g);
  }
}

function cronometrar(n: number, frames: number, parte: number): number {
  montar(n);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    if (parte === 0) scene.update(DT);
    else if (parte === 1) { scene.update(DT); scene.resolveCollisions(); }
    else { scene.update(DT); scene.resolveCollisions(); scene.computeWorld(); }
  }
  return (Date.now() - t0) / frames;
}

for (const n of [500, 1000]) {
  const so_update = cronometrar(n, 60, 0);
  const ate_colisao = cronometrar(n, 60, 1);
  const tudo = cronometrar(n, 60, 2);
  io.print("== " + n + " objetos em movimento ==");
  io.print("  update(dt)         " + so_update.toFixed(2) + " ms/frame");
  io.print("  resolveCollisions  " + (ate_colisao - so_update).toFixed(2) + " ms/frame");
  io.print("  computeWorld       " + (tudo - ate_colisao).toFixed(2) + " ms/frame");
  io.print("  TOTAL              " + tudo.toFixed(2) + " ms/frame");
  io.print("");
}

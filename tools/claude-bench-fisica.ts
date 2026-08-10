// Quanto custa a FÍSICA por frame, sem render nenhum.
//
// Headless de propósito: nenhuma janela, nenhum `drawMesh`. Se o custo do frame
// já aparecer aqui, ele não é da fronteira TS→nativo do desenho — é do
// `update` + `resolveCollisions`, que são TypeScript puro.
//
// Mede os dois estados que o observador relatou como diferentes: objetos EM
// MOVIMENTO contra objetos EM REPOUSO. A cena tem sleeping (`t.asleep`), e um
// corpo dormindo é PULADO pela colisão — então a diferença entre os dois
// números é o custo que o sleeping esconde quando tudo está parado.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { Rigidbody } from "../scripts/rigidbody";

const DT = 1.0 / 60.0;

function montar(n: number, alturaDoChao: number): void {
  scene.clear();
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(4, 200, 200, 200);
    // Uma grade, espaçada o suficiente para não ser um só amontoado — o custo
    // do grid espacial depende de quantos vizinhos cada célula tem.
    g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, alturaDoChao + (i / lado | 0) * 0.05, ((i / lado) | 0) * 1.5 - lado * 0.75);
    g.transform.setScale(0.5);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.5));
    scene.add(g);
  }
}

function medir(n: number, frames: number): number {
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    scene.update(DT);
    scene.resolveCollisions();
    scene.computeWorld();
  }
  return (Date.now() - t0) / frames;
}

io.print("n      |  caindo (ms/frame) | assentado (ms/frame) | orcamento de 16.7ms");
io.print("-------+--------------------+----------------------+--------------------");
for (const n of [100, 250, 500, 1000, 2000]) {
  // EM MOVIMENTO: soltos no ar, caindo — ninguém dorme.
  montar(n, 8.0);
  const caindo = medir(n, 60);

  // EM REPOUSO: no chão e já assentados. Roda 240 frames antes de medir para
  // que o sleeping tenha tempo de agir (SLEEP_FRAMES), senão isto mede a queda
  // de novo e os dois números seriam o mesmo por acidente.
  montar(n, 0.25);
  medir(n, 240);
  const parado = medir(n, 60);

  const marca = caindo > 16.7 ? "  ESTOURA" : "  ok";
  io.print(
    ("" + n).padEnd(7) + "|  " +
    caindo.toFixed(2).padStart(17) + " | " +
    parado.toFixed(2).padStart(20) + " | " +
    (caindo > 0 ? (1000.0 / caindo).toFixed(0) + " fps só de fisica" : "") + marca
  );
}

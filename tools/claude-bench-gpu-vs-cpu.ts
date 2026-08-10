// CPU contra GPU, na MESMA cena e no MESMO número de frames.
//
// A pergunta é uma só: quanto custa um frame de física com N corpos em
// movimento, em cada backend. Headless — nenhuma janela, nenhum `drawMesh` —
// para que o número seja da física e de mais nada.
//
// O caminho GPU é medido pelo `rbService`, que é como o jogo o usa de verdade:
// LÊ o resultado do frame anterior e SUBMETE este sem esperar (1 frame de
// latência, como o fluido). Medir com espera daria um número que ninguém paga.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { Rigidbody } from "../scripts/rigidbody";
import { rbAvailable, rbInit, rbSetBody, rbUpload, rbService, rbSyncStatics } from "../engine/rigid/gpurigid";

const DT = 1.0 / 60.0;

function cpu(n: number, frames: number): number {
  scene.clear();
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75);
    g.transform.setScale(0.5);
    g.addBehavior(new Rigidbody(0.0 - 9.8, 0.5));
    scene.add(g);
  }
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { scene.update(DT); scene.resolveCollisions(); scene.computeWorld(); }
  return (Date.now() - t0) / frames;
}

function gpu(n: number, frames: number): number {
  rbInit(n);
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    rbSetBody(i, (i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05, (((i / lado) | 0)) * 1.5 - lado * 0.75,
              0.25, 0.25, 0.25, 1.0);
  }
  rbUpload();
  rbSyncStatics(scene);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { rbService(1); }
  return (Date.now() - t0) / frames;
}

io.print("GPU disponivel: " + (rbAvailable() !== 0 ? "sim" : "NAO — so o numero da CPU vale"));
io.print("");
io.print("   n   |   CPU ms/frame  |   GPU ms/frame  |  ganho");
io.print("-------+-----------------+-----------------+---------");
for (const n of [250, 500, 1000, 2000, 4000]) {
  const c = cpu(n, 60);
  const g = gpu(n, 60);
  const ganho = g > 0.001 ? (c / g).toFixed(1) + "x" : "—";
  io.print(("" + n).padEnd(7) + "|" + c.toFixed(2).padStart(16) + " |" + g.toFixed(2).padStart(16) + " |  " + ganho);
}

// O laço de render do editor: a forma ANTIGA contra a que está no repositório.
//
// Por que este arquivo existe, e não o `prof.txt` do editor: a seção "render 3D"
// do profiler depende de quantos objetos caem no frustum, e a câmera do editor
// segue o MOUSE REAL da máquina (`main.ts:516`). Três execuções alternadas de
// 40 s deram 13,19 / 0,34 / 5,73 ms para o MESMO código — a posição do cursor
// durante a medição vale 40×, e qualquer efeito da mudança desaparece embaixo
// disso. Aqui a câmera é um argumento e não se mexe.
//
// A comparação é honesta num ponto e limitada em outro, e os dois estão ditos:
//   - honesta: a variante NOVA é `drawSceneObjects` importada de
//     `engine/render/scenedraw.ts` — o MESMO código que o editor executa, não
//     uma cópia que envelhece.
//   - limitada: mede o regime em que os objetos são DESCARTADOS (câmera apontada
//     para longe). O caminho em que eles são desenhados chama `drawGPU`, que
//     exige janela — e é dominado pela chamada nativa, que esta mudança não
//     tocou. Ou seja: isto mede a PREPARAÇÃO, que é o que a mudança mexeu.

import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { scene } from "../editor/control/session";
import { frustumBegin, frustumParams, inFrustumFast } from "../engine/render/gpu3d";
import { drawSceneObjects, fParams } from "../engine/render/scenedraw";

const N = 500;
const F = 200;

scene.clear();
for (let i = 0; i < N; i++) {
  const g = new GameObject("o" + i);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition((i % 25) * 2 - 25, 0, ((i / 25) | 0) * 2 - 20);
  scene.add(g);
}
scene.computeWorld();
// Câmera olhando para longe da cena — tudo descartado, como "olhar para o céu".
frustumBegin(0, 5, 0, 0, 1.5, 1.0, 1.6);
frustumParams(fParams);

const objs: GameObject[] = scene.objects;
const trs: Transform[] = scene.trs;

// ── A FORMA ANTIGA, copiada de `main.ts` no commit 026c5f3 ────────────────────
// Corpo do frame, `inFrustumFast` lendo as variáveis de módulo de `gpu3d.ts`.
// Só a parte de PREPARAÇÃO: o trecho de desenho não roda neste regime (nada
// passa no frustum), então a cópia termina onde a antiga chamava `drawGPU`.
function lacoAntigo(): number {
  let oi = 0;
  let drawnN = 0;
  const objsN = objs.length;
  while (oi < objsN) {
    const o = objs[oi];
    if (o.active === 0) { oi = oi + 1; continue; }
    const tr: Transform = trs[oi];
    let rmax: f64 = tr.sx;
    if (tr.sy > rmax) rmax = tr.sy;
    if (tr.sz > rmax) rmax = tr.sz;
    if (inFrustumFast(tr.wx, tr.wy, tr.wz, rmax * 0.87) === 0) { oi = oi + 1; continue; }
    drawnN = drawnN + 1;
    oi = oi + 1;
  }
  return drawnN;
}

function medir(nome: string, corpo: () => number): number {
  const t0 = Date.now();
  let acc = 0;
  for (let f = 0; f < F; f++) acc = acc + corpo();
  const ms = (Date.now() - t0) / F;
  io.print("  " + nome.padEnd(38) + ms.toFixed(3).padStart(7) + " ms/frame   (" +
           (ms * 1000000.0 / N).toFixed(0) + " ns/objeto)   desenhados=" + (acc / F));
  return ms;
}

io.print("laco de render, " + N + " objetos, " + F + " frames, camera FIXA:");
const a = medir("ANTIGO (corpo do frame)", lacoAntigo);
const b = medir("NOVO (funcao livre tipada)", () => {
  return drawSceneObjects(objs, trs, objs.length, scene, 0, 0 - 1, 0.0,
    fParams[0], fParams[1], fParams[2], fParams[3], fParams[4],
    fParams[5], fParams[6], fParams[7], fParams[8]);
});
io.print("");
io.print("  razao ANTIGO/NOVO: " + (a / b).toFixed(2) + "x");
// Os dois têm de concordar no número de desenhados, senão a comparação é entre
// duas coisas diferentes. Neste regime ambos devem responder 0.

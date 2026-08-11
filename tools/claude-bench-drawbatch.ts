// O custo das TRAVESSIAS de desenho: 500 chamadas por frame contra 1.
//
// Por que este arquivo e não `claude-bench-render-loop.ts`: aquele mede o regime
// em que os objetos são DESCARTADOS (câmera apontada para longe) e o próprio
// cabeçalho dele diz que o caminho de desenho "exige janela e é dominado pela
// chamada nativa, que esta mudança não tocou". Esta mudança toca exatamente essa
// chamada, então precisa do regime oposto: janela aberta, câmera fixa APONTADA
// para a cena, todos os objetos passando no frustum e sendo desenhados.
//
// A câmera é fixa e nunca lê o mouse — a lição registrada no outro bench, onde
// três execuções do MESMO código deram 13,19 / 0,34 / 5,73 ms porque a câmera
// seguia o cursor.
//
// O frame inteiro é medido (beginFrame → desenho → endFrame) porque é o número
// que o editor paga. A diferença entre as duas variantes é só quantas travessias
// TS→nativo o meio delas faz.

import io from "../compat/io.ts";
import { openWindow, pump, isOpen, close, beginFrame, endFrame } from "rts:egui";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { scene } from "../editor/control/session";
import { initMeshes, setCam, setLgt, setVsync, frustumBegin, frustumParams } from "../engine/render/gpu3d";
import { drawSceneObjects, fParams, setDrawBatch } from "../engine/render/scenedraw";

const N = 500;
const F = 300;

const win = openWindow("bench drawbatch", 1000, 620, 0);
if (win <= 0) {
  io.print("openWindow devolveu 0 — sem janela não há o que medir");
} else {
  initMeshes(win);
  // VSYNC OFF: com ele o frame fica preso no present e um ganho de CPU vira
  // espera, nao fps. E o mesmo motivo do comando ws `vsync 0`.
  setVsync(win, 0);

  scene.clear();
  for (let i = 0; i < N; i++) {
    const g = new GameObject("o" + i);
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition((i % 25) * 2 - 25, 0, ((i / 25) | 0) * 2 - 20);
    scene.add(g);
  }
  scene.computeWorld();

  const objs: GameObject[] = scene.objects;
  const trs: Transform[] = scene.trs;

  // Câmera FIXA olhando PARA a cena: yaw 0 olha para +Z, e os objetos estão em
  // z de -20 a 20, então a câmera fica atrás deles em z negativo.
  setLgt(win, 10.0, 30.0, -20.0, 0.35);
  frustumBegin(0.0, 26.0, -62.0, 0.0, 0.0 - 0.35, 1.0, 1.6);
  frustumParams(fParams);

  // Os dois caminhos no MESMO binário e na mesma execução: entre dois builds o
  // ruído da máquina é maior que o efeito que se procura.
  function medir(nome: string, lote: number): number {
    setDrawBatch(lote);
    let desenhados = 0;
    let frames = 0;
    // Aquecimento: o primeiro frame cria pipeline, textura e instance buffer, e
    // entraria inteiro na média do caminho que rodasse primeiro.
    let w = 0;
    while (w < 30 && isOpen(win)) {
      pump(win); beginFrame(win);
      setCam(win, 0.0, 26.0, 0.0 - 62.0, 0.0, 0.0 - 0.35, 1.0, 1.6);
      drawSceneObjects(objs, trs, objs.length, scene, win, 0 - 1, 0.0,
        fParams[0], fParams[1], fParams[2], fParams[3], fParams[4],
        fParams[5], fParams[6], fParams[7], fParams[8]);
      endFrame(win); w = w + 1;
    }
    // CRONÔMETRO SÓ NA EMISSÃO. O frame inteiro é dominado pelo present/vsync —
    // as duas variantes mediram 21 e 24 ms de frame completo, e a diferença que
    // se procura (uns poucos ms de travessia) fica embaixo do ruído da
    // apresentação. `beginFrame`/`endFrame` ficam FORA do relógio de propósito:
    // eles não mudaram, e é o laço de emissão que esta mudança tocou.
    let acc: f64 = 0.0;
    const tf0 = Date.now();
    while (frames < F && isOpen(win)) {
      pump(win);
      beginFrame(win);
      setCam(win, 0.0, 26.0, 0.0 - 62.0, 0.0, 0.0 - 0.35, 1.0, 1.6);
      const e0 = performance.now();
      desenhados = drawSceneObjects(objs, trs, objs.length, scene, win, 0 - 1, 0.0,
        fParams[0], fParams[1], fParams[2], fParams[3], fParams[4],
        fParams[5], fParams[6], fParams[7], fParams[8]);
      acc = acc + (performance.now() - e0);
      endFrame(win);
      frames = frames + 1;
    }
    const ms = acc / frames;
    const frameMs = (Date.now() - tf0) / frames;
    io.print("  " + nome.padEnd(30) + ms.toFixed(3).padStart(8) + " ms emissao   " +
             frameMs.toFixed(2).padStart(6) + " ms frame   desenhados=" + desenhados + "/" + N);
    return ms;
  }

  io.print("");
  io.print("  " + N + " objetos, " + F + " frames, camera FIXA — SO a emissao:");
  // Alternado e repetido: a ordem importa (cache, clock da GPU), e uma execução
  // só de cada não distingue efeito de deriva.
  const a1 = medir("POR OBJETO (drawMesh xN)", 0);
  const b1 = medir("EM LOTE (drawMeshBatch x1)", 1);
  const a2 = medir("POR OBJETO (2a vez)", 0);
  const b2 = medir("EM LOTE (2a vez)", 1);
  const a = (a1 + a2) * 0.5;
  const b = (b1 + b2) * 0.5;
  io.print("");
  io.print("  media POR OBJETO             : " + a.toFixed(3) + " ms");
  io.print("  media EM LOTE                : " + b.toFixed(3) + " ms");
  io.print("  razao POR-OBJETO / LOTE      : " + (a / b).toFixed(2) + "x");
  io.print("  economizado por frame        : " + (a - b).toFixed(3) + " ms");
  close(win);
}

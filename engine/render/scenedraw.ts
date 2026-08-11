// O laço de render da cena, fora de `main.ts`.
//
// Ele saiu de lá por uma razão de MEDIÇÃO antes de qualquer razão de estilo: no
// corpo do frame não há como medi-lo sem abrir uma janela e sem depender de para
// onde a câmera está apontada — e a câmera do editor segue o mouse REAL da
// máquina (`main.ts:516`), então duas execuções de 40 s sem supervisão dão
// números que diferem 40×. Num módulo, `tools/claude-bench-render-loop.ts`
// chama exatamente a função que o editor chama, com a câmera fixa.

import { GameObject } from "../core/gameobject";
import { Transform } from "../core/transform";
import { Scene } from "../core/scene";
import { renderX, renderY, renderZ } from "../core/interpolate";
import { drawGPU, drawGPUMesh } from "./gpu3d";

/// Os 9 números do frustum, buffer REAPROVEITADO entre frames: alocar um array
/// por frame para transportar nove doubles poria pressão de GC no caminho do
/// render. Lido uma vez por frame, FORA do laço — que é a diferença que importa.
export const fParams: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/// O laço de render da cena, como FUNÇÃO LIVRE de parâmetros TIPADOS.
///
/// MEDIDO (release, `tools/claude-bench-lacoprep.ts`), 500 objetos apontando
/// para o céu — onde nada é desenhado e o laço roda inteiro:
///
///     3. inFrustumFast no corpo do frame      2,910 ms/frame  (5820 ns/objeto)
///     4. mesma aritmética "inline"            2,810 ms/frame  (5620 ns/objeto)
///     5. mesma aritmética em função livre     0,920 ms/frame  (1840 ns/objeto)
///
/// 3× com a conta IDÊNTICA, e `engine/core/scene.ts` já vivia disso:
/// `computeWorldInto` e `resolveInto` são funções livres pelo mesmo motivo.
///
/// O QUE de fato custa, porque "função livre" sozinho não explica: a variante 4
/// é inline e NÃO ganha nada. O que ela tem em comum com a 3 é ler o frustum de
/// VARIÁVEL DE MÓDULO (em `gpu3d.ts` na 3; em `const` de topo capturado pela
/// closure na 4). A 5 recebe os mesmos números por PARÂMETRO. É o mesmo achado
/// que rendeu 39% em `resolveCollisions` na semana passada: uma leitura de
/// escopo de módulo dentro do laço quente não é um imediato, é uma leitura.
///
/// Por isso TUDO aqui entra por parâmetro — inclusive `win`, `selected` e
/// `alpha`, que eram `WIN`, `S.selected` e uma local do frame — e o `drawnN`
/// SAI pelo retorno em vez de ser escrito em `S` de dentro do laço.
///
/// O frustum chega por valor e a aritmética de `inFrustumFast` está aberta aqui:
/// é a única duplicação da mudança, e é deliberada. Chamar `inFrustumFast` de
/// dentro custaria de volta as leituras de módulo que são o objeto do exercício;
/// `frustumParams` garante que os NÚMEROS venham de uma fonte só, mesmo com a
/// conta escrita em dois lugares. Se o teste de frustum mudar, muda nos dois.
export function drawSceneObjects(objs: GameObject[], trs: Transform[], n: number,
                          sc: Scene, win: number, selected: number, alpha: f64,
                          cx: f64, cy: f64, cz: f64,
                          cyw: f64, syw: f64, cpt: f64, spt: f64,
                          tanH: f64, tanV: f64): number {
  let drawnN = 0;
  let oi = 0;
  while (oi < n) {
    const o: GameObject = objs[oi];
    // ORDEM IMPORTA: descarte barato primeiro. Inativo sai já; a visibilidade é
    // testada ANTES do dispatch virtual do MeshRenderer/Material, que era pago
    // por objeto mesmo pros que nem seriam desenhados.
    if (o.active === 0) { oi = oi + 1; continue; }
    const tr: Transform = trs[oi];   // espelho: evita o hop `o.transform`
    let rmax: f64 = tr.sx;
    if (tr.sy > rmax) rmax = tr.sy;
    if (tr.sz > rmax) rmax = tr.sz;
    // `inFrustumFast(tr.wx, tr.wy, tr.wz, rmax * 0.87)`, aberto (ver acima).
    const r: f64 = rmax * 0.87;
    const dx: f64 = tr.wx - cx; const dy: f64 = tr.wy - cy; const dz: f64 = tr.wz - cz;
    const x1: f64 = dx * cyw - dz * syw;
    const z1: f64 = dx * syw + dz * cyw;
    const y2: f64 = dy * cpt - z1 * spt;
    const z2: f64 = dy * spt + z1 * cpt;
    if (z2 + r < 0.1) { oi = oi + 1; continue; }          // atrás do near
    if (z2 - r > 500.0) { oi = oi + 1; continue; }        // além do far
    const limH: f64 = z2 * tanH;
    if (x1 - r > limH) { oi = oi + 1; continue; }
    if (0.0 - x1 - r > limH) { oi = oi + 1; continue; }
    const limV: f64 = z2 * tanV;
    if (y2 - r > limV) { oi = oi + 1; continue; }
    if (0.0 - y2 - r > limV) { oi = oi + 1; continue; }

    // GEOMETRIA: do component MeshRenderer (rendIdx cacheado, O(1)) quando existe;
    // senão fallback pros campos legado do GameObject (cenas sem MeshRenderer).
    let meshKind = o.meshKind;
    let customMesh = o.customMesh;
    if (o.rendIdx >= 0) {
      const rd = o.behaviors[o.rendIdx];
      meshKind = rd.rMeshKind() | 0;
      customMesh = rd.rCustomMesh() | 0;
    }
    if (meshKind !== 0 || customMesh > 0) {
      let rr = o.cr | 0; let gg = o.cg | 0; let bbv = o.cb | 0;
      // Selecionado (ou na multi-seleção) = dourado. O teste é O(1) via flag no
      // próprio objeto: antes varria S.selection INTEIRA por objeto visível.
      if (o.selFlag !== 0 || oi === selected) { rr = 255; gg = 230; bbv = 120; }
      const col = (rr << 16) | (gg << 8) | bbv;
      // APARÊNCIA: se o objeto tem um component Material (matIdx cacheado, O(1)),
      // ele manda; senão fallback pros campos do GameObject.
      // tex: imagem real (id>=2) tem prioridade sobre o procedural (0/1).
      let texArg = o.tex;
      if (o.textureId > 0) texArg = o.textureId;
      let emisArg = o.emissive;
      if (o.matIdx >= 0) {
        const m = o.behaviors[o.matIdx];
        const tid = m.matTexId() | 0;
        if (tid > 0) texArg = tid; else texArg = m.matTexMode();
        emisArg = m.matEmissive();
      }
      // POSIÇÃO DE RENDER, não a da simulação. Com passo fixo o frame quase nunca
      // cai em cima de um passo, e desenhar sempre o último estado faz o
      // movimento tremer. `alpha` é a fração que sobrou no acumulador.
      // `tr.wx/wy/wz` seguem intactos: a simulação é a verdade, e é ela que a
      // colisão, o gizmo e o `state` do WebSocket leem. Ver interpolate.ts.
      const rx = renderX(sc, oi, alpha);
      const ry = renderY(sc, oi, alpha);
      const rz = renderZ(sc, oi, alpha);
      if (customMesh > 0) {
        drawGPUMesh(win, customMesh, rx, ry, rz,
          tr.wrx, tr.wry, tr.sx, tr.sy, tr.sz, col, emisArg, texArg);
      } else {
        drawGPU(win, meshKind, rx, ry, rz,
          tr.wrx, tr.wry, tr.sx, tr.sy, tr.sz, col, emisArg, texArg);
      }
      drawnN = drawnN + 1;
    }
    oi = oi + 1;
  }
  return drawnN;
}


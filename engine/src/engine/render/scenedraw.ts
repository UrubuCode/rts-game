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
import { drawGPUMeshBuf, drawBatch, meshIdFor, meshRadius, frustumNear, frustumFar,
         DRAW_FLOATS, D_X, D_Y, D_Z, D_RX, D_RY, D_SX, D_SY, D_SZ, D_COR, D_EMISSIVO, D_TEX, D_TILE, D_MATERIAL } from "./gpu3d";
import { resolveMaterialTexture } from "./material_tex";
import { resolvePbrMaterial } from "./pbr_material";

// ── LOTE: os buffers de instância, REAPROVEITADOS entre frames ──────────────
//
// 8 floats (x,y,z,rx,ry,sx,sy,sz) + 4 inteiros (mesh,color,emissive,tex) por
// objeto. Dois arrays e não um: uma cor `0xAARRGGBB` com alpha passa de 2^24 e
// não é exata em f32 — voltaria com o canal errado. Alocar por frame poria
// pressão de GC no caminho do render, que é o mesmo motivo pelo qual `fParams`
// já é reaproveitado; crescem por dobra e nunca encolhem.
let bufT: Float32Array = new Float32Array(0);
let bufC: Uint32Array = new Uint32Array(0);

function garanteCapacidade(n: number): void {
  if (bufC.length >= n * 4) return;
  let cap = 64;
  while (cap < n) cap = cap * 2;
  bufT = new Float32Array(cap * 8);
  bufC = new Uint32Array(cap * 4);
}

// Qual caminho de emissão o laço usa. Existe para o bench medir os DOIS no MESMO
// binário — entre dois builds o ruído é maior que o efeito — e não é uma opção
// de jogo: o editor usa o lote, que é o default.
let emitirEmLote = 1;
// Views do lote do quadro anterior (reaproveitadas enquanto o tamanho não muda).
let viewT: Float32Array = new Float32Array(0);
let viewC: Uint32Array = new Uint32Array(0);
let viewN = 0 - 1;
/// Transform/material do desenho individual (DRAW_FLOATS), reaproveitado.
const drawBuf = new Float64Array(DRAW_FLOATS);
/// Posição de render de quem se desenha sozinho (Skeleton), reaproveitada.
const posSelf = new Float64Array(3);

/// `cfg` de `drawSceneObjects`: [0] selecionado, [1] alpha, [2..10] os 9 números de `fParams`.
export const DS_SEL = 0; export const DS_ALPHA = 1; export const DS_F = 2;
export const DS_FLOATS = 11;
/// Preenche `cfg` com a seleção, o alpha e o frustum `fp` (os 9 números de `fParams`).
export function prepararDesenho(cfg: Float64Array, fp: f64[], selected: number, alpha: f64): void {
  cfg[DS_SEL] = selected; cfg[DS_ALPHA] = alpha;
  let i = 0;
  while (i < 9) { cfg[DS_F + i] = fp[i]; i = i + 1; }
}
export function setDrawBatch(on: number): void { emitirEmLote = on; }

/// Os 9 números do frustum, buffer REAPROVEITADO entre frames: alocar um array
/// por frame para transportar nove doubles poria pressão de GC no caminho do
/// render. Lido uma vez por frame, FORA do laço — que é a diferença que importa.
export const fParams: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
/// SEGUNDA vista na mesma fila (a prévia da câmera do editor): o objeto fora do
/// frustum principal ainda é desenhado se estiver dentro deste. Mesmo formato
/// de `fParams` + [9] near, [10] far; [7] < 0 = sem descarte (ortográfica).
/// Lido UMA vez por chamada, fora do laço (ver o cabeçalho de drawSceneObjects).
export const fParams2: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let segundaVista = 0;
/// 1 = `fParams2` vale neste frame (o editor liga só com a prévia desenhada).
export function definirSegundaVista(on: number): void { segundaVista = on; }

/// Cor 0xRRGGBB de um objeto selecionado no editor (dourado) — a mesma para
/// malhas e para renderers que se desenham sozinhos (Skeleton).
const SELECTED_COLOR: number = (255 << 16) | (230 << 8) | 120;

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
///
/// Task 10.5: eram 16 parâmetros, e 5+ parâmetros alocam por chamada no RTS.
/// O frustum, a seleção e o alpha chegam em `cfg` (ver `prepararDesenho`) e são
/// lidos para LOCAIS aqui, uma vez por chamada — o que o parágrafo acima pede
/// (nada de leitura de módulo dentro do laço) continua valendo.
export function drawSceneObjects(sc: Scene, n: number, win: number, cfg: Float64Array): number {
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const selected: number = cfg[DS_SEL]; const alpha: f64 = cfg[DS_ALPHA];
  const cx: f64 = cfg[DS_F]; const cy: f64 = cfg[DS_F + 1]; const cz: f64 = cfg[DS_F + 2];
  const cyw: f64 = cfg[DS_F + 3]; const syw: f64 = cfg[DS_F + 4]; const cpt: f64 = cfg[DS_F + 5]; const spt: f64 = cfg[DS_F + 6];
  const tanH: f64 = cfg[DS_F + 7]; const tanV: f64 = cfg[DS_F + 8];
  let drawnN = 0;
  // Near/far do frustum preparado em gpu3d (frustumBegin/frustumBeginBuf):
  // uma leitura por chamada, fora do laço.
  const fNear: f64 = frustumNear(); const fFar: f64 = frustumFar();
  // Segunda vista (prévia): em locais, uma leitura por chamada.
  const seg: boolean = segundaVista !== 0;
  const s2x: f64 = fParams2[0]; const s2y: f64 = fParams2[1]; const s2z: f64 = fParams2[2];
  const s2cyw: f64 = fParams2[3]; const s2syw: f64 = fParams2[4]; const s2cpt: f64 = fParams2[5]; const s2spt: f64 = fParams2[6];
  const s2tanH: f64 = fParams2[7]; const s2tanV: f64 = fParams2[8]; const s2near: f64 = fParams2[9]; const s2far: f64 = fParams2[10];
  // Entradas no lote: difere de drawnN quando um objeto com tiling vai pelo
  // desenho individual (o lote não carrega `tile`).
  let loteN = 0;
  let oi = 0;
  if (emitirEmLote !== 0) garanteCapacidade(n);
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
    // `inFrustumFast(tr.wx, tr.wy, tr.wz, rmax * raio)`, aberto (ver acima).
    //
    // O RAIO É DA MALHA, e 0.87 (`sqrt(3)/2`, o cubo unitário) só vale para as
    // primitivas. Um `.obj` de dois metros com escala 1 tem raio 1,0 e sumia da
    // borda da tela antes de sair do campo de visão — o culling o descartava
    // por um raio que não era o dele.
    //
    // Só o mesh CUSTOM consulta a tabela, e o campo lido é `customMesh`, que é
    // um campo simples do objeto. Resolver o `MeshRenderer` aqui seria pagar um
    // despacho virtual por objeto INVISÍVEL, que é exatamente o que a ordem
    // deste laço existe para evitar (ver o comentário acima). Um custom mesh
    // pendurado num `MeshRenderer` continua com o raio da primitiva — está
    // errado por menos, e consertá-lo custa a medição que o cabeçalho descreve.
    // Um renderer que se desenha sozinho (Skeleton) publica o próprio raio em
    // `boundRadius` (campo simples, sem despacho) — centrado nos pés, cobre o
    // personagem inteiro.
    const r: f64 = rmax * (o.boundRadius > 0.0 ? o.boundRadius : (o.customMesh > 0 ? meshRadius(o.customMesh) : 0.87));
    const dx: f64 = tr.wx - cx; const dy: f64 = tr.wy - cy; const dz: f64 = tr.wz - cz;
    const x1: f64 = dx * cyw - dz * syw;
    const z1: f64 = dx * syw + dz * cyw;
    const y2: f64 = dy * cpt - z1 * spt;
    const z2: f64 = dy * spt + z1 * cpt;
    // tanH < 0 = várias vistas (ver camera_views.frustumDasVistas): sem descarte.
    if (tanH >= 0.0) {
      const limH: f64 = z2 * tanH;
      const limV: f64 = z2 * tanV;
      // atrás do near, além do far, fora dos lados
      let fora: boolean = z2 + r < fNear || z2 - r > fFar || x1 - r > limH || 0.0 - x1 - r > limH ||
        y2 - r > limV || 0.0 - y2 - r > limV;
      // fora da vista principal: ainda pode aparecer na segunda (mesma conta, aberta)
      if (fora && seg) {
        if (s2tanH < 0.0) fora = false;
        else {
          const ex: f64 = tr.wx - s2x; const ey: f64 = tr.wy - s2y; const ez: f64 = tr.wz - s2z;
          const ex1: f64 = ex * s2cyw - ez * s2syw;
          const ez1: f64 = ex * s2syw + ez * s2cyw;
          const ey2: f64 = ey * s2cpt - ez1 * s2spt;
          const ez2: f64 = ey * s2spt + ez1 * s2cpt;
          const lh: f64 = ez2 * s2tanH; const lv: f64 = ez2 * s2tanV;
          fora = ez2 + r < s2near || ez2 - r > s2far || ex1 - r > lh || 0.0 - ex1 - r > lh || ey2 - r > lv || 0.0 - ey2 - r > lv;
        }
      }
      if (fora) { oi = oi + 1; continue; }
    }

    // RENDERER QUE SE DESENHA (Skeleton: várias peças por objeto, rotação em
    // quaternion). Não entra no lote; conta como um objeto desenhado.
    // Mesma posição de RENDER e mesmo destaque de seleção dos demais objetos.
    if (o.rendIdx >= 0 && o.behaviors[o.rendIdx].drawsSelf() !== 0) {
      const tint = o.selFlag !== 0 || oi === selected ? SELECTED_COLOR : 0 - 1;
      posSelf[0] = renderX(sc, oi, alpha); posSelf[1] = renderY(sc, oi, alpha); posSelf[2] = renderZ(sc, oi, alpha);
      if (o.behaviors[o.rendIdx].drawSelf(win, posSelf, tint) !== 0) {
        drawnN = drawnN + 1; oi = oi + 1; continue;
      }
    }

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
      // Selecionado (ou na multi-seleção) = dourado. O teste é O(1) via flag no
      // próprio objeto: antes varria S.selection INTEIRA por objeto visível.
      const col = o.selFlag !== 0 || oi === selected ? SELECTED_COLOR : ((o.cr | 0) << 16) | ((o.cg | 0) << 8) | (o.cb | 0);
      // APARÊNCIA: se o objeto tem um component Material (matIdx cacheado, O(1)),
      // ele manda; senão fallback pros campos do GameObject.
      // tex: imagem real (id>=2) tem prioridade sobre o procedural (0/1).
      let texArg = o.tex;
      if (o.textureId > 0) texArg = o.textureId;
      let emisArg = o.emissive;
      let tileArg = 0.0;
      let materialArg = 0;
      if (o.matIdx >= 0) {
        const m = o.behaviors[o.matIdx];
        const tid = resolveMaterialTexture(win, m);
        if (m.matPbr() !== 0) materialArg = resolvePbrMaterial(win, m);
        tileArg = m.matTile();
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
      // Tiling não viaja no lote (4 códigos por objeto): quem tem vai pelo
      // desenho individual, que carrega o `tile`.
      if (emitirEmLote !== 0 && tileArg <= 0.0 && materialArg === 0) {
        // ACUMULA. A escrita num array tipado é local; o que ela substitui é uma
        // ida ao nativo por objeto, e é essa a diferença que a medição procura.
        const ft = loteN * 8;
        bufT[ft] = rx; bufT[ft + 1] = ry; bufT[ft + 2] = rz;
        bufT[ft + 3] = tr.wrx; bufT[ft + 4] = tr.wry;
        bufT[ft + 5] = tr.sx; bufT[ft + 6] = tr.sy; bufT[ft + 7] = tr.sz;
        const ct = loteN * 4;
        bufC[ct] = customMesh > 0 ? customMesh : meshIdFor(meshKind);
        bufC[ct + 1] = col;
        bufC[ct + 2] = emisArg;
        // `tex` negativo vira um u32 gigante no array tipado, onde o caminho por
        // objeto fazia `tex.max(0)` do lado Rust. O resultado VISÍVEL seria o
        // mesmo (id inexistente = sem textura), mas igual por acidente não é
        // igual: o pedido é que o editor desenhe idêntico.
        bufC[ct + 3] = texArg < 0 ? 0 : texArg;
        loteN = loteN + 1;
      } else {
        const d = drawBuf;
        d[D_X] = rx; d[D_Y] = ry; d[D_Z] = rz; d[D_RX] = tr.wrx; d[D_RY] = tr.wry;
        d[D_SX] = tr.sx; d[D_SY] = tr.sy; d[D_SZ] = tr.sz;
        d[D_MATERIAL] = materialArg;
        d[D_COR] = col; d[D_EMISSIVO] = emisArg; d[D_TEX] = texArg; d[D_TILE] = tileArg;
        drawGPUMeshBuf(win, customMesh > 0 ? customMesh : meshIdFor(meshKind), d);
      }
      drawnN = drawnN + 1;
    }
    oi = oi + 1;
  }
  // UMA travessia com o que sobreviveu ao frustum. O `subarray` é uma view sobre
  // o mesmo buffer — não copia — e é o que impede o nativo de ler as sobras do
  // frame anterior, que continuam no fim do array reaproveitado.
  if (emitirEmLote !== 0 && loteN > 0) {
    // As views só são refeitas quando o tamanho do lote (ou o buffer) muda: com a
    // cena parada, nenhuma view nova por quadro.
    if (loteN !== viewN || viewT.buffer !== bufT.buffer) {
      viewT = bufT.subarray(0, loteN * 8); viewC = bufC.subarray(0, loteN * 4); viewN = loteN;
    }
    drawBatch(win, viewT, viewC);
  }
  return drawnN;
}


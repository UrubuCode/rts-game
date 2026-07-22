// Engine RTS — renderer de MESH genérico (data-driven) sobre o rasterizador.
//
// Geometria em arrays de módulo (verts achatado [x,y,z,...] + faces achatado
// [a,b,c,...] triângulos). Um único drawMeshSolid projeta os N vértices, e por
// triângulo: normal em ESPAÇO-OBJETO apontada pra FORA (dot com o centróide),
// rotacionada pro mundo → shading; z-buffer resolve oclusão (sem backface cull,
// correto pra sólidos convexos). meshKind: 1=cubo, 2=pirâmide, 3=octaedro.
//
// Funções top-level lendo consts de módulo (arrays) — ok desde o fix de gcell.

import math from "rts:math";
import { fillTri } from "./raster";

// ── geometria (espaço-objeto, meia-extensão ~0.5..0.6; multiplicada por scale) ─
const CUBE_V: f64[] = [
  -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  -0.5,0.5,-0.5,  0.5,0.5,-0.5,
  -0.5,-0.5,0.5,   0.5,-0.5,0.5,   -0.5,0.5,0.5,   0.5,0.5,0.5
];
const CUBE_F: number[] = [
  1,3,7, 1,7,5,   0,4,6, 0,6,2,   2,6,7, 2,7,3,
  0,1,5, 0,5,4,   4,5,7, 4,7,6,   0,2,3, 0,3,1
];
const PYRA_V: f64[] = [
  -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5,-0.5,0.5,  -0.5,-0.5,0.5,  0.0,0.6,0.0
];
const PYRA_F: number[] = [
  0,1,2, 0,2,3,   0,1,4, 1,2,4, 2,3,4, 3,0,4
];
const OCTA_V: f64[] = [
  0.6,0.0,0.0,  -0.6,0.0,0.0,  0.0,0.6,0.0,  0.0,-0.6,0.0,  0.0,0.0,0.6,  0.0,0.0,-0.6
];
const OCTA_F: number[] = [
  2,0,4, 2,4,1, 2,1,5, 2,5,0,   3,4,0, 3,1,4, 3,5,1, 3,0,5
];

/// Desenha um mesh sólido sombreado do tipo `kind` em (ox,oy,oz), rotado (rx,ry),
/// escala `scale`, cor base (br,bg,bb). Escreve no framebuffer + z-buffer.
export function drawMeshSolid(
  fbuf: i64, zbuf: i64, W: number, H: number,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  ox: f64, oy: f64, oz: f64, rx: f64, ry: f64, scale: f64,
  kind: number, br: number, bg: number, bb: number
): void {
  // seleciona a geometria pelo tipo
  let V: f64[] = CUBE_V;
  let F: number[] = CUBE_F;
  let nv = 8;
  let nf = 12;
  if (kind === 2) { V = PYRA_V; F = PYRA_F; nv = 5; nf = 6; }
  if (kind === 3) { V = OCTA_V; F = OCTA_F; nv = 6; nf = 8; }

  const cyw = math.cos(cyaw); const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch); const spt = math.sin(cpitch);
  const cor = math.cos(ry); const sor = math.sin(ry);
  const cxr = math.cos(rx); const sxr = math.sin(rx);
  const halfW: f64 = W * 0.5; const halfH: f64 = H * 0.5;

  // por vértice: tela (sx,sy), profundidade (cz) e posição espaço-objeto (ovx..)
  const sxA: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
  const syA: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
  const czA: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
  const ovx: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
  const ovy: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
  const ovz: f64[] = [0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];

  let i = 0;
  while (i < nv) {
    const lx: f64 = V[i * 3] * scale;
    const ly: f64 = V[i * 3 + 1] * scale;
    const lz: f64 = V[i * 3 + 2] * scale;
    ovx[i] = lx; ovy[i] = ly; ovz[i] = lz;
    // rotação do objeto (Y depois X)
    const r1x = lx * cor + lz * sor;
    const r1z = 0 - lx * sor + lz * cor;
    const r2y = ly * cxr - r1z * sxr;
    const r2z = ly * sxr + r1z * cxr;
    const wx = ox + r1x; const wy = oy + r2y; const wz = oz + r2z;
    const dx = wx - camx; const dy = wy - camy; const dz = wz - camz;
    const x1 = dx * cyw - dz * syw;
    const z1 = dx * syw + dz * cyw;
    const y2 = dy * cpt - z1 * spt;
    const z2 = dy * spt + z1 * cpt;
    czA[i] = z2;
    let zz: f64 = z2; if (zz < 0.05) zz = 0.05;
    sxA[i] = halfW + (x1 / zz) * focal;
    syA[i] = halfH - (y2 / zz) * focal;
    i = i + 1;
  }

  const lgx: f64 = 0.40; const lgy: f64 = 0.82; const lgz: f64 = 0.41;

  let f = 0;
  while (f < nf) {
    const a = F[f * 3]; const b = F[f * 3 + 1]; const c = F[f * 3 + 2];
    if (czA[a] > 0.05 && czA[b] > 0.05 && czA[c] > 0.05) {
      // normal em espaço-objeto via cross((B-A),(C-A))
      const e1x = ovx[b] - ovx[a]; const e1y = ovy[b] - ovy[a]; const e1z = ovz[b] - ovz[a];
      const e2x = ovx[c] - ovx[a]; const e2y = ovy[c] - ovy[a]; const e2z = ovz[c] - ovz[a];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      // aponta pra FORA: centróide da face (espaço-objeto, centro na origem)
      const cxo = (ovx[a] + ovx[b] + ovx[c]);
      const cyo = (ovy[a] + ovy[b] + ovy[c]);
      const czo = (ovz[a] + ovz[b] + ovz[c]);
      if (nx * cxo + ny * cyo + nz * czo < 0) { nx = 0 - nx; ny = 0 - ny; nz = 0 - nz; }
      // rotaciona a normal pro mundo (Y depois X) e normaliza
      const rn1x = nx * cor + nz * sor;
      const rn1z = 0 - nx * sor + nz * cor;
      const wny = ny * cxr - rn1z * sxr;
      const wnz = ny * sxr + rn1z * cxr;
      const wnx = rn1x;
      const len: f64 = math.sqrt(wnx * wnx + wny * wny + wnz * wnz);
      let sh: f64 = 0.0;
      if (len > 0.0001) sh = (wnx * lgx + wny * lgy + wnz * lgz) / len;
      if (sh < 0) sh = 0;
      const lit: f64 = 0.28 + 0.72 * sh;
      let cr = br * lit; let cg = bg * lit; let cbv = bb * lit;
      if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cbv > 255) cbv = 255;
      const col = (cr | 0) | ((cg | 0) << 8) | ((cbv | 0) << 16) | (0xFF << 24);
      fillTri(fbuf, zbuf, W, H,
        sxA[a], syA[a], czA[a], sxA[b], syA[b], czA[b], sxA[c], syA[c], czA[c], col);
    }
    f = f + 1;
  }
}

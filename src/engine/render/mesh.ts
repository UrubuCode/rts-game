// Engine RTS — renderer de MESH genérico (data-driven) sobre o rasterizador.
//
// Geometria em arrays de módulo (verts achatado [x,y,z,...] + faces achatado
// [a,b,c,...] triângulos). Um único drawMeshSolid projeta os N vértices, e por
// triângulo: normal em ESPAÇO-OBJETO apontada pra FORA (dot com o centróide),
// rotacionada pro mundo → shading; z-buffer resolve oclusão (sem backface cull,
// correto pra sólidos convexos). meshKind: 1=cubo, 2=pirâmide, 3=octaedro, 4=esfera.
//
// Funções top-level lendo/escrevendo arrays de módulo — ok desde o fix de gcell.

import math from "../../compat/math.ts";
import { fillTri } from "./raster";

// ── geometria fixa (espaço-objeto, meia-extensão ~0.5) ───────────────────────
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

// ── ESFERA gerada por lat/long (UV sphere) no init do módulo ─────────────────
const PI: f64 = 3.14159265358979;
const LAT = 6;    // aneis
const LON = 9;   // fatias
const SPH_V: f64[] = [];
const SPH_F: number[] = [];
function buildSphere(): void {
  let i = 0;
  while (i <= LAT) {
    const theta: f64 = PI * (i / LAT);
    const st: f64 = math.sin(theta);
    const ct: f64 = math.cos(theta);
    let j = 0;
    while (j < LON) {
      const phi: f64 = 2.0 * PI * (j / LON);
      SPH_V.push(0.5 * st * math.cos(phi));
      SPH_V.push(0.5 * ct);
      SPH_V.push(0.5 * st * math.sin(phi));
      j = j + 1;
    }
    i = i + 1;
  }
  let ri = 0;
  while (ri < LAT) {
    let j = 0;
    while (j < LON) {
      let jn = j + 1;
      if (jn >= LON) jn = 0;
      const a = ri * LON + j;
      const b = ri * LON + jn;
      const c = (ri + 1) * LON + jn;
      const d = (ri + 1) * LON + j;
      SPH_F.push(a); SPH_F.push(b); SPH_F.push(c);
      SPH_F.push(a); SPH_F.push(c); SPH_F.push(d);
      j = j + 1;
    }
    ri = ri + 1;
  }
}
buildSphere();

// ── scratch por vértice (nível de módulo, reusado a cada chamada) ────────────
const MAXV = 160;
function zerosF(n: number): f64[] { const a: f64[] = []; let i = 0; while (i < n) { a.push(0.0); i = i + 1; } return a; }
// ── luz direcional + ambiente (controláveis) ─────────────────────────────────
let LGX: f64 = 0.40; let LGY: f64 = 0.82; let LGZ: f64 = 0.41;  // direção da luz (norm.)
let AMBIENT: f64 = 0.28;   // piso de iluminação (0 = sombra preta, 1 = sem sombra)

/// Define a direção da luz direcional (será normalizada). Estilo Directional Light.
export function setLight(x: f64, y: f64, z: f64): void {
  const len: f64 = math.sqrt(x * x + y * y + z * z);
  if (len > 0.0001) { LGX = x / len; LGY = y / len; LGZ = z / len; }
}
/// Define o nível de luz ambiente (0..1).
export function setAmbient(a: f64): void {
  AMBIENT = a;
}

const sxA: f64[] = zerosF(MAXV);
const syA: f64[] = zerosF(MAXV);
const czA: f64[] = zerosF(MAXV);
const ovx: f64[] = zerosF(MAXV);
const ovy: f64[] = zerosF(MAXV);
const ovz: f64[] = zerosF(MAXV);

/// Desenha um mesh sólido sombreado do tipo `kind` em (ox,oy,oz), rotado (rx,ry),
/// escala `scale`, cor base (br,bg,bb). Escreve no framebuffer + z-buffer.
export function drawMeshSolid(
  fbuf: i64, zbuf: i64, W: number, H: number,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  ox: f64, oy: f64, oz: f64, rx: f64, ry: f64, scale: f64,
  kind: number, br: number, bg: number, bb: number
): void {
  let V: f64[] = CUBE_V;
  let F: number[] = CUBE_F;
  if (kind === 2) { V = PYRA_V; F = PYRA_F; }
  if (kind === 3) { V = OCTA_V; F = OCTA_F; }
  if (kind === 4) { V = SPH_V; F = SPH_F; }
  const nv = V.length / 3;
  const nf = F.length / 3;

  const cyw = math.cos(cyaw); const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch); const spt = math.sin(cpitch);
  const cor = math.cos(ry); const sor = math.sin(ry);
  const cxr = math.cos(rx); const sxr = math.sin(rx);
  const halfW: f64 = W * 0.5; const halfH: f64 = H * 0.5;

  // aliasa os arrays de scratch de MÓDULO pra locais: 1 gcell_get por array aqui,
  // depois acesso DIRETO (sem extern por elemento) — evita o gargalo de perf.
  const _sx = sxA; const _sy = syA; const _cz = czA;
  const _ox = ovx; const _oy = ovy; const _oz = ovz;
  const lgx = LGX; const lgy = LGY; const lgz = LGZ; const amb = AMBIENT;

  let i = 0;
  while (i < nv) {
    const lx: f64 = V[i * 3] * scale;
    const ly: f64 = V[i * 3 + 1] * scale;
    const lz: f64 = V[i * 3 + 2] * scale;
    _ox[i] = lx; _oy[i] = ly; _oz[i] = lz;
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
    _cz[i] = z2;
    let zz: f64 = z2; if (zz < 0.05) zz = 0.05;
    _sx[i] = halfW + (x1 / zz) * focal;
    _sy[i] = halfH - (y2 / zz) * focal;
    i = i + 1;
  }



  let f = 0;
  while (f < nf) {
    const a = F[f * 3]; const b = F[f * 3 + 1]; const c = F[f * 3 + 2];
    if (_cz[a] > 0.05 && _cz[b] > 0.05 && _cz[c] > 0.05) {
      const e1x = _ox[b] - _ox[a]; const e1y = _oy[b] - _oy[a]; const e1z = _oz[b] - _oz[a];
      const e2x = _ox[c] - _ox[a]; const e2y = _oy[c] - _oy[a]; const e2z = _oz[c] - _oz[a];
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const cxo = (_ox[a] + _ox[b] + _ox[c]);
      const cyo = (_oy[a] + _oy[b] + _oy[c]);
      const czo = (_oz[a] + _oz[b] + _oz[c]);
      if (nx * cxo + ny * cyo + nz * czo < 0) { nx = 0 - nx; ny = 0 - ny; nz = 0 - nz; }
      const rn1x = nx * cor + nz * sor;
      const rn1z = 0 - nx * sor + nz * cor;
      const wny = ny * cxr - rn1z * sxr;
      const wnz = ny * sxr + rn1z * cxr;
      const wnx = rn1x;
      const len: f64 = math.sqrt(wnx * wnx + wny * wny + wnz * wnz);
      let sh: f64 = 0.0;
      if (len > 0.0001) sh = (wnx * lgx + wny * lgy + wnz * lgz) / len;
      if (sh < 0) sh = 0;
      const lit: f64 = amb + (1.0 - amb) * sh;
      let cr = br * lit; let cg = bg * lit; let cbv = bb * lit;
      if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cbv > 255) cbv = 255;
      const col = (cr | 0) | ((cg | 0) << 8) | ((cbv | 0) << 16) | (0xFF << 24);
      fillTri(fbuf, zbuf, W, H,
        _sx[a], _sy[a], _cz[a], _sx[b], _sy[b], _cz[b], _sx[c], _sy[c], _cz[c], col);
    }
    f = f + 1;
  }
}

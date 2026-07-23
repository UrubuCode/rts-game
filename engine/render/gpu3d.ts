// Engine RTS — caminho de render 3D por GPU (pipeline wgpu no rts-egui).
//
// Em vez de rasterizar por software (raster.ts/mesh.ts), sobe as meshes pra VRAM
// UMA vez (egui.meshUpload) e por frame só manda câmera/luz + 1 drawMesh por
// objeto (egui.drawMesh) — a GPU faz projeção/rasterização/shading/depth. A UI do
// egui é composta por cima.
//
// Geometria: pos+normal interleaved (6 f32/vértice). Normais SUAVES (= posição
// normalizada) — perfeitas pra esfera; cubo/pirâmide/octaedro ficam com shading
// arredondado (ok por ora). meshKind: 1=cubo, 2=pirâmide, 3=octaedro, 4=esfera.

import egui from "rts:egui";
import buffer from "rts:buffer";
import math from "rts:math";

const PI: f64 = 3.14159265358979;

// ids das meshes na GPU (0 = não carregada)
let idCube = 0;
let idPyra = 0;
let idOcta = 0;
let idSphere = 0;
let ready = 0;

// sobe uma mesh (verts = [x,y,z,nx,ny,nz,...], inds = [i,i,i,...]) pra VRAM.
function upload(win: i64, verts: f64[], inds: number[]): number {
  const nv = verts.length / 6;
  const ni = inds.length;
  const vbuf = buffer.alloc(nv * 6 * 4);
  const ibuf = buffer.alloc(ni * 4);
  let i = 0;
  while (i < verts.length) { buffer.write_f32(vbuf, i * 4, verts[i]); i = i + 1; }
  let j = 0;
  while (j < ni) { buffer.write_i32(ibuf, j * 4, inds[j]); j = j + 1; }
  const id = egui.meshUpload(win, buffer.ptr(vbuf), nv, buffer.ptr(ibuf), ni);
  buffer.free(vbuf);
  buffer.free(ibuf);
  return id;
}

// adiciona um vértice (pos + normal suave = pos normalizada) ao array.
function pushV(a: f64[], x: f64, y: f64, z: f64): void {
  const l = math.sqrt(x * x + y * y + z * z);
  let nx = 0.0; let ny = 1.0; let nz = 0.0;
  if (l > 0.0001) { nx = x / l; ny = y / l; nz = z / l; }
  a.push(x); a.push(y); a.push(z);
  a.push(nx); a.push(ny); a.push(nz);
}

/// Sobe as 4 meshes primitivas (1×). Chame depois de abrir a janela.
export function initMeshes(win: i64): void {
  if (ready !== 0) return;

  // ── cubo ──
  const cv: f64[] = [];
  const cc: f64[] = [
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  -0.5,0.5,-0.5,  0.5,0.5,-0.5,
    -0.5,-0.5,0.5,   0.5,-0.5,0.5,   -0.5,0.5,0.5,   0.5,0.5,0.5
  ];
  let k = 0;
  while (k < 8) { pushV(cv, cc[k * 3], cc[k * 3 + 1], cc[k * 3 + 2]); k = k + 1; }
  const cf: number[] = [
    1,3,7, 1,7,5,   0,6,2, 0,4,6,   2,6,7, 2,7,3,
    0,1,5, 0,5,4,   4,5,7, 4,7,6,   0,2,3, 0,3,1
  ];
  idCube = upload(win, cv, cf);

  // ── pirâmide ──
  const pv: f64[] = [];
  const pc: f64[] = [ -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5, 0.0,0.6,0.0 ];
  let p = 0;
  while (p < 5) { pushV(pv, pc[p * 3], pc[p * 3 + 1], pc[p * 3 + 2]); p = p + 1; }
  const pf: number[] = [ 0,2,1, 0,3,2,  0,1,4, 1,2,4, 2,3,4, 3,0,4 ];
  idPyra = upload(win, pv, pf);

  // ── octaedro ──
  const ov: f64[] = [];
  const oc: f64[] = [ 0.6,0,0, -0.6,0,0, 0,0.6,0, 0,-0.6,0, 0,0,0.6, 0,0,-0.6 ];
  let o = 0;
  while (o < 6) { pushV(ov, oc[o * 3], oc[o * 3 + 1], oc[o * 3 + 2]); o = o + 1; }
  const of: number[] = [ 2,4,0, 2,1,4, 2,5,1, 2,0,5,  3,0,4, 3,4,1, 3,1,5, 3,5,0 ];
  idOcta = upload(win, ov, of);

  // ── esfera (UV lat/long, alta tesselação — a GPU aguenta) ──
  const sv: f64[] = [];
  const sf: number[] = [];
  const LAT = 16;
  const LON = 24;
  let ii = 0;
  while (ii <= LAT) {
    const theta: f64 = PI * (ii / LAT);
    const st: f64 = math.sin(theta);
    const ct: f64 = math.cos(theta);
    let jj = 0;
    while (jj < LON) {
      const phi: f64 = 2.0 * PI * (jj / LON);
      pushV(sv, 0.5 * st * math.cos(phi), 0.5 * ct, 0.5 * st * math.sin(phi));
      jj = jj + 1;
    }
    ii = ii + 1;
  }
  let ri = 0;
  while (ri < LAT) {
    let jj = 0;
    while (jj < LON) {
      let jn = jj + 1;
      if (jn >= LON) jn = 0;
      const a = ri * LON + jj;
      const b = ri * LON + jn;
      const c = (ri + 1) * LON + jn;
      const d = (ri + 1) * LON + jj;
      sf.push(a); sf.push(c); sf.push(b);
      sf.push(a); sf.push(d); sf.push(c);
      jj = jj + 1;
    }
    ri = ri + 1;
  }
  idSphere = upload(win, sv, sf);

  ready = 1;
}

/// Define a câmera do frame 3D (fly cam).
export function setCam(win: i64, cx: f64, cy: f64, cz: f64, yaw: f64, pitch: f64, fovY: f64, aspect: f64): void {
  egui.setCamera(win, cx, cy, cz, yaw, pitch, fovY, aspect);
}
/// Define a luz direcional.
export function setLgt(win: i64, dx: f64, dy: f64, dz: f64, ambient: f64): void {
  egui.setLight(win, dx, dy, dz, ambient);
}

/// Enfileira 1 objeto pra desenhar na GPU (mapeia meshKind → mesh id).
export function drawGPU(win: i64, kind: number, px: f64, py: f64, pz: f64,
                        rx: f64, ry: f64, sx: f64, sy: f64, sz: f64, color: number): void {
  let id = idCube;
  if (kind === 2) id = idPyra;
  if (kind === 3) id = idOcta;
  if (kind === 4) id = idSphere;
  egui.drawMesh(win, id, px, py, pz, rx, ry, sx, sy, sz, color);
}

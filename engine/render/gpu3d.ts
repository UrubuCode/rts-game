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

// adiciona um vértice (pos + normal suave = pos normalizada) ao array (esfera).
function pushV(a: f64[], x: f64, y: f64, z: f64): void {
  const l = math.sqrt(x * x + y * y + z * z);
  let nx = 0.0; let ny = 1.0; let nz = 0.0;
  if (l > 0.0001) { nx = x / l; ny = y / l; nz = z / l; }
  a.push(x); a.push(y); a.push(z);
  a.push(nx); a.push(ny); a.push(nz);
}

// mesh FLAT (facetada): cada face vira 3 vértices com a NORMAL DA FACE (arestas
// duras — cubo parece cubo). Winding + normal forçados pra FORA (culling ok).
function buildFlat(win: i64, corners: f64[], faces: number[]): number {
  const verts: f64[] = [];
  const inds: number[] = [];
  let f = 0;
  let vi = 0;
  while (f < faces.length) {
    const ia = faces[f]; const ib = faces[f + 1]; const ic = faces[f + 2];
    const ax = corners[ia * 3]; const ay = corners[ia * 3 + 1]; const az = corners[ia * 3 + 2];
    let bx = corners[ib * 3]; let by = corners[ib * 3 + 1]; let bz = corners[ib * 3 + 2];
    let cx = corners[ic * 3]; let cy = corners[ic * 3 + 1]; let cz = corners[ic * 3 + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    // centróide (corners centrados na origem) aponta pra fora
    const dot: f64 = nx * (ax + bx + cx) + ny * (ay + by + cy) + nz * (az + bz + cz);
    if (dot < 0) {
      const tx = bx; const ty = by; const tz = bz; bx = cx; by = cy; bz = cz; cx = tx; cy = ty; cz = tz;
      nx = 0 - nx; ny = 0 - ny; nz = 0 - nz;
    }
    const l = math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 0.0001) { nx = nx / l; ny = ny / l; nz = nz / l; }
    verts.push(ax); verts.push(ay); verts.push(az); verts.push(nx); verts.push(ny); verts.push(nz);
    verts.push(bx); verts.push(by); verts.push(bz); verts.push(nx); verts.push(ny); verts.push(nz);
    verts.push(cx); verts.push(cy); verts.push(cz); verts.push(nx); verts.push(ny); verts.push(nz);
    inds.push(vi); inds.push(vi + 1); inds.push(vi + 2);
    vi = vi + 3;
    f = f + 3;
  }
  return upload(win, verts, inds);
}

/// Sobe as 4 meshes primitivas (1×). Chame depois de abrir a janela.
export function initMeshes(win: i64): void {
  if (ready !== 0) return;

  // ── cubo / pirâmide / octaedro: FLAT (arestas duras) ──
  const cc: f64[] = [
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  -0.5,0.5,-0.5,  0.5,0.5,-0.5,
    -0.5,-0.5,0.5,   0.5,-0.5,0.5,   -0.5,0.5,0.5,   0.5,0.5,0.5
  ];
  const cf: number[] = [
    1,3,7, 1,7,5,   0,6,2, 0,4,6,   2,6,7, 2,7,3,
    0,1,5, 0,5,4,   4,5,7, 4,7,6,   0,2,3, 0,3,1
  ];
  idCube = buildFlat(win, cc, cf);

  const pc: f64[] = [ -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5,0.5, -0.5,-0.5,0.5, 0.0,0.6,0.0 ];
  const pf: number[] = [ 0,2,1, 0,3,2,  0,1,4, 1,2,4, 2,3,4, 3,0,4 ];
  idPyra = buildFlat(win, pc, pf);

  const oc: f64[] = [ 0.6,0,0, -0.6,0,0, 0,0.6,0, 0,-0.6,0, 0,0,0.6, 0,0,-0.6 ];
  const of: number[] = [ 2,4,0, 2,1,4, 2,5,1, 2,0,5,  3,0,4, 3,4,1, 3,1,5, 3,5,0 ];
  idOcta = buildFlat(win, oc, of);

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

/// Frustum culling: `true` se a esfera envolvente (centro wx,wy,wz + raio) está
/// (ao menos parcialmente) dentro do campo de visão. Engine-side, transparente —
/// pula o drawMesh de quem está atrás/fora, poupando draw calls em cenas grandes.
export function inFrustum(camx: f64, camy: f64, camz: f64, yaw: f64, pitch: f64,
                          fovY: f64, aspect: f64, wx: f64, wy: f64, wz: f64, radius: f64): number {
  const cyw = math.cos(yaw); const syw = math.sin(yaw);
  const cpt = math.cos(pitch); const spt = math.sin(pitch);
  const dx = wx - camx; const dy = wy - camy; const dz = wz - camz;
  const x1 = dx * cyw - dz * syw;
  const z1 = dx * syw + dz * cyw;
  const y2 = dy * cpt - z1 * spt;
  const z2 = dy * spt + z1 * cpt;
  if (z2 + radius < 0.1) return 0;         // atrás do near
  if (z2 - radius > 500.0) return 0;       // além do far
  const tanV: f64 = math.tan(fovY * 0.5);
  const tanH: f64 = tanV * aspect;
  if (x1 - radius > z2 * tanH) return 0;
  if (0 - x1 - radius > z2 * tanH) return 0;
  if (y2 - radius > z2 * tanV) return 0;
  if (0 - y2 - radius > z2 * tanV) return 0;
  return 1;
}

/// Enfileira 1 objeto pra desenhar na GPU (mapeia meshKind → mesh id).
export function drawGPU(win: i64, kind: number, px: f64, py: f64, pz: f64,
                        rx: f64, ry: f64, sx: f64, sy: f64, sz: f64, color: number, emissive: number): void {
  let id = idCube;
  if (kind === 2) id = idPyra;
  if (kind === 3) id = idOcta;
  if (kind === 4) id = idSphere;
  egui.drawMesh(win, id, px, py, pz, rx, ry, sx, sy, sz, color, emissive);
}

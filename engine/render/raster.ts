// Engine RTS — RASTERIZADOR software com z-buffer (faces sólidas + shading).
//
// render.* só tem rect/line/text/image (sem polígono), então desenhamos num
// FRAMEBUFFER (RGBA em buffer) + Z-BUFFER (f64 por pixel) e blitamos com
// render.image — o mesmo caminho do rtscraft. Funções top-level sobre
// handles/primitivos (dispatch de namespace provado).
//
// Cor em memória: R no byte baixo (0xAABBGGRR little-endian = RGBA).

import buffer from "../../compat/buffer.ts";
import math from "../../compat/math.ts";

// Limpa o framebuffer + z-buffer via buffer.fill (memset em Rust — 2 chamadas,
// não um loop de ~N pixels no TS). `bgGray` é um BYTE 0..255 (fundo cinza
// uniforme, RGBA = bgGray). O z vira 0x7F...7F = f64 gigante (~+infinito).
export function clearFB(fbuf: i64, zbuf: i64, npix: number, bgGray: number): void {
  buffer.fill(fbuf, bgGray, npix * 4);
  buffer.fill(zbuf, 127, npix * 8);
}

// Triângulo z-bufferizado. (ax,ay)=tela, az=profundidade de câmera (menor=perto).
// Preenche por baricentricas; escreve cor se mais perto que o z atual.
export function fillTri(
  fbuf: i64, zbuf: i64, W: number, H: number,
  ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, cx: f64, cy: f64, cz: f64,
  col: number
): void {
  const area: f64 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area > 0 - 0.0001 && area < 0.0001) return; // degenerado
  const inv: f64 = 1.0 / area;

  // bounding box (clampado à tela)
  let minx = math.floor(math.min(ax, math.min(bx, cx)));
  let maxx = math.ceil(math.max(ax, math.max(bx, cx)));
  let miny = math.floor(math.min(ay, math.min(by, cy)));
  let maxy = math.ceil(math.max(ay, math.max(by, cy)));
  if (minx < 0) minx = 0;
  if (miny < 0) miny = 0;
  if (maxx > W - 1) maxx = W - 1;
  if (maxy > H - 1) maxy = H - 1;

  let py = miny;
  while (py <= maxy) {
    const pyf: f64 = py + 0.5;
    let px = minx;
    while (px <= maxx) {
      const pxf: f64 = px + 0.5;
      // baricentricas (divididas pela área com sinal → sempre >=0 dentro)
      const l0: f64 = ((cx - bx) * (pyf - by) - (cy - by) * (pxf - bx)) * inv;
      const l1: f64 = ((ax - cx) * (pyf - cy) - (ay - cy) * (pxf - cx)) * inv;
      const l2: f64 = ((bx - ax) * (pyf - ay) - (by - ay) * (pxf - ax)) * inv;
      if (l0 >= 0 && l1 >= 0 && l2 >= 0) {
        const z: f64 = l0 * az + l1 * bz + l2 * cz;
        const off = (py * W + px) * 8;
        const zc = buffer.read_f64(zbuf, off);
        if (z < zc) {
          buffer.write_f64(zbuf, off, z);
          buffer.write_i32(fbuf, (py * W + px) * 4, col);
        }
      }
      px = px + 1;
    }
    py = py + 1;
  }
}

// Desenha um cubo SÓLIDO sombreado. Projeta os 8 cantos, culla faces de costas,
// sombreia cada face por normal·luz, rasteriza 2 triângulos por face.
export function drawCubeSolid(
  fbuf: i64, zbuf: i64, W: number, H: number,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  ox: f64, oy: f64, oz: f64, rx: f64, ry: f64, scale: f64,
  br: number, bg: number, bb: number
): void {
  const cyw = math.cos(cyaw); const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch); const spt = math.sin(cpitch);
  const cor = math.cos(ry); const sor = math.sin(ry);
  const cxr = math.cos(rx); const sxr = math.sin(rx);
  const hs = scale * 0.5;
  const halfW: f64 = W * 0.5;
  const halfH: f64 = H * 0.5;

  // por canto: sx,sy (tela), cz (prof. câmera), e pos de câmera cxp,cyp,czp
  const sxA: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const syA: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const czA: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const cxp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const cyp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const czp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];

  let ci = 0;
  while (ci < 8) {
    let lx: f64 = 0 - hs; if ((ci & 1) !== 0) lx = hs;
    let ly: f64 = 0 - hs; if ((ci & 2) !== 0) ly = hs;
    let lz: f64 = 0 - hs; if ((ci & 4) !== 0) lz = hs;
    // rotação do objeto (Y depois X)
    const r1x = lx * cor + lz * sor;
    const r1z = 0 - lx * sor + lz * cor;
    const r2y = ly * cxr - r1z * sxr;
    const r2z = ly * sxr + r1z * cxr;
    const wx = ox + r1x; const wy = oy + r2y; const wz = oz + r2z;
    // espaço de câmera
    const dx = wx - camx; const dy = wy - camy; const dz = wz - camz;
    const x1 = dx * cyw - dz * syw;
    const z1 = dx * syw + dz * cyw;
    const y2 = dy * cpt - z1 * spt;
    const z2 = dy * spt + z1 * cpt;
    cxp[ci] = x1; cyp[ci] = y2; czp[ci] = z2;
    czA[ci] = z2;
    let zz: f64 = z2; if (zz < 0.05) zz = 0.05;
    sxA[ci] = halfW + (x1 / zz) * focal;
    syA[ci] = halfH - (y2 / zz) * focal;
    ci = ci + 1;
  }

  // luz direcional (normalizada)
  const lgx: f64 = 0.40; const lgy: f64 = 0.82; const lgz: f64 = 0.41;

  // 6 faces: 4 cantos + normal local (nx,ny,nz)
  const fc: number[] = [
    1, 3, 7, 5,   0, 4, 6, 2,   2, 6, 7, 3,
    0, 1, 5, 4,   4, 5, 7, 6,   0, 2, 3, 1
  ];
  const fn: f64[] = [
    1, 0, 0,   0 - 1, 0, 0,   0, 1, 0,
    0, 0 - 1, 0,   0, 0, 1,   0, 0, 0 - 1
  ];

  let f = 0;
  while (f < 6) {
    const a = fc[f * 4]; const b = fc[f * 4 + 1];
    const c = fc[f * 4 + 2]; const d = fc[f * 4 + 3];
    // normal local rotacionada (Y depois X) → mundo
    const nlx = fn[f * 3]; const nly = fn[f * 3 + 1]; const nlz = fn[f * 3 + 2];
    const n1x = nlx * cor + nlz * sor;
    const n1z = 0 - nlx * sor + nlz * cor;
    const nwy = nly * cxr - n1z * sxr;
    const nwz = nly * sxr + n1z * cxr;
    const nwx = n1x;
    // backface cull em câmera: normal(câmera)·centro(câmera) > 0 = de costas
    const ncx = nwx * cyw - nwz * syw;
    const ncz = nwx * syw + nwz * cyw;
    const ncy = nwy * cpt - (nwx * syw + nwz * cyw) * spt; // (aprox; y só p/ shade)
    const cenX = (cxp[a] + cxp[c]) * 0.5;
    const cenY = (cyp[a] + cyp[c]) * 0.5;
    const cenZ = (czp[a] + czp[c]) * 0.5;
    const facing = ncx * cenX + ncy * cenY + ncz * cenZ;
    // só desenha faces viradas p/ câmera e à frente do near
    if (facing < 0 && czp[a] > 0.05 && czp[b] > 0.05 && czp[c] > 0.05 && czp[d] > 0.05) {
      // shading: normal(mundo)·luz
      let sh: f64 = nwx * lgx + nwy * lgy + nwz * lgz;
      if (sh < 0) sh = 0;
      const lit: f64 = 0.28 + 0.72 * sh;
      let cr = br * lit; let cg = bg * lit; let cb = bb * lit;
      if (cr > 255) cr = 255; if (cg > 255) cg = 255; if (cb > 255) cb = 255;
      const col = (cr | 0) | ((cg | 0) << 8) | ((cb | 0) << 16) | (0xFF << 24);
      // 2 triângulos (a,b,c) e (a,c,d)
      fillTri(fbuf, zbuf, W, H,
        sxA[a], syA[a], czA[a], sxA[b], syA[b], czA[b], sxA[c], syA[c], czA[c], col);
      fillTri(fbuf, zbuf, W, H,
        sxA[a], syA[a], czA[a], sxA[c], syA[c], czA[c], sxA[d], syA[d], czA[d], col);
    }
    f = f + 1;
  }
}

// Chão sólido: um grande quad no plano y=0, xadrez sutil por profundidade.
export function drawFloor(
  fbuf: i64, zbuf: i64, W: number, H: number,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  half: f64, col: number
): void {
  const cyw = math.cos(cyaw); const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch); const spt = math.sin(cpitch);
  const halfW: f64 = W * 0.5; const halfH: f64 = H * 0.5;
  // 4 cantos do quad (y=0)
  projFloorTri(fbuf, zbuf, W, H, camx, camy, camz, cyw, syw, cpt, spt, focal, halfW, halfH,
    0 - half, 0, 0 - half, half, 0, 0 - half, half, 0, half, col);
  projFloorTri(fbuf, zbuf, W, H, camx, camy, camz, cyw, syw, cpt, spt, focal, halfW, halfH,
    0 - half, 0, 0 - half, half, 0, half, 0 - half, 0, half, col);
}

function projFloorTri(
  fbuf: i64, zbuf: i64, W: number, H: number,
  camx: f64, camy: f64, camz: f64, cyw: f64, syw: f64, cpt: f64, spt: f64,
  focal: f64, halfW: f64, halfH: f64,
  ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, cx: f64, cy: f64, cz: f64,
  col: number
): void {
  const dax = ax - camx; const day = ay - camy; const daz = az - camz;
  const ax1 = dax * cyw - daz * syw; const az1 = dax * syw + daz * cyw;
  const ay2 = day * cpt - az1 * spt; const az2 = day * spt + az1 * cpt;
  const dbx = bx - camx; const dby = by - camy; const dbz = bz - camz;
  const bx1 = dbx * cyw - dbz * syw; const bz1 = dbx * syw + dbz * cyw;
  const by2 = dby * cpt - bz1 * spt; const bz2 = dby * spt + bz1 * cpt;
  const dcx = cx - camx; const dcy = cy - camy; const dcz = cz - camz;
  const cx1 = dcx * cyw - dcz * syw; const cz1 = dcx * syw + dcz * cyw;
  const cy2 = dcy * cpt - cz1 * spt; const cz2 = dcy * spt + cz1 * cpt;
  if (az2 < 0.05 || bz2 < 0.05 || cz2 < 0.05) return; // clip simples
  const asx = halfW + (ax1 / az2) * focal; const asy = halfH - (ay2 / az2) * focal;
  const bsx = halfW + (bx1 / bz2) * focal; const bsy = halfH - (by2 / bz2) * focal;
  const csx = halfW + (cx1 / cz2) * focal; const csy = halfH - (cy2 / cz2) * focal;
  fillTri(fbuf, zbuf, W, H, asx, asy, az2, bsx, bsy, bz2, csx, csy, cz2, col);
}

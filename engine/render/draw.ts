// Engine RTS — RENDER PASS 3D (software, em TS) sobre render.*.
//
// Projeção perspectiva de meshes: cada função é TOP-LEVEL e recebe só
// PRIMITIVOS (win handle i64 + números) — o motor despacha render.*/math.* bem
// nesse formato (mesmo padrão do rtscraft: extrair campos no call site e passar
// primitivos). Nenhum método sobre param tipado-classe aqui.
//
// Convenção de câmera: forward = +Z após aplicar -yaw (em torno de Y) e -pitch
// (em torno de X). Um ponto só desenha se cair na frente (z_cam > perto).

import math from "rts:math";
import render from "rts:render";


// Projeta um ponto de MUNDO pra TELA. Escreve o resultado em 3 slots de um
// buffer não — em vez disso devolvemos via um truque: retornamos sx e o chamador
// recomputa? Não. Aqui projetamos INLINE dentro de drawCube (sem cross-fn de
// múltiplos retornos, que o motor não faz bem). Esta fn fica como referência.

/// Desenha um cubo (wireframe) de lado `scale`, centrado em (cx,cy,cz), rotado
/// por (rx,ry) rad, na cor 0xRRGGBBAA `col`. `focal` = (H*0.5)/tan(fov/2).
export function drawCube(
  win: i64,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  cw: f64, ch: f64,
  cx: f64, cy: f64, cz: f64, rx: f64, ry: f64, scale: f64, col: number
): void {
  const cyw = math.cos(cyaw);
  const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch);
  const spt = math.sin(cpitch);
  const cor = math.cos(ry);
  const sor = math.sin(ry);
  const cxr = math.cos(rx);
  const sxr = math.sin(rx);
  const hs = scale * 0.5;
  const halfW = cw * 0.5;
  const halfH = ch * 0.5;

  // 8 cantos projetados → sxArr/syArr; visArr marca "na frente da câmera".
  const sxA: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const syA: f64[] = [0, 0, 0, 0, 0, 0, 0, 0];
  const viA: number[] = [0, 0, 0, 0, 0, 0, 0, 0];

  let ci = 0;
  while (ci < 8) {
    // canto local do cubo unitário em [-hs,hs]
    let lx: f64 = 0 - hs;
    if ((ci & 1) !== 0) lx = hs;
    let ly: f64 = 0 - hs;
    if ((ci & 2) !== 0) ly = hs;
    let lz: f64 = 0 - hs;
    if ((ci & 4) !== 0) lz = hs;

    // rotação do objeto: Y depois X
    const rxx = lx * cor + lz * sor;
    const rzz = 0 - lx * sor + lz * cor;
    const ryy = ly * cxr - rzz * sxr;
    const rzz2 = ly * sxr + rzz * cxr;

    // mundo
    const wx = cx + rxx;
    const wy = cy + ryy;
    const wz = cz + rzz2;

    // espaço de câmera: translada, -yaw (Y), -pitch (X)
    const dx = wx - camx;
    const dy = wy - camy;
    const dz = wz - camz;
    const x1 = dx * cyw - dz * syw;
    const z1 = dx * syw + dz * cyw;
    const y2 = dy * cpt - z1 * spt;
    const z2 = dy * spt + z1 * cpt;

    if (z2 > 0.05) {
      const sx = halfW + (x1 / z2) * focal;
      const sy = halfH - (y2 / z2) * focal;
      sxA[ci] = sx;
      syA[ci] = sy;
      viA[ci] = 1;
    }
    ci = ci + 1;
  }

  // 12 arestas (pares de índices de canto). Só desenha se ambos visíveis.
  const ea: number[] = [0,1, 1,3, 3,2, 2,0,  4,5, 5,7, 7,6, 6,4,  0,4, 1,5, 2,6, 3,7];
  let ei = 0;
  while (ei < 24) {
    const a = ea[ei];
    const b = ea[ei + 1];
    if (viA[a] !== 0 && viA[b] !== 0) {
      render.line(win, sxA[a], syA[a], sxA[b], syA[b], 2, col);
    }
    ei = ei + 2;
  }
}

/// Grid de chão no plano y=0, de -n..n em passos de 1. Ajuda a "sentir" o 3D.
export function drawGrid(
  win: i64,
  camx: f64, camy: f64, camz: f64, cyaw: f64, cpitch: f64, focal: f64,
  cw: f64, ch: f64, n: number, col: number
): void {
  const cyw = math.cos(cyaw);
  const syw = math.sin(cyaw);
  const cpt = math.cos(cpitch);
  const spt = math.sin(cpitch);
  const halfW = cw * 0.5;
  const halfH = ch * 0.5;
  let i = 0 - n;
  while (i <= n) {
    // duas linhas: paralela a X e paralela a Z, cada uma projetada por 2 pontos
    // linha ao longo de Z (x fixo = i)
    drawSeg(win, i, 0, 0 - n, i, 0, n, camx, camy, camz, cyw, syw, cpt, spt, focal, halfW, halfH, col);
    // linha ao longo de X (z fixo = i)
    drawSeg(win, 0 - n, 0, i, n, 0, i, camx, camy, camz, cyw, syw, cpt, spt, focal, halfW, halfH, col);
    i = i + 1;
  }
}

// Projeta e desenha 1 segmento de mundo (a→b). Interno ao drawGrid.
function drawSeg(
  win: i64, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64,
  camx: f64, camy: f64, camz: f64, cyw: f64, syw: f64, cpt: f64, spt: f64,
  focal: f64, halfW: f64, halfH: f64, col: number
): void {
  const dax = ax - camx; const day = ay - camy; const daz = az - camz;
  const ax1 = dax * cyw - daz * syw;
  const az1 = dax * syw + daz * cyw;
  const ay2 = day * cpt - az1 * spt;
  const az2 = day * spt + az1 * cpt;
  const dbx = bx - camx; const dby = by - camy; const dbz = bz - camz;
  const bx1 = dbx * cyw - dbz * syw;
  const bz1 = dbx * syw + dbz * cyw;
  const by2 = dby * cpt - bz1 * spt;
  const bz2 = dby * spt + bz1 * cpt;
  if (az2 <= 0.05) return;
  if (bz2 <= 0.05) return;
  const asx = halfW + (ax1 / az2) * focal;
  const asy = halfH - (ay2 / az2) * focal;
  const bsx = halfW + (bx1 / bz2) * focal;
  const bsy = halfH - (by2 / bz2) * focal;
  render.line(win, asx, asy, bsx, bsy, 1, col);
}

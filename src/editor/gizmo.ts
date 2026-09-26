// Editor RTS — Gizmo de manipulação de objeto na viewport (estilo Unity).
// Só a MATEMÁTICA pura (sem desenho): o main.ts projeta o centro do objeto + as
// pontas dos 3 eixos pra tela, desenha as linhas coloridas (X vermelho/Y verde/Z
// azul) com `app.line`, e usa estas funções pra (a) descobrir qual eixo o mouse
// pegou e (b) converter o arrasto do mouse em movimento restrito ao eixo.
//
// Ferramentas (S.tool): 0=nenhuma/seleção, 1=Move, 2=Rotate, 3=Scale.

export const TOOL_NONE: number = 0;
export const TOOL_MOVE: number = 1;
export const TOOL_ROTATE: number = 2;
export const TOOL_SCALE: number = 3;

/// Radianos de rotação por unidade de mundo arrastada ao longo do eixo (objeto e osso).
export const GIZMO_ROTATE_PER_UNIT: f64 = 0.5;
/// Passos do snap (S.snap): movimento em unidades de mundo, rotação em radianos (15°).
export const SNAP_MOVE_STEP: f64 = 0.5;
export const SNAP_ROTATE_STEP: f64 = 0.2618;

// ── VISTA: a câmera da tela num buffer (Task 10.5) ─────────────────────────
// As funções abaixo tinham 7 a 13 parâmetros escalares e devolviam um array
// novo por chamada; 5+ parâmetros alocam por chamada no RTS, e o anel do gizmo
// de rotação chamava `projPt` 144 vezes por quadro. Agora a câmera vai num
// Float64Array preenchido uma vez por quadro e as saídas num buffer do chamador.
/// Layout da vista: camX, camY, camZ, cos(yaw), sin(yaw), cos(pitch), sin(pitch), focal, W, H.
export const VISTA_FLOATS: number = 10;
/// Distância (unidades de mundo) do ponto à frente da câmera quando o raio não acha o chão.
export const FORWARD_DROP_DIST: f64 = 12.0;
/// Buffer do gizmo 2D (pickAxis/axisMove): centro, pontas X/Y/Z na tela e comprimento de mundo dos eixos.
export const GIZMO_FLOATS: number = 9;
export const GZ_LEN = 8;

// Projeta um ponto de MUNDO `p` = [x, y, z] → TELA. `out` = [sx, sy, ok] (ok=0 se
// atrás da câmera). Puro — o main.ts liga os pontos (rings do gizmo rotate).
export function projPt(out: Float64Array, v: Float64Array, p: Float64Array): void {
  const dx = p[0] - v[0]; const dy = p[1] - v[1]; const dz = p[2] - v[2];
  const cyw = v[3]; const syw = v[4]; const cpt2 = v[5]; const spt2 = v[6];
  const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
  const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
  if (z2 <= 0.2) { out[0] = 0.0; out[1] = 0.0; out[2] = 0.0; return; }
  out[0] = v[8] * 0.5 + (x1 / z2) * v[7]; out[1] = v[9] * 0.5 - (y2 / z2) * v[7]; out[2] = 1.0;
}

// Direção (não normalizada) do raio da câmera pelo pixel (sx, sy), em `out[0..2]`.
function raioDaTela(out: Float64Array, v: Float64Array, sx: f64, sy: f64): void {
  // desfaz a perspectiva: em espaço de câmera, um raio com z2=1 tem
  // x1 = (sx - W/2)/focalW  e  y2 = (H/2 - sy)/focalW.
  const rx1 = (sx - v[8] * 0.5) / v[7];
  const ry2 = (v[9] * 0.5 - sy) / v[7];
  const rz2: f64 = 1.0;
  const cyw = v[3]; const syw = v[4]; const cpt2 = v[5]; const spt2 = v[6];
  // desfaz o PITCH (a direta era: y2 = dy*cpt2 - z1*spt2; z2 = dy*spt2 + z1*cpt2)
  const rdy = ry2 * cpt2 + rz2 * spt2;
  const rz1 = rz2 * cpt2 - ry2 * spt2;
  // desfaz o YAW (a direta era: x1 = dx*cyw - dz*syw; z1 = dx*syw + dz*cyw)
  out[0] = rx1 * cyw + rz1 * syw;
  out[1] = rdy;
  out[2] = rz1 * cyw - rx1 * syw;
}

/// INVERSO de projPt: TELA → ponto no MUNDO sobre o chão (plano Y = 0).
/// Usado pelo drag & drop do Project (soltar um asset na viewport cai no chão,
/// como na Unity). `out` = [wx, wy, wz, ok] (ok=0 quando o raio é paralelo ao
/// plano ou aponta pro lado oposto — ex.: mirando o céu).
export function screenToGround(out: Float64Array, v: Float64Array, sx: f64, sy: f64): void {
  raioDaTela(out, v, sx, sy);
  const rdx = out[0]; const rdy = out[1]; const rdz = out[2];
  out[0] = 0.0; out[1] = 0.0; out[2] = 0.0; out[3] = 0.0;
  if (rdy > 0.0 - 0.0001 && rdy < 0.0001) return;
  const t = (0.0 - v[1]) / rdy;
  if (t <= 0.0) return;
  out[0] = v[0] + rdx * t; out[1] = 0.0; out[2] = v[2] + rdz * t; out[3] = 1.0;
}

/// Ponto no mundo a FORWARD_DROP_DIST unidades à frente da câmera, na direção do
/// cursor. Fallback do drop quando o raio não encontra o chão. `out` = [x, y, z, 1].
export function screenToForward(out: Float64Array, v: Float64Array, sx: f64, sy: f64): void {
  raioDaTela(out, v, sx, sy);
  const rdx = out[0]; const rdy = out[1]; const rdz = out[2];
  // normaliza pra distância ser em unidades de mundo de verdade
  let len = rdx * rdx + rdy * rdy + rdz * rdz;
  if (len < 0.000001) len = 1.0;
  // sqrt por Newton (evita importar math só pra isto)
  let s = len;
  let k = 0;
  while (k < 12) { s = (s + len / s) * 0.5; k = k + 1; }
  out[0] = v[0] + (rdx / s) * FORWARD_DROP_DIST; out[1] = v[1] + (rdy / s) * FORWARD_DROP_DIST;
  out[2] = v[2] + (rdz / s) * FORWARD_DROP_DIST; out[3] = 1.0;
}

// Arredonda `v` pro múltiplo mais próximo de `step` (snap to grid). step<=0 → v.
export function snapv(v: f64, step: f64): f64 {
  if (step <= 0.0) return v;
  const n = v / step;
  // round: floor(n+0.5) (n pode ser negativo)
  const r = n >= 0.0 ? ((n + 0.5) | 0) : (0 - ((0.5 - n) | 0));
  return (r * 1.0) * step;
}

// distância² de um ponto (px,py) ao segmento do centro do gizmo (g[0],g[1]) à
// ponta do eixo `eixo` (g[2+2e], g[3+2e]).
export function segDist2(px: f64, py: f64, g: Float64Array, eixo: number): f64 {
  const ax = g[0]; const ay = g[1];
  const vx = g[2 + eixo * 2] - ax; const vy = g[3 + eixo * 2] - ay;
  const wx = px - ax; const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t: f64 = 0.0;
  if (len2 > 0.0001) t = (wx * vx + wy * vy) / len2;
  if (t < 0.0) t = 0.0;
  if (t > 1.0) t = 1.0;
  const cx = ax + vx * t; const cy = ay + vy * t;
  const ex = px - cx; const ey = py - cy;
  return ex * ex + ey * ey;
}

// Qual eixo o mouse (mx,my) está sobre? `g` = buffer do gizmo (GIZMO_FLOATS:
// centro projetado + pontas de X/Y/Z). Devolve 0=X, 1=Y, 2=Z, ou -1 se nenhum
// dentro do limiar de ~10px. Escolhe o mais próximo.
export function pickAxis(mx: f64, my: f64, g: Float64Array): number {
  const thresh2: f64 = 100.0;   // 10px²
  let best = 0 - 1;
  let bestD: f64 = thresh2;
  const dx = segDist2(mx, my, g, 0);
  if (dx < bestD) { bestD = dx; best = 0; }
  const dy = segDist2(mx, my, g, 1);
  if (dy < bestD) { bestD = dy; best = 1; }
  const dz = segDist2(mx, my, g, 2);
  if (dz < bestD) { bestD = dz; best = 2; }
  return best;
}

// Quanto mover no MUNDO ao longo do eixo `eixo` (0..2), dado o delta do mouse
// (mdx,mdy) e o buffer do gizmo `g`: a ponta de tela do eixo e o comprimento de
// mundo g[GZ_LEN] que esse segmento representa. Projeta o delta do mouse na
// direção de tela do eixo e converte pra unidades de mundo.
export function axisMove(mdx: f64, mdy: f64, g: Float64Array, eixo: number): f64 {
  const ax = g[2 + eixo * 2] - g[0]; const ay = g[3 + eixo * 2] - g[1];
  const screenLen2 = ax * ax + ay * ay;
  if (screenLen2 < 0.5) return 0.0;
  const screenLen = math_sqrt(screenLen2);
  // projeção escalar do delta do mouse na direção unitária do eixo (em px)
  const amountPx: f64 = (mdx * ax + mdy * ay) / screenLen;
  // px → mundo: worldLen corresponde a screenLen px
  return amountPx * (g[GZ_LEN] / screenLen);
}

// sqrt local (evita import de math só pra isto)
function math_sqrt(v: f64): f64 {
  if (v <= 0.0) return 0.0;
  let g: f64 = v;
  let i = 0;
  while (i < 20) { g = 0.5 * (g + v / g); i = i + 1; }
  return g;
}

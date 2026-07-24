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

// Projeta um ponto de MUNDO → TELA. Retorna [sx, sy, ok] (ok=0 se atrás da
// câmera). Puro — o main.ts liga os pontos com app.line (rings do gizmo rotate).
export function projPt(wx: f64, wy: f64, wz: f64, camX: f64, camY: f64, camZ: f64,
                       cyw: f64, syw: f64, cpt2: f64, spt2: f64, focalW: f64, W: f64, H: f64): f64[] {
  const dx = wx - camX; const dy = wy - camY; const dz = wz - camZ;
  const x1 = dx * cyw - dz * syw; const z1 = dx * syw + dz * cyw;
  const y2 = dy * cpt2 - z1 * spt2; const z2 = dy * spt2 + z1 * cpt2;
  if (z2 <= 0.2) { const bad: f64[] = [0.0, 0.0, 0.0]; return bad; }
  const out: f64[] = [W * 0.5 + (x1 / z2) * focalW, H * 0.5 - (y2 / z2) * focalW, 1.0];
  return out;
}

// distância² de um ponto (px,py) ao segmento (ax,ay)-(bx,by).
export function segDist2(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64): f64 {
  const vx = bx - ax; const vy = by - ay;
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

// Qual eixo o mouse (mx,my) está sobre? Recebe o centro projetado (ox,oy) + as
// pontas projetadas de X/Y/Z. Devolve 0=X, 1=Y, 2=Z, ou -1 se nenhum dentro do
// limiar de ~10px. Escolhe o mais próximo.
export function pickAxis(mx: f64, my: f64, ox: f64, oy: f64,
                         xex: f64, xey: f64, yex: f64, yey: f64, zex: f64, zey: f64): number {
  const thresh2: f64 = 100.0;   // 10px²
  let best = 0 - 1;
  let bestD: f64 = thresh2;
  const dx = segDist2(mx, my, ox, oy, xex, xey);
  if (dx < bestD) { bestD = dx; best = 0; }
  const dy = segDist2(mx, my, ox, oy, yex, yey);
  if (dy < bestD) { bestD = dy; best = 1; }
  const dz = segDist2(mx, my, ox, oy, zex, zey);
  if (dz < bestD) { bestD = dz; best = 2; }
  return best;
}

// Quanto mover no MUNDO ao longo de um eixo, dado o delta do mouse (mdx,mdy) e as
// pontas de tela do eixo (do centro (ox,oy) até (aex,aey)) + o comprimento de
// mundo `worldLen` que esse segmento representa. Projeta o delta do mouse na
// direção de tela do eixo e converte pra unidades de mundo.
export function axisMove(mdx: f64, mdy: f64, ox: f64, oy: f64, aex: f64, aey: f64, worldLen: f64): f64 {
  const ax = aex - ox; const ay = aey - oy;
  const screenLen2 = ax * ax + ay * ay;
  if (screenLen2 < 0.5) return 0.0;
  const screenLen = math_sqrt(screenLen2);
  // projeção escalar do delta do mouse na direção unitária do eixo (em px)
  const amountPx: f64 = (mdx * ax + mdy * ay) / screenLen;
  // px → mundo: worldLen corresponde a screenLen px
  return amountPx * (worldLen / screenLen);
}

// sqrt local (evita import de math só pra isto)
function math_sqrt(v: f64): f64 {
  if (v <= 0.0) return 0.0;
  let g: f64 = v;
  let i = 0;
  while (i < 20) { g = 0.5 * (g + v / g); i = i + 1; }
  return g;
}

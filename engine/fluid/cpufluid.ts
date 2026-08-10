// ═══════════════════════════════════════════════════════════════════════════
// FLUIDO CPU — backend de CPU da fachada engine/fluid/fluid.ts.
//
// As MESMAS equações do kernel WGSL (gpufluid.ts), linha a linha: densidade
// poly6, pressão simétrica, viscosidade, near-pressure de Clavet, teto de
// velocidade, colisão com AABBs da cena com absorção. Um backend precisa ser
// TROCÁVEL pelo outro sem a água mudar de comportamento — por isso as
// constantes são idênticas e qualquer ajuste tem que ser feito NOS DOIS.
//
// Arrays achatados de módulo + funções livres com parâmetros anotados (laço
// quente nunca em método — lição #1999; hoje o hoist bastaria, mas função
// livre roda rápido em QUALQUER versão do runtime).
//
// LIMITE: força-bruta O(n²) — é o FALLBACK para máquina sem GPU, dimensionado
// para até ~1.000 partículas (93 ns/par medido => n=1024 ≈ 8 ms/frame;
// n=4096 ≈ 6 SEGUNDOS/frame). Jogo em fallback deve reduzir o n; um grid
// espacial aqui só vale se o fallback virar caminho de primeira classe.
// ═══════════════════════════════════════════════════════════════════════════
import math from "../../compat/math.ts";

import { Scene } from "../core/scene";
import { GameObject, COL_BOX } from "../core/gameobject";
import { Transform } from "../core/transform";

// Constantes ESPELHO do kernel WGSL — mudou lá, muda aqui.
const CF_H: f64 = 0.45;
const CF_H2: f64 = 0.2025;
const CF_DT: f64 = 1.0 / 240.0;
const CF_RADIUS: f64 = 0.16;
const CF_STIFF: f64 = 90.0;
const CF_VISC: f64 = 4.0;
const CF_HHALF: f64 = 0.2475;      // H * 0.55
const CF_NEAR: f64 = 55.0;
const CF_VMAX: f64 = 14.0;
const CF_MAX_COLLIDERS = 768;

let cfN = 0;
const cfPX: f64[] = [];
const cfPY: f64[] = [];
const cfPZ: f64[] = [];
const cfVX: f64[] = [];
const cfVY: f64[] = [];
const cfVZ: f64[] = [];
const cfD: f64[] = [];
let cfRest: f64 = 0.0;

// colisores AABB (centro + meia-extensão), achatados
const cfCX: f64[] = [];
const cfCY: f64[] = [];
const cfCZ: f64[] = [];
const cfHX: f64[] = [];
const cfHY: f64[] = [];
const cfHZ: f64[] = [];
let cfM = 0;

export function cfCount(): number { return cfN; }
export function cfX(i: number): f64 { return cfPX[i]; }
export function cfY(i: number): f64 { return cfPY[i]; }
export function cfZ(i: number): f64 { return cfPZ[i]; }
export function cfVelX(i: number): f64 { return cfVX[i]; }
export function cfVelY(i: number): f64 { return cfVY[i]; }
export function cfVelZ(i: number): f64 { return cfVZ[i]; }
/// Na CPU ninguém é cortado do desenho (contagens pequenas — o culling de
/// casca só paga na escala em que a GPU já teria sido escolhida).
export function cfHidden(i: number): number { return 0; }

export function cfInit(n: number): number {
  cfN = n;
  cfPX.length = 0; cfPY.length = 0; cfPZ.length = 0;
  cfVX.length = 0; cfVY.length = 0; cfVZ.length = 0;
  cfD.length = 0;
  let i = 0;
  while (i < n) {
    cfPX.push(0.0); cfPY.push(0.0); cfPZ.push(0.0);
    cfVX.push(0.0); cfVY.push(0.0); cfVZ.push(0.0);
    cfD.push(0.0);
    i = i + 1;
  }
  return 1;
}

/// Escreve direto o estado de uma partícula (spawn e HANDOFF entre backends).
export function cfSetState(i: number, x: f64, y: f64, z: f64,
                           vx: f64, vy: f64, vz: f64): void {
  cfPX[i] = x; cfPY[i] = y; cfPZ[i] = z;
  cfVX[i] = vx; cfVY[i] = vy; cfVZ[i] = vz;
}

export function cfSpawnBlock(cols: number, rows: number, layers: number,
                             x0: f64, y0: f64, z0: f64, spacing: f64): void {
  let i = 0;
  let c = 0;
  while (c < cols) {
    let r = 0;
    while (r < rows) {
      let l = 0;
      while (l < layers) {
        if (i < cfN) {
          cfSetState(i, x0 + c * spacing, y0 + r * spacing, z0 + l * spacing,
                     0.0, 0.0, 0.0);
        }
        i = i + 1;
        l = l + 1;
      }
      r = r + 1;
    }
    c = c + 1;
  }
  // REST calibrada na grade (mesma regra do backend GPU: 85% da média)
  if (cfRest === 0.0) {
    densityPass(cfPX, cfPY, cfPZ, cfD, cfN);
    let acc: f64 = 0.0;
    let k = 0;
    while (k < cfN) { acc = acc + cfD[k]; k = k + 1; }
    cfRest = (acc / cfN) * 0.85;
  }
}

export function cfSyncColliders(sc: Scene): void {
  const objs: GameObject[] = sc.objects;
  const trs: Transform[] = sc.trs;
  const n = objs.length;
  cfCX.length = 0; cfCY.length = 0; cfCZ.length = 0;
  cfHX.length = 0; cfHY.length = 0; cfHZ.length = 0;
  let m = 0;
  let i = 0;
  while (i < n && m < CF_MAX_COLLIDERS) {
    const o: GameObject = objs[i];
    if (o.colShape === COL_BOX && o.active !== 0) {
      const t: Transform = trs[i];
      cfCX.push(t.wx); cfCY.push(t.wy); cfCZ.push(t.wz);
      cfHX.push(t.sx * 0.5); cfHY.push(t.sy * 0.5); cfHZ.push(t.sz * 0.5);
      m = m + 1;
    }
    i = i + 1;
  }
  cfM = m;
}

/// Passe de densidade (poly6 sobre H², como o kernel WGSL).
function densityPass(px: f64[], py: f64[], pz: f64[], d: f64[], n: number): void {
  let i = 0;
  while (i < n) {
    const ax = px[i]; const ay = py[i]; const az = pz[i];
    let acc: f64 = 0.0;
    let j = 0;
    while (j < n) {
      const dx = ax - px[j]; const dy = ay - py[j]; const dz = az - pz[j];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < CF_H2) { const w = CF_H2 - r2; acc = acc + w * w * w; }
      j = j + 1;
    }
    d[i] = acc;
    i = i + 1;
  }
}

/// Força + integração + colisão com o mundo (espelho do kernel de força).
function forcePass(px: f64[], py: f64[], pz: f64[],
                   vx: f64[], vy: f64[], vz: f64[], d: f64[], n: number,
                   rest: f64,
                   ccx: f64[], ccy: f64[], ccz: f64[],
                   chx: f64[], chy: f64[], chz: f64[], m: number): void {
  let i = 0;
  while (i < n) {
    const ax = px[i]; const ay = py[i]; const az = pz[i];
    const avx = vx[i]; const avy = vy[i]; const avz = vz[i];
    const di = d[i];
    let pi = di - rest;
    if (pi < 0.0) pi = 0.0;
    pi = pi * CF_STIFF;
    let fx: f64 = 0.0;
    let fy: f64 = 0.0 - 9.8;
    let fz: f64 = 0.0;
    let j = 0;
    while (j < n) {
      if (j !== i) {
        const dx = ax - px[j]; const dy = ay - py[j]; const dz = az - pz[j];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < CF_H2 && r2 > 0.000001) {
          const r = math.sqrt(r2);
          let dj = d[j];
          if (dj < 0.0001) dj = 0.0001;
          let pj = d[j] - rest;
          if (pj < 0.0) pj = 0.0;
          pj = pj * CF_STIFF;
          const push = (pi + pj) * 0.5 * (CF_H - r) * (CF_H - r) / dj;
          fx = fx + dx * (push / r);
          fy = fy + dy * (push / r);
          fz = fz + dz * (push / r);
          const vk = CF_VISC * (CF_H - r) / dj;
          fx = fx + (vx[j] - avx) * vk;
          fy = fy + (vy[j] - avy) * vk;
          fz = fz + (vz[j] - avz) * vk;
          if (r < CF_HHALF) {
            const q = 1.0 - r / CF_HHALF;
            const nk = CF_NEAR * q * q / r;
            fx = fx + dx * nk;
            fy = fy + dy * nk;
            fz = fz + dz * nk;
          }
        }
      }
      j = j + 1;
    }
    let nvx = avx + fx * CF_DT;
    let nvy = avy + fy * CF_DT;
    let nvz = avz + fz * CF_DT;
    const sp2 = nvx * nvx + nvy * nvy + nvz * nvz;
    if (sp2 > CF_VMAX * CF_VMAX) {
      const sc = CF_VMAX / math.sqrt(sp2);
      nvx = nvx * sc; nvy = nvy * sc; nvz = nvz * sc;
    }
    let nx = ax + nvx * CF_DT;
    let ny = ay + nvy * CF_DT;
    let nz = az + nvz * CF_DT;
    // colisão com AABBs (ponto mais próximo; absorve como o kernel)
    let k = 0;
    while (k < m) {
      let cpx = nx; let cpy = ny; let cpz = nz;
      const lx = ccx[k] - chx[k]; const hxk = ccx[k] + chx[k];
      const ly = ccy[k] - chy[k]; const hyk = ccy[k] + chy[k];
      const lz = ccz[k] - chz[k]; const hzk = ccz[k] + chz[k];
      if (cpx < lx) cpx = lx; if (cpx > hxk) cpx = hxk;
      if (cpy < ly) cpy = ly; if (cpy > hyk) cpy = hyk;
      if (cpz < lz) cpz = lz; if (cpz > hzk) cpz = hzk;
      const dxc = nx - cpx; const dyc = ny - cpy; const dzc = nz - cpz;
      const d2 = dxc * dxc + dyc * dyc + dzc * dzc;
      if (d2 < CF_RADIUS * CF_RADIUS) {
        if (d2 > 0.000001) {
          const dd = math.sqrt(d2);
          const nxn = dxc / dd; const nyn = dyc / dd; const nzn = dzc / dd;
          nx = cpx + nxn * CF_RADIUS;
          ny = cpy + nyn * CF_RADIUS;
          nz = cpz + nzn * CF_RADIUS;
          const vn = nvx * nxn + nvy * nyn + nvz * nzn;
          if (vn < 0.0) {
            nvx = nvx - nxn * (vn * 1.2);
            nvy = nvy - nyn * (vn * 1.2);
            nvz = nvz - nzn * (vn * 1.2);
          }
        } else {
          // centro dentro da caixa: sai pela face mais rasa
          const qx = (chx[k] + CF_RADIUS) - (nx > ccx[k] ? nx - ccx[k] : ccx[k] - nx);
          const qy = (chy[k] + CF_RADIUS) - (ny > ccy[k] ? ny - ccy[k] : ccy[k] - ny);
          const qz = (chz[k] + CF_RADIUS) - (nz > ccz[k] ? nz - ccz[k] : ccz[k] - nz);
          if (qx < qy && qx < qz) {
            nx = ccx[k] + (nx >= ccx[k] ? 1.0 : 0.0 - 1.0) * (chx[k] + CF_RADIUS);
            nvx = nvx * (0.0 - 0.2);
          } else if (qy < qz) {
            ny = ccy[k] + (ny >= ccy[k] ? 1.0 : 0.0 - 1.0) * (chy[k] + CF_RADIUS);
            nvy = nvy * (0.0 - 0.2);
          } else {
            nz = ccz[k] + (nz >= ccz[k] ? 1.0 : 0.0 - 1.0) * (chz[k] + CF_RADIUS);
            nvz = nvz * (0.0 - 0.2);
          }
        }
      }
      k = k + 1;
    }
    if (ny < 0.0 - 20.0) { ny = 0.0 - 20.0; nvy = 0.0; }
    px[i] = nx; py[i] = ny; pz[i] = nz;
    vx[i] = nvx; vy[i] = nvy; vz[i] = nvz;
    i = i + 1;
  }
}

/// Fixa a densidade de repouso vinda do outro backend (handoff).
export function cfSetRest(v: f64): void { cfRest = v; }
export function cfRestDensity(): f64 { return cfRest; }

export function cfStep(substeps: number): void {
  let s = 0;
  while (s < substeps) {
    densityPass(cfPX, cfPY, cfPZ, cfD, cfN);
    forcePass(cfPX, cfPY, cfPZ, cfVX, cfVY, cfVZ, cfD, cfN, cfRest,
              cfCX, cfCY, cfCZ, cfHX, cfHY, cfHZ, cfM);
    s = s + 1;
  }
}

// ONDE estão os 9,3 ms de `resolveCollisions` — por ABLAÇÃO, não por dedução.
//
// Este repositório tem quatro campanhas de otimização refutadas pela medição,
// uma delas com as quatro premissas falsas. Então antes de tocar em
// `scene.ts` a pergunta é qual construção custa, e a forma de saber é somar uma
// de cada vez sobre o MESMO laço e ler a diferença.
//
// O cenário é o do `claude-bench-fisica-partes.ts`: 500 corpos espaçados 1,5
// com raio 0,25 — NENHUM par se toca. Logo o custo medido lá é travessia pura,
// e `solvePair` mal é chamada. É esse laço vazio que este probe disseca.

import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";

const N = 500;
const FRAMES = 60;
const CGRID_MASK = 8191;

// ── as mesmas estruturas que o resolveInto recebe ──────────────────────────
const objs: GameObject[] = [];
const trs: Transform[] = [];
const cIdx: number[] = [];
const gHead: number[] = [];
const gNext: number[] = [];
const lastX: f64[] = []; const lastY: f64[] = []; const lastZ: f64[] = [];

const lado = Math.ceil(Math.sqrt(N));
for (let i = 0; i < N; i++) {
  const g = new GameObject("o" + i);
  g.setMesh(4, 200, 200, 200);
  g.transform.setPosition((i % lado) * 1.5 - lado * 0.75, 8.0, ((i / lado) | 0) * 1.5 - lado * 0.75);
  g.transform.setScale(0.5);
  objs.push(g);
  trs.push(g.transform);
  cIdx.push(i);
  gNext.push(0 - 1);
  lastX.push(1e30); lastY.push(1e30); lastZ.push(1e30);
}
let h = 0;
while (h < 8192) { gHead.push(0 - 1); h = h + 1; }

function mfloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

// ── A: só o laço + índice ──────────────────────────────────────────────────
function passA(cI: number[], m: number): number {
  let acc = 0; let k = 0;
  while (k < m) { acc = acc ^ cI[k]; k = k + 1; }
  return acc;
}

// ── B: + o objeto e o campo `stationary` (acesso a campo de CLASSE) ────────
function passB(os: GameObject[], cI: number[], m: number): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    acc = acc ^ oi; k = k + 1;
  }
  return acc;
}

// ── C: + o Transform e a leitura de px/py/pz ───────────────────────────────
function passC(os: GameObject[], ts: Transform[], cI: number[], m: number): f64 {
  let acc: f64 = 0.0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    acc = acc + t.px + t.py + t.pz;
    k = k + 1;
  }
  return acc;
}

// ── D: + o teste de movimento (lastX/Y/Z, arrays de f64) ───────────────────
function passD(os: GameObject[], ts: Transform[], cI: number[], m: number,
               lX: f64[], lY: f64[], lZ: f64[]): f64 {
  let acc: f64 = 0.0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    acc = acc + moved2;
    k = k + 1;
  }
  return acc;
}

// ── E: + mfloor×2 e o hash das 9 células (SEM andar nos buckets) ───────────
function passE(os: GameObject[], ts: Transform[], cI: number[], m: number,
               lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const gx = mfloor(px * inv);
    const gz = mfloor(pz * inv);
    let dz = 0 - 1;
    while (dz <= 1) {
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & CGRID_MASK);
        acc = acc ^ b;
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    k = k + 1;
  }
  return acc;
}

// ── E1: SÓ o mfloor x2 (sem o laço das 9) ──────────────────────────────────
// E - D deu 1,53 ms de 1,93. Dois suspeitos moram nesse degrau: as duas
// CHAMADAS de `mfloor` e o laço 3x3. E1 e E2 os separam.
function passE1(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    acc = acc ^ mfloor(px * inv) ^ mfloor(pz * inv);
    k = k + 1;
  }
  return acc;
}

// ── E2: mfloor INLINE (mesma matemática, sem a chamada) + laço das 9 ───────
function passE2(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    let dz = 0 - 1;
    while (dz <= 1) {
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & CGRID_MASK);
        acc = acc ^ b;
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    k = k + 1;
  }
  return acc;
}

// ── E3: hashes de linha/coluna HOISTED para fora do laço 3x3 ──────────────
// E1/E2 mataram o suspeito `mfloor` (0,08 ms, e inliná-lo não move nada). O que
// sobra no degrau de 1,7 ms é o próprio 3x3: 18 multiplicações por objeto, onde
// `(gx+dx)` só assume TRÊS valores e `(gz+dz)` outros três. Seis produtos
// bastam — o resto é soma. Mesma aritmética, mesmos bits.
function passE3(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    const hx0 = (gx - 1) * 73856093;
    const hx1 = gx * 73856093;
    const hx2 = (gx + 1) * 73856093;
    const hz0 = (gz - 1) * 19349663;
    const hz1 = gz * 19349663;
    const hz2 = (gz + 1) * 19349663;
    acc = acc ^ ((hx0 + hz0) & CGRID_MASK) ^ ((hx1 + hz0) & CGRID_MASK) ^ ((hx2 + hz0) & CGRID_MASK)
              ^ ((hx0 + hz1) & CGRID_MASK) ^ ((hx1 + hz1) & CGRID_MASK) ^ ((hx2 + hz1) & CGRID_MASK)
              ^ ((hx0 + hz2) & CGRID_MASK) ^ ((hx1 + hz2) & CGRID_MASK) ^ ((hx2 + hz2) & CGRID_MASK);
    k = k + 1;
  }
  return acc;
}


// ── E4: as 9 celulas SEM o `& CGRID_MASK` ─────────────────────────────────
// Sobrou um suspeito so. E3 (6 multiplicacoes, reta, sem laco) custa o mesmo
// que E2 (18 multiplicacoes, dois lacos aninhados) — logo nem o produto nem o
// laco explicam o degrau. O que E2/E3 tem e E1 nao tem sao NOVE operacoes `&`.
function passE4(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    const hx0 = (gx - 1) * 73856093; const hx1 = gx * 73856093; const hx2 = (gx + 1) * 73856093;
    const hz0 = (gz - 1) * 19349663; const hz1 = gz * 19349663; const hz2 = (gz + 1) * 19349663;
    acc = acc ^ (hx0 + hz0) ^ (hx1 + hz0) ^ (hx2 + hz0)
              ^ (hx0 + hz1) ^ (hx1 + hz1) ^ (hx2 + hz1)
              ^ (hx0 + hz2) ^ (hx1 + hz2) ^ (hx2 + hz2);
    k = k + 1;
  }
  return acc;
}

// ── E5: SO uma operacao `&` por objeto (em vez de nove) ───────────────────
function passE5(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    acc = acc ^ ((gx * 73856093 + gz * 19349663) & CGRID_MASK);
    k = k + 1;
  }
  return acc;
}


// ── E6: nove `&`, mas sobre operandos PEQUENOS (cabem em i32) ─────────────
// `gx * 73856093` passa de 1,7e9 com gx=23 — somado ao termo de z, ESTOURA i32.
// Se o `&` caro for o `&` sobre numero grande (caminho lento de conversao) e
// nao o `&` em si, nove ANDs sobre valores pequenos devem custar quase nada.
// E o conserto passa a ser aritmetico, nao estrutural.
function passE6(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    // mesmos nove ANDs, operandos na casa dos milhares em vez de bilhoes
    const sx = gx + 4096; const sz = gz + 4096;
    acc = acc ^ ((sx - 1 + sz) & CGRID_MASK) ^ ((sx + sz) & CGRID_MASK) ^ ((sx + 1 + sz) & CGRID_MASK)
              ^ ((sx - 1 + sz + 1) & CGRID_MASK) ^ ((sx + sz + 1) & CGRID_MASK) ^ ((sx + 1 + sz + 1) & CGRID_MASK)
              ^ ((sx - 1 + sz + 2) & CGRID_MASK) ^ ((sx + sz + 2) & CGRID_MASK) ^ ((sx + 1 + sz + 2) & CGRID_MASK);
    k = k + 1;
  }
  return acc;
}


// ── E7: os mesmos nove `&`, em NOVE COMANDOS em vez de uma cadeia ─────────
// 1 AND custa 0,017 ms; 9 ANDs custam 1,55 — noventa vezes mais para nove
// vezes o trabalho. Nao-linear assim nao e o operador, e a forma da expressao
// (pressao de registrador / spill). Se nove comandos separados forem baratos, o
// conserto em scene.ts nao muda hash nenhum: muda so como o valor e escrito.
function passE7(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    let dz = 0 - 1;
    while (dz <= 1) {
      const hz = (gz + dz) * 19349663;
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = ((gx + dx) * 73856093 + hz) & CGRID_MASK;
        acc = acc ^ b;
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    k = k + 1;
  }
  return acc;
}

// ── E8: mascara POR EIXO (3+3 ANDs), celula = mx * 128 + mz, sem AND no 3x3 ─
// Um grid 64x128 toroidal em vez do hash multiplicativo. Nenhum falso NEGATIVO
// e possivel (a celula visitada sempre mapeia no balde onde o objeto entrou), e
// o alias so ocorre a 64 celulas de distancia — fora de qualquer janela 3x3.
function passE8(os: GameObject[], ts: Transform[], cI: number[], m: number,
                lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const fx = px * inv; let gx = fx | 0; if (fx < 0.0 && (gx * 1.0) !== fx) gx = gx - 1;
    const fz = pz * inv; let gz = fz | 0; if (fz < 0.0 && (gz * 1.0) !== fz) gz = gz - 1;
    const mx0 = ((gx - 1) & 63) * 128; const mx1 = (gx & 63) * 128; const mx2 = ((gx + 1) & 63) * 128;
    const mz0 = (gz - 1) & 127; const mz1 = gz & 127; const mz2 = (gz + 1) & 127;
    acc = acc ^ (mx0 + mz0) ^ (mx1 + mz0) ^ (mx2 + mz0)
              ^ (mx0 + mz1) ^ (mx1 + mz1) ^ (mx2 + mz1)
              ^ (mx0 + mz2) ^ (mx1 + mz2) ^ (mx2 + mz2);
    k = k + 1;
  }
  return acc;
}

// ── F: + andar nos buckets (o laço COMPLETO, sem solvePair) ────────────────
function passF(os: GameObject[], ts: Transform[], cI: number[], m: number,
               gH: number[], gN: number[],
               lX: f64[], lY: f64[], lZ: f64[], inv: f64): number {
  let acc = 0; let k = 0;
  while (k < m) {
    const oi = cI[k];
    const ob: GameObject = os[oi];
    if (ob.stationary !== 0) { k = k + 1; continue; }
    const t: Transform = ts[oi];
    const px = t.px; const py = t.py; const pz = t.pz;
    const dxm = px - lX[oi]; const dym = py - lY[oi]; const dzm = pz - lZ[oi];
    const moved2: f64 = dxm * dxm + dym * dym + dzm * dzm;
    if (moved2 < 0.000001) { k = k + 1; continue; }
    lX[oi] = px; lY[oi] = py; lZ[oi] = pz;
    const gx = mfloor(px * inv);
    const gz = mfloor(pz * inv);
    let dz = 0 - 1;
    while (dz <= 1) {
      let dx = 0 - 1;
      while (dx <= 1) {
        const b = (((gx + dx) * 73856093 + (gz + dz) * 19349663) & CGRID_MASK);
        let q = gH[b];
        while (q >= 0) {
          const other = cI[q];
          if (other !== oi) acc = acc ^ other;
          q = gN[q];
        }
        dx = dx + 1;
      }
      dz = dz + 1;
    }
    k = k + 1;
  }
  return acc;
}

// ── cronômetro: cada passe roda FRAMES vezes sobre a mesma cena ────────────
// Os corpos são "movidos" um epsilon por frame para que o teste de movimento
// não descarte tudo — é o que acontece no bench, onde eles caem.
function mover(): void {
  let i = 0;
  while (i < N) { const t: Transform = trs[i]; t.py = t.py - 0.01; i = i + 1; }
}

const inv: f64 = 1.0 / 0.5;
// grid montado uma vez (o custo dele é medido à parte, no bench real)
let k2 = 0;
while (k2 < N) {
  const t: Transform = trs[k2];
  const b = ((mfloor(t.px * inv) * 73856093 + mfloor(t.pz * inv) * 19349663) & CGRID_MASK);
  gNext[k2] = gHead[b]; gHead[b] = k2;
  k2 = k2 + 1;
}

function crono(parte: number): f64 {
  // aquece e zera o "último visto" para que a primeira volta não seja especial
  let i = 0;
  while (i < N) { lastX[i] = 1e30; lastY[i] = 1e30; lastZ[i] = 1e30; i = i + 1; }
  const t0 = Date.now();
  for (let f = 0; f < FRAMES; f++) {
    mover();
    if (parte === 0) passA(cIdx, N);
    else if (parte === 1) passB(objs, cIdx, N);
    else if (parte === 2) passC(objs, trs, cIdx, N);
    else if (parte === 3) passD(objs, trs, cIdx, N, lastX, lastY, lastZ);
    else if (parte === 4) passE(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 6) passE1(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 7) passE2(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 8) passE3(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 9) passE4(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 10) passE5(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 11) passE6(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 12) passE7(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else if (parte === 13) passE8(objs, trs, cIdx, N, lastX, lastY, lastZ, inv);
    else passF(objs, trs, cIdx, N, gHead, gNext, lastX, lastY, lastZ, inv);
  }
  return (Date.now() - t0) / FRAMES;
}

// custo do `mover()` sozinho, para descontar
const t0m = Date.now();
for (let f = 0; f < FRAMES; f++) mover();
const cMover = (Date.now() - t0m) / FRAMES;

const a = crono(0); const b = crono(1); const c = crono(2);
const d = crono(3); const e = crono(4); const g = crono(5);

io.print("== ablacao de resolveInto, " + N + " corpos, " + FRAMES + " frames ==");
io.print("  (mover() sozinho, descontado de todos: " + cMover.toFixed(3) + " ms)");
io.print("  A laco + cIdx[k]                " + (a - cMover).toFixed(3));
io.print("  B + objs[oi].stationary         " + (b - cMover).toFixed(3));
io.print("  C + trs[oi].px/py/pz            " + (c - cMover).toFixed(3));
io.print("  D + teste de movimento (f64[])  " + (d - cMover).toFixed(3));
io.print("  E + mfloor x2 + hash das 9      " + (e - cMover).toFixed(3));
io.print("  F + andar nos buckets           " + (g - cMover).toFixed(3));
const e1 = crono(6); const e2 = crono(7);
io.print("  E1 = D + SO mfloor x2 (chamada) " + (e1 - cMover).toFixed(3));
io.print("  E2 = E com mfloor INLINE        " + (e2 - cMover).toFixed(3));
const e3 = crono(8);
io.print("  E3 = E com hash HOISTED (6 mul) " + (e3 - cMover).toFixed(3));
const e4v = crono(9); const e5v = crono(10);
io.print("  E4 = E3 SEM os nove `&`         " + (e4v - cMover).toFixed(3));
io.print("  E5 = UM `&` por objeto          " + (e5v - cMover).toFixed(3));
const e6v = crono(11);
io.print("  E6 = NOVE `&` em i32 pequeno    " + (e6v - cMover).toFixed(3));
const e7v = crono(12); const e8v = crono(13);
io.print("  E7 = nove `&` em nove COMANDOS  " + (e7v - cMover).toFixed(3));
io.print("  E8 = mascara por EIXO (3+3)     " + (e8v - cMover).toFixed(3));

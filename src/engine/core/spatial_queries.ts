// ═══════════════════════════════════════════════════════════════════════════
// EXECUTOR DE CONSULTAS ESPACIAIS NO HOST (Lote B, §5)
//
// Centraliza todas as consultas geométricas (raycast, overlapSphere, overlapBox)
// no host (CPU), com índice espacial próprio (grid dinâmico de células 2x maior
// meia-extensão).
//
// Regras obrigatórias do contrato (docs/contrato-consultas-e-latencia.md):
//   - Filtro simétrico: (queryMask & targetLayer) !== 0 && (targetMask & queryLayer) !== 0
//   - includeTriggers: falso por padrão. Quando verdadeiro, depth = 0 em overlap
//   - overlap devolve lista estritamente ordenada por bodyId crescente
//   - Identificador estável: bodyId = go.id
//   - stepId: pbGpuLastReadbackStep() no modo GPU, stepCount() nos modos CPU e Rust
//   - Variantes NonAlloc com parâmetros escalares: ZERO alocações no heap
// ═══════════════════════════════════════════════════════════════════════════

import math from "@compat/math.ts";
import io from "@compat/io.ts";
import time from "@compat/time.ts";
import { GameObject } from "./gameobject";
import { Transform } from "./transform";
import { Scene } from "./scene";
import { shapeOf, halfXOf, halfYOf, halfZOf, centerWorldX, centerWorldY, centerWorldZ,
         radiusOfCol, triggerOf, hullIdOf, SHAPE_SPHERE, SHAPE_BOX, SHAPE_HULL } from "./collider";
import { hullAt } from "./hullreg";
import { hullContactLocal, Contact } from "./hullpack";
import { stepCount } from "./fixedstep";
import { pbActiveBackend, pbGpuLastReadbackStep } from "./physics_backend";
import { LAYER_DEFAULT, MASK_ALL } from "../rigid/materials";

export const COL_SPHERE = SHAPE_SPHERE;
export const COL_BOX = SHAPE_BOX;
export const COL_HULL = SHAPE_HULL;

export interface RaycastHit {
  hit: boolean;
  bodyId: number;
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
  stepId: number;
}

export interface OverlapHit {
  hit: boolean;
  bodyId: number;
  depth: number;
  normal: [number, number, number];
  stepId: number;
}

export interface SpatialFilter {
  layer?: number;
  mask?: number;
  includeTriggers?: boolean;
}

export function createRaycastHit(): RaycastHit {
  return {
    hit: false,
    bodyId: 0,
    point: [0.0, 0.0, 0.0],
    normal: [0.0, 0.0, 0.0],
    distance: 0.0,
    stepId: 0,
  };
}

export function createOverlapHit(): OverlapHit {
  return {
    hit: false,
    bodyId: 0,
    depth: 0.0,
    normal: [0.0, 0.0, 0.0],
    stepId: 0,
  };
}

// ── ÍNDICE ESPACIAL PRÓPRIO (GRID NO HOST) ──────────────────────────────────
const SGRID_CAP = 8192;
const SGRID_MASK = 8191;

let sActiveScene: Scene | null = null;
let sHead: number[] = new Array(SGRID_CAP).fill(-1);
let sEntriesObj: number[] = [];
let sEntriesNext: number[] = [];
let sEntriesCount = 0;
let sUsedBuckets: number[] = [];
let sUsedBucketsCount = 0;

let sObjs: GameObject[] = [];
let sTrs: Transform[] = [];
let sMinX: f64[] = [];
let sMaxX: f64[] = [];
let sMinY: f64[] = [];
let sMaxY: f64[] = [];
let sMinZ: f64[] = [];
let sMaxZ: f64[] = [];
let sSceneMinX = 0.0;
let sSceneMaxX = 0.0;
let sSceneMinZ = 0.0;
let sSceneMaxZ = 0.0;

let sCellSize = 2.0;
let sInvCellSize = 0.5;
let sLastRebuildStep = -1;
let sLastSceneVersion = -1;

let sQueryStamp = 0;
let sVisitedStamp: number[] = new Array(4096).fill(0);

// Instância única reusada para testes de casca sem alocação
const sHullContactOut: Contact = new Contact();

export function setSpatialScene(sc: Scene | null): void {
  sActiveScene = sc;
  sLastRebuildStep = -1;
  sLastSceneVersion = -1;
}

export function getSpatialScene(): Scene | null {
  return sActiveScene;
}

function mfloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

function sHash(gx: number, gz: number): number {
  return ((gx * 73856093 + gz * 19349663) & SGRID_MASK);
}

/// Obtém o stepId correto para consultas espaciais segundo o backend ativo.
export function getSpatialStepId(): number {
  if (pbActiveBackend() === 1) {
    return pbGpuLastReadbackStep();
  }
  return stepCount();
}

/// Reconstrói o índice espacial no host a partir da cena.
export function spatialRebuildIndex(sc?: Scene): void {
  const targetScene = sc !== undefined ? sc : sActiveScene;
  if (targetScene === null) return;

  // Limpa buckets anteriormente utilizados
  let b = 0;
  while (b < sUsedBucketsCount) {
    sHead[sUsedBuckets[b]] = -1;
    b = b + 1;
  }
  sUsedBucketsCount = 0;
  sEntriesCount = 0;

  sObjs.length = 0;
  sTrs.length = 0;
  sMinX.length = 0;
  sMaxX.length = 0;
  sMinY.length = 0;
  sMaxY.length = 0;
  sMinZ.length = 0;
  sMaxZ.length = 0;

  sSceneMinX = 1e30;
  sSceneMaxX = -1e30;
  sSceneMinZ = 1e30;
  sSceneMaxZ = -1e30;

  const allObjs = targetScene.objects;
  const n = allObjs.length;
  let maxHalfExtent: f64 = 0.5;

  let i = 0;
  while (i < n) {
    const o = allObjs[i];
    if (o.active !== 0 && (o.collideFlag !== 0 || o.colIdx >= 0)) {
      const t = o.transform;
      const cx = centerWorldX(o, t);
      const cy = centerWorldY(o, t);
      const cz = centerWorldZ(o, t);
      const hx = halfXOf(o, t);
      const hy = halfYOf(o, t);
      const hz = halfZOf(o, t);

      if (hx > maxHalfExtent) maxHalfExtent = hx;
      if (hy > maxHalfExtent) maxHalfExtent = hy;
      if (hz > maxHalfExtent) maxHalfExtent = hz;

      const minX = cx - hx; const maxX = cx + hx;
      const minZ = cz - hz; const maxZ = cz + hz;
      if (minX < sSceneMinX) sSceneMinX = minX;
      if (maxX > sSceneMaxX) sSceneMaxX = maxX;
      if (minZ < sSceneMinZ) sSceneMinZ = minZ;
      if (maxZ > sSceneMaxZ) sSceneMaxZ = maxZ;

      sObjs.push(o);
      sTrs.push(t);
      sMinX.push(minX);
      sMaxX.push(maxX);
      sMinY.push(cy - hy);
      sMaxY.push(cy + hy);
      sMinZ.push(minZ);
      sMaxZ.push(maxZ);
    }
    i = i + 1;
  }

  if (sObjs.length === 0) {
    sSceneMinX = 0.0; sSceneMaxX = 0.0;
    sSceneMinZ = 0.0; sSceneMaxZ = 0.0;
  }

  // Célula dimensionada dinamicamente para 2 * maiorMeiaExtensão (§5.1)
  sCellSize = maxHalfExtent * 2.0;
  if (sCellSize < 0.25) sCellSize = 0.25;
  sInvCellSize = 1.0 / sCellSize;

  const m = sObjs.length;
  while (sVisitedStamp.length < m) {
    sVisitedStamp.push(0);
  }

  let k = 0;
  while (k < m) {
    const minGx = mfloor(sMinX[k] * sInvCellSize);
    const maxGx = mfloor(sMaxX[k] * sInvCellSize);
    const minGz = mfloor(sMinZ[k] * sInvCellSize);
    const maxGz = mfloor(sMaxZ[k] * sInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      let gz = minGz;
      while (gz <= maxGz) {
        const bucket = sHash(gx, gz);
        if (sHead[bucket] === -1) {
          sUsedBuckets[sUsedBucketsCount] = bucket;
          sUsedBucketsCount = sUsedBucketsCount + 1;
        }
        const entryIdx = sEntriesCount;
        sEntriesCount = sEntriesCount + 1;
        sEntriesObj[entryIdx] = k;
        sEntriesNext[entryIdx] = sHead[bucket];
        sHead[bucket] = entryIdx;

        gz = gz + 1;
      }
      gx = gx + 1;
    }
    k = k + 1;
  }

  sLastRebuildStep = getSpatialStepId();
  sLastSceneVersion = targetScene.compVersion;
}

function ensureIndex(sc?: Scene): Scene | null {
  const targetScene = sc !== undefined ? sc : sActiveScene;
  if (targetScene === null) return null;
  const curStep = getSpatialStepId();
  if (sLastRebuildStep !== curStep || sLastSceneVersion !== targetScene.compVersion) {
    spatialRebuildIndex(targetScene);
  }
  return targetScene;
}

/// Mede o custo de reconstrução do índice espacial do executor no host (Aceite 8).
export function spatialGridRebuildCost(sc: Scene): { timeMs: f64; cellCount: number; objCount: number } {
  const t0 = performance.now();
  spatialRebuildIndex(sc);
  const timeMs = performance.now() - t0;
  return {
    timeMs: timeMs,
    cellCount: sUsedBucketsCount,
    objCount: sObjs.length,
  };
}

// ── FILTRO SIMÉTRICO E TRIGGERS (§5.2) ──────────────────────────────────────
function passesFilter(
  queryMask: number,
  queryLayer: number,
  includeTriggers: boolean,
  targetGo: GameObject,
): boolean {
  if (!includeTriggers && triggerOf(targetGo) !== 0) {
    return false;
  }
  const targetLayer = targetGo.layer;
  const targetMask = targetGo.mask;
  if ((queryMask & targetLayer) === 0) return false;
  if ((targetMask & queryLayer) === 0) return false;
  return true;
}

// ── GEOMETRIA DE RAYCAST ───────────────────────────────────────────────────

function raycastObject(
  k: number,
  ox: f64, oy: f64, oz: f64,
  ndx: f64, ndy: f64, ndz: f64,
  maxDistance: f64,
  outHit: RaycastHit,
  includeTriggers: boolean,
): boolean {
  const go = sObjs[k];
  const t = sTrs[k];
  const cx = centerWorldX(go, t);
  const cy = centerWorldY(go, t);
  const cz = centerWorldZ(go, t);
  const shape = shapeOf(go);

  if (shape === COL_SPHERE) {
    const r = radiusOfCol(go, t);
    const vx = ox - cx;
    const vy = oy - cy;
    const vz = oz - cz;
    const b = vx * ndx + vy * ndy + vz * ndz;
    const c = vx * vx + vy * vy + vz * vz - r * r;
    const disc = b * b - c;
    if (disc < 0.0) return false;

    const sqrtD = math.sqrt(disc);
    let hitDist = 0.0 - b - sqrtD;
    if (hitDist < 0.0) {
      if (0.0 - b + sqrtD >= 0.0) {
        // Origem dentro da esfera
        hitDist = 0.0;
        outHit.hit = true;
        outHit.bodyId = go.id;
        outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
        outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
        outHit.distance = 0.0;
        outHit.stepId = getSpatialStepId();
        return true;
      }
      return false;
    }
    if (hitDist > maxDistance) return false;

    const px = ox + ndx * hitDist;
    const py = oy + ndy * hitDist;
    const pz = oz + ndz * hitDist;
    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.point[0] = px; outHit.point[1] = py; outHit.point[2] = pz;
    outHit.normal[0] = (px - cx) / r;
    outHit.normal[1] = (py - cy) / r;
    outHit.normal[2] = (pz - cz) / r;
    outHit.distance = hitDist;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  if (shape === COL_BOX) {
    const hx = halfXOf(go, t);
    const hy = halfYOf(go, t);
    const hz = halfZOf(go, t);
    const yaw = t.wry;

    let rox = ox - cx;
    let roy = oy - cy;
    let roz = oz - cz;
    let rdx = ndx;
    let rdy = ndy;
    let rdz = ndz;

    if (yaw !== 0.0) {
      const cosY = math.cos(0.0 - yaw);
      const sinY = math.sin(0.0 - yaw);
      rox = (ox - cx) * cosY - (oz - cz) * sinY;
      roz = (ox - cx) * sinY + (oz - cz) * cosY;
      rdx = ndx * cosY - ndz * sinY;
      rdz = ndx * sinY + ndz * cosY;
    }

    // Origem dentro da caixa
    if (rox >= 0.0 - hx && rox <= hx && roy >= 0.0 - hy && roy <= hy && roz >= 0.0 - hz && roz <= hz) {
      outHit.hit = true;
      outHit.bodyId = go.id;
      outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
      outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
      outHit.distance = 0.0;
      outHit.stepId = getSpatialStepId();
      return true;
    }

    let tmin = 0.0;
    let tmax = maxDistance;
    let hitNormX = 0.0;
    let hitNormY = 0.0;
    let hitNormZ = 0.0;

    // Eixo X
    if (math.abs(rdx) < 0.000000001) {
      if (rox < 0.0 - hx || rox > hx) return false;
    } else {
      const inv = 1.0 / rdx;
      let t1 = (0.0 - hx - rox) * inv;
      let t2 = (hx - rox) * inv;
      let n1 = 0.0 - 1.0;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
      if (t1 > tmin) { tmin = t1; hitNormX = n1; hitNormY = 0.0; hitNormZ = 0.0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }

    // Eixo Y
    if (math.abs(rdy) < 0.000000001) {
      if (roy < 0.0 - hy || roy > hy) return false;
    } else {
      const inv = 1.0 / rdy;
      let t1 = (0.0 - hy - roy) * inv;
      let t2 = (hy - roy) * inv;
      let n1 = 0.0 - 1.0;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
      if (t1 > tmin) { tmin = t1; hitNormX = 0.0; hitNormY = n1; hitNormZ = 0.0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }

    // Eixo Z
    if (math.abs(rdz) < 0.000000001) {
      if (roz < 0.0 - hz || roz > hz) return false;
    } else {
      const inv = 1.0 / rdz;
      let t1 = (0.0 - hz - roz) * inv;
      let t2 = (hz - roz) * inv;
      let n1 = 0.0 - 1.0;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
      if (t1 > tmin) { tmin = t1; hitNormX = 0.0; hitNormY = 0.0; hitNormZ = n1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }

    if (tmin < 0.0 || tmin > maxDistance) return false;

    let nx = hitNormX;
    let ny = hitNormY;
    let nz = hitNormZ;
    if (yaw !== 0.0) {
      const cosY = math.cos(yaw);
      const sinY = math.sin(yaw);
      nx = hitNormX * cosY - hitNormZ * sinY;
      nz = hitNormX * sinY + hitNormZ * cosY;
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.point[0] = ox + ndx * tmin;
    outHit.point[1] = oy + ndy * tmin;
    outHit.point[2] = oz + ndz * tmin;
    outHit.normal[0] = nx;
    outHit.normal[1] = ny;
    outHit.normal[2] = nz;
    outHit.distance = tmin;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  if (shape === COL_HULL) {
    const hid = hullIdOf(go);
    const hull = hullAt(hid);
    if (hull === null) {
      // Degenera para caixa
      return false;
    }
    const yaw = t.wry;
    const sx = t.sx !== 0.0 ? t.sx : 1.0;
    const sy = t.sy !== 0.0 ? t.sy : 1.0;
    const sz = t.sz !== 0.0 ? t.sz : 1.0;

    let rox = ox - cx;
    let roy = oy - cy;
    let roz = oz - cz;
    let rdx = ndx;
    let rdy = ndy;
    let rdz = ndz;

    if (yaw !== 0.0) {
      const cosY = math.cos(0.0 - yaw);
      const sinY = math.sin(0.0 - yaw);
      rox = (ox - cx) * cosY - (oz - cz) * sinY;
      roz = (ox - cx) * sinY + (oz - cz) * cosY;
      rdx = ndx * cosY - ndz * sinY;
      rdz = ndx * sinY + ndz * cosY;
    }

    // Leva para espaço local não-escalado da casca
    rox = rox / sx; roy = roy / sy; roz = roz / sz;
    rdx = rdx / sx; rdy = rdy / sy; rdz = rdz / sz;

    const planes = hull.planes;
    const m = (planes.length / 4) | 0;
    let tenter = 0.0;
    let texit = maxDistance;
    let hitNx = 0.0; let hitNy = 0.0; let hitNz = 0.0;

    let pidx = 0;
    while (pidx < m) {
      const off = pidx * 4;
      const nx = planes[off];
      const ny = planes[off + 1];
      const nz = planes[off + 2];
      const d = planes[off + 3];

      const denom = nx * rdx + ny * rdy + nz * rdz;
      const num = d - (nx * rox + ny * roy + nz * roz);

      if (math.abs(denom) < 0.000000001) {
        if (num < 0.0) return false;
      } else if (denom > 0.0) {
        const tau = num / denom;
        if (tau < texit) texit = tau;
      } else {
        const tau = num / denom;
        if (tau > tenter) {
          tenter = tau;
          hitNx = nx; hitNy = ny; hitNz = nz;
        }
      }
      if (tenter > texit) return false;
      pidx = pidx + 1;
    }

    if (tenter < 0.0) {
      // Origem dentro da casca
      outHit.hit = true;
      outHit.bodyId = go.id;
      outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
      outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
      outHit.distance = 0.0;
      outHit.stepId = getSpatialStepId();
      return true;
    }
    if (tenter > maxDistance) return false;

    let wnx = hitNx; let wny = hitNy; let wnz = hitNz;
    if (yaw !== 0.0) {
      const cosY = math.cos(yaw);
      const sinY = math.sin(yaw);
      wnx = hitNx * cosY - hitNz * sinY;
      wnz = hitNx * sinY + hitNz * cosY;
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.point[0] = ox + ndx * tenter;
    outHit.point[1] = oy + ndy * tenter;
    outHit.point[2] = oz + ndz * tenter;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.distance = tenter;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  return false;
}

// ── RAYCAST NON-ALLOC COM PARÂMETROS ESCALARES (§5.5) ───────────────────────

const sTempRayHit: RaycastHit = createRaycastHit();

export function raycastNonAlloc(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  outHit: RaycastHit,
  mask: number = MASK_ALL,
  layer: number = LAYER_DEFAULT,
  includeTriggers: boolean = false,
  sc?: Scene,
): boolean {
  const targetScene = ensureIndex(sc);
  if (targetScene === null) return false;

  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 0.000000000001) return false;
  const invLen = 1.0 / math.sqrt(len2);
  const ndx = dx * invLen;
  const ndy = dy * invLen;
  const ndz = dz * invLen;

  sQueryStamp = sQueryStamp + 1;
  const stamp = sQueryStamp;

  const cell = sCellSize;
  const invCell = sInvCellSize;

  // Descarte rápido se o raio não cruza a AABB geral da cena
  const endX = ox + ndx * maxDistance;
  const endZ = oz + ndz * maxDistance;
  const minRx = ox < endX ? ox : endX;
  const maxRx = ox > endX ? ox : endX;
  const minRz = oz < endZ ? oz : endZ;
  const maxRz = oz > endZ ? oz : endZ;

  if (sObjs.length === 0 || maxRx < sSceneMinX || minRx > sSceneMaxX || maxRz < sSceneMinZ || minRz > sSceneMaxZ) {
    outHit.hit = false;
    return false;
  }

  let closestDist = maxDistance + 1.0;
  let found = false;

  // DDA 2D (Amanatides–Woo) no plano XZ
  let gx = mfloor(ox * invCell);
  let gz = mfloor(oz * invCell);

  let stepX = 0;
  let tDeltaX = 1e30;
  let tMaxX = 1e30;
  if (ndx > 0.000000001) {
    stepX = 1;
    tDeltaX = cell / ndx;
    tMaxX = ((gx + 1) * cell - ox) / ndx;
  } else if (ndx < -0.000000001) {
    stepX = -1;
    tDeltaX = (0.0 - cell) / ndx;
    tMaxX = (gx * cell - ox) / ndx;
  }

  let stepZ = 0;
  let tDeltaZ = 1e30;
  let tMaxZ = 1e30;
  if (ndz > 0.000000001) {
    stepZ = 1;
    tDeltaZ = cell / ndz;
    tMaxZ = ((gz + 1) * cell - oz) / ndz;
  } else if (ndz < -0.000000001) {
    stepZ = -1;
    tDeltaZ = (0.0 - cell) / ndz;
    tMaxZ = (gz * cell - oz) / ndz;
  }

  let tCurrent = 0.0;

  while (tCurrent <= closestDist && tCurrent <= maxDistance) {
    const bucket = sHash(gx, gz);
    let entry = sHead[bucket];
    while (entry !== -1) {
      const k = sEntriesObj[entry];
      if (sVisitedStamp[k] !== stamp) {
        sVisitedStamp[k] = stamp;
        const go = sObjs[k];
        if (passesFilter(mask, layer, includeTriggers, go)) {
          const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers);
          if (hit) {
            if (sTempRayHit.distance < closestDist) {
              closestDist = sTempRayHit.distance;
              outHit.hit = true;
              outHit.bodyId = sTempRayHit.bodyId;
              outHit.point[0] = sTempRayHit.point[0];
              outHit.point[1] = sTempRayHit.point[1];
              outHit.point[2] = sTempRayHit.point[2];
              outHit.normal[0] = sTempRayHit.normal[0];
              outHit.normal[1] = sTempRayHit.normal[1];
              outHit.normal[2] = sTempRayHit.normal[2];
              outHit.distance = sTempRayHit.distance;
              outHit.stepId = sTempRayHit.stepId;
              found = true;
            }
          }
        }
      }
      entry = sEntriesNext[entry];
    }

    // Avança para a próxima célula pelo menor tMax
    if (tMaxX < tMaxZ) {
      tCurrent = tMaxX;
      gx = gx + stepX;
      tMaxX = tMaxX + tDeltaX;
    } else {
      tCurrent = tMaxZ;
      gz = gz + stepZ;
      tMaxZ = tMaxZ + tDeltaZ;
    }
  }

  if (!found) {
    outHit.hit = false;
  }
  return found;
}

export function raycast(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  filter?: SpatialFilter,
  sc?: Scene,
): RaycastHit | null {
  const hit = createRaycastHit();
  const mask = filter !== undefined && filter.mask !== undefined ? filter.mask : MASK_ALL;
  const layer = filter !== undefined && filter.layer !== undefined ? filter.layer : LAYER_DEFAULT;
  const includeTriggers = filter !== undefined && filter.includeTriggers !== undefined ? filter.includeTriggers : false;

  if (raycastNonAlloc(ox, oy, oz, dx, dy, dz, maxDistance, hit, mask, layer, includeTriggers, sc)) {
    return hit;
  }
  return null;
}

// ── OVERLAP SPHERE GEOMETRIA E IMPLEMENTAÇÃO ───────────────────────────────

function overlapSphereObject(
  k: number,
  cx: f64, cy: f64, cz: f64,
  radius: f64,
  outHit: OverlapHit,
  includeTriggers: boolean,
): boolean {
  const go = sObjs[k];
  const t = sTrs[k];
  const tcx = centerWorldX(go, t);
  const tcy = centerWorldY(go, t);
  const tcz = centerWorldZ(go, t);
  const shape = shapeOf(go);
  const isTrigger = triggerOf(go) !== 0;

  if (shape === COL_SPHERE) {
    const tr = radiusOfCol(go, t);
    const dx = tcx - cx;
    const dy = tcy - cy;
    const dz = tcz - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    const rSum = radius + tr;
    if (dist2 >= rSum * rSum) return false;

    const dist = math.sqrt(dist2);
    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.depth = isTrigger ? 0.0 : (rSum - dist);
    if (dist > 0.0000001) {
      outHit.normal[0] = dx / dist;
      outHit.normal[1] = dy / dist;
      outHit.normal[2] = dz / dist;
    } else {
      outHit.normal[0] = 0.0;
      outHit.normal[1] = 1.0;
      outHit.normal[2] = 0.0;
    }
    outHit.stepId = getSpatialStepId();
    return true;
  }

  if (shape === COL_BOX) {
    const thx = halfXOf(go, t);
    const thy = halfYOf(go, t);
    const thz = halfZOf(go, t);
    const yaw = t.wry;

    let rx = cx - tcx;
    let ry = cy - tcy;
    let rz = cz - tcz;

    if (yaw !== 0.0) {
      const cosY = math.cos(0.0 - yaw);
      const sinY = math.sin(0.0 - yaw);
      rx = (cx - tcx) * cosY - (cz - tcz) * sinY;
      rz = (cx - tcx) * sinY + (cz - tcz) * cosY;
    }

    let qx = rx;
    if (qx < 0.0 - thx) qx = 0.0 - thx; else if (qx > thx) qx = thx;
    let qy = ry;
    if (qy < 0.0 - thy) qy = 0.0 - thy; else if (qy > thy) qy = thy;
    let qz = rz;
    if (qz < 0.0 - thz) qz = 0.0 - thz; else if (qz > thz) qz = thz;

    const vx = rx - qx;
    const vy = ry - qy;
    const vz = rz - qz;
    const dist2 = vx * vx + vy * vy + vz * vz;
    if (dist2 >= radius * radius) return false;

    const dist = math.sqrt(dist2);
    let lnx = 0.0; let lny = 0.0; let lnz = 0.0;
    let depth = 0.0;

    if (dist > 0.0000001) {
      depth = radius - dist;
      // Normal aponta do volume de consulta para o alvo
      lnx = 0.0 - vx / dist;
      lny = 0.0 - vy / dist;
      lnz = 0.0 - vz / dist;
    } else {
      // Centro da esfera dentro da caixa
      const penX = thx - math.abs(rx);
      const penY = thy - math.abs(ry);
      const penZ = thz - math.abs(rz);
      if (penX <= penY && penX <= penZ) {
        lnx = rx >= 0.0 ? 0.0 - 1.0 : 1.0;
        depth = radius + penX;
      } else if (penY <= penX && penY <= penZ) {
        lny = ry >= 0.0 ? 0.0 - 1.0 : 1.0;
        depth = radius + penY;
      } else {
        lnz = rz >= 0.0 ? 0.0 - 1.0 : 1.0;
        depth = radius + penZ;
      }
    }

    let wnx = lnx; let wny = lny; let wnz = lnz;
    if (yaw !== 0.0) {
      const cosY = math.cos(yaw);
      const sinY = math.sin(yaw);
      wnx = lnx * cosY - lnz * sinY;
      wnz = lnx * sinY + lnz * cosY;
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.depth = isTrigger ? 0.0 : depth;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  if (shape === COL_HULL) {
    const hid = hullIdOf(go);
    const hull = hullAt(hid);
    if (hull === null) return false;

    const yaw = t.wry;
    const sx = t.sx !== 0.0 ? t.sx : 1.0;
    const sy = t.sy !== 0.0 ? t.sy : 1.0;
    const sz = t.sz !== 0.0 ? t.sz : 1.0;

    let rx = cx - tcx;
    let ry = cy - tcy;
    let rz = cz - tcz;

    if (yaw !== 0.0) {
      const cosY = math.cos(0.0 - yaw);
      const sinY = math.sin(0.0 - yaw);
      rx = (cx - tcx) * cosY - (cz - tcz) * sinY;
      rz = (cx - tcx) * sinY + (cz - tcz) * cosY;
    }

    const menor = sx < sy ? (sx < sz ? sx : sz) : (sy < sz ? sy : sz);
    if (hullContactLocal(hull, rx / sx, ry / sy, rz / sz, radius / menor, sHullContactOut) === 0) {
      return false;
    }

    let wnx = sHullContactOut.nx;
    const wny = sHullContactOut.ny;
    let wnz = sHullContactOut.nz;
    if (yaw !== 0.0) {
      const cosY = math.cos(yaw);
      const sinY = math.sin(yaw);
      wnx = sHullContactOut.nx * cosY - sHullContactOut.nz * sinY;
      wnz = sHullContactOut.nx * sinY + sHullContactOut.nz * cosY;
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.depth = isTrigger ? 0.0 : sHullContactOut.depth;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  return false;
}

function swapOverlapHits(a: OverlapHit, b: OverlapHit): void {
  const tmpHit = a.hit; a.hit = b.hit; b.hit = tmpHit;
  const tmpId = a.bodyId; a.bodyId = b.bodyId; b.bodyId = tmpId;
  const tmpDepth = a.depth; a.depth = b.depth; b.depth = tmpDepth;
  const tmpStep = a.stepId; a.stepId = b.stepId; b.stepId = tmpStep;
  const nx = a.normal[0]; a.normal[0] = b.normal[0]; b.normal[0] = nx;
  const ny = a.normal[1]; a.normal[1] = b.normal[1]; b.normal[1] = ny;
  const nz = a.normal[2]; a.normal[2] = b.normal[2]; b.normal[2] = nz;
}

/// Ordena os hits in-place por bodyId crescente (§5.3).
function sortHitsInPlace(hits: OverlapHit[], count: number): void {
  let i = 1;
  while (i < count) {
    let j = i;
    while (j > 0 && hits[j - 1].bodyId > hits[j].bodyId) {
      swapOverlapHits(hits[j - 1], hits[j]);
      j = j - 1;
    }
    i = i + 1;
  }
}

const sCandidateOverlapHit: OverlapHit = createOverlapHit();

function copyOverlapHit(dst: OverlapHit, src: OverlapHit): void {
  dst.hit = src.hit;
  dst.bodyId = src.bodyId;
  dst.depth = src.depth;
  dst.normal[0] = src.normal[0];
  dst.normal[1] = src.normal[1];
  dst.normal[2] = src.normal[2];
  dst.stepId = src.stepId;
}

export function overlapSphereNonAlloc(
  cx: number, cy: number, cz: number,
  radius: number,
  outHits: OverlapHit[],
  maxHits: number,
  mask: number = MASK_ALL,
  layer: number = LAYER_DEFAULT,
  includeTriggers: boolean = false,
  sc?: Scene,
): number {
  const targetScene = ensureIndex(sc);
  if (targetScene === null || maxHits <= 0) return 0;

  sQueryStamp = sQueryStamp + 1;
  const stamp = sQueryStamp;

  const minGx = mfloor((cx - radius) * sInvCellSize);
  const maxGx = mfloor((cx + radius) * sInvCellSize);
  const minGz = mfloor((cz - radius) * sInvCellSize);
  const maxGz = mfloor((cz + radius) * sInvCellSize);

  let storedCount = 0;
  let totalFound = 0;

  let gx = minGx;
  while (gx <= maxGx) {
    let gz = minGz;
    while (gz <= maxGz) {
      const bucket = sHash(gx, gz);
      let entry = sHead[bucket];
      while (entry !== -1) {
        const k = sEntriesObj[entry];
        if (sVisitedStamp[k] !== stamp) {
          sVisitedStamp[k] = stamp;
          const go = sObjs[k];
          if (passesFilter(mask, layer, includeTriggers, go)) {
            if (overlapSphereObject(k, cx, cy, cz, radius, sCandidateOverlapHit, includeTriggers)) {
              totalFound = totalFound + 1;
              const candId = sCandidateOverlapHit.bodyId;
              if (storedCount < maxHits) {
                let pos = storedCount;
                while (pos > 0 && outHits[pos - 1].bodyId > candId) {
                  copyOverlapHit(outHits[pos], outHits[pos - 1]);
                  pos = pos - 1;
                }
                copyOverlapHit(outHits[pos], sCandidateOverlapHit);
                storedCount = storedCount + 1;
              } else if (candId < outHits[maxHits - 1].bodyId) {
                let pos = maxHits - 1;
                while (pos > 0 && outHits[pos - 1].bodyId > candId) {
                  copyOverlapHit(outHits[pos], outHits[pos - 1]);
                  pos = pos - 1;
                }
                copyOverlapHit(outHits[pos], sCandidateOverlapHit);
              }
            }
          }
        }
        entry = sEntriesNext[entry];
      }
      gz = gz + 1;
    }
    gx = gx + 1;
  }

  return totalFound;
}

export function overlapSphere(
  cx: number, cy: number, cz: number,
  radius: number,
  filter?: SpatialFilter,
  sc?: Scene,
): OverlapHit[] {
  const targetScene = ensureIndex(sc);
  if (targetScene === null) return [];

  const mask = filter !== undefined && filter.mask !== undefined ? filter.mask : MASK_ALL;
  const layer = filter !== undefined && filter.layer !== undefined ? filter.layer : LAYER_DEFAULT;
  const includeTriggers = filter !== undefined && filter.includeTriggers !== undefined ? filter.includeTriggers : false;

  sQueryStamp = sQueryStamp + 1;
  const stamp = sQueryStamp;

  const minGx = mfloor((cx - radius) * sInvCellSize);
  const maxGx = mfloor((cx + radius) * sInvCellSize);
  const minGz = mfloor((cz - radius) * sInvCellSize);
  const maxGz = mfloor((cz + radius) * sInvCellSize);

  const result: OverlapHit[] = [];

  let gx = minGx;
  while (gx <= maxGx) {
    let gz = minGz;
    while (gz <= maxGz) {
      const bucket = sHash(gx, gz);
      let entry = sHead[bucket];
      while (entry !== -1) {
        const k = sEntriesObj[entry];
        if (sVisitedStamp[k] !== stamp) {
          sVisitedStamp[k] = stamp;
          const go = sObjs[k];
          if (passesFilter(mask, layer, includeTriggers, go)) {
            const hit = createOverlapHit();
            if (overlapSphereObject(k, cx, cy, cz, radius, hit, includeTriggers)) {
              result.push(hit);
            }
          }
        }
        entry = sEntriesNext[entry];
      }
      gz = gz + 1;
    }
    gx = gx + 1;
  }

  if (result.length > 1) {
    sortHitsInPlace(result, result.length);
  }
  return result;
}

// ── OVERLAP BOX GEOMETRIA E IMPLEMENTAÇÃO ──────────────────────────────────

function overlapBoxObject(
  k: number,
  cx: f64, cy: f64, cz: f64,
  hx: f64, hy: f64, hz: f64,
  outHit: OverlapHit,
  includeTriggers: boolean,
): boolean {
  const go = sObjs[k];
  const t = sTrs[k];
  const tcx = centerWorldX(go, t);
  const tcy = centerWorldY(go, t);
  const tcz = centerWorldZ(go, t);
  const shape = shapeOf(go);
  const isTrigger = triggerOf(go) !== 0;

  if (shape === COL_SPHERE) {
    // Esfera contra caixa (simétrico a overlapSphereObject)
    const tr = radiusOfCol(go, t);
    let rx = tcx - cx;
    let ry = tcy - cy;
    let rz = tcz - cz;

    let qx = rx;
    if (qx < 0.0 - hx) qx = 0.0 - hx; else if (qx > hx) qx = hx;
    let qy = ry;
    if (qy < 0.0 - hy) qy = 0.0 - hy; else if (qy > hy) qy = hy;
    let qz = rz;
    if (qz < 0.0 - hz) qz = 0.0 - hz; else if (qz > hz) qz = hz;

    const vx = rx - qx;
    const vy = ry - qy;
    const vz = rz - qz;
    const dist2 = vx * vx + vy * vy + vz * vz;
    if (dist2 >= tr * tr) return false;

    const dist = math.sqrt(dist2);
    let depth = 0.0;
    let nx = 0.0; let ny = 0.0; let nz = 0.0;

    if (dist > 0.0000001) {
      depth = tr - dist;
      nx = vx / dist;
      ny = vy / dist;
      nz = vz / dist;
    } else {
      const penX = hx - math.abs(rx);
      const penY = hy - math.abs(ry);
      const penZ = hz - math.abs(rz);
      if (penX <= penY && penX <= penZ) {
        nx = rx >= 0.0 ? 1.0 : 0.0 - 1.0;
        depth = tr + penX;
      } else if (penY <= penX && penY <= penZ) {
        ny = ry >= 0.0 ? 1.0 : 0.0 - 1.0;
        depth = tr + penY;
      } else {
        nz = rz >= 0.0 ? 1.0 : 0.0 - 1.0;
        depth = tr + penZ;
      }
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.depth = isTrigger ? 0.0 : depth;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  if (shape === COL_BOX) {
    const thx = halfXOf(go, t);
    const thy = halfYOf(go, t);
    const thz = halfZOf(go, t);
    const yaw = t.wry;

    // Se o alvo não tem rotação (ou muito próxima de zero), AABB vs AABB direto
    if (math.abs(yaw) < 0.00001) {
      const dx = math.abs(tcx - cx) - (hx + thx);
      const dy = math.abs(tcy - cy) - (hy + thy);
      const dz = math.abs(tcz - cz) - (hz + thz);

      if (dx >= 0.0 || dy >= 0.0 || dz >= 0.0) return false;

      let depth = 0.0 - dx;
      let nx = tcx >= cx ? 1.0 : 0.0 - 1.0;
      let ny = 0.0;
      let nz = 0.0;

      if ((0.0 - dy) < depth) {
        depth = 0.0 - dy;
        nx = 0.0;
        ny = tcy >= cy ? 1.0 : 0.0 - 1.0;
        nz = 0.0;
      }
      if ((0.0 - dz) < depth) {
        depth = 0.0 - dz;
        nx = 0.0;
        ny = 0.0;
        nz = tcz >= cz ? 1.0 : 0.0 - 1.0;
      }

      outHit.hit = true;
      outHit.bodyId = go.id;
      outHit.depth = isTrigger ? 0.0 : depth;
      outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
      outHit.stepId = getSpatialStepId();
      return true;
    }

    // SAT OBB em XZ + intervalo em Y
    const dy = math.abs(tcy - cy) - (hy + thy);
    if (dy >= 0.0) return false;

    const cosY = math.cos(yaw);
    const sinY = math.sin(yaw);

    // Eixos a testar em XZ:
    // Eixo 1: (1, 0)
    const ax1 = math.abs(cosY) * thx + math.abs(sinY) * thz + hx;
    const pen1 = ax1 - math.abs(tcx - cx);
    if (pen1 <= 0.0) return false;

    // Eixo 2: (0, 1)
    const ax2 = math.abs(sinY) * thx + math.abs(cosY) * thz + hz;
    const pen2 = ax2 - math.abs(tcz - cz);
    if (pen2 <= 0.0) return false;

    // Eixo 3: (cosY, sinY)
    const dX = tcx - cx;
    const dZ = tcz - cz;
    const projD3 = math.abs(dX * cosY + dZ * sinY);
    const ax3 = thx + math.abs(cosY) * hx + math.abs(sinY) * hz;
    const pen3 = ax3 - projD3;
    if (pen3 <= 0.0) return false;

    // Eixo 4: (-sinY, cosY)
    const projD4 = math.abs(0.0 - dX * sinY + dZ * cosY);
    const ax4 = thz + math.abs(sinY) * hx + math.abs(cosY) * hz;
    const pen4 = ax4 - projD4;
    if (pen4 <= 0.0) return false;

    // Menor penetração entre os eixos testados
    let minPen = pen1;
    let nx = tcx >= cx ? 1.0 : 0.0 - 1.0;
    let ny = 0.0;
    let nz = 0.0;

    if (pen2 < minPen) {
      minPen = pen2;
      nx = 0.0; ny = 0.0; nz = tcz >= cz ? 1.0 : 0.0 - 1.0;
    }
    if (0.0 - dy < minPen) {
      minPen = 0.0 - dy;
      nx = 0.0; ny = tcy >= cy ? 1.0 : 0.0 - 1.0; nz = 0.0;
    }
    if (pen3 < minPen) {
      minPen = pen3;
      nx = (dX * cosY + dZ * sinY) >= 0.0 ? cosY : 0.0 - cosY;
      ny = 0.0;
      nz = (dX * cosY + dZ * sinY) >= 0.0 ? sinY : 0.0 - sinY;
    }
    if (pen4 < minPen) {
      minPen = pen4;
      nx = (0.0 - dX * sinY + dZ * cosY) >= 0.0 ? 0.0 - sinY : sinY;
      ny = 0.0;
      nz = (0.0 - dX * sinY + dZ * cosY) >= 0.0 ? cosY : 0.0 - cosY;
    }

    outHit.hit = true;
    outHit.bodyId = go.id;
    outHit.depth = isTrigger ? 0.0 : minPen;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = getSpatialStepId();
    return true;
  }

  return false;
}

export function overlapBoxNonAlloc(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  outHits: OverlapHit[],
  maxHits: number,
  mask: number = MASK_ALL,
  layer: number = LAYER_DEFAULT,
  includeTriggers: boolean = false,
  sc?: Scene,
): number {
  const targetScene = ensureIndex(sc);
  if (targetScene === null || maxHits <= 0) return 0;

  sQueryStamp = sQueryStamp + 1;
  const stamp = sQueryStamp;

  const minGx = mfloor((cx - hx) * sInvCellSize);
  const maxGx = mfloor((cx + hx) * sInvCellSize);
  const minGz = mfloor((cz - hz) * sInvCellSize);
  const maxGz = mfloor((cz + hz) * sInvCellSize);

  let storedCount = 0;
  let totalFound = 0;

  let gx = minGx;
  while (gx <= maxGx) {
    let gz = minGz;
    while (gz <= maxGz) {
      const bucket = sHash(gx, gz);
      let entry = sHead[bucket];
      while (entry !== -1) {
        const k = sEntriesObj[entry];
        if (sVisitedStamp[k] !== stamp) {
          sVisitedStamp[k] = stamp;
          const go = sObjs[k];
          if (passesFilter(mask, layer, includeTriggers, go)) {
            if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, sCandidateOverlapHit, includeTriggers)) {
              totalFound = totalFound + 1;
              const candId = sCandidateOverlapHit.bodyId;
              if (storedCount < maxHits) {
                let pos = storedCount;
                while (pos > 0 && outHits[pos - 1].bodyId > candId) {
                  copyOverlapHit(outHits[pos], outHits[pos - 1]);
                  pos = pos - 1;
                }
                copyOverlapHit(outHits[pos], sCandidateOverlapHit);
                storedCount = storedCount + 1;
              } else if (candId < outHits[maxHits - 1].bodyId) {
                let pos = maxHits - 1;
                while (pos > 0 && outHits[pos - 1].bodyId > candId) {
                  copyOverlapHit(outHits[pos], outHits[pos - 1]);
                  pos = pos - 1;
                }
                copyOverlapHit(outHits[pos], sCandidateOverlapHit);
              }
            }
          }
        }
        entry = sEntriesNext[entry];
      }
      gz = gz + 1;
    }
    gx = gx + 1;
  }

  return totalFound;
}

export function overlapBox(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  filter?: SpatialFilter,
  sc?: Scene,
): OverlapHit[] {
  const targetScene = ensureIndex(sc);
  if (targetScene === null) return [];

  const mask = filter !== undefined && filter.mask !== undefined ? filter.mask : MASK_ALL;
  const layer = filter !== undefined && filter.layer !== undefined ? filter.layer : LAYER_DEFAULT;
  const includeTriggers = filter !== undefined && filter.includeTriggers !== undefined ? filter.includeTriggers : false;

  sQueryStamp = sQueryStamp + 1;
  const stamp = sQueryStamp;

  const minGx = mfloor((cx - hx) * sInvCellSize);
  const maxGx = mfloor((cx + hx) * sInvCellSize);
  const minGz = mfloor((cz - hz) * sInvCellSize);
  const maxGz = mfloor((cz + hz) * sInvCellSize);

  const result: OverlapHit[] = [];

  let gx = minGx;
  while (gx <= maxGx) {
    let gz = minGz;
    while (gz <= maxGz) {
      const bucket = sHash(gx, gz);
      let entry = sHead[bucket];
      while (entry !== -1) {
        const k = sEntriesObj[entry];
        if (sVisitedStamp[k] !== stamp) {
          sVisitedStamp[k] = stamp;
          const go = sObjs[k];
          if (passesFilter(mask, layer, includeTriggers, go)) {
            const hit = createOverlapHit();
            if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, hit, includeTriggers)) {
              result.push(hit);
            }
          }
        }
        entry = sEntriesNext[entry];
      }
      gz = gz + 1;
    }
    gx = gx + 1;
  }

  if (result.length > 1) {
    sortHitsInPlace(result, result.length);
  }
  return result;
}

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
         radiusOfCol, triggerOf, hullIdOf, halfLocalX, halfLocalY, halfLocalZ,
         centerLocalX, centerLocalY, centerLocalZ,
         SHAPE_SPHERE, SHAPE_BOX, SHAPE_HULL } from "./collider";
import { hullAt } from "./hullreg";
import { hullContactLocal, Contact } from "./hullpack";
import { stepCount } from "./fixedstep";
import { pbActiveBackend, pbGpuLastReadbackStep } from "./physics_backend";
import { BODY_STATIC, bodyTypeOf, LAYER_DEFAULT, MASK_ALL } from "../rigid/materials";

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
let sObjCap = 4096;
let sDynHead: number[] = new Array(SGRID_CAP).fill(-1);
let sDynNext: number[] = new Array(sObjCap).fill(-1);
let sDynCell: number[] = new Array(sObjCap).fill(0);
let sPrevDynCount = 0;
let sDynamicMaxHalfExtent = 0.5;
let sDynCellSize = 2.0;
let sDynInvCellSize = 0.5;
let sBucketStamp: number[] = new Array(SGRID_CAP).fill(0);

let sStaticHead: number[] = new Array(SGRID_CAP).fill(-1);
let sStaticUsedBuckets: number[] = new Array(SGRID_CAP).fill(0);
let sStaticUsedBucketsCount = 0;
let sStaticEntriesCap = 32768;
let sStaticEntriesObj: number[] = new Array(sStaticEntriesCap).fill(0);
let sStaticEntriesNext: number[] = new Array(sStaticEntriesCap).fill(0);
let sStaticEntriesCount = 0;
let sStaticCellSize = 2.0;
let sStaticInvCellSize = 0.5;
let sStaticMaxHalfExtent = 0.5;

function growStaticEntries(): void {
  const newCap = sStaticEntriesCap * 2;
  while (sStaticEntriesObj.length < newCap) {
    sStaticEntriesObj.push(0);
    sStaticEntriesNext.push(0);
  }
  sStaticEntriesCap = newCap;
}

let sObjs: GameObject[] = [];
let sTrs: Transform[] = [];

let sLocalHx: number[] = new Array(sObjCap).fill(0.5);
let sLocalHy: number[] = new Array(sObjCap).fill(0.5);
let sLocalHz: number[] = new Array(sObjCap).fill(0.5);
let sLocalCx: number[] = new Array(sObjCap).fill(0.0);
let sLocalCy: number[] = new Array(sObjCap).fill(0.0);
let sLocalCz: number[] = new Array(sObjCap).fill(0.0);

let sWorldCx: number[] = new Array(sObjCap).fill(0.0);
let sWorldCy: number[] = new Array(sObjCap).fill(0.0);
let sWorldCz: number[] = new Array(sObjCap).fill(0.0);
let sWorldHx: number[] = new Array(sObjCap).fill(0.5);
let sWorldHy: number[] = new Array(sObjCap).fill(0.5);
let sWorldHz: number[] = new Array(sObjCap).fill(0.5);
let sWorldRadius: number[] = new Array(sObjCap).fill(0.5);

let sShape: number[] = new Array(sObjCap).fill(0);
let sTrigger: number[] = new Array(sObjCap).fill(0);
let sHullId: number[] = new Array(sObjCap).fill(0);
let sIsStatic: number[] = new Array(sObjCap).fill(0);
let sLayer: number[] = new Array(sObjCap).fill(0);
let sMask: number[] = new Array(sObjCap).fill(0);

let sBodyId: number[] = new Array(sObjCap).fill(0);
let sYaw: number[] = new Array(sObjCap).fill(0.0);

let sStaticIndices: number[] = new Array(sObjCap).fill(0);
let sStaticCount = 0;
let sDynamicIndices: number[] = new Array(sObjCap).fill(0);
let sDynamicCount = 0;

let sMinX: number[] = new Array(sObjCap).fill(0.0);
let sMaxX: number[] = new Array(sObjCap).fill(0.0);
let sMinY: number[] = new Array(sObjCap).fill(0.0);
let sMaxY: number[] = new Array(sObjCap).fill(0.0);
let sMinZ: number[] = new Array(sObjCap).fill(0.0);
let sMaxZ: number[] = new Array(sObjCap).fill(0.0);

let sStaticSceneMinX = 0.0; let sStaticSceneMaxX = 0.0;
let sStaticSceneMinY = 0.0; let sStaticSceneMaxY = 0.0;
let sStaticSceneMinZ = 0.0; let sStaticSceneMaxZ = 0.0;

let sSceneMinX = 0.0;
let sSceneMaxX = 0.0;
let sSceneMinY = 0.0;
let sSceneMaxY = 0.0;
let sSceneMinZ = 0.0;
let sSceneMaxZ = 0.0;

let sCellSize = 2.0;
let sInvCellSize = 0.5;
let sLastRebuildStep = -1;
let sLastSceneVersion = -1;

let sQueryStamp = 0;
let sVisitedStamp: number[] = new Array(sObjCap).fill(0);

function ensureObjCapacity(cap: number): void {
  if (sObjCap >= cap) return;
  let newCap = sObjCap * 2;
  while (newCap < cap) newCap = newCap * 2;
  while (sLocalHx.length < newCap) {
    sLocalHx.push(0.5); sLocalHy.push(0.5); sLocalHz.push(0.5);
    sLocalCx.push(0.0); sLocalCy.push(0.0); sLocalCz.push(0.0);
    sWorldCx.push(0.0); sWorldCy.push(0.0); sWorldCz.push(0.0);
    sWorldHx.push(0.5); sWorldHy.push(0.5); sWorldHz.push(0.5);
    sWorldRadius.push(0.5);
    sShape.push(0); sTrigger.push(0); sHullId.push(0); sIsStatic.push(0);
    sLayer.push(0); sMask.push(0);
    sBodyId.push(0); sYaw.push(0.0);
    sStaticIndices.push(0); sDynamicIndices.push(0);
    sMinX.push(0.0); sMaxX.push(0.0);
    sMinY.push(0.0); sMaxY.push(0.0);
    sMinZ.push(0.0); sMaxZ.push(0.0);
    sVisitedStamp.push(0);
    sDynNext.push(-1);
    sDynCell.push(0);
  }
  sObjCap = newCap;
}

// Instância única reusada para testes de casca sem alocação
const sHullContactOut: Contact = new Contact();

export function setSpatialScene(sc: Scene | null): void {
  sActiveScene = sc;
  sLastRebuildStep = -1;
  sLastSceneVersion = -1;
  let b = 0;
  while (b < sStaticUsedBucketsCount) {
    sStaticHead[sStaticUsedBuckets[b]] = -1;
    b = b + 1;
  }
  sStaticUsedBucketsCount = 0;
  sStaticEntriesCount = 0;

  let di = 0;
  while (di < sPrevDynCount) {
    sDynHead[sDynCell[di]] = -1;
    di = di + 1;
  }
  sPrevDynCount = 0;
}

export function getSpatialScene(): Scene | null {
  return sActiveScene;
}

function mfloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

function sHash(gx: number, gy: number, gz: number): number {
  return (((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & SGRID_MASK);
}

const sRebuildStatsOut: f64[] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

/// Reconstrução dos objetos dinâmicos no índice espacial como FUNÇÃO LIVRE de parâmetros TIPADOS.
///
/// Segue o mesmo padrão de `computeWorldInto` e `buildSceneGrid` em `scene.ts`:
/// parâmetros com anotações explícitas de array tipado (`f64[]`, `number[]`, `Transform[]`)
/// e constantes de máscara/multiplicadores locais evitam o caminho dinâmico do runtime.
function rebuildDynamicsInto(
  dynamicCount: number,
  dynamicIndices: number[],
  trs: Transform[],
  yawArr: f64[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  worldCxArr: f64[], worldCyArr: f64[], worldCzArr: f64[],
  minXArr: f64[], maxXArr: f64[],
  minYArr: f64[], maxYArr: f64[],
  minZArr: f64[], maxZArr: f64[],
  invCellSize: f64,
  dynHead: number[],
  dynNext: number[],
  dynCell: number[],
  prevDynCount: number,
  countsAndBoundsOut: f64[],
): void {
  const mask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  // 1. Limpa APENAS os buckets sujos na passada anterior (no máximo prevDynCount)
  let k = 0;
  while (k < prevDynCount) {
    dynHead[dynCell[k]] = -1;
    k = k + 1;
  }

  let sceneMinX = countsAndBoundsOut[2];
  let sceneMaxX = countsAndBoundsOut[3];
  let sceneMinY = countsAndBoundsOut[4];
  let sceneMaxY = countsAndBoundsOut[5];
  let sceneMinZ = countsAndBoundsOut[6];
  let sceneMaxZ = countsAndBoundsOut[7];

  let di = 0;
  while (di < dynamicCount) {
    const objIdx = dynamicIndices[di];
    const t: Transform = trs[objIdx];
    yawArr[objIdx] = t.wry;
    const hx = worldHxArr[objIdx];
    const hy = worldHyArr[objIdx];
    const hz = worldHzArr[objIdx];
    const lcx = localCxArr[objIdx];
    const lcy = localCyArr[objIdx];
    const lcz = localCzArr[objIdx];
    let cx = t.wx;
    let cy = t.wy;
    let cz = t.wz;
    if (lcx !== 0.0 || lcz !== 0.0) {
      const ox = lcx * t.sx; const oz = lcz * t.sz;
      if (t.wry === 0.0) {
        cx = cx + ox;
        cz = cz + oz;
      } else {
        const cs = math.cos(t.wry); const sn = math.sin(t.wry);
        cx = cx + (ox * cs + oz * sn);
        cz = cz + (0.0 - ox * sn + oz * cs);
      }
    }
    if (lcy !== 0.0) {
      cy = cy + lcy * t.sy;
    }
    worldCxArr[objIdx] = cx; worldCyArr[objIdx] = cy; worldCzArr[objIdx] = cz;

    const minX = cx - hx; const maxX = cx + hx;
    const minY = cy - hy; const maxY = cy + hy;
    const minZ = cz - hz; const maxZ = cz + hz;
    minXArr[objIdx] = minX; maxXArr[objIdx] = maxX;
    minYArr[objIdx] = minY; maxYArr[objIdx] = maxY;
    minZArr[objIdx] = minZ; maxZArr[objIdx] = maxZ;

    if (minX < sceneMinX) sceneMinX = minX;
    if (maxX > sceneMaxX) sceneMaxX = maxX;
    if (minY < sceneMinY) sceneMinY = minY;
    if (maxY > sceneMaxY) sceneMaxY = maxY;
    if (minZ < sceneMinZ) sceneMinZ = minZ;
    if (maxZ > sceneMaxZ) sceneMaxZ = maxZ;

    const gx = mfloor(cx * invCellSize);
    const gy = mfloor(cy * invCellSize);
    const gz = mfloor(cz * invCellSize);
    const bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);

    dynCell[di] = bucket;
    dynNext[objIdx] = dynHead[bucket];
    dynHead[bucket] = objIdx;

    di = di + 1;
  }

  countsAndBoundsOut[2] = sceneMinX;
  countsAndBoundsOut[3] = sceneMaxX;
  countsAndBoundsOut[4] = sceneMinY;
  countsAndBoundsOut[5] = sceneMaxY;
  countsAndBoundsOut[6] = sceneMinZ;
  countsAndBoundsOut[7] = sceneMaxZ;
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

  const compVer = targetScene.compVersion;
  if (sLastSceneVersion !== compVer) {
    const allObjs = targetScene.objects;
    const n = allObjs.length;
    ensureObjCapacity(n);

    sObjs.length = 0;
    sTrs.length = 0;
    sStaticCount = 0;
    sDynamicCount = 0;
    let maxStaticHalfExtent: f64 = 0.5;
    let maxDynamicHalfExtent: f64 = 0.5;

    let i = 0;
    while (i < n) {
      const o = allObjs[i];
      if (o.active !== 0 && (o.collideFlag !== 0 || o.colIdx >= 0)) {
        const k = sObjs.length;
        sObjs.push(o);
        const t = o.transform;
        sTrs.push(t);

        const shp = shapeOf(o);
        const trig = triggerOf(o);
        const hid = hullIdOf(o);
        const lhx = halfLocalX(o);
        const lhy = halfLocalY(o);
        const lhz = halfLocalZ(o);
        const lcx = centerLocalX(o);
        const lcy = centerLocalY(o);
        const lcz = centerLocalZ(o);
        const isStat = (bodyTypeOf(o) === BODY_STATIC) ? 1 : 0;

        sShape[k] = shp;
        sTrigger[k] = trig;
        sHullId[k] = hid;
        sLocalHx[k] = lhx;
        sLocalHy[k] = lhy;
        sLocalHz[k] = lhz;
        sLocalCx[k] = lcx;
        sLocalCy[k] = lcy;
        sLocalCz[k] = lcz;
        sIsStatic[k] = isStat;
        sLayer[k] = o.layer;
        sMask[k] = o.mask;
        sBodyId[k] = o.id;

        const hx = lhx * t.sx;
        const hy = lhy * t.sy;
        const hz = lhz * t.sz;

        sWorldHx[k] = hx;
        sWorldHy[k] = hy;
        sWorldHz[k] = hz;
        sWorldRadius[k] = hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz);

        if (isStat !== 0) {
          if (hx > maxStaticHalfExtent) maxStaticHalfExtent = hx;
          if (hy > maxStaticHalfExtent) maxStaticHalfExtent = hy;
          if (hz > maxStaticHalfExtent) maxStaticHalfExtent = hz;
          sStaticIndices[sStaticCount] = k;
          sStaticCount = sStaticCount + 1;
        } else {
          if (hx > maxDynamicHalfExtent) maxDynamicHalfExtent = hx;
          if (hy > maxDynamicHalfExtent) maxDynamicHalfExtent = hy;
          if (hz > maxDynamicHalfExtent) maxDynamicHalfExtent = hz;
          sDynamicIndices[sDynamicCount] = k;
          sDynamicCount = sDynamicCount + 1;
        }
      }
      i = i + 1;
    }

    // Célula estática dimensionada dinamicamente para 2 * maiorMeiaExtensãoEstática
    sStaticMaxHalfExtent = maxStaticHalfExtent;
    sStaticCellSize = maxStaticHalfExtent * 2.0;
    if (sStaticCellSize < 2.0) sStaticCellSize = 2.0;
    sStaticInvCellSize = 1.0 / sStaticCellSize;

    // Célula dinâmica dimensionada para 2 * maiorMeiaExtensão dinâmica
    sDynamicMaxHalfExtent = maxDynamicHalfExtent;
    sDynCellSize = maxDynamicHalfExtent * 2.0;
    if (sDynCellSize < 2.0) sDynCellSize = 2.0;
    sDynInvCellSize = 1.0 / sDynCellSize;
    sCellSize = sDynCellSize;
    sInvCellSize = sDynInvCellSize;

    // Limpa buckets estáticos
    let b = 0;
    while (b < sStaticUsedBucketsCount) {
      sStaticHead[sStaticUsedBuckets[b]] = -1;
      b = b + 1;
    }
    sStaticUsedBucketsCount = 0;
    sStaticEntriesCount = 0;

    sStaticSceneMinX = 1e30; sStaticSceneMaxX = -1e30;
    sStaticSceneMinY = 1e30; sStaticSceneMaxY = -1e30;
    sStaticSceneMinZ = 1e30; sStaticSceneMaxZ = -1e30;

    let si = 0;
    while (si < sStaticCount) {
      const k = sStaticIndices[si];
      const t = sTrs[k];
      sYaw[k] = t.wry;
      const hx = sWorldHx[k];
      const hy = sWorldHy[k];
      const hz = sWorldHz[k];
      const lcx = sLocalCx[k];
      const lcy = sLocalCy[k];
      const lcz = sLocalCz[k];
      let cx = t.wx;
      let cy = t.wy;
      let cz = t.wz;
      if (lcx !== 0.0 || lcz !== 0.0) {
        const ox = lcx * t.sx; const oz = lcz * t.sz;
        if (t.wry === 0.0) {
          cx = cx + ox;
          cz = cz + oz;
        } else {
          const cs = math.cos(t.wry); const sn = math.sin(t.wry);
          cx = cx + (ox * cs + oz * sn);
          cz = cz + (0.0 - ox * sn + oz * cs);
        }
      }
      if (lcy !== 0.0) {
        cy = cy + lcy * t.sy;
      }
      sWorldCx[k] = cx; sWorldCy[k] = cy; sWorldCz[k] = cz;

      const minX = cx - hx; const maxX = cx + hx;
      const minY = cy - hy; const maxY = cy + hy;
      const minZ = cz - hz; const maxZ = cz + hz;
      sMinX[k] = minX; sMaxX[k] = maxX;
      sMinY[k] = minY; sMaxY[k] = maxY;
      sMinZ[k] = minZ; sMaxZ[k] = maxZ;

      if (minX < sStaticSceneMinX) sStaticSceneMinX = minX;
      if (maxX > sStaticSceneMaxX) sStaticSceneMaxX = maxX;
      if (minY < sStaticSceneMinY) sStaticSceneMinY = minY;
      if (maxY > sStaticSceneMaxY) sStaticSceneMaxY = maxY;
      if (minZ < sStaticSceneMinZ) sStaticSceneMinZ = minZ;
      if (maxZ > sStaticSceneMaxZ) sStaticSceneMaxZ = maxZ;

      const minGx = mfloor(minX * sStaticInvCellSize);
      const maxGx = mfloor(maxX * sStaticInvCellSize);
      const minGy = mfloor(minY * sStaticInvCellSize);
      const maxGy = mfloor(maxY * sStaticInvCellSize);
      const minGz = mfloor(minZ * sStaticInvCellSize);
      const maxGz = mfloor(maxZ * sStaticInvCellSize);

      let gx = minGx;
      while (gx <= maxGx) {
        const hashX = gx * 73856093;
        let gy = minGy;
        while (gy <= maxGy) {
          const gxy = hashX ^ (gy * 19349663);
          let gz = minGz;
          while (gz <= maxGz) {
            const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
            if (sStaticHead[bucket] === -1) {
              sStaticUsedBuckets[sStaticUsedBucketsCount] = bucket;
              sStaticUsedBucketsCount = sStaticUsedBucketsCount + 1;
            }
            const entryIdx = sStaticEntriesCount;
            sStaticEntriesCount = sStaticEntriesCount + 1;
            if (sStaticEntriesCount >= sStaticEntriesCap) growStaticEntries();
            sStaticEntriesObj[entryIdx] = k;
            sStaticEntriesNext[entryIdx] = sStaticHead[bucket];
            sStaticHead[bucket] = entryIdx;
            gz = gz + 1;
          }
          gy = gy + 1;
        }
        gx = gx + 1;
      }
      si = si + 1;
    }

    sLastSceneVersion = compVer;
  }

  sRebuildStatsOut[2] = sStaticCount > 0 ? sStaticSceneMinX : 1e30;
  sRebuildStatsOut[3] = sStaticCount > 0 ? sStaticSceneMaxX : -1e30;
  sRebuildStatsOut[4] = sStaticCount > 0 ? sStaticSceneMinY : 1e30;
  sRebuildStatsOut[5] = sStaticCount > 0 ? sStaticSceneMaxY : -1e30;
  sRebuildStatsOut[6] = sStaticCount > 0 ? sStaticSceneMinZ : 1e30;
  sRebuildStatsOut[7] = sStaticCount > 0 ? sStaticSceneMaxZ : -1e30;

  // Atualiza apenas os objetos dinâmicos através de FUNÇÃO LIVRE TIPADA
  rebuildDynamicsInto(
    sDynamicCount, sDynamicIndices, sTrs,
    sYaw, sWorldHx, sWorldHy, sWorldHz,
    sLocalCx, sLocalCy, sLocalCz,
    sWorldCx, sWorldCy, sWorldCz,
    sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
    sDynInvCellSize, sDynHead, sDynNext, sDynCell,
    sPrevDynCount,
    sRebuildStatsOut,
  );

  sPrevDynCount = sDynamicCount;
  sSceneMinX = sRebuildStatsOut[2];
  sSceneMaxX = sRebuildStatsOut[3];
  sSceneMinY = sRebuildStatsOut[4];
  sSceneMaxY = sRebuildStatsOut[5];
  sSceneMinZ = sRebuildStatsOut[6];
  sSceneMaxZ = sRebuildStatsOut[7];

  if (sObjs.length === 0) {
    sSceneMinX = 0.0; sSceneMaxX = 0.0;
    sSceneMinY = 0.0; sSceneMaxY = 0.0;
    sSceneMinZ = 0.0; sSceneMaxZ = 0.0;
  }

  sLastRebuildStep = getSpatialStepId();
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
    cellCount: sDynamicCount,
    objCount: sObjs.length,
  };
}

// ── FILTRO SIMÉTRICO E TRIGGERS (§5.2) ──────────────────────────────────────
function passesFilter(
  queryMask: number,
  queryLayer: number,
  includeTriggers: boolean,
  k: number,
): boolean {
  if (!includeTriggers && sTrigger[k] !== 0) {
    return false;
  }
  const targetLayer = sLayer[k];
  const targetMask = sMask[k];
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
  curStepId: number,
): boolean {
  const cx = sWorldCx[k];
  const cy = sWorldCy[k];
  const cz = sWorldCz[k];
  const shape = sShape[k];

  if (shape === COL_SPHERE) {
    const r = sWorldRadius[k];
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
        outHit.bodyId = sBodyId[k];
        outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
        outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
        outHit.distance = 0.0;
        outHit.stepId = curStepId;
        return true;
      }
      return false;
    }
    if (hitDist > maxDistance) return false;

    const px = ox + ndx * hitDist;
    const py = oy + ndy * hitDist;
    const pz = oz + ndz * hitDist;
    outHit.hit = true;
    outHit.bodyId = sBodyId[k];
    outHit.point[0] = px; outHit.point[1] = py; outHit.point[2] = pz;
    outHit.normal[0] = (px - cx) / r;
    outHit.normal[1] = (py - cy) / r;
    outHit.normal[2] = (pz - cz) / r;
    outHit.distance = hitDist;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_BOX) {
    const hx = sWorldHx[k];
    const hy = sWorldHy[k];
    const hz = sWorldHz[k];
    const yaw = sYaw[k];

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
      outHit.bodyId = sBodyId[k];
      outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
      outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
      outHit.distance = 0.0;
      outHit.stepId = curStepId;
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
    outHit.bodyId = sBodyId[k];
    outHit.point[0] = ox + ndx * tmin;
    outHit.point[1] = oy + ndy * tmin;
    outHit.point[2] = oz + ndz * tmin;
    outHit.normal[0] = nx;
    outHit.normal[1] = ny;
    outHit.normal[2] = nz;
    outHit.distance = tmin;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_HULL) {
    const hid = sHullId[k];
    const hull = hullAt(hid);
    if (hull === null) {
      // Degenera para caixa
      return false;
    }
    const t = sTrs[k];
    const yaw = sYaw[k];
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
      outHit.bodyId = sBodyId[k];
      outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
      outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
      outHit.distance = 0.0;
      outHit.stepId = curStepId;
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
    outHit.bodyId = sBodyId[k];
    outHit.point[0] = ox + ndx * tenter;
    outHit.point[1] = oy + ndy * tenter;
    outHit.point[2] = oz + ndz * tenter;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.distance = tenter;
    outHit.stepId = curStepId;
    return true;
  }

  return false;
}

// ── RAYCAST NON-ALLOC COM PARÂMETROS ESCALARES (§5.5) ───────────────────────

const sTempRayHit: RaycastHit = createRaycastHit();

function raycastStaticDDA(
  ox: f64, oy: f64, oz: f64,
  ndx: f64, ndy: f64, ndz: f64,
  maxDistance: f64,
  outHit: RaycastHit,
  mask: number,
  layer: number,
  includeTriggers: boolean,
  curStepId: number,
  stamp: number,
): boolean {
  if (sStaticCount === 0) return false;

  const cell = sStaticCellSize;
  const invCell = sStaticInvCellSize;

  const endX = ox + ndx * maxDistance;
  const endY = oy + ndy * maxDistance;
  const endZ = oz + ndz * maxDistance;
  const minRx = ox < endX ? ox : endX;
  const maxRx = ox > endX ? ox : endX;
  const minRy = oy < endY ? oy : endY;
  const maxRy = oy > endY ? oy : endY;
  const minRz = oz < endZ ? oz : endZ;
  const maxRz = oz > endZ ? oz : endZ;

  if (maxRx < sStaticSceneMinX || minRx > sStaticSceneMaxX ||
      maxRy < sStaticSceneMinY || minRy > sStaticSceneMaxY ||
      maxRz < sStaticSceneMinZ || minRz > sStaticSceneMaxZ) {
    return false;
  }

  let closestDist = maxDistance + 1.0;
  let found = false;

  let gx = mfloor(ox * invCell);
  let gy = mfloor(oy * invCell);
  let gz = mfloor(oz * invCell);

  let stepX = 0; let tDeltaX = 1e30; let tMaxX = 1e30;
  if (ndx > 0.000000001) {
    stepX = 1; tDeltaX = cell / ndx; tMaxX = ((gx + 1) * cell - ox) / ndx;
  } else if (ndx < -0.000000001) {
    stepX = -1; tDeltaX = (0.0 - cell) / ndx; tMaxX = (gx * cell - ox) / ndx;
  }

  let stepY = 0; let tDeltaY = 1e30; let tMaxY = 1e30;
  if (ndy > 0.000000001) {
    stepY = 1; tDeltaY = cell / ndy; tMaxY = ((gy + 1) * cell - oy) / ndy;
  } else if (ndy < -0.000000001) {
    stepY = -1; tDeltaY = (0.0 - cell) / ndy; tMaxY = (gy * cell - oy) / ndy;
  }

  let stepZ = 0; let tDeltaZ = 1e30; let tMaxZ = 1e30;
  if (ndz > 0.000000001) {
    stepZ = 1; tDeltaZ = cell / ndz; tMaxZ = ((gz + 1) * cell - oz) / ndz;
  } else if (ndz < -0.000000001) {
    stepZ = -1; tDeltaZ = (0.0 - cell) / ndz; tMaxZ = (gz * cell - oz) / ndz;
  }

  let tCurrent = 0.0;
  while (tCurrent <= closestDist && tCurrent <= maxDistance) {
    const bucket = (((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & SGRID_MASK);
    let entry = sStaticHead[bucket];
    while (entry !== -1) {
      const k = sStaticEntriesObj[entry];
      if (sVisitedStamp[k] !== stamp) {
        sVisitedStamp[k] = stamp;
        if (passesFilter(mask, layer, includeTriggers, k)) {
          const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId);
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
      entry = sStaticEntriesNext[entry];
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        tCurrent = tMaxX; gx = gx + stepX; tMaxX = tMaxX + tDeltaX;
      } else {
        tCurrent = tMaxZ; gz = gz + stepZ; tMaxZ = tMaxZ + tDeltaZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        tCurrent = tMaxY; gy = gy + stepY; tMaxY = tMaxY + tDeltaY;
      } else {
        tCurrent = tMaxZ; gz = gz + stepZ; tMaxZ = tMaxZ + tDeltaZ;
      }
    }
  }

  return found;
}

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
  const curStepId = getSpatialStepId();

  let closestDist = maxDistance;
  let found = false;

  // 1. Raycast contra estáticos (DDA exata atual)
  if (sStaticCount > 0) {
    if (raycastStaticDDA(ox, oy, oz, ndx, ndy, ndz, closestDist, outHit, mask, layer, includeTriggers, curStepId, stamp)) {
      closestDist = outHit.distance;
      found = true;
    }
  }

  // 2. Raycast contra dinâmicos
  if (sDynamicCount > 0) {
    const cell = sCellSize;
    const invCell = sInvCellSize;

    const endX = ox + ndx * closestDist;
    const endY = oy + ndy * closestDist;
    const endZ = oz + ndz * closestDist;
    const minRx = ox < endX ? ox : endX;
    const maxRx = ox > endX ? ox : endX;
    const minRy = oy < endY ? oy : endY;
    const maxRy = oy > endY ? oy : endY;
    const minRz = oz < endZ ? oz : endZ;
    const maxRz = oz > endZ ? oz : endZ;

    if (maxRx >= sSceneMinX && minRx <= sSceneMaxX &&
        maxRy >= sSceneMinY && minRy <= sSceneMaxY &&
        maxRz >= sSceneMinZ && minRz <= sSceneMaxZ) {
      let gx = mfloor(ox * invCell);
      let gy = mfloor(oy * invCell);
      let gz = mfloor(oz * invCell);

      let stepX = 0; let tDeltaX = 1e30; let tMaxX = 1e30;
      if (ndx > 0.000000001) {
        stepX = 1; tDeltaX = cell / ndx; tMaxX = ((gx + 1) * cell - ox) / ndx;
      } else if (ndx < -0.000000001) {
        stepX = -1; tDeltaX = (0.0 - cell) / ndx; tMaxX = (gx * cell - ox) / ndx;
      }

      let stepY = 0; let tDeltaY = 1e30; let tMaxY = 1e30;
      if (ndy > 0.000000001) {
        stepY = 1; tDeltaY = cell / ndy; tMaxY = ((gy + 1) * cell - oy) / ndy;
      } else if (ndy < -0.000000001) {
        stepY = -1; tDeltaY = (0.0 - cell) / ndy; tMaxY = (gy * cell - oy) / ndy;
      }

      let stepZ = 0; let tDeltaZ = 1e30; let tMaxZ = 1e30;
      if (ndz > 0.000000001) {
        stepZ = 1; tDeltaZ = cell / ndz; tMaxZ = ((gz + 1) * cell - oz) / ndz;
      } else if (ndz < -0.000000001) {
        stepZ = -1; tDeltaZ = (0.0 - cell) / ndz; tMaxZ = (gz * cell - oz) / ndz;
      }

      let tCurrent = 0.0;
      while (tCurrent <= closestDist && tCurrent <= maxDistance) {
        const bucket = (((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & SGRID_MASK);
        let k = sDynHead[bucket];
        while (k !== -1) {
          if (sVisitedStamp[k] !== stamp) {
            sVisitedStamp[k] = stamp;
            if (passesFilter(mask, layer, includeTriggers, k)) {
              const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId);
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
          k = sDynNext[k];
        }

        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            tCurrent = tMaxX; gx = gx + stepX; tMaxX = tMaxX + tDeltaX;
          } else {
            tCurrent = tMaxZ; gz = gz + stepZ; tMaxZ = tMaxZ + tDeltaZ;
          }
        } else {
          if (tMaxY < tMaxZ) {
            tCurrent = tMaxY; gy = gy + stepY; tMaxY = tMaxY + tDeltaY;
          } else {
            tCurrent = tMaxZ; gz = gz + stepZ; tMaxZ = tMaxZ + tDeltaZ;
          }
        }
      }
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
  curStepId: number,
): boolean {
  const tcx = sWorldCx[k];
  const tcy = sWorldCy[k];
  const tcz = sWorldCz[k];
  const shape = sShape[k];
  const isTrigger = sTrigger[k] !== 0;

  if (shape === COL_SPHERE) {
    const tr = sWorldRadius[k];
    const dx = tcx - cx;
    const dy = tcy - cy;
    const dz = tcz - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    const rSum = radius + tr;
    if (dist2 >= rSum * rSum) return false;

    const dist = math.sqrt(dist2);
    outHit.hit = true;
    outHit.bodyId = sBodyId[k];
    outHit.depth = isTrigger ? 0.0 : (rSum - dist);
    const norm = outHit.normal;
    if (dist > 0.0000001) {
      norm[0] = dx / dist;
      norm[1] = dy / dist;
      norm[2] = dz / dist;
    } else {
      norm[0] = 0.0;
      norm[1] = 1.0;
      norm[2] = 0.0;
    }
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_BOX) {
    const thx = sWorldHx[k];
    const thy = sWorldHy[k];
    const thz = sWorldHz[k];
    const yaw = sYaw[k];

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
    outHit.bodyId = sBodyId[k];
    outHit.depth = isTrigger ? 0.0 : depth;
    const norm = outHit.normal;
    norm[0] = wnx; norm[1] = wny; norm[2] = wnz;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_HULL) {
    const hid = sHullId[k];
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = sTrs[k];
    const yaw = sYaw[k];
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
    outHit.bodyId = sBodyId[k];
    outHit.depth = isTrigger ? 0.0 : sHullContactOut.depth;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.stepId = curStepId;
    return true;
  }

  return false;
}

function testOverlapSphereObject(
  k: number,
  cx: number, cy: number, cz: number,
  radius: number,
): boolean {
  const shape = sShape[k];
  const tcx = sWorldCx[k];
  const tcy = sWorldCy[k];
  const tcz = sWorldCz[k];

  if (shape === COL_SPHERE) {
    const rTarget = sWorldRadius[k];
    const dx = tcx - cx;
    const dy = tcy - cy;
    const dz = tcz - cz;
    const rSum = radius + rTarget;
    return (dx * dx + dy * dy + dz * dz < rSum * rSum);
  }

  if (shape === COL_BOX) {
    const thx = sWorldHx[k];
    const thy = sWorldHy[k];
    const thz = sWorldHz[k];
    const yaw = sYaw[k];

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
    return (vx * vx + vy * vy + vz * vz < radius * radius);
  }

  if (shape === COL_HULL) {
    const hid = sHullId[k];
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = sTrs[k];
    const yaw = sYaw[k];
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
    return hullContactLocal(hull, rx / sx, ry / sy, rz / sz, radius / menor, sHullContactOut) !== 0;
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

function overlapSphereInto(
  cx: f64, cy: f64, cz: f64,
  radius: f64,
  minGx: number, maxGx: number,
  minGy: number, maxGy: number,
  minGz: number, maxGz: number,
  minQx: f64, maxQx: f64,
  minQy: f64, maxQy: f64,
  minQz: f64, maxQz: f64,
  outHits: OverlapHit[],
  maxHits: number,
  mask: number,
  layer: number,
  includeTriggers: boolean,
  curStepId: number,
  head: number[],
  entriesObj: number[],
  entriesNext: number[],
  visitedStamp: number[],
  stamp: number,
  triggerArr: number[],
  layerArr: number[],
  maskArr: number[],
  minXArr: f64[], maxXArr: f64[],
  minYArr: f64[], maxYArr: f64[],
  minZArr: f64[], maxZArr: f64[],
  bodyIdArr: number[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
): number {
  const gridMask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  let storedCount = startStoredCount;
  let totalFound = startTotalFound;

  let gx = minGx;
  while (gx <= maxGx) {
    const hashX = gx * hxMult;
    let gy = minGy;
    while (gy <= maxGy) {
      const gxy = hashX ^ (gy * hyMult);
      let gz = minGz;
      while (gz <= maxGz) {
        const bucket = (gxy ^ (gz * hzMult)) & gridMask;
        let entry = head[bucket];
        while (entry !== -1) {
          const k = entriesObj[entry];
          if (visitedStamp[k] !== stamp) {
            visitedStamp[k] = stamp;
            if (includeTriggers || triggerArr[k] === 0) {
              if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {
                if (minXArr[k] <= maxQx && maxXArr[k] >= minQx &&
                    minYArr[k] <= maxQy && maxYArr[k] >= minQy &&
                    minZArr[k] <= maxQz && maxZArr[k] >= minQz) {
                  if (storedCount < maxHits) {
                    const target = outHits[storedCount];
                    if (overlapSphereObject(k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
                      totalFound = totalFound + 1;
                      const candId = target.bodyId;
                      let p = storedCount;
                      while (p > 0 && outHits[p - 1].bodyId > candId) {
                        outHits[p] = outHits[p - 1];
                        p = p - 1;
                      }
                      outHits[p] = target;
                      storedCount = storedCount + 1;
                    }
                  } else {
                    const candId = bodyIdArr[k];
                    if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapSphereObject(k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
                        totalFound = totalFound + 1;
                        const target = outHits[maxHits - 1];
                        target.hit = true;
                        target.bodyId = candId;
                        target.depth = candHit.depth;
                        const tn = target.normal;
                        const sn = candHit.normal;
                        tn[0] = sn[0]; tn[1] = sn[1]; tn[2] = sn[2];
                        target.stepId = curStepId;
                        let p = maxHits - 1;
                        while (p > 0 && outHits[p - 1].bodyId > candId) {
                          outHits[p] = outHits[p - 1];
                          p = p - 1;
                        }
                        outHits[p] = target;
                      }
                    } else {
                      if (testOverlapSphereObject(k, cx, cy, cz, radius)) {
                        totalFound = totalFound + 1;
                      }
                    }
                  }
                }
              }
            }
          }
          entry = entriesNext[entry];
        }
        gz = gz + 1;
      }
      gy = gy + 1;
    }
    gx = gx + 1;
  }

  return totalFound;
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
  const curStepId = getSpatialStepId();

  const minQx = cx - radius;
  const maxQx = cx + radius;
  const minQy = cy - radius;
  const maxQy = cy + radius;
  const minQz = cz - radius;
  const maxQz = cz + radius;

  let storedCount = 0;
  let totalFound = 0;

  // 1. Estáticos
  if (sStaticCount > 0) {
    const minGx = mfloor(minQx * sStaticInvCellSize);
    const maxGx = mfloor(maxQx * sStaticInvCellSize);
    const minGy = mfloor(minQy * sStaticInvCellSize);
    const maxGy = mfloor(maxQy * sStaticInvCellSize);
    const minGz = mfloor(minQz * sStaticInvCellSize);
    const maxGz = mfloor(maxQz * sStaticInvCellSize);

    totalFound = overlapSphereInto(
      cx, cy, cz, radius,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, maxHits, mask, layer, includeTriggers, curStepId,
      sStaticHead, sStaticEntriesObj, sStaticEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      0, 0,
    );
    storedCount = totalFound < maxHits ? totalFound : maxHits;
  }

  // 2. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          if (sBucketStamp[bucket] !== stamp) {
            sBucketStamp[bucket] = stamp;
            let k = sDynHead[bucket];
            while (k !== -1) {
              if (includeTriggers || sTrigger[k] === 0) {
                if ((mask & sLayer[k]) !== 0 && (sMask[k] & layer) !== 0) {
                  if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                      sMinY[k] <= maxQy && sMaxY[k] >= minQy &&
                      sMinZ[k] <= maxQz && sMaxZ[k] >= minQz) {
                    if (storedCount < maxHits) {
                      const target = outHits[storedCount];
                      if (overlapSphereObject(k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
                        totalFound = totalFound + 1;
                        const candId = target.bodyId;
                        let p = storedCount;
                        while (p > 0 && outHits[p - 1].bodyId > candId) {
                          outHits[p] = outHits[p - 1];
                          p = p - 1;
                        }
                        outHits[p] = target;
                        storedCount = storedCount + 1;
                      }
                    } else {
                      const candId = sBodyId[k];
                      if (candId < outHits[maxHits - 1].bodyId) {
                        if (overlapSphereObject(k, cx, cy, cz, radius, sCandidateOverlapHit, includeTriggers, curStepId)) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, sCandidateOverlapHit);
                          let p = maxHits - 1;
                          while (p > 0 && outHits[p - 1].bodyId > candId) {
                            outHits[p] = outHits[p - 1];
                            p = p - 1;
                          }
                          outHits[p] = target;
                        }
                      } else {
                        if (testOverlapSphereObject(k, cx, cy, cz, radius)) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  }
                }
              }
              k = sDynNext[k];
            }
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
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
  const curStepId = getSpatialStepId();

  const minQx = cx - radius;
  const maxQx = cx + radius;
  const minQy = cy - radius;
  const maxQy = cy + radius;
  const minQz = cz - radius;
  const maxQz = cz + radius;

  const result: OverlapHit[] = [];

  // 1. Estáticos
  if (sStaticCount > 0) {
    const minGx = mfloor(minQx * sStaticInvCellSize);
    const maxGx = mfloor(maxQx * sStaticInvCellSize);
    const minGy = mfloor(minQy * sStaticInvCellSize);
    const maxGy = mfloor(maxQy * sStaticInvCellSize);
    const minGz = mfloor(minQz * sStaticInvCellSize);
    const maxGz = mfloor(maxQz * sStaticInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          let entry = sStaticHead[bucket];
          while (entry !== -1) {
            const k = sStaticEntriesObj[entry];
            if (sVisitedStamp[k] !== stamp) {
              sVisitedStamp[k] = stamp;
              if (passesFilter(mask, layer, includeTriggers, k)) {
                if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                    sMinY[k] <= maxQy && sMaxY[k] >= minQy &&
                    sMinZ[k] <= maxQz && sMaxZ[k] >= minQz) {
                  const hit = createOverlapHit();
                  if (overlapSphereObject(k, cx, cy, cz, radius, hit, includeTriggers, curStepId)) {
                    result.push(hit);
                  }
                }
              }
            }
            entry = sStaticEntriesNext[entry];
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
  }

  // 2. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          if (sBucketStamp[bucket] !== stamp) {
            sBucketStamp[bucket] = stamp;
            let k = sDynHead[bucket];
            while (k !== -1) {
              if (includeTriggers || sTrigger[k] === 0) {
                if ((mask & sLayer[k]) !== 0 && (sMask[k] & layer) !== 0) {
                  if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                      sMinY[k] <= maxQy && sMaxY[k] >= minQy &&
                      sMinZ[k] <= maxQz && sMaxZ[k] >= minQz) {
                    const hit = createOverlapHit();
                    if (overlapSphereObject(k, cx, cy, cz, radius, hit, includeTriggers, curStepId)) {
                      result.push(hit);
                    }
                  }
                }
              }
              k = sDynNext[k];
            }
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
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
  curStepId: number,
): boolean {
  const tcx = sWorldCx[k];
  const tcy = sWorldCy[k];
  const tcz = sWorldCz[k];
  const shape = sShape[k];
  const isTrigger = sTrigger[k] !== 0;

  if (shape === COL_SPHERE) {
    // Esfera contra caixa (simétrico a overlapSphereObject)
    const tr = sWorldRadius[k];
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
    outHit.bodyId = sBodyId[k];
    outHit.depth = isTrigger ? 0.0 : depth;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_BOX) {
    const thx = sWorldHx[k];
    const thy = sWorldHy[k];
    const thz = sWorldHz[k];
    const yaw = sYaw[k];

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
      outHit.bodyId = sBodyId[k];
      outHit.depth = isTrigger ? 0.0 : depth;
      outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
      outHit.stepId = curStepId;
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
    outHit.bodyId = sBodyId[k];
    outHit.depth = isTrigger ? 0.0 : minPen;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = curStepId;
    return true;
  }

  return false;
}

function testOverlapBoxObject(
  k: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): boolean {
  const shape = sShape[k];
  const tcx = sWorldCx[k];
  const tcy = sWorldCy[k];
  const tcz = sWorldCz[k];

  if (shape === COL_SPHERE) {
    const rTarget = sWorldRadius[k];
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
    return (vx * vx + vy * vy + vz * vz < rTarget * rTarget);
  }

  if (shape === COL_BOX) {
    const thx = sWorldHx[k];
    const thy = sWorldHy[k];
    const thz = sWorldHz[k];
    const yaw = sYaw[k];

    if (math.abs(yaw) < 0.00001) {
      const dx = math.abs(tcx - cx) - (hx + thx);
      const dy = math.abs(tcy - cy) - (hy + thy);
      const dz = math.abs(tcz - cz) - (hz + thz);
      return (dx < 0.0 && dy < 0.0 && dz < 0.0);
    }

    const dy = math.abs(tcy - cy) - (hy + thy);
    if (dy >= 0.0) return false;

    const cosY = math.cos(yaw);
    const sinY = math.sin(yaw);

    const ax1 = math.abs(cosY) * thx + math.abs(sinY) * thz + hx;
    if (ax1 - math.abs(tcx - cx) <= 0.0) return false;

    const ax2 = math.abs(sinY) * thx + math.abs(cosY) * thz + hz;
    if (ax2 - math.abs(tcz - cz) <= 0.0) return false;

    const dX = tcx - cx;
    const dZ = tcz - cz;
    const projD3 = math.abs(dX * cosY + dZ * sinY);
    const ax3 = thx + math.abs(cosY) * hx + math.abs(sinY) * hz;
    if (ax3 - projD3 <= 0.0) return false;

    const projD4 = math.abs(0.0 - dX * sinY + dZ * cosY);
    const ax4 = thz + math.abs(sinY) * hx + math.abs(cosY) * hz;
    if (ax4 - projD4 <= 0.0) return false;

    return true;
  }

  if (shape === COL_HULL) {
    const hid = sHullId[k];
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = sTrs[k];
    const yaw = sYaw[k];
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
    return hullContactLocal(hull, rx / sx, ry / sy, rz / sz, (hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz)) / menor, sHullContactOut) !== 0;
  }

  return false;
}

function overlapBoxInto(
  cx: f64, cy: f64, cz: f64,
  hx: f64, hy: f64, hz: f64,
  minGx: number, maxGx: number,
  minGy: number, maxGy: number,
  minGz: number, maxGz: number,
  minQx: f64, maxQx: f64,
  minQy: f64, maxQy: f64,
  minQz: f64, maxQz: f64,
  outHits: OverlapHit[],
  maxHits: number,
  mask: number,
  layer: number,
  includeTriggers: boolean,
  curStepId: number,
  head: number[],
  entriesObj: number[],
  entriesNext: number[],
  visitedStamp: number[],
  stamp: number,
  triggerArr: number[],
  layerArr: number[],
  maskArr: number[],
  minXArr: f64[], maxXArr: f64[],
  minYArr: f64[], maxYArr: f64[],
  minZArr: f64[], maxZArr: f64[],
  bodyIdArr: number[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
): number {
  const gridMask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  let storedCount = startStoredCount;
  let totalFound = startTotalFound;

  let gx = minGx;
  while (gx <= maxGx) {
    const hashX = gx * hxMult;
    let gy = minGy;
    while (gy <= maxGy) {
      const gxy = hashX ^ (gy * hyMult);
      let gz = minGz;
      while (gz <= maxGz) {
        const bucket = (gxy ^ (gz * hzMult)) & gridMask;
        let entry = head[bucket];
        while (entry !== -1) {
          const k = entriesObj[entry];
          if (visitedStamp[k] !== stamp) {
            visitedStamp[k] = stamp;
            if (includeTriggers || triggerArr[k] === 0) {
              if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {
                if (minXArr[k] <= maxQx && maxXArr[k] >= minQx &&
                    minYArr[k] <= maxQy && maxYArr[k] >= minQy &&
                    minZArr[k] <= maxQz && maxZArr[k] >= minQz) {
                  if (storedCount < maxHits) {
                    const target = outHits[storedCount];
                    if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                      totalFound = totalFound + 1;
                      const candId = target.bodyId;
                      let p = storedCount;
                      while (p > 0 && outHits[p - 1].bodyId > candId) {
                        outHits[p] = outHits[p - 1];
                        p = p - 1;
                      }
                      outHits[p] = target;
                      storedCount = storedCount + 1;
                    }
                  } else {
                    const candId = bodyIdArr[k];
                    if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                        totalFound = totalFound + 1;
                        const target = outHits[maxHits - 1];
                        copyOverlapHit(target, candHit);
                        let p = maxHits - 1;
                        while (p > 0 && outHits[p - 1].bodyId > candId) {
                          outHits[p] = outHits[p - 1];
                          p = p - 1;
                        }
                        outHits[p] = target;
                      }
                    } else {
                      if (testOverlapBoxObject(k, cx, cy, cz, hx, hy, hz)) {
                        totalFound = totalFound + 1;
                      }
                    }
                  }
                }
              }
            }
          }
          entry = entriesNext[entry];
        }
        gz = gz + 1;
      }
      gy = gy + 1;
    }
    gx = gx + 1;
  }

  return totalFound;
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
  const curStepId = getSpatialStepId();

  const minQx = cx - hx;
  const maxQx = cx + hx;
  const minQy = cy - hy;
  const maxQy = cy + hy;
  const minQz = cz - hz;
  const maxQz = cz + hz;

  let storedCount = 0;
  let totalFound = 0;

  // 1. Estáticos
  if (sStaticCount > 0) {
    const minGx = mfloor(minQx * sStaticInvCellSize);
    const maxGx = mfloor(maxQx * sStaticInvCellSize);
    const minGy = mfloor(minQy * sStaticInvCellSize);
    const maxGy = mfloor(maxQy * sStaticInvCellSize);
    const minGz = mfloor(minQz * sStaticInvCellSize);
    const maxGz = mfloor(maxQz * sStaticInvCellSize);

    totalFound = overlapBoxInto(
      cx, cy, cz, hx, hy, hz,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, maxHits, mask, layer, includeTriggers, curStepId,
      sStaticHead, sStaticEntriesObj, sStaticEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      0, 0,
    );
    storedCount = totalFound < maxHits ? totalFound : maxHits;
  }

  // 2. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          if (sBucketStamp[bucket] !== stamp) {
            sBucketStamp[bucket] = stamp;
            let k = sDynHead[bucket];
            while (k !== -1) {
              if (includeTriggers || sTrigger[k] === 0) {
                if ((mask & sLayer[k]) !== 0 && (sMask[k] & layer) !== 0) {
                  if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                      sMinY[k] <= maxQy && sMaxY[k] >= minQy &&
                      sMinZ[k] <= maxQz && sMaxZ[k] >= minQz) {
                    if (storedCount < maxHits) {
                      const target = outHits[storedCount];
                      if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                        totalFound = totalFound + 1;
                        const candId = target.bodyId;
                        let p = storedCount;
                        while (p > 0 && outHits[p - 1].bodyId > candId) {
                          outHits[p] = outHits[p - 1];
                          p = p - 1;
                        }
                        outHits[p] = target;
                        storedCount = storedCount + 1;
                      }
                    } else {
                      const candId = sBodyId[k];
                      if (candId < outHits[maxHits - 1].bodyId) {
                        if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, sCandidateOverlapHit, includeTriggers, curStepId)) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, sCandidateOverlapHit);
                          let p = maxHits - 1;
                          while (p > 0 && outHits[p - 1].bodyId > candId) {
                            outHits[p] = outHits[p - 1];
                            p = p - 1;
                          }
                          outHits[p] = target;
                        }
                      } else {
                        if (testOverlapBoxObject(k, cx, cy, cz, hx, hy, hz)) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  }
                }
              }
              k = sDynNext[k];
            }
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
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
  const curStepId = getSpatialStepId();

  const minQx = cx - hx;
  const maxQx = cx + hx;
  const minQy = cy - hy;
  const maxQy = cy + hy;
  const minQz = cz - hz;
  const maxQz = cz + hz;

  const result: OverlapHit[] = [];

  // 1. Estáticos
  if (sStaticCount > 0) {
    const minGx = mfloor(minQx * sStaticInvCellSize);
    const maxGx = mfloor(maxQx * sStaticInvCellSize);
    const minGy = mfloor(minQy * sStaticInvCellSize);
    const maxGy = mfloor(maxQy * sStaticInvCellSize);
    const minGz = mfloor(minQz * sStaticInvCellSize);
    const maxGz = mfloor(maxQz * sStaticInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          let entry = sStaticHead[bucket];
          while (entry !== -1) {
            const k = sStaticEntriesObj[entry];
            if (sVisitedStamp[k] !== stamp) {
              sVisitedStamp[k] = stamp;
              if (passesFilter(mask, layer, includeTriggers, k)) {
                if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                    sMinY[k] <= maxQy && maxYArr[k] >= minQy &&
                    sMinZ[k] <= maxQz && maxZArr[k] >= minQz) {
                  const hit = createOverlapHit();
                  if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, hit, includeTriggers, curStepId)) {
                    result.push(hit);
                  }
                }
              }
            }
            entry = sStaticEntriesNext[entry];
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
  }

  // 2. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          if (sBucketStamp[bucket] !== stamp) {
            sBucketStamp[bucket] = stamp;
            let k = sDynHead[bucket];
            while (k !== -1) {
              if (includeTriggers || sTrigger[k] === 0) {
                if ((mask & sLayer[k]) !== 0 && (sMask[k] & layer) !== 0) {
                  if (sMinX[k] <= maxQx && sMaxX[k] >= minQx &&
                      sMinY[k] <= maxQy && sMaxY[k] >= minQy &&
                      sMinZ[k] <= maxQz && sMaxZ[k] >= minQz) {
                    const hit = createOverlapHit();
                    if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, hit, includeTriggers, curStepId)) {
                      result.push(hit);
                    }
                  }
                }
              }
              k = sDynNext[k];
            }
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
  }

  if (result.length > 1) {
    sortHitsInPlace(result, result.length);
  }
  return result;
}

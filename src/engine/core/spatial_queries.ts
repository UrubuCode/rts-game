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
import { Scene, DYN_OP_ADD, DYN_OP_REMOVE } from "./scene";
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
let sHasDynamicLocalOffset = 0;

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

// ── TIER 2: GRID COARSE PARA ESTÁTICOS MÉDIOS/GRANDES ─────────────────────
let sStaticCoarseHead: number[] = new Array(SGRID_CAP).fill(-1);
let sStaticCoarseUsedBuckets: number[] = new Array(SGRID_CAP).fill(0);
let sStaticCoarseUsedBucketsCount = 0;
let sStaticCoarseEntriesCap = 32768;
let sStaticCoarseEntriesObj: number[] = new Array(sStaticCoarseEntriesCap).fill(0);
let sStaticCoarseEntriesNext: number[] = new Array(sStaticCoarseEntriesCap).fill(0);
let sStaticCoarseEntriesCount = 0;
let sStaticCoarseCellSize = 32.0;
let sStaticCoarseInvCellSize = 1.0 / 32.0;
let sStaticCoarseCount = 0;
let sStaticCoarseIndices: number[] = new Array(sObjCap).fill(0);
let sStaticCoarseSceneMinX = 0.0; let sStaticCoarseSceneMaxX = 0.0;
let sStaticCoarseSceneMinY = 0.0; let sStaticCoarseSceneMaxY = 0.0;
let sStaticCoarseSceneMinZ = 0.0; let sStaticCoarseSceneMaxZ = 0.0;

function growStaticCoarseEntries(): void {
  const newCap = sStaticCoarseEntriesCap * 2;
  while (sStaticCoarseEntriesObj.length < newCap) {
    sStaticCoarseEntriesObj.push(0);
    sStaticCoarseEntriesNext.push(0);
  }
  sStaticCoarseEntriesCap = newCap;
}

// ── CORPOS COLOSSAIS (TERRENOS GIGANTES DE MAPA E CHEFES DINÂMICOS) ────────
let sColossalStaticCap = 256;
let sColossalStaticObjs: number[] = new Array(sColossalStaticCap).fill(0);
let sColossalStaticCount = 0;

let sColossalDynamicCap = 256;
let sColossalDynamicObjs: number[] = new Array(sColossalDynamicCap).fill(0);
let sColossalDynamicCount = 0;

function addColossalStatic(k: number): void {
  if (sColossalStaticCount >= sColossalStaticCap) {
    const newCap = sColossalStaticCap * 2;
    while (sColossalStaticObjs.length < newCap) sColossalStaticObjs.push(0);
    sColossalStaticCap = newCap;
  }
  sColossalStaticObjs[sColossalStaticCount] = k;
  sColossalStaticCount = sColossalStaticCount + 1;
}

function addColossalDynamic(k: number): void {
  if (sColossalDynamicCount >= sColossalDynamicCap) {
    const newCap = sColossalDynamicCap * 2;
    while (sColossalDynamicObjs.length < newCap) sColossalDynamicObjs.push(0);
    sColossalDynamicCap = newCap;
  }
  sColossalDynamicObjs[sColossalDynamicCount] = k;
  sColossalDynamicCount = sColossalDynamicCount + 1;
}

function removeColossalDynamicBySlot(k: number): void {
  let ci = 0;
  while (ci < sColossalDynamicCount) {
    if (sColossalDynamicObjs[ci] === k) {
      const lastCi = sColossalDynamicCount - 1;
      if (ci < lastCi) {
        sColossalDynamicObjs[ci] = sColossalDynamicObjs[lastCi];
      }
      sColossalDynamicCount = sColossalDynamicCount - 1;
      return;
    }
    ci = ci + 1;
  }
}

function updateColossalDynamicSlot(oldK: number, newK: number): void {
  let ci = 0;
  while (ci < sColossalDynamicCount) {
    if (sColossalDynamicObjs[ci] === oldK) {
      sColossalDynamicObjs[ci] = newK;
      return;
    }
    ci = ci + 1;
  }
}

let sStaticCacheWx: f64[] = new Array(sObjCap).fill(0.0);
let sStaticCacheWy: f64[] = new Array(sObjCap).fill(0.0);
let sStaticCacheWz: f64[] = new Array(sObjCap).fill(0.0);
let sStaticCacheSx: f64[] = new Array(sObjCap).fill(1.0);
let sStaticCacheWry: f64[] = new Array(sObjCap).fill(0.0);

// Buffer reutilizado para coleta de dinâmicos no único passe de staticDirty
const sDynCollectObjs: GameObject[] = [];
let sDynCollectCount = 0;

// Buffer reutilizado para cálculo de mediana sem alocações no heap
let sExtentBuffer: f64[] = new Array(sObjCap).fill(0.0);

function quickselect(arr: f64[], left: number, right: number, k: number): f64 {
  while (left < right) {
    const pivotIdx = (left + right) >> 1;
    const pivotVal = arr[pivotIdx];
    let i = left;
    let j = right;
    while (i <= j) {
      while (arr[i] < pivotVal) i = i + 1;
      while (arr[j] > pivotVal) j = j - 1;
      if (i <= j) {
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        i = i + 1;
        j = j - 1;
      }
    }
    if (k <= j) {
      right = j;
    } else if (k >= i) {
      left = i;
    } else {
      return arr[k];
    }
  }
  return arr[left];
}

let sMinX: number[] = new Array(sObjCap).fill(0.0);
let sMaxX: number[] = new Array(sObjCap).fill(0.0);
let sMinY: number[] = new Array(sObjCap).fill(0.0);
let sMaxY: number[] = new Array(sObjCap).fill(0.0);
let sMinZ: number[] = new Array(sObjCap).fill(0.0);
let sMaxZ: number[] = new Array(sObjCap).fill(0.0);

let sStaticSceneMinX = 0.0; let sStaticSceneMaxX = 0.0;
let sStaticSceneMinY = 0.0; let sStaticSceneMaxY = 0.0;
let sStaticSceneMinZ = 0.0; let sStaticSceneMaxZ = 0.0;

let sDynSceneMinX = 0.0; let sDynSceneMaxX = 0.0;
let sDynSceneMinY = 0.0; let sDynSceneMaxY = 0.0;
let sDynSceneMinZ = 0.0; let sDynSceneMaxZ = 0.0;

let sCellSize = 2.0;
let sInvCellSize = 0.5;
let sLastRebuildStep = -1;
let sLastStaticVersion = -1;
let sLastCompVersion = -1;
let sStaticTotal = 0;

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
    sStaticCoarseIndices.push(0);
    sExtentBuffer.push(0.0);
    sMinX.push(0.0); sMaxX.push(0.0);
    sMinY.push(0.0); sMaxY.push(0.0);
    sMinZ.push(0.0); sMaxZ.push(0.0);
    sVisitedStamp.push(0);
    sDynNext.push(-1);
    sDynCell.push(0);
    sStaticCacheWx.push(0.0);
    sStaticCacheWy.push(0.0);
    sStaticCacheWz.push(0.0);
    sStaticCacheSx.push(1.0);
    sStaticCacheWry.push(0.0);
  }
  sObjCap = newCap;
}

// Instância única reusada para testes de casca sem alocação
const sHullContactOut: Contact = new Contact();

export function setSpatialScene(sc: Scene | null): void {
  sActiveScene = sc;
  sLastRebuildStep = -1;
  sLastStaticVersion = -1;
  sLastCompVersion = -1;
  sStaticTotal = 0;
  let b = 0;
  while (b < sStaticUsedBucketsCount) {
    sStaticHead[sStaticUsedBuckets[b]] = -1;
    b = b + 1;
  }
  sStaticUsedBucketsCount = 0;
  sStaticEntriesCount = 0;

  let cb = 0;
  while (cb < sStaticCoarseUsedBucketsCount) {
    sStaticCoarseHead[sStaticCoarseUsedBuckets[cb]] = -1;
    cb = cb + 1;
  }
  sStaticCoarseUsedBucketsCount = 0;
  sStaticCoarseEntriesCount = 0;
  sStaticCoarseCount = 0;

  let di = 0;
  while (di < sPrevDynCount) {
    sDynHead[sDynCell[di]] = -1;
    di = di + 1;
  }
  sPrevDynCount = 0;
  sColossalStaticCount = 0;
  sColossalDynamicCount = 0;
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

let sCandCx: f64 = 0.0;
let sCandCy: f64 = 0.0;
let sCandCz: f64 = 0.0;
let sCandYaw: f64 = 0.0;

function resolveCandidateTransform(k: number): void {
  if (sIsStatic[k] !== 0) {
    sCandCx = sWorldCx[k];
    sCandCy = sWorldCy[k];
    sCandCz = sWorldCz[k];
    sCandYaw = sYaw[k];
    return;
  }
  const t = sTrs[k];
  sCandYaw = t.wry;
  if (sHasDynamicLocalOffset === 0) {
    sCandCx = t.wx;
    sCandCy = t.wy;
    sCandCz = t.wz;
    return;
  }
  let cx = t.wx;
  let cy = t.wy;
  let cz = t.wz;
  const lcx = sLocalCx[k];
  const lcy = sLocalCy[k];
  const lcz = sLocalCz[k];
  if (lcx !== 0.0 || lcz !== 0.0) {
    const ox = lcx * t.sx;
    const oz = lcz * t.sz;
    if (t.wry === 0.0) {
      cx = cx + ox;
      cz = cz + oz;
    } else {
      const cs = math.cos(t.wry);
      const sn = math.sin(t.wry);
      cx = cx + (ox * cs + oz * sn);
      cz = cz + (0.0 - ox * sn + oz * cs);
    }
  }
  if (lcy !== 0.0) {
    cy = cy + lcy * t.sy;
  }
  sCandCx = cx;
  sCandCy = cy;
  sCandCz = cz;
}

/// ARQUITETURA DO GRID DINÂMICO (Centro Único + Expansão de Consulta):
/// Os corpos dinâmicos são indexados em célula única determinada pelo seu centro (reduzindo
/// inserções de 16.000 para 2.000 e viabilizando o rebuild em ~0.33 ms a 60 Hz).
/// As consultas de overlap expandem a AABB de busca por `sDynamicMaxHalfExtent`, e o DDA de raycast
/// engorda o raio pela mesma meia-extensão máxima.
///
/// LIMITAÇÃO CONHECIDA (Corpos Dinâmicos Grandes):
/// Como a região de busca é expandida pela MAIOR meia-extensão dinâmica presente na cena, se um
/// único corpo dinâmico for excepcionalmente grande (ex: um veículo ou chefe com meia-extensão de 50 u),
/// todas as consultas de overlap dinâmico passam a varrer uma vizinhança expandida em 50 u, aumentando
/// o número de células e corpos candidatos testados. Caso uma cena futura necessite de múltiplos corpos
/// dinâmicos colossais coexistindo com milhares de corpos pequenos, uma partição em camadas hierárquicas
/// ou multi-célula dedicada para corpos grandes deverá ser introduzida.
///
/// Reconstrução dos objetos dinâmicos no índice espacial como FUNÇÃO LIVRE de parâmetros TIPADOS.
///
/// Segue o mesmo padrão de `computeWorldInto` e `buildSceneGrid` em `scene.ts`:
/// parâmetros com anotações explícitas de array tipado (`f64[]`, `number[]`, `Transform[]`)
/// e constantes de máscara/multiplicadores locais evitam o caminho dinâmico do runtime.
function rebuildDynamicsInto(
  dynamicCount: number,
  dynamicIndices: number[],
  objs: GameObject[],
  trs: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  invCellSize: f64,
  dynHead: number[],
  dynNext: number[],
  dynCell: number[],
  prevDynCount: number,
  hasLocalOffset: number,
): void {
  const mask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  // 1. Limpa APENAS os buckets sujos na passada anterior (no máximo prevDynCount)
  let k = 0;
  while (k < prevDynCount) {
    const b = dynCell[k];
    if (b >= 0) dynHead[b] = -1;
    k = k + 1;
  }

  let minX = 1e30; let maxX = -1e30;
  let minY = 1e30; let maxY = -1e30;
  let minZ = 1e30; let maxZ = -1e30;
  let activeCount = 0;

  // 2. Insere cada objeto dinâmico no grid pelo centro e atualiza os limites da cena dinâmica a cada passo
  if (hasLocalOffset === 0) {
    let di = 0;
    while (di < dynamicCount) {
      const objIdx = dynamicIndices[di];
      const o: GameObject = objs[objIdx];
      if (o.active === 0) {
        dynCell[di] = -1;
        di = di + 1;
        continue;
      }
      activeCount = activeCount + 1;
      const t: Transform = trs[objIdx];
      const wx = t.wx; const wy = t.wy; const wz = t.wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      const fx = wx * invCellSize; const tx = fx | 0; const gx = tx > fx ? tx - 1 : tx;
      const fy = wy * invCellSize; const ty = fy | 0; const gy = ty > fy ? ty - 1 : ty;
      const fz = wz * invCellSize; const tz = fz | 0; const gz = tz > fz ? tz - 1 : tz;
      const bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);
      dynCell[di] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;
      di = di + 1;
    }
  } else {
    let di = 0;
    while (di < dynamicCount) {
      const objIdx = dynamicIndices[di];
      const o: GameObject = objs[objIdx];
      if (o.active === 0) {
        dynCell[di] = -1;
        di = di + 1;
        continue;
      }
      activeCount = activeCount + 1;
      const t: Transform = trs[objIdx];
      let cx = t.wx;
      let cy = t.wy;
      let cz = t.wz;
      const lcx = localCxArr[objIdx];
      const lcy = localCyArr[objIdx];
      const lcz = localCzArr[objIdx];
      if (lcx !== 0.0 || lcz !== 0.0) {
        const ox = lcx * t.sx; const oz = lcz * t.sz;
        const yaw = t.wry;
        if (yaw === 0.0) {
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

      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      if (cz < minZ) minZ = cz; if (cz > maxZ) maxZ = cz;

      const fx = cx * invCellSize;
      const tx = fx | 0;
      const gx = tx > fx ? tx - 1 : tx;

      const fy = cy * invCellSize;
      const ty = fy | 0;
      const gy = ty > fy ? ty - 1 : ty;

      const fz = cz * invCellSize;
      const tz = fz | 0;
      const gz = tz > fz ? tz - 1 : tz;

      const bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);

      dynCell[di] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;

      di = di + 1;
    }
  }

  if (activeCount > 0) {
    const dynH = sDynamicMaxHalfExtent + 0.01;
    sDynSceneMinX = minX - dynH;
    sDynSceneMaxX = maxX + dynH;
    sDynSceneMinY = minY - dynH;
    sDynSceneMaxY = maxY + dynH;
    sDynSceneMinZ = minZ - dynH;
    sDynSceneMaxZ = maxZ + dynH;
  } else {
    sDynSceneMinX = 0.0; sDynSceneMaxX = 0.0;
    sDynSceneMinY = 0.0; sDynSceneMaxY = 0.0;
    sDynSceneMinZ = 0.0; sDynSceneMaxZ = 0.0;
  }
}

function dynPassesAABB(k: number, minQx: f64, maxQx: f64, minQy: f64, maxQy: f64, minQz: f64, maxQz: f64): boolean {
  const t = sTrs[k];
  if (sHasDynamicLocalOffset === 0) {
    const hx = sWorldHx[k];
    if (t.wx - hx > maxQx || t.wx + hx < minQx) return false;
    const hy = sWorldHy[k];
    if (t.wy - hy > maxQy || t.wy + hy < minQy) return false;
    const hz = sWorldHz[k];
    if (t.wz - hz > maxQz || t.wz + hz < minQz) return false;
    return true;
  }
  let cx = t.wx;
  const lcx = sLocalCx[k];
  const lcz = sLocalCz[k];
  if (lcx !== 0.0 || lcz !== 0.0) {
    const ox = lcx * t.sx; const oz = lcz * t.sz;
    if (t.wry === 0.0) {
      cx = cx + ox;
    } else {
      cx = cx + (ox * math.cos(t.wry) + oz * math.sin(t.wry));
    }
  }
  const hx = sWorldHx[k];
  if (cx - hx > maxQx || cx + hx < minQx) return false;

  let cy = t.wy;
  const lcy = sLocalCy[k];
  if (lcy !== 0.0) cy = cy + lcy * t.sy;
  const hy = sWorldHy[k];
  if (cy - hy > maxQy || cy + hy < minQy) return false;

  let cz = t.wz;
  if (lcx !== 0.0 || lcz !== 0.0) {
    const ox = lcx * t.sx; const oz = lcz * t.sz;
    if (t.wry === 0.0) {
      cz = cz + oz;
    } else {
      cz = cz + (0.0 - ox * math.sin(t.wry) + oz * math.cos(t.wry));
    }
  }
  const hz = sWorldHz[k];
  if (cz - hz > maxQz || cz + hz < minQz) return false;

  return true;
}


/// Obtém o stepId correto para consultas espaciais segundo o backend ativo.
export function getSpatialStepId(): number {
  if (pbActiveBackend() === 1) {
    return pbGpuLastReadbackStep();
  }
  return stepCount();
}

/// Verificação rápida de drift dos estáticos como função livre com parâmetros tipados.
/// Executada UMA VEZ por passo dentro de spatialRebuildIndex (e NÃO por consulta).
function checkStaticDriftFree(
  count: number,
  trs: Transform[],
  cWx: f64[],
  cWy: f64[],
  cWz: f64[],
  cSx: f64[],
  cWry: f64[],
): boolean {
  let i = 0;
  while (i < count) {
    const t = trs[i];
    if (t.wx !== cWx[i] || t.wy !== cWy[i] || t.wz !== cWz[i] ||
        t.sx !== cSx[i] || t.wry !== cWry[i]) {
      return true;
    }
    i = i + 1;
  }
  return false;
}

/// Reconstrói o índice espacial no host a partir da cena.
export function spatialRebuildIndex(sc?: Scene): void {
  const targetScene = sc !== undefined ? sc : sActiveScene;
  if (targetScene === null) return;


  const statVer = targetScene.staticVersion;
  const compVer = targetScene.compVersion;

  let staticDirty = (sLastStaticVersion !== statVer);

  // Verificação de drift dos estáticos (executada UMA VEZ por passo dentro da reindexação, e não por consulta)
  if (!staticDirty && sStaticTotal > 0) {
    if (checkStaticDriftFree(sStaticTotal, sTrs, sStaticCacheWx, sStaticCacheWy, sStaticCacheWz, sStaticCacheSx, sStaticCacheWry)) {
      staticDirty = true;
    }
  }
  const compDirty = (sLastCompVersion !== compVer || staticDirty);

  if (staticDirty) {
    const allObjs = targetScene.objects;
    const n = allObjs.length;
    ensureObjCapacity(n);

    sObjs.length = 0;
    sTrs.length = 0;
    let allStaticCount = 0;
    sDynCollectCount = 0;

    let i = 0;
    while (i < n) {
      const o = allObjs[i];
      if (o.collideFlag !== 0 || o.colIdx >= 0) {
        if (bodyTypeOf(o) === BODY_STATIC) {
          if (o.active !== 0) {
          const k = sObjs.length;
          sObjs.push(o);
          const t = o.transform;
          sTrs.push(t);
          o.spatialSlot = k;
          o.spatialDynSlot = 0 - 1;

          const shp = shapeOf(o);
          const trig = triggerOf(o);
          const hid = hullIdOf(o);
          const lhx = halfLocalX(o);
          const lhy = halfLocalY(o);
          const lhz = halfLocalZ(o);
          const lcx = centerLocalX(o);
          const lcy = centerLocalY(o);
          const lcz = centerLocalZ(o);

          sShape[k] = shp;
          sTrigger[k] = trig;
          sHullId[k] = hid;
          sLocalHx[k] = lhx;
          sLocalHy[k] = lhy;
          sLocalHz[k] = lhz;
          sLocalCx[k] = lcx;
          sLocalCy[k] = lcy;
          sLocalCz[k] = lcz;
          sIsStatic[k] = 1;
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

          // Maior meia-extensão característica
          const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

          sYaw[k] = t.wry;
          let cx = t.wx; let cy = t.wy; let cz = t.wz;
          if (lcx !== 0.0 || lcz !== 0.0) {
            const ox = lcx * t.sx; const oz = lcz * t.sz;
            if (t.wry === 0.0) {
              cx = cx + ox; cz = cz + oz;
            } else {
              const cs = math.cos(t.wry); const sn = math.sin(t.wry);
              cx = cx + (ox * cs + oz * sn);
              cz = cz + (0.0 - ox * sn + oz * cs);
            }
          }
          if (lcy !== 0.0) cy = cy + lcy * t.sy;
          sWorldCx[k] = cx; sWorldCy[k] = cy; sWorldCz[k] = cz;

          sStaticCacheWx[k] = t.wx;
          sStaticCacheWy[k] = t.wy;
          sStaticCacheWz[k] = t.wz;
          sStaticCacheSx[k] = t.sx;
          sStaticCacheWry[k] = t.wry;

          const minX = cx - hx; const maxX = cx + hx;
          const minY = cy - hy; const maxY = cy + hy;
          const minZ = cz - hz; const maxZ = cz + hz;
          sMinX[k] = minX; sMaxX[k] = maxX;
          sMinY[k] = minY; sMaxY[k] = maxY;
          sMinZ[k] = minZ; sMaxZ[k] = maxZ;

          sStaticIndices[allStaticCount] = k;
          sExtentBuffer[allStaticCount] = maxH;
          allStaticCount = allStaticCount + 1;
        } else {
          sDynCollectObjs[sDynCollectCount] = o;
          sDynCollectCount = sDynCollectCount + 1;
        }
      }
      i = i + 1;
    }

    sStaticTotal = sObjs.length;

    // Célula estática Tier 1 dimensionada pela MEDIANA das meias-extensões características
    let statCellSize = 2.0;
    if (allStaticCount > 0) {
      const medianExtent = quickselect(sExtentBuffer, 0, allStaticCount - 1, allStaticCount >> 1);
      statCellSize = medianExtent * 2.0;
    }
    if (statCellSize < 2.0) statCellSize = 2.0;
    sStaticCellSize = statCellSize;
    sStaticInvCellSize = 1.0 / sStaticCellSize;

    // Limiar relativo à célula (§Item 1 do Claude)
    const tier1Threshold = 2.0 * sStaticCellSize;

    sStaticCount = 0;
    sStaticCoarseCount = 0;
    sColossalStaticCount = 0;

    let coarseCandidatesCount = 0;
    let si = 0;
    while (si < allStaticCount) {
      const k = sStaticIndices[si];
      const hx = sWorldHx[k];
      const hy = sWorldHy[k];
      const hz = sWorldHz[k];
      const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);
      if (maxH <= tier1Threshold) {
        sStaticIndices[sStaticCount] = k;
        sStaticCount = sStaticCount + 1;
      } else {
        sStaticCoarseIndices[coarseCandidatesCount] = k;
        sExtentBuffer[coarseCandidatesCount] = maxH;
        coarseCandidatesCount = coarseCandidatesCount + 1;
      }
      si = si + 1;
    }

    // Dimensiona Tier 2 (Coarse Grid) se houver candidatos
    let coarseCellSize = sStaticCellSize * 4.0;
    if (coarseCandidatesCount > 0) {
      const medianCoarse = quickselect(sExtentBuffer, 0, coarseCandidatesCount - 1, coarseCandidatesCount >> 1);
      coarseCellSize = medianCoarse * 2.0;
      if (coarseCellSize < sStaticCellSize * 4.0) coarseCellSize = sStaticCellSize * 4.0;
    }
    sStaticCoarseCellSize = coarseCellSize;
    sStaticCoarseInvCellSize = 1.0 / sStaticCoarseCellSize;
    const tier2Threshold = 2.0 * sStaticCoarseCellSize;

    let cci = 0;
    let finalCoarseCount = 0;
    while (cci < coarseCandidatesCount) {
      const k = sStaticCoarseIndices[cci];
      const hx = sWorldHx[k];
      const hy = sWorldHy[k];
      const hz = sWorldHz[k];
      const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);
      if (maxH <= tier2Threshold && maxH <= 128.0) {
        sStaticCoarseIndices[finalCoarseCount] = k;
        finalCoarseCount = finalCoarseCount + 1;
      } else {
        addColossalStatic(k);
      }
      cci = cci + 1;
    }
    sStaticCoarseCount = finalCoarseCount;

    // Limpa e popula buckets estáticos Tier 1 (Grid Fino)
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

    let ti = 0;
    while (ti < sStaticCount) {
      const k = sStaticIndices[ti];
      const minX = sMinX[k]; const maxX = sMaxX[k];
      const minY = sMinY[k]; const maxY = sMaxY[k];
      const minZ = sMinZ[k]; const maxZ = sMaxZ[k];

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
      ti = ti + 1;
    }

    // Limpa e popula buckets estáticos Tier 2 (Grid Coarse)
    let cb = 0;
    while (cb < sStaticCoarseUsedBucketsCount) {
      sStaticCoarseHead[sStaticCoarseUsedBuckets[cb]] = -1;
      cb = cb + 1;
    }
    sStaticCoarseUsedBucketsCount = 0;
    sStaticCoarseEntriesCount = 0;

    sStaticCoarseSceneMinX = 1e30; sStaticCoarseSceneMaxX = -1e30;
    sStaticCoarseSceneMinY = 1e30; sStaticCoarseSceneMaxY = -1e30;
    sStaticCoarseSceneMinZ = 1e30; sStaticCoarseSceneMaxZ = -1e30;

    let cii = 0;
    while (cii < sStaticCoarseCount) {
      const k = sStaticCoarseIndices[cii];
      const minX = sMinX[k]; const maxX = sMaxX[k];
      const minY = sMinY[k]; const maxY = sMaxY[k];
      const minZ = sMinZ[k]; const maxZ = sMaxZ[k];

      if (minX < sStaticCoarseSceneMinX) sStaticCoarseSceneMinX = minX;
      if (maxX > sStaticCoarseSceneMaxX) sStaticCoarseSceneMaxX = maxX;
      if (minY < sStaticCoarseSceneMinY) sStaticCoarseSceneMinY = minY;
      if (maxY > sStaticCoarseSceneMaxY) sStaticCoarseSceneMaxY = maxY;
      if (minZ < sStaticCoarseSceneMinZ) sStaticCoarseSceneMinZ = minZ;
      if (maxZ > sStaticCoarseSceneMaxZ) sStaticCoarseSceneMaxZ = maxZ;

      const minGx = mfloor(minX * sStaticCoarseInvCellSize);
      const maxGx = mfloor(maxX * sStaticCoarseInvCellSize);
      const minGy = mfloor(minY * sStaticCoarseInvCellSize);
      const maxGy = mfloor(maxY * sStaticCoarseInvCellSize);
      const minGz = mfloor(minZ * sStaticCoarseInvCellSize);
      const maxGz = mfloor(maxZ * sStaticCoarseInvCellSize);

      let gx = minGx;
      while (gx <= maxGx) {
        const hashX = gx * 73856093;
        let gy = minGy;
        while (gy <= maxGy) {
          const gxy = hashX ^ (gy * 19349663);
          let gz = minGz;
          while (gz <= maxGz) {
            const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
            if (sStaticCoarseHead[bucket] === -1) {
              sStaticCoarseUsedBuckets[sStaticCoarseUsedBucketsCount] = bucket;
              sStaticCoarseUsedBucketsCount = sStaticCoarseUsedBucketsCount + 1;
            }
            const entryIdx = sStaticCoarseEntriesCount;
            sStaticCoarseEntriesCount = sStaticCoarseEntriesCount + 1;
            if (sStaticCoarseEntriesCount >= sStaticCoarseEntriesCap) growStaticCoarseEntries();
            sStaticCoarseEntriesObj[entryIdx] = k;
            sStaticCoarseEntriesNext[entryIdx] = sStaticCoarseHead[bucket];
            sStaticCoarseHead[bucket] = entryIdx;
            gz = gz + 1;
          }
          gy = gy + 1;
        }
        gx = gx + 1;
      }
      cii = cii + 1;
    }

    sLastStaticVersion = statVer;
  }

  // 2. SINCRONIZAÇÃO DA COMPOSIÇÃO DINÂMICA (quando compVersion mudar)
  if (compDirty) {
    // Se a malha estática NÃO mudou e há mutações incrementais pendentes na fila da cena,
    // processa estritamente a fila em O(K), sem percorrer os N objetos da cena.
    if (!staticDirty && targetScene.pendingDynamicOps.length > 0) {
      const ops = targetScene.pendingDynamicOps;
      const objs = targetScene.pendingDynamicObjs;
      const numOps = ops.length;
      let oi = 0;
      while (oi < numOps) {
        const op = ops[oi];
        const o = objs[oi];
        if (op === DYN_OP_ADD) {
          if ((o.collideFlag !== 0 || o.colIdx >= 0) && bodyTypeOf(o) !== BODY_STATIC) {
            ensureObjCapacity(sObjs.length + 1);
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

            sShape[k] = shp;
            sTrigger[k] = trig;
            sHullId[k] = hid;
            sLocalHx[k] = lhx;
            sLocalHy[k] = lhy;
            sLocalHz[k] = lhz;
            sLocalCx[k] = lcx;
            sLocalCy[k] = lcy;
            sLocalCz[k] = lcz;
            sIsStatic[k] = 0;
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

            const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

            if (lcx !== 0.0 || lcy !== 0.0 || lcz !== 0.0) sHasDynamicLocalOffset = 1;
            o.spatialSlot = k;

            if (maxH > 16.0) {
              addColossalDynamic(k);
              o.spatialDynSlot = 0 - 1;
            } else {
              o.spatialDynSlot = sDynamicCount;
              sDynamicIndices[sDynamicCount] = k;
              sDynamicCount = sDynamicCount + 1;
              if (hx > sDynamicMaxHalfExtent) sDynamicMaxHalfExtent = hx;
              if (hy > sDynamicMaxHalfExtent) sDynamicMaxHalfExtent = hy;
              if (hz > sDynamicMaxHalfExtent) sDynamicMaxHalfExtent = hz;
            }
          }
        } else if (op === DYN_OP_REMOVE) {
          const k = o.spatialSlot;
          if (k >= sStaticTotal && k < sObjs.length && sObjs[k] === o) {
            // 1. Remover de sDynamicIndices ou sColossalDynamicObjs
            const dynSlot = o.spatialDynSlot;
            if (dynSlot >= 0 && dynSlot < sDynamicCount && sDynamicIndices[dynSlot] === k) {
              const lastDynSlot = sDynamicCount - 1;
              if (dynSlot < lastDynSlot) {
                const movedK = sDynamicIndices[lastDynSlot];
                sDynamicIndices[dynSlot] = movedK;
                sObjs[movedK].spatialDynSlot = dynSlot;
              }
              sDynamicCount = sDynamicCount - 1;
            } else {
              removeColossalDynamicBySlot(k);
            }
            o.spatialDynSlot = 0 - 1;

            // 2. Swap-with-last em sObjs e arrays paralelos
            const lastK = sObjs.length - 1;
            if (k < lastK) {
              const lastObj = sObjs[lastK];
              sObjs[k] = lastObj;
              sTrs[k] = sTrs[lastK];
              sShape[k] = sShape[lastK];
              sTrigger[k] = sTrigger[lastK];
              sHullId[k] = sHullId[lastK];
              sLocalHx[k] = sLocalHx[lastK];
              sLocalHy[k] = sLocalHy[lastK];
              sLocalHz[k] = sLocalHz[lastK];
              sLocalCx[k] = sLocalCx[lastK];
              sLocalCy[k] = sLocalCy[lastK];
              sLocalCz[k] = sLocalCz[lastK];
              sIsStatic[k] = sIsStatic[lastK];
              sLayer[k] = sLayer[lastK];
              sMask[k] = sMask[lastK];
              sBodyId[k] = sBodyId[lastK];
              sWorldHx[k] = sWorldHx[lastK];
              sWorldHy[k] = sWorldHy[lastK];
              sWorldHz[k] = sWorldHz[lastK];
              sWorldRadius[k] = sWorldRadius[lastK];
              sYaw[k] = sYaw[lastK];
              sWorldCx[k] = sWorldCx[lastK];
              sWorldCy[k] = sWorldCy[lastK];
              sWorldCz[k] = sWorldCz[lastK];

              lastObj.spatialSlot = k;
              if (lastObj.spatialDynSlot >= 0) {
                sDynamicIndices[lastObj.spatialDynSlot] = k;
              } else {
                updateColossalDynamicSlot(lastK, k);
              }
            }
            sObjs.pop();
            sTrs.pop();
            o.spatialSlot = 0 - 1;
          }
        }
        oi = oi + 1;
      }
      ops.length = 0;
      objs.length = 0;
    } else if (staticDirty) {
      // Quando staticDirty foi true, sDynCollectObjs já coletou exatamente os dinâmicos
      // no único passe da cena, sem precisar chamar bodyTypeOf nem verificar os estáticos novamente!
      sObjs.length = sStaticTotal;
      sTrs.length = sStaticTotal;
      sDynamicCount = 0;
      sColossalDynamicCount = 0;
      let maxDynamicHalfExtent: f64 = 0.5;
      let hasDynLocalOffset = 0;
      let dynMinX = 1e30; let dynMaxX = -1e30;
      let dynMinY = 1e30; let dynMaxY = -1e30;
      let dynMinZ = 1e30; let dynMaxZ = -1e30;

      let i = 0;
      while (i < sDynCollectCount) {
        const o = sDynCollectObjs[i];
        const k = sObjs.length;
        sObjs.push(o);
        const t = o.transform;
        sTrs.push(t);
        o.spatialSlot = k;

        const shp = shapeOf(o);
        const trig = triggerOf(o);
        const hid = hullIdOf(o);
        const lhx = halfLocalX(o);
        const lhy = halfLocalY(o);
        const lhz = halfLocalZ(o);
        const lcx = centerLocalX(o);
        const lcy = centerLocalY(o);
        const lcz = centerLocalZ(o);

        sShape[k] = shp;
        sTrigger[k] = trig;
        sHullId[k] = hid;
        sLocalHx[k] = lhx;
        sLocalHy[k] = lhy;
        sLocalHz[k] = lhz;
        sLocalCx[k] = lcx;
        sLocalCy[k] = lcy;
        sLocalCz[k] = lcz;
        sIsStatic[k] = 0;
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

        const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

        if (lcx !== 0.0 || lcy !== 0.0 || lcz !== 0.0) hasDynLocalOffset = 1;
        if (maxH > 16.0) {
          addColossalDynamic(k);
          o.spatialDynSlot = 0 - 1;
        } else {
          if (hx > maxDynamicHalfExtent) maxDynamicHalfExtent = hx;
          if (hy > maxDynamicHalfExtent) maxDynamicHalfExtent = hy;
          if (hz > maxDynamicHalfExtent) maxDynamicHalfExtent = hz;
          if (t.wx < dynMinX) dynMinX = t.wx;
          if (t.wx > dynMaxX) dynMaxX = t.wx;
          if (t.wy < dynMinY) dynMinY = t.wy;
          if (t.wy > dynMaxY) dynMaxY = t.wy;
          if (t.wz < dynMinZ) dynMinZ = t.wz;
          if (t.wz > dynMaxZ) dynMaxZ = t.wz;
          o.spatialDynSlot = sDynamicCount;
          sDynamicIndices[sDynamicCount] = k;
          sDynamicCount = sDynamicCount + 1;
        }
        i = i + 1;
      }

      sHasDynamicLocalOffset = hasDynLocalOffset;
      sDynamicMaxHalfExtent = maxDynamicHalfExtent;

      targetScene.pendingDynamicOps.length = 0;
      targetScene.pendingDynamicObjs.length = 0;
    } else {
      // Reconstrução dinâmica completa (fallback quando compVersion foi alterado manualmente sem fila)
      const allObjs = targetScene.objects;
      const n = allObjs.length;
      ensureObjCapacity(n);

      sObjs.length = sStaticTotal;
      sTrs.length = sStaticTotal;
      sDynamicCount = 0;
      sColossalDynamicCount = 0;
      let maxDynamicHalfExtent: f64 = 0.5;
      let hasDynLocalOffset = 0;
      let dynMinX = 1e30; let dynMaxX = -1e30;
      let dynMinY = 1e30; let dynMaxY = -1e30;
      let dynMinZ = 1e30; let dynMaxZ = -1e30;

      let i = 0;
      while (i < n) {
        const o = allObjs[i];
        if (o.collideFlag !== 0 || o.colIdx >= 0) {
          if (bodyTypeOf(o) !== BODY_STATIC) {
            const k = sObjs.length;
            sObjs.push(o);
            const t = o.transform;
            sTrs.push(t);
            o.spatialSlot = k;

            const shp = shapeOf(o);
            const trig = triggerOf(o);
            const hid = hullIdOf(o);
            const lhx = halfLocalX(o);
            const lhy = halfLocalY(o);
            const lhz = halfLocalZ(o);
            const lcx = centerLocalX(o);
            const lcy = centerLocalY(o);
            const lcz = centerLocalZ(o);

            sShape[k] = shp;
            sTrigger[k] = trig;
            sHullId[k] = hid;
            sLocalHx[k] = lhx;
            sLocalHy[k] = lhy;
            sLocalHz[k] = lhz;
            sLocalCx[k] = lcx;
            sLocalCy[k] = lcy;
            sLocalCz[k] = lcz;
            sIsStatic[k] = 0;
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

            const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

            if (lcx !== 0.0 || lcy !== 0.0 || lcz !== 0.0) hasDynLocalOffset = 1;
            if (maxH > 16.0) {
              addColossalDynamic(k);
              o.spatialDynSlot = 0 - 1;
            } else {
              if (hx > maxDynamicHalfExtent) maxDynamicHalfExtent = hx;
              if (hy > maxDynamicHalfExtent) maxDynamicHalfExtent = hy;
              if (hz > maxDynamicHalfExtent) maxDynamicHalfExtent = hz;
              if (t.wx < dynMinX) dynMinX = t.wx;
              if (t.wx > dynMaxX) dynMaxX = t.wx;
              if (t.wy < dynMinY) dynMinY = t.wy;
              if (t.wy > dynMaxY) dynMaxY = t.wy;
              if (t.wz < dynMinZ) dynMinZ = t.wz;
              if (t.wz > dynMaxZ) dynMaxZ = t.wz;
              o.spatialDynSlot = sDynamicCount;
              sDynamicIndices[sDynamicCount] = k;
              sDynamicCount = sDynamicCount + 1;
            }
          }
        }
        i = i + 1;
      }

      sHasDynamicLocalOffset = hasDynLocalOffset;
      sDynamicMaxHalfExtent = maxDynamicHalfExtent;

      targetScene.pendingDynamicOps.length = 0;
      targetScene.pendingDynamicObjs.length = 0;
    }

    // Célula dinâmica dimensionada para 2 * maiorMeiaExtensão dinâmica
    sDynCellSize = sDynamicMaxHalfExtent * 2.0;
    if (sDynCellSize < 2.0) sDynCellSize = 2.0;
    sDynInvCellSize = 1.0 / sDynCellSize;
    sCellSize = sDynCellSize;
    sInvCellSize = sDynInvCellSize;

    sLastCompVersion = compVer;
  }

  // 3. Atualiza apenas os objetos dinâmicos através de FUNÇÃO LIVRE TIPADA
  rebuildDynamicsInto(
    sDynamicCount, sDynamicIndices, sObjs, sTrs,
    sLocalCx, sLocalCy, sLocalCz,
    sDynInvCellSize, sDynHead, sDynNext, sDynCell,
    sPrevDynCount,
    sHasDynamicLocalOffset,
  );

  sPrevDynCount = sDynamicCount;
  sLastRebuildStep = getSpatialStepId();
}


function ensureIndex(sc?: Scene): Scene | null {
  const targetScene = sc !== undefined ? sc : sActiveScene;
  if (targetScene === null) return null;
  const curStep = getSpatialStepId();

  if (sLastRebuildStep !== curStep ||
      sLastCompVersion !== targetScene.compVersion ||
      sLastStaticVersion !== targetScene.staticVersion) {
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
  if (sObjs[k].active === 0) return false;
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
  resolveCandidateTransform(k);
  const cx = sCandCx;
  const cy = sCandCy;
  const cz = sCandCz;
  const yaw = sCandYaw;
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

function raycastStaticGridDDA(
  ox: f64, oy: f64, oz: f64,
  ndx: f64, ndy: f64, ndz: f64,
  maxDistance: f64,
  outHit: RaycastHit,
  mask: number,
  layer: number,
  includeTriggers: boolean,
  curStepId: number,
  stamp: number,
  cell: f64,
  invCell: f64,
  sceneMinX: f64, sceneMaxX: f64,
  sceneMinY: f64, sceneMaxY: f64,
  sceneMinZ: f64, sceneMaxZ: f64,
  head: number[],
  entriesObj: number[],
  entriesNext: number[],
): boolean {
  let tMin = 0.0;
  let tMax = maxDistance;

  const boxMinX = sceneMinX - 0.01;
  const boxMaxX = sceneMaxX + 0.01;
  if (math.abs(ndx) < 0.000000001) {
    if (ox < boxMinX || ox > boxMaxX) return false;
  } else {
    const invD = 1.0 / ndx;
    let t1 = (boxMinX - ox) * invD;
    let t2 = (boxMaxX - ox) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  const boxMinY = sceneMinY - 0.01;
  const boxMaxY = sceneMaxY + 0.01;
  if (math.abs(ndy) < 0.000000001) {
    if (oy < boxMinY || oy > boxMaxY) return false;
  } else {
    const invD = 1.0 / ndy;
    let t1 = (boxMinY - oy) * invD;
    let t2 = (boxMaxY - oy) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  const boxMinZ = sceneMinZ - 0.01;
  const boxMaxZ = sceneMaxZ + 0.01;
  if (math.abs(ndz) < 0.000000001) {
    if (oz < boxMinZ || oz > boxMaxZ) return false;
  } else {
    const invD = 1.0 / ndz;
    let t1 = (boxMinZ - oz) * invD;
    let t2 = (boxMaxZ - oz) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  if (tMax < 0.0) return false;
  if (tMin >= maxDistance) return false;

  let closestDist = maxDistance + 1.0;
  let found = false;

  let tCurrent = 0.0;
  let curOx = ox;
  let curOy = oy;
  let curOz = oz;
  if (tMin > 0.0) {
    tCurrent = tMin;
    curOx = ox + ndx * (tMin + 0.0001);
    curOy = oy + ndy * (tMin + 0.0001);
    curOz = oz + ndz * (tMin + 0.0001);
  }

  let gx = mfloor(curOx * invCell);
  let gy = mfloor(curOy * invCell);
  let gz = mfloor(curOz * invCell);

  let stepX = 0; let tDeltaX = 1e30; let tMaxX = 1e30;
  if (ndx > 0.000000001) {
    stepX = 1; tDeltaX = cell / ndx; tMaxX = tCurrent + ((gx + 1) * cell - curOx) / ndx;
  } else if (ndx < -0.000000001) {
    stepX = -1; tDeltaX = (0.0 - cell) / ndx; tMaxX = tCurrent + (gx * cell - curOx) / ndx;
  }

  let stepY = 0; let tDeltaY = 1e30; let tMaxY = 1e30;
  if (ndy > 0.000000001) {
    stepY = 1; tDeltaY = cell / ndy; tMaxY = tCurrent + ((gy + 1) * cell - curOy) / ndy;
  } else if (ndy < -0.000000001) {
    stepY = -1; tDeltaY = (0.0 - cell) / ndy; tMaxY = tCurrent + (gy * cell - curOy) / ndy;
  }

  let stepZ = 0; let tDeltaZ = 1e30; let tMaxZ = 1e30;
  if (ndz > 0.000000001) {
    stepZ = 1; tDeltaZ = cell / ndz; tMaxZ = tCurrent + ((gz + 1) * cell - curOz) / ndz;
  } else if (ndz < -0.000000001) {
    stepZ = -1; tDeltaZ = (0.0 - cell) / ndz; tMaxZ = tCurrent + (gz * cell - curOz) / ndz;
  }

  let tEndLoop = closestDist < maxDistance ? closestDist : maxDistance;
  if (tMax < tEndLoop) tEndLoop = tMax;
  while (tCurrent <= tEndLoop) {
    const bucket = (((gx * 73856093) ^ (gy * 19349663) ^ (gz * 83492791)) & SGRID_MASK);
    let entry = head[bucket];
    while (entry !== -1) {
      const k = entriesObj[entry];
      if (sVisitedStamp[k] !== stamp) {
        sVisitedStamp[k] = stamp;
        if (passesFilter(mask, layer, includeTriggers, k)) {
          const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId);
          if (hit) {
            if (sTempRayHit.distance < closestDist) {
              closestDist = sTempRayHit.distance;
              if (closestDist < tEndLoop) tEndLoop = closestDist;
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
      entry = entriesNext[entry];
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
  return raycastStaticGridDDA(
    ox, oy, oz, ndx, ndy, ndz, maxDistance, outHit,
    mask, layer, includeTriggers, curStepId, stamp,
    sStaticCellSize, sStaticInvCellSize,
    sStaticSceneMinX, sStaticSceneMaxX,
    sStaticSceneMinY, sStaticSceneMaxY,
    sStaticSceneMinZ, sStaticSceneMaxZ,
    sStaticHead, sStaticEntriesObj, sStaticEntriesNext,
  );
}

function raycastStaticCoarseDDA(
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
  if (sStaticCoarseCount === 0) return false;
  return raycastStaticGridDDA(
    ox, oy, oz, ndx, ndy, ndz, maxDistance, outHit,
    mask, layer, includeTriggers, curStepId, stamp,
    sStaticCoarseCellSize, sStaticCoarseInvCellSize,
    sStaticCoarseSceneMinX, sStaticCoarseSceneMaxX,
    sStaticCoarseSceneMinY, sStaticCoarseSceneMaxY,
    sStaticCoarseSceneMinZ, sStaticCoarseSceneMaxZ,
    sStaticCoarseHead, sStaticCoarseEntriesObj, sStaticCoarseEntriesNext,
  );
}

function raycastDynamicsDDA(
  ox: f64, oy: f64, oz: f64,
  ndx: f64, ndy: f64, ndz: f64,
  maxDistance: f64,
  outHit: RaycastHit,
  mask: number,
  layer: number,
  includeTriggers: boolean,
  curStepId: number,
  stamp: number,
  cell: f64,
  invCell: f64,
  dynH: f64,
  head: number[],
  next: number[],
  visitedStamp: number[],
  bucketStamp: number[],
  tempHit: RaycastHit,
  trsArr: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  hasLocalOffset: number,
  shapeArr: number[],
  triggerArr: number[],
  layerArr: number[],
  maskArr: number[],
  bodyIdArr: number[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
  hullIdArr: number[],
): boolean {
  let tMin = 0.0;
  let tMax = maxDistance;

  const dynMinX = sDynSceneMinX;
  const dynMaxX = sDynSceneMaxX;
  if (math.abs(ndx) < 0.000000001) {
    if (ox < dynMinX || ox > dynMaxX) return false;
  } else {
    const invD = 1.0 / ndx;
    let t1 = (dynMinX - ox) * invD;
    let t2 = (dynMaxX - ox) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  const dynMinY = sDynSceneMinY;
  const dynMaxY = sDynSceneMaxY;
  if (math.abs(ndy) < 0.000000001) {
    if (oy < dynMinY || oy > dynMaxY) return false;
  } else {
    const invD = 1.0 / ndy;
    let t1 = (dynMinY - oy) * invD;
    let t2 = (dynMaxY - oy) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  const dynMinZ = sDynSceneMinZ;
  const dynMaxZ = sDynSceneMaxZ;
  if (math.abs(ndz) < 0.000000001) {
    if (oz < dynMinZ || oz > dynMaxZ) return false;
  } else {
    const invD = 1.0 / ndz;
    let t1 = (dynMinZ - oz) * invD;
    let t2 = (dynMaxZ - oz) * invD;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }

  if (tMax < 0.0) return false;
  if (tMin >= maxDistance) return false;

  let closestDist = maxDistance;
  let found = false;

  let tCurrent = 0.0;
  let curOx = ox;
  let curOy = oy;
  let curOz = oz;
  if (tMin > 0.0) {
    tCurrent = tMin;
    curOx = ox + ndx * (tMin + 0.0001);
    curOy = oy + ndy * (tMin + 0.0001);
    curOz = oz + ndz * (tMin + 0.0001);
  }

  const fox = curOx * invCell; const tox = fox | 0; let gx = tox > fox ? tox - 1 : tox;
  const foy = curOy * invCell; const toy = foy | 0; let gy = toy > foy ? toy - 1 : toy;
  const foz = curOz * invCell; const toz = foz | 0; let gz = toz > foz ? toz - 1 : toz;

  let stepX = 0; let tDeltaX = 1e30; let tMaxX = 1e30;
  if (ndx > 0.000000001) {
    stepX = 1; tDeltaX = cell / ndx; tMaxX = tCurrent + ((gx + 1) * cell - curOx) / ndx;
  } else if (ndx < -0.000000001) {
    stepX = -1; tDeltaX = (0.0 - cell) / ndx; tMaxX = tCurrent + (gx * cell - curOx) / ndx;
  }

  let stepY = 0; let tDeltaY = 1e30; let tMaxY = 1e30;
  if (ndy > 0.000000001) {
    stepY = 1; tDeltaY = cell / ndy; tMaxY = tCurrent + ((gy + 1) * cell - curOy) / ndy;
  } else if (ndy < -0.000000001) {
    stepY = -1; tDeltaY = (0.0 - cell) / ndy; tMaxY = tCurrent + (gy * cell - curOy) / ndy;
  }

  let stepZ = 0; let tDeltaZ = 1e30; let tMaxZ = 1e30;
  if (ndz > 0.000000001) {
    stepZ = 1; tDeltaZ = cell / ndz; tMaxZ = tCurrent + ((gz + 1) * cell - curOz) / ndz;
  } else if (ndz < -0.000000001) {
    stepZ = -1; tDeltaZ = (0.0 - cell) / ndz; tMaxZ = tCurrent + (gz * cell - curOz) / ndz;
  }

  const gridMask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  let tEndLoop = closestDist;
  if (tMax < tEndLoop) tEndLoop = tMax;
  while (tCurrent <= tEndLoop) {
    const tNext = tMaxX < tMaxY ? (tMaxX < tMaxZ ? tMaxX : tMaxZ) : (tMaxY < tMaxZ ? tMaxY : tMaxZ);
    const tEnd = tNext < tEndLoop ? tNext : tEndLoop;

    const x0 = ox + ndx * tCurrent;
    const y0 = oy + ndy * tCurrent;
    const z0 = oz + ndz * tCurrent;
    const x1 = ox + ndx * tEnd;
    const y1 = oy + ndy * tEnd;
    const z1 = oz + ndz * tEnd;

    const segMinX = (x0 < x1 ? x0 : x1) - dynH;
    const segMaxX = (x0 > x1 ? x0 : x1) + dynH;
    const segMinY = (y0 < y1 ? y0 : y1) - dynH;
    const segMaxY = (y0 > y1 ? y0 : y1) + dynH;
    const segMinZ = (z0 < z1 ? z0 : z1) - dynH;
    const segMaxZ = (z0 > z1 ? z0 : z1) + dynH;

    const fminx = segMinX * invCell; const tminx = fminx | 0; const minNx = tminx > fminx ? tminx - 1 : tminx;
    const fmaxx = segMaxX * invCell; const tmaxx = fmaxx | 0; const maxNx = tmaxx > fmaxx ? tmaxx - 1 : tmaxx;
    const fminy = segMinY * invCell; const tminy = fminy | 0; const minNy = tminy > fminy ? tminy - 1 : tminy;
    const fmaxy = segMaxY * invCell; const tmaxy = fmaxy | 0; const maxNy = tmaxy > fmaxy ? tmaxy - 1 : tmaxy;
    const fminz = segMinZ * invCell; const tminz = fminz | 0; const minNz = tminz > fminz ? tminz - 1 : tminz;
    const fmaxz = segMaxZ * invCell; const tmaxz = fmaxz | 0; const maxNz = tmaxz > fmaxz ? tmaxz - 1 : tmaxz;

    let nx = minNx;
    let hashNx = minNx * hxMult;
    while (nx <= maxNx) {
      let ny = minNy;
      let hashNy = minNy * hyMult;
      while (ny <= maxNy) {
        const hashNxy = hashNx ^ hashNy;
        let nz = minNz;
        let hashNz = minNz * hzMult;
        while (nz <= maxNz) {
          const bucket = (hashNxy ^ hashNz) & gridMask;
          if (bucketStamp[bucket] !== stamp) {
            bucketStamp[bucket] = stamp;
            let k = head[bucket];
            while (k !== -1) {
              if (visitedStamp[k] !== stamp) {
                visitedStamp[k] = stamp;
                if (includeTriggers || triggerArr[k] === 0) {
                  if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {
                    const shp = shapeArr[k];
                    const t = trsArr[k];
                    let cx = t.wx;
                    let cy = t.wy;
                    let cz = t.wz;
                    const yaw = t.wry;
                    if (hasLocalOffset !== 0) {
                      const lcx = localCxArr[k];
                      const lcy = localCyArr[k];
                      const lcz = localCzArr[k];
                      if (lcx !== 0.0 || lcz !== 0.0) {
                        const oxLocal = lcx * t.sx; const ozLocal = lcz * t.sz;
                        if (yaw === 0.0) {
                          cx = cx + oxLocal; cz = cz + ozLocal;
                        } else {
                          const cs = math.cos(yaw); const sn = math.sin(yaw);
                          cx = cx + (oxLocal * cs + ozLocal * sn);
                          cz = cz + (0.0 - oxLocal * sn + ozLocal * cs);
                        }
                      }
                      if (lcy !== 0.0) cy = cy + lcy * t.sy;
                    }

                    if (shp === 0) { // COL_SPHERE
                      const tr = worldRadiusArr[k];
                      const ocX = ox - cx;
                      const ocY = oy - cy;
                      const ocZ = oz - cz;
                      const b = ocX * ndx + ocY * ndy + ocZ * ndz;
                      const c = ocX * ocX + ocY * ocY + ocZ * ocZ - tr * tr;
                      if (c <= 0.0) { // Origem dentro da esfera
                        closestDist = 0.0;
                        if (closestDist < tEndLoop) tEndLoop = closestDist;
                        outHit.hit = true;
                        outHit.bodyId = bodyIdArr[k];
                        outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
                        outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
                        outHit.distance = 0.0;
                        outHit.stepId = curStepId;
                        found = true;
                      } else if (b <= 0.0) {
                        const disc = b * b - c;
                        if (disc >= 0.0) {
                          const dist = (0.0 - b) - math.sqrt(disc);
                          if (dist >= 0.0 && dist < closestDist) {
                            closestDist = dist;
                            if (closestDist < tEndLoop) tEndLoop = closestDist;
                            const hxPoint = ox + ndx * dist;
                            const hyPoint = oy + ndy * dist;
                            const hzPoint = oz + ndz * dist;
                            outHit.hit = true;
                            outHit.bodyId = bodyIdArr[k];
                            outHit.point[0] = hxPoint; outHit.point[1] = hyPoint; outHit.point[2] = hzPoint;
                            const nxSph = (hxPoint - cx) / tr;
                            const nySph = (hyPoint - cy) / tr;
                            const nzSph = (hzPoint - cz) / tr;
                            outHit.normal[0] = nxSph; outHit.normal[1] = nySph; outHit.normal[2] = nzSph;
                            outHit.distance = dist;
                            outHit.stepId = curStepId;
                            found = true;
                          }
                        }
                      }
                    } else if (shp === 1) { // COL_BOX
                      const hx = worldHxArr[k];
                      const hy = worldHyArr[k];
                      const hz = worldHzArr[k];
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

                      if (rox >= 0.0 - hx && rox <= hx && roy >= 0.0 - hy && roy <= hy && roz >= 0.0 - hz && roz <= hz) {
                        closestDist = 0.0;
                        if (closestDist < tEndLoop) tEndLoop = closestDist;
                        outHit.hit = true;
                        outHit.bodyId = bodyIdArr[k];
                        outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
                        outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
                        outHit.distance = 0.0;
                        outHit.stepId = curStepId;
                        found = true;
                      } else {
                        let tmin = 0.0;
                        let tmax = closestDist;
                        let hitNormX = 0.0; let hitNormY = 0.0; let hitNormZ = 0.0;
                        let ok = true;

                        // X
                        if (math.abs(rdx) < 0.000000001) {
                          if (rox < 0.0 - hx || rox > hx) ok = false;
                        } else {
                          const inv = 1.0 / rdx;
                          let t1 = (0.0 - hx - rox) * inv;
                          let t2 = (hx - rox) * inv;
                          let n1 = 0.0 - 1.0;
                          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
                          if (t1 > tmin) { tmin = t1; hitNormX = n1; hitNormY = 0.0; hitNormZ = 0.0; }
                          if (t2 < tmax) tmax = t2;
                          if (tmin > tmax) ok = false;
                        }

                        if (ok) {
                          // Y
                          if (math.abs(rdy) < 0.000000001) {
                            if (roy < 0.0 - hy || roy > hy) ok = false;
                          } else {
                            const inv = 1.0 / rdy;
                            let t1 = (0.0 - hy - roy) * inv;
                            let t2 = (hy - roy) * inv;
                            let n1 = 0.0 - 1.0;
                            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
                            if (t1 > tmin) { tmin = t1; hitNormX = 0.0; hitNormY = n1; hitNormZ = 0.0; }
                            if (t2 < tmax) tmax = t2;
                            if (tmin > tmax) ok = false;
                          }
                        }

                        if (ok) {
                          // Z
                          if (math.abs(rdz) < 0.000000001) {
                            if (roz < 0.0 - hz || roz > hz) ok = false;
                          } else {
                            const inv = 1.0 / rdz;
                            let t1 = (0.0 - hz - roz) * inv;
                            let t2 = (hz - roz) * inv;
                            let n1 = 0.0 - 1.0;
                            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; n1 = 1.0; }
                            if (t1 > tmin) { tmin = t1; hitNormX = 0.0; hitNormY = 0.0; hitNormZ = n1; }
                            if (t2 < tmax) tmax = t2;
                            if (tmin > tmax) ok = false;
                          }
                        }

                        if (ok && tmin >= 0.0 && tmin < closestDist) {
                          closestDist = tmin;
                          if (closestDist < tEndLoop) tEndLoop = closestDist;
                          let nxBox = hitNormX; let nyBox = hitNormY; let nzBox = hitNormZ;
                          if (yaw !== 0.0) {
                            const cosY = math.cos(yaw); const sinY = math.sin(yaw);
                            nxBox = hitNormX * cosY - hitNormZ * sinY;
                            nzBox = hitNormX * sinY + hitNormZ * cosY;
                          }
                          outHit.hit = true;
                          outHit.bodyId = bodyIdArr[k];
                          outHit.point[0] = ox + ndx * tmin;
                          outHit.point[1] = oy + ndy * tmin;
                          outHit.point[2] = oz + ndz * tmin;
                          outHit.normal[0] = nxBox; outHit.normal[1] = nyBox; outHit.normal[2] = nzBox;
                          outHit.distance = tmin;
                          outHit.stepId = curStepId;
                          found = true;
                        }
                      }
                    } else { // Fallback para COL_HULL
                      const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);
                      if (hit && tempHit.distance < closestDist) {
                        closestDist = tempHit.distance;
                        if (closestDist < tEndLoop) tEndLoop = closestDist;
                        outHit.hit = true;
                        outHit.bodyId = tempHit.bodyId;
                        outHit.point[0] = tempHit.point[0];
                        outHit.point[1] = tempHit.point[1];
                        outHit.point[2] = tempHit.point[2];
                        outHit.normal[0] = tempHit.normal[0];
                        outHit.normal[1] = tempHit.normal[1];
                        outHit.normal[2] = tempHit.normal[2];
                        outHit.distance = tempHit.distance;
                        outHit.stepId = tempHit.stepId;
                        found = true;
                      }
                    }
                  }
                }
              }
              k = next[k];
            }
          }
          hashNz = hashNz + hzMult;
          nz = nz + 1;
        }
        hashNy = hashNy + hyMult;
        ny = ny + 1;
      }
      hashNx = hashNx + hxMult;
      nx = nx + 1;
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
  if (maxDistance <= 0.0 || maxDistance !== maxDistance) return false;
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

  // 1. Raycast contra estáticos Tier 1 (Grid Fino)
  if (sStaticCount > 0) {
    if (raycastStaticDDA(ox, oy, oz, ndx, ndy, ndz, closestDist, outHit, mask, layer, includeTriggers, curStepId, stamp)) {
      closestDist = outHit.distance;
      found = true;
    }
  }

  // 2. Raycast contra estáticos Tier 2 (Grid Coarse)
  if (sStaticCoarseCount > 0) {
    if (raycastStaticCoarseDDA(ox, oy, oz, ndx, ndy, ndz, closestDist, outHit, mask, layer, includeTriggers, curStepId, stamp)) {
      closestDist = outHit.distance;
      found = true;
    }
  }

  // 3. Raycast contra dinâmicos (DDA do raio engordado em maiorMeiaExtensãoDinâmica)
  if (sDynamicCount > 0) {
    if (raycastDynamicsDDA(
      ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
      mask, layer, includeTriggers, curStepId, stamp,
      sDynCellSize, sDynInvCellSize, sDynamicMaxHalfExtent,
      sDynHead, sDynNext, sVisitedStamp, sBucketStamp, sTempRayHit,
      sTrs, sLocalCx, sLocalCy, sLocalCz, sHasDynamicLocalOffset,
      sShape, sTrigger, sLayer, sMask, sBodyId,
      sWorldHx, sWorldHy, sWorldHz, sWorldRadius, sHullId,
    )) {
      closestDist = outHit.distance;
      found = true;
    }
  }

  // 4. Raycast contra estáticos colossais (terrenos gigantes)
  if (sColossalStaticCount > 0) {
    let li = 0;
    while (li < sColossalStaticCount) {
      const k = sColossalStaticObjs[li];
      if (passesFilter(mask, layer, includeTriggers, k)) {
        if (raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId)) {
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
      li = li + 1;
    }
  }

  // 5. Raycast contra dinâmicos colossais (chefes gigantes)
  if (sColossalDynamicCount > 0) {
    let li = 0;
    while (li < sColossalDynamicCount) {
      const k = sColossalDynamicObjs[li];
      if (passesFilter(mask, layer, includeTriggers, k)) {
        if (raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId)) {
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
      li = li + 1;
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
  resolveCandidateTransform(k);
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;
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
  resolveCandidateTransform(k);
  const shape = sShape[k];
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;

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
            if (sObjs[k].active === 0) {
              entry = entriesNext[entry];
              continue;
            }
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

function overlapSphereDynamicsInto(
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
  next: number[],
  bucketStamp: number[],
  stamp: number,
  triggerArr: number[],
  layerArr: number[],
  maskArr: number[],
  bodyIdArr: number[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
  trsArr: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  hasLocalOffset: number,
  shapeArr: number[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
  hullIdArr: number[],
): number {
  const gridMask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  let storedCount = startStoredCount;
  let totalFound = startTotalFound;
  const r2 = radius * radius;

  let gx = minGx;
  let hashX = minGx * hxMult;
  while (gx <= maxGx) {
    let gy = minGy;
    let hashY = minGy * hyMult;
    while (gy <= maxGy) {
      const gxy = hashX ^ hashY;
      let gz = minGz;
      let hashZ = minGz * hzMult;
      while (gz <= maxGz) {
        const bucket = (gxy ^ hashZ) & gridMask;
        if (bucketStamp[bucket] !== stamp) {
          bucketStamp[bucket] = stamp;
          let k = head[bucket];
          while (k !== -1) {
            if (sObjs[k].active === 0) {
              k = next[k];
              continue;
            }
            const isTrig = triggerArr[k] !== 0;
            if (includeTriggers || !isTrig) {
              if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {
                const t = trsArr[k];
                let cxObj = t.wx;
                let cyObj = t.wy;
                let czObj = t.wz;
                const yaw = t.wry;
                if (hasLocalOffset !== 0) {
                  const lcx = localCxArr[k];
                  const lcy = localCyArr[k];
                  const lcz = localCzArr[k];
                  if (lcx !== 0.0 || lcz !== 0.0) {
                    const oxLocal = lcx * t.sx; const ozLocal = lcz * t.sz;
                    if (yaw === 0.0) {
                      cxObj = cxObj + oxLocal; czObj = czObj + ozLocal;
                    } else {
                      const cs = math.cos(yaw); const sn = math.sin(yaw);
                      cxObj = cxObj + (oxLocal * cs + ozLocal * sn);
                      czObj = czObj + (0.0 - oxLocal * sn + ozLocal * cs);
                    }
                  }
                  if (lcy !== 0.0) cyObj = cyObj + lcy * t.sy;
                }

                const hx = worldHxArr[k];
                const rx = cx - cxObj;
                const absRx = rx < 0.0 ? 0.0 - rx : rx;
                if (absRx <= radius + hx) {
                  const hy = worldHyArr[k];
                  const ry = cy - cyObj;
                  const absRy = ry < 0.0 ? 0.0 - ry : ry;
                  if (absRy <= radius + hy) {
                    const hz = worldHzArr[k];
                    const rz = cz - czObj;
                    const absRz = rz < 0.0 ? 0.0 - rz : rz;
                    if (absRz <= radius + hz) {
                      const shp = shapeArr[k];
                      const candId = bodyIdArr[k];
                      const needsFullHit = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;

                      if (shp === 0) { // COL_SPHERE
                        const tr = worldRadiusArr[k];
                        const d2 = rx * rx + ry * ry + rz * rz;
                        const rSum = radius + tr;
                        if (d2 < rSum * rSum) {
                          totalFound = totalFound + 1;
                          if (needsFullHit) {
                            const dist = math.sqrt(d2);
                            const depth = isTrig ? 0.0 : (rSum - dist);
                            let nx = 0.0; let ny = 1.0; let nz = 0.0;
                            if (dist > 0.0000001) {
                              const inv = 1.0 / dist;
                              nx = (0.0 - rx) * inv; ny = (0.0 - ry) * inv; nz = (0.0 - rz) * inv;
                            }
                            if (storedCount < maxHits) {
                              const target = outHits[storedCount];
                              target.hit = true; target.bodyId = candId; target.depth = depth;
                              target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                              target.stepId = curStepId;
                              let p = storedCount;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1];
                                p = p - 1;
                              }
                              outHits[p] = target;
                              storedCount = storedCount + 1;
                            } else {
                              const target = outHits[maxHits - 1];
                              target.hit = true; target.bodyId = candId; target.depth = depth;
                              target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                              target.stepId = curStepId;
                              let p = maxHits - 1;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1];
                                p = p - 1;
                              }
                              outHits[p] = target;
                            }
                          }
                        }
                      } else if (shp === 1) { // COL_BOX
                        let lrx = rx;
                        let lry = ry;
                        let lrz = rz;
                        if (yaw !== 0.0) {
                          const cosY = math.cos(0.0 - yaw);
                          const sinY = math.sin(0.0 - yaw);
                          lrx = rx * cosY - rz * sinY;
                          lrz = rx * sinY + rz * cosY;
                        }

                        let vx = 0.0;
                        if (lrx > hx) vx = lrx - hx; else if (lrx < -hx) vx = lrx + hx;
                        let vy = 0.0;
                        if (lry > hy) vy = lry - hy; else if (lry < -hy) vy = lry + hy;
                        let vz = 0.0;
                        if (lrz > hz) vz = lrz - hz; else if (lrz < -hz) vz = lrz + hz;

                        const vd2 = vx * vx + vy * vy + vz * vz;
                        if (vd2 < r2) {
                          totalFound = totalFound + 1;
                          if (needsFullHit) {
                            const dist = math.sqrt(vd2);
                            let lnx = 0.0; let lny = 0.0; let lnz = 0.0;
                            let depth = 0.0;
                            if (dist > 0.0000001) {
                              depth = isTrig ? 0.0 : (radius - dist);
                              const inv = 1.0 / dist;
                              lnx = 0.0 - vx * inv; lny = 0.0 - vy * inv; lnz = 0.0 - vz * inv;
                            } else {
                              const penX = hx - (lrx < 0.0 ? 0.0 - lrx : lrx);
                              const penY = hy - (lry < 0.0 ? 0.0 - lry : lry);
                              const penZ = hz - (lrz < 0.0 ? 0.0 - lrz : lrz);
                              if (penX <= penY && penX <= penZ) {
                                lnx = lrx >= 0.0 ? 0.0 - 1.0 : 1.0;
                                depth = isTrig ? 0.0 : (radius + penX);
                              } else if (penY <= penX && penY <= penZ) {
                                lny = lry >= 0.0 ? 0.0 - 1.0 : 1.0;
                                depth = isTrig ? 0.0 : (radius + penY);
                              } else {
                                lnz = lrz >= 0.0 ? 0.0 - 1.0 : 1.0;
                                depth = isTrig ? 0.0 : (radius + penZ);
                              }
                            }

                            let wnx = lnx; let wny = lny; let wnz = lnz;
                            if (yaw !== 0.0) {
                              const cosY = math.cos(yaw); const sinY = math.sin(yaw);
                              wnx = lnx * cosY - lnz * sinY;
                              wnz = lnx * sinY + lnz * cosY;
                            }

                            if (storedCount < maxHits) {
                              const target = outHits[storedCount];
                              target.hit = true; target.bodyId = candId; target.depth = depth;
                              target.normal[0] = wnx; target.normal[1] = wny; target.normal[2] = wnz;
                              target.stepId = curStepId;
                              let p = storedCount;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1];
                                p = p - 1;
                              }
                              outHits[p] = target;
                              storedCount = storedCount + 1;
                            } else {
                              const target = outHits[maxHits - 1];
                              target.hit = true; target.bodyId = candId; target.depth = depth;
                              target.normal[0] = wnx; target.normal[1] = wny; target.normal[2] = wnz;
                              target.stepId = curStepId;
                              let p = maxHits - 1;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1];
                                p = p - 1;
                              }
                              outHits[p] = target;
                            }
                          }
                        }
                      } else { // Fallback para COL_HULL
                        if (storedCount < maxHits) {
                          const target = outHits[storedCount];
                          if (overlapSphereObject(k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
                            totalFound = totalFound + 1;
                            let p = storedCount;
                            while (p > 0 && outHits[p - 1].bodyId > candId) {
                              outHits[p] = outHits[p - 1];
                              p = p - 1;
                            }
                            outHits[p] = target;
                            storedCount = storedCount + 1;
                          }
                        } else if (candId < outHits[maxHits - 1].bodyId) {
                          if (overlapSphereObject(k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
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
                        } else if (testOverlapSphereObject(k, cx, cy, cz, radius)) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  }
                }
              }
            }
            k = next[k];
          }
        }
        hashZ = hashZ + hzMult;
        gz = gz + 1;
      }
      hashY = hashY + hyMult;
      gy = gy + 1;
    }
    hashX = hashX + hxMult;
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
  let effectiveMaxHits = maxHits;
  if (outHits.length < effectiveMaxHits) {
    effectiveMaxHits = outHits.length;
  }
  if (effectiveMaxHits <= 0) return 0;

  const targetScene = ensureIndex(sc);
  if (targetScene === null) return 0;

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

  // 1. Estáticos Tier 1 (Grid Fino)
  if (sStaticCount > 0 && maxQx >= sStaticSceneMinX && minQx <= sStaticSceneMaxX &&
      maxQy >= sStaticSceneMinY && minQy <= sStaticSceneMaxY &&
      maxQz >= sStaticSceneMinZ && minQz <= sStaticSceneMaxZ) {
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
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sStaticHead, sStaticEntriesObj, sStaticEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      0, 0,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 2. Estáticos Tier 2 (Grid Coarse)
  if (sStaticCoarseCount > 0 && maxQx >= sStaticCoarseSceneMinX && minQx <= sStaticCoarseSceneMaxX &&
      maxQy >= sStaticCoarseSceneMinY && minQy <= sStaticCoarseSceneMaxY &&
      maxQz >= sStaticCoarseSceneMinZ && minQz <= sStaticCoarseSceneMaxZ) {
    const minGx = mfloor(minQx * sStaticCoarseInvCellSize);
    const maxGx = mfloor(maxQx * sStaticCoarseInvCellSize);
    const minGy = mfloor(minQy * sStaticCoarseInvCellSize);
    const maxGy = mfloor(maxQy * sStaticCoarseInvCellSize);
    const minGz = mfloor(minQz * sStaticCoarseInvCellSize);
    const maxGz = mfloor(maxQz * sStaticCoarseInvCellSize);

    totalFound = overlapSphereInto(
      cx, cy, cz, radius,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sStaticCoarseHead, sStaticCoarseEntriesObj, sStaticCoarseEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      storedCount, totalFound,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0 && maxQx >= sDynSceneMinX && minQx <= sDynSceneMaxX &&
      maxQy >= sDynSceneMinY && minQy <= sDynSceneMaxY &&
      maxQz >= sDynSceneMinZ && minQz <= sDynSceneMaxZ) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    totalFound = overlapSphereDynamicsInto(
      cx, cy, cz, radius,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sDynHead, sDynNext, sBucketStamp, stamp,
      sTrigger, sLayer, sMask, sBodyId, sCandidateOverlapHit,
      storedCount, totalFound,
      sTrs, sLocalCx, sLocalCy, sLocalCz, sHasDynamicLocalOffset,
      sShape, sWorldHx, sWorldHy, sWorldHz, sWorldRadius, sHullId,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 4. Objetos colossais (estáticos e dinâmicos)
  if (sColossalStaticCount > 0 || sColossalDynamicCount > 0) {
    let colIdx = 0;
    const totalCol = sColossalStaticCount + sColossalDynamicCount;
    while (colIdx < totalCol) {
      const k = colIdx < sColossalStaticCount
        ? sColossalStaticObjs[colIdx]
        : sColossalDynamicObjs[colIdx - sColossalStaticCount];
      colIdx = colIdx + 1;

      if (passesFilter(mask, layer, includeTriggers, k)) {
        const candId = sBodyId[k];
        if (storedCount < effectiveMaxHits) {
          const target = outHits[storedCount];
          if (overlapSphereObject(k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
            totalFound = totalFound + 1;
            let p = storedCount;
            while (p > 0 && outHits[p - 1].bodyId > candId) {
              outHits[p] = outHits[p - 1];
              p = p - 1;
            }
            outHits[p] = target;
            storedCount = storedCount + 1;
          }
        } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
          if (overlapSphereObject(k, cx, cy, cz, radius, sCandidateOverlapHit, includeTriggers, curStepId)) {
            totalFound = totalFound + 1;
            const target = outHits[effectiveMaxHits - 1];
            copyOverlapHit(target, sCandidateOverlapHit);
            let p = effectiveMaxHits - 1;
            while (p > 0 && outHits[p - 1].bodyId > candId) {
              outHits[p] = outHits[p - 1];
              p = p - 1;
            }
            outHits[p] = target;
          }
        } else if (testOverlapSphereObject(k, cx, cy, cz, radius)) {
          totalFound = totalFound + 1;
        }
      }
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

  // 1. Estáticos Tier 1 (Grid Fino)
  if (sStaticCount > 0 && maxQx >= sStaticSceneMinX && minQx <= sStaticSceneMaxX &&
      maxQy >= sStaticSceneMinY && minQy <= sStaticSceneMaxY &&
      maxQz >= sStaticSceneMinZ && minQz <= sStaticSceneMaxZ) {
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

  // 2. Estáticos Tier 2 (Grid Coarse)
  if (sStaticCoarseCount > 0 && maxQx >= sStaticCoarseSceneMinX && minQx <= sStaticCoarseSceneMaxX &&
      maxQy >= sStaticCoarseSceneMinY && minQy <= sStaticCoarseSceneMaxY &&
      maxQz >= sStaticCoarseSceneMinZ && minQz <= sStaticCoarseSceneMaxZ) {
    const minGx = mfloor(minQx * sStaticCoarseInvCellSize);
    const maxGx = mfloor(maxQx * sStaticCoarseInvCellSize);
    const minGy = mfloor(minQy * sStaticCoarseInvCellSize);
    const maxGy = mfloor(maxQy * sStaticCoarseInvCellSize);
    const minGz = mfloor(minQz * sStaticCoarseInvCellSize);
    const maxGz = mfloor(maxQz * sStaticCoarseInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          let entry = sStaticCoarseHead[bucket];
          while (entry !== -1) {
            const k = sStaticCoarseEntriesObj[entry];
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
            entry = sStaticCoarseEntriesNext[entry];
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
  }

  // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0 && maxQx >= sDynSceneMinX && minQx <= sDynSceneMaxX &&
      maxQy >= sDynSceneMinY && minQy <= sDynSceneMaxY &&
      maxQz >= sDynSceneMinZ && minQz <= sDynSceneMaxZ) {
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
                  if (dynPassesAABB(k, minQx, maxQx, minQy, maxQy, minQz, maxQz)) {
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

  // 4. Objetos colossais (estáticos e dinâmicos)
  if (sColossalStaticCount > 0 || sColossalDynamicCount > 0) {
    let colIdx = 0;
    const totalCol = sColossalStaticCount + sColossalDynamicCount;
    while (colIdx < totalCol) {
      const k = colIdx < sColossalStaticCount
        ? sColossalStaticObjs[colIdx]
        : sColossalDynamicObjs[colIdx - sColossalStaticCount];
      colIdx = colIdx + 1;

      if (passesFilter(mask, layer, includeTriggers, k)) {
        const hit = createOverlapHit();
        if (overlapSphereObject(k, cx, cy, cz, radius, hit, includeTriggers, curStepId)) {
          result.push(hit);
        }
      }
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
  resolveCandidateTransform(k);
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;
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
  resolveCandidateTransform(k);
  const shape = sShape[k];
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;

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
            if (sObjs[k].active === 0) {
              entry = entriesNext[entry];
              continue;
            }
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

function overlapBoxDynamicsInto(
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
  next: number[],
  bucketStamp: number[],
  stamp: number,
  triggerArr: number[],
  layerArr: number[],
  maskArr: number[],
  bodyIdArr: number[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
  trsArr: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  hasLocalOffset: number,
  shapeArr: number[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
  hullIdArr: number[],
): number {
  const gridMask = 8191;
  const hxMult = 73856093;
  const hyMult = 19349663;
  const hzMult = 83492791;

  let storedCount = startStoredCount;
  let totalFound = startTotalFound;

  let gx = minGx;
  let hashX = minGx * hxMult;
  while (gx <= maxGx) {
    let gy = minGy;
    let hashY = minGy * hyMult;
    while (gy <= maxGy) {
      const gxy = hashX ^ hashY;
      let gz = minGz;
      let hashZ = minGz * hzMult;
      while (gz <= maxGz) {
        const bucket = (gxy ^ hashZ) & gridMask;
        if (bucketStamp[bucket] !== stamp) {
          bucketStamp[bucket] = stamp;
          let k = head[bucket];
          while (k !== -1) {
            if (sObjs[k].active === 0) {
              k = next[k];
              continue;
            }
            const isTrig = triggerArr[k] !== 0;
            if (includeTriggers || !isTrig) {
              if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {
                const t = trsArr[k];
                let cxObj = t.wx;
                let cyObj = t.wy;
                let czObj = t.wz;
                const yaw = t.wry;
                if (hasLocalOffset !== 0) {
                  const lcx = localCxArr[k];
                  const lcy = localCyArr[k];
                  const lcz = localCzArr[k];
                  if (lcx !== 0.0 || lcz !== 0.0) {
                    const oxLocal = lcx * t.sx; const ozLocal = lcz * t.sz;
                    if (yaw === 0.0) {
                      cxObj = cxObj + oxLocal; czObj = czObj + ozLocal;
                    } else {
                      const cs = math.cos(yaw); const sn = math.sin(yaw);
                      cxObj = cxObj + (oxLocal * cs + ozLocal * sn);
                      czObj = czObj + (0.0 - oxLocal * sn + ozLocal * cs);
                    }
                  }
                  if (lcy !== 0.0) cyObj = cyObj + lcy * t.sy;
                }

                const thx = worldHxArr[k];
                const rx = cxObj - cx;
                const absRx = rx < 0.0 ? 0.0 - rx : rx;
                if (absRx <= hx + thx) {
                  const thy = worldHyArr[k];
                  const ry = cyObj - cy;
                  const absRy = ry < 0.0 ? 0.0 - ry : ry;
                  if (absRy <= hy + thy) {
                    const thz = worldHzArr[k];
                    const rz = czObj - cz;
                    const absRz = rz < 0.0 ? 0.0 - rz : rz;
                    if (absRz <= hz + thz) {
                      const shp = shapeArr[k];
                      const candId = bodyIdArr[k];

                      if (shp === 0) { // COL_SPHERE (esfera vs caixa)
                        const tr = worldRadiusArr[k];
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
                        if (dist2 < tr * tr) {
                          totalFound = totalFound + 1;
                          const needsFull = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;
                          if (needsFull) {
                            const dist = math.sqrt(dist2);
                            let depth = 0.0;
                            let nx = 0.0; let ny = 0.0; let nz = 0.0;
                            if (dist > 0.0000001) {
                              depth = tr - dist;
                              const inv = 1.0 / dist;
                              nx = vx * inv; ny = vy * inv; nz = vz * inv;
                            } else {
                              const penX = hx - (rx < 0.0 ? 0.0 - rx : rx);
                              const penY = hy - (ry < 0.0 ? 0.0 - ry : ry);
                              const penZ = hz - (rz < 0.0 ? 0.0 - rz : rz);
                              if (penX <= penY && penX <= penZ) {
                                nx = rx >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penX;
                              } else if (penY <= penX && penY <= penZ) {
                                ny = ry >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penY;
                              } else {
                                nz = rz >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penZ;
                              }
                            }
                            if (storedCount < maxHits) {
                              const target = outHits[storedCount];
                              target.hit = true; target.bodyId = candId; target.depth = isTrig ? 0.0 : depth;
                              target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                              target.stepId = curStepId;
                              let p = storedCount;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1]; p = p - 1;
                              }
                              outHits[p] = target;
                              storedCount = storedCount + 1;
                            } else {
                              const target = outHits[maxHits - 1];
                              target.hit = true; target.bodyId = candId; target.depth = isTrig ? 0.0 : depth;
                              target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                              target.stepId = curStepId;
                              let p = maxHits - 1;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1]; p = p - 1;
                              }
                              outHits[p] = target;
                            }
                          }
                        }
                      } else if (shp === 1) { // COL_BOX (caixa vs caixa)
                        if (yaw === 0.0) { // AABB vs AABB direto
                          const dx = absRx - (hx + thx);
                          const dy = absRy - (hy + thy);
                          const dz = absRz - (hz + thz);
                          if (dx < 0.0 && dy < 0.0 && dz < 0.0) {
                            totalFound = totalFound + 1;
                            const needsFull = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;
                            if (needsFull) {
                              let depth = 0.0 - dx;
                              let nx = cxObj >= cx ? 1.0 : 0.0 - 1.0;
                              let ny = 0.0; let nz = 0.0;
                              if ((0.0 - dy) < depth) {
                                depth = 0.0 - dy; nx = 0.0; ny = cyObj >= cy ? 1.0 : 0.0 - 1.0; nz = 0.0;
                              }
                              if ((0.0 - dz) < depth) {
                                depth = 0.0 - dz; nx = 0.0; ny = 0.0; nz = czObj >= cz ? 1.0 : 0.0 - 1.0;
                              }
                              if (storedCount < maxHits) {
                                const target = outHits[storedCount];
                                target.hit = true; target.bodyId = candId; target.depth = isTrig ? 0.0 : depth;
                                target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                                target.stepId = curStepId;
                                let p = storedCount;
                                while (p > 0 && outHits[p - 1].bodyId > candId) {
                                  outHits[p] = outHits[p - 1]; p = p - 1;
                                }
                                outHits[p] = target;
                                storedCount = storedCount + 1;
                              } else {
                                const target = outHits[maxHits - 1];
                                target.hit = true; target.bodyId = candId; target.depth = isTrig ? 0.0 : depth;
                                target.normal[0] = nx; target.normal[1] = ny; target.normal[2] = nz;
                                target.stepId = curStepId;
                                let p = maxHits - 1;
                                while (p > 0 && outHits[p - 1].bodyId > candId) {
                                  outHits[p] = outHits[p - 1]; p = p - 1;
                                }
                                outHits[p] = target;
                              }
                            }
                          }
                        } else { // Caixa rotacionada -> overlapBoxObject
                          if (storedCount < maxHits) {
                            const target = outHits[storedCount];
                            if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                              totalFound = totalFound + 1;
                              let p = storedCount;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1]; p = p - 1;
                              }
                              outHits[p] = target;
                              storedCount = storedCount + 1;
                            }
                          } else if (candId < outHits[maxHits - 1].bodyId) {
                            if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                              totalFound = totalFound + 1;
                              const target = outHits[maxHits - 1];
                              copyOverlapHit(target, candHit);
                              let p = maxHits - 1;
                              while (p > 0 && outHits[p - 1].bodyId > candId) {
                                outHits[p] = outHits[p - 1]; p = p - 1;
                              }
                              outHits[p] = target;
                            }
                          } else if (testOverlapBoxObject(k, cx, cy, cz, hx, hy, hz)) {
                            totalFound = totalFound + 1;
                          }
                        }
                      } else { // Fallback COL_HULL
                        if (storedCount < maxHits) {
                          const target = outHits[storedCount];
                          if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                            totalFound = totalFound + 1;
                            let p = storedCount;
                            while (p > 0 && outHits[p - 1].bodyId > candId) {
                              outHits[p] = outHits[p - 1]; p = p - 1;
                            }
                            outHits[p] = target;
                            storedCount = storedCount + 1;
                          }
                        } else if (candId < outHits[maxHits - 1].bodyId) {
                          if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                            totalFound = totalFound + 1;
                            const target = outHits[maxHits - 1];
                            copyOverlapHit(target, candHit);
                            let p = maxHits - 1;
                            while (p > 0 && outHits[p - 1].bodyId > candId) {
                              outHits[p] = outHits[p - 1]; p = p - 1;
                            }
                            outHits[p] = target;
                          }
                        } else if (testOverlapBoxObject(k, cx, cy, cz, hx, hy, hz)) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  }
                }
              }
            }
            k = next[k];
          }
        }
        hashZ = hashZ + hzMult;
        gz = gz + 1;
      }
      hashY = hashY + hyMult;
      gy = gy + 1;
    }
    hashX = hashX + hxMult;
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
  let effectiveMaxHits = maxHits;
  if (outHits.length < effectiveMaxHits) {
    effectiveMaxHits = outHits.length;
  }
  if (effectiveMaxHits <= 0) return 0;

  const targetScene = ensureIndex(sc);
  if (targetScene === null) return 0;

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

  // 1. Estáticos Tier 1 (Grid Fino)
  if (sStaticCount > 0 && maxQx >= sStaticSceneMinX && minQx <= sStaticSceneMaxX &&
      maxQy >= sStaticSceneMinY && minQy <= sStaticSceneMaxY &&
      maxQz >= sStaticSceneMinZ && minQz <= sStaticSceneMaxZ) {
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
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sStaticHead, sStaticEntriesObj, sStaticEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      0, 0,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 2. Estáticos Tier 2 (Grid Coarse)
  if (sStaticCoarseCount > 0 && maxQx >= sStaticCoarseSceneMinX && minQx <= sStaticCoarseSceneMaxX &&
      maxQy >= sStaticCoarseSceneMinY && minQy <= sStaticCoarseSceneMaxY &&
      maxQz >= sStaticCoarseSceneMinZ && minQz <= sStaticCoarseSceneMaxZ) {
    const minGx = mfloor(minQx * sStaticCoarseInvCellSize);
    const maxGx = mfloor(maxQx * sStaticCoarseInvCellSize);
    const minGy = mfloor(minQy * sStaticCoarseInvCellSize);
    const maxGy = mfloor(maxQy * sStaticCoarseInvCellSize);
    const minGz = mfloor(minQz * sStaticCoarseInvCellSize);
    const maxGz = mfloor(maxQz * sStaticCoarseInvCellSize);

    totalFound = overlapBoxInto(
      cx, cy, cz, hx, hy, hz,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sStaticCoarseHead, sStaticCoarseEntriesObj, sStaticCoarseEntriesNext,
      sVisitedStamp, stamp,
      sTrigger, sLayer, sMask,
      sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
      sBodyId, sCandidateOverlapHit,
      storedCount, totalFound,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0 && maxQx >= sDynSceneMinX && minQx <= sDynSceneMaxX &&
      maxQy >= sDynSceneMinY && minQy <= sDynSceneMaxY &&
      maxQz >= sDynSceneMinZ && minQz <= sDynSceneMaxZ) {
    const dynH = sDynamicMaxHalfExtent;
    const minGx = mfloor((minQx - dynH) * sDynInvCellSize);
    const maxGx = mfloor((maxQx + dynH) * sDynInvCellSize);
    const minGy = mfloor((minQy - dynH) * sDynInvCellSize);
    const maxGy = mfloor((maxQy + dynH) * sDynInvCellSize);
    const minGz = mfloor((minQz - dynH) * sDynInvCellSize);
    const maxGz = mfloor((maxQz + dynH) * sDynInvCellSize);

    totalFound = overlapBoxDynamicsInto(
      cx, cy, cz, hx, hy, hz,
      minGx, maxGx, minGy, maxGy, minGz, maxGz,
      minQx, maxQx, minQy, maxQy, minQz, maxQz,
      outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
      sDynHead, sDynNext, sBucketStamp, stamp,
      sTrigger, sLayer, sMask, sBodyId, sCandidateOverlapHit,
      storedCount, totalFound,
      sTrs, sLocalCx, sLocalCy, sLocalCz, sHasDynamicLocalOffset,
      sShape, sWorldHx, sWorldHy, sWorldHz, sWorldRadius, sHullId,
    );
    storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
  }

  // 4. Objetos colossais (estáticos e dinâmicos)
  if (sColossalStaticCount > 0 || sColossalDynamicCount > 0) {
    let colIdx = 0;
    const totalCol = sColossalStaticCount + sColossalDynamicCount;
    while (colIdx < totalCol) {
      const k = colIdx < sColossalStaticCount
        ? sColossalStaticObjs[colIdx]
        : sColossalDynamicObjs[colIdx - sColossalStaticCount];
      colIdx = colIdx + 1;

      if (passesFilter(mask, layer, includeTriggers, k)) {
        const candId = sBodyId[k];
        if (storedCount < effectiveMaxHits) {
          const target = outHits[storedCount];
          if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
            totalFound = totalFound + 1;
            let p = storedCount;
            while (p > 0 && outHits[p - 1].bodyId > candId) {
              outHits[p] = outHits[p - 1];
              p = p - 1;
            }
            outHits[p] = target;
            storedCount = storedCount + 1;
          }
        } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
          if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, sCandidateOverlapHit, includeTriggers, curStepId)) {
            totalFound = totalFound + 1;
            const target = outHits[effectiveMaxHits - 1];
            copyOverlapHit(target, sCandidateOverlapHit);
            let p = effectiveMaxHits - 1;
            while (p > 0 && outHits[p - 1].bodyId > candId) {
              outHits[p] = outHits[p - 1];
              p = p - 1;
            }
            outHits[p] = target;
          }
        } else if (testOverlapBoxObject(k, cx, cy, cz, hx, hy, hz)) {
          totalFound = totalFound + 1;
        }
      }
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

  // 1. Estáticos Tier 1 (Grid Fino)
  if (sStaticCount > 0 && maxQx >= sStaticSceneMinX && minQx <= sStaticSceneMaxX &&
      maxQy >= sStaticSceneMinY && minQy <= sStaticSceneMaxY &&
      maxQz >= sStaticSceneMinZ && minQz <= sStaticSceneMaxZ) {
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

  // 2. Estáticos Tier 2 (Grid Coarse)
  if (sStaticCoarseCount > 0 && maxQx >= sStaticCoarseSceneMinX && minQx <= sStaticCoarseSceneMaxX &&
      maxQy >= sStaticCoarseSceneMinY && minQy <= sStaticCoarseSceneMaxY &&
      maxQz >= sStaticCoarseSceneMinZ && minQz <= sStaticCoarseSceneMaxZ) {
    const minGx = mfloor(minQx * sStaticCoarseInvCellSize);
    const maxGx = mfloor(maxQx * sStaticCoarseInvCellSize);
    const minGy = mfloor(minQy * sStaticCoarseInvCellSize);
    const maxGy = mfloor(maxQy * sStaticCoarseInvCellSize);
    const minGz = mfloor(minQz * sStaticCoarseInvCellSize);
    const maxGz = mfloor(maxQz * sStaticCoarseInvCellSize);

    let gx = minGx;
    while (gx <= maxGx) {
      const hashX = gx * 73856093;
      let gy = minGy;
      while (gy <= maxGy) {
        const gxy = hashX ^ (gy * 19349663);
        let gz = minGz;
        while (gz <= maxGz) {
          const bucket = (gxy ^ (gz * 83492791)) & SGRID_MASK;
          let entry = sStaticCoarseHead[bucket];
          while (entry !== -1) {
            const k = sStaticCoarseEntriesObj[entry];
            if (sVisitedStamp[k] !== stamp) {
              sVisitedStamp[k] = stamp;
              if (passesFilter(mask, layer, includeTriggers, k)) {
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
            entry = sStaticCoarseEntriesNext[entry];
          }
          gz = gz + 1;
        }
        gy = gy + 1;
      }
      gx = gx + 1;
    }
  }

  // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
  if (sDynamicCount > 0 && maxQx >= sDynSceneMinX && minQx <= sDynSceneMaxX &&
      maxQy >= sDynSceneMinY && minQy <= sDynSceneMaxY &&
      maxQz >= sDynSceneMinZ && minQz <= sDynSceneMaxZ) {
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
                  if (dynPassesAABB(k, minQx, maxQx, minQy, maxQy, minQz, maxQz)) {
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

  // 4. Objetos colossais (estáticos e dinâmicos)
  if (sColossalStaticCount > 0 || sColossalDynamicCount > 0) {
    let colIdx = 0;
    const totalCol = sColossalStaticCount + sColossalDynamicCount;
    while (colIdx < totalCol) {
      const k = colIdx < sColossalStaticCount
        ? sColossalStaticObjs[colIdx]
        : sColossalDynamicObjs[colIdx - sColossalStaticCount];
      colIdx = colIdx + 1;

      if (passesFilter(mask, layer, includeTriggers, k)) {
        const hit = createOverlapHit();
        if (overlapBoxObject(k, cx, cy, cz, hx, hy, hz, hit, includeTriggers, curStepId)) {
          result.push(hit);
        }
      }
    }
  }

  if (result.length > 1) {
    sortHitsInPlace(result, result.length);
  }
  return result;
}

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
const SGRID_CAP = 1024;
const SGRID_MASK = 1023;
const HASH_X = 73856093;
const HASH_Y = 19349663;
const HASH_Z = 83492791;

function cellHash(gx: number, gy: number, gz: number): number {
  return (((gx * HASH_X) ^ (gy * HASH_Y) ^ (gz * HASH_Z)) & SGRID_MASK);
}

function insertHitSorted(outHits: OverlapHit[], startIndex: number, target: OverlapHit): void {
  const candId = target.bodyId;
  let p = startIndex;
  while (p > 0 && outHits[p - 1].bodyId > candId) {
    outHits[p] = outHits[p - 1];
    p = p - 1;
  }
  outHits[p] = target;
}

/// Escrita de um hit em duas funções de 4 parâmetros, sem função de 9 e sem
/// `const target = outHits[i]`: no RTS atual, uma função com 5+ parâmetros que
/// escreve propriedades num elemento de array aloca um bloco de spill por
/// chamada (medido com RTS_GC_DEBUG: 20.000 overlaps = 23 coletas / 1 M
/// células; nesta forma, zero). Ver repro em scratch/repro_params.ts.
function writeHitCore(target: OverlapHit, candId: number, depth: f64, curStepId: number): void {
  target.hit = true;
  target.bodyId = candId;
  target.depth = depth;
  target.stepId = curStepId;
}
function writeHitNormal(target: OverlapHit, nx: f64, ny: f64, nz: f64): void {
  target.normal[0] = nx;
  target.normal[1] = ny;
  target.normal[2] = nz;
}

let sActiveScene: Scene | null = null;
let sCandCx: f64 = 0.0;
let sCandCy: f64 = 0.0;
let sCandCz: f64 = 0.0;
let sCandYaw: f64 = 0.0;
const sHullContactOut: Contact = new Contact();
const sSharedBucketStamp: number[] = new Array(SGRID_CAP).fill(0);
const sSharedVisitedStamp: number[] = new Array(8192).fill(0);
const sSharedStaticIndices: number[] = [];
const sSharedStaticCoarseIndices: number[] = [];
const sSharedExtentBuffer: f64[] = [];
const sSharedDynCollectObjs: GameObject[] = [];
let sSharedDynCollectCount: number = 0;
let sQueryStamp: number = 0;

function ensureSharedVisitedCapacity(cap: number): void {
  while (sSharedVisitedStamp.length < cap) sSharedVisitedStamp.push(0);
}

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

function mfloor(v: f64): number {
  const t = v | 0;
  if (v < 0.0 && (t * 1.0) !== v) return t - 1;
  return t;
}

export function getSpatialStepId(): number {
  if (pbActiveBackend() === 1) {
    return pbGpuLastReadbackStep();
  }
  return stepCount();
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASSE DO ÍNDICE ESPACIAL POR CENA (§8 e §8.3 item 4)
// ═══════════════════════════════════════════════════════════════════════════

export class SpatialIndex {
  scene: Scene;

  objCap: number = 64;
  dynHead: number[];
  dynNext: number[];
  dynCell: number[];
  prevDynCount: number = 0;
  dynamicMaxHalfExtent: number = 0.5;
  dynCellSize: number = 2.0;
  dynInvCellSize: number = 0.5;
  hasDynamicLocalOffset: number = 0;

  staticHead: number[];
  staticUsedBuckets: number[];
  staticEntriesCap: number = 0;
  staticEntriesObj: number[] = [];
  staticEntriesNext: number[] = [];
  staticEntriesCount: number = 0;
  staticCellSize: number = 2.0;
  staticInvCellSize: number = 0.5;
  staticMaxHalfExtent: number = 0.5;

  objs: GameObject[] = [];
  trs: Transform[] = [];

  localCx: number[] = [];
  localCy: number[] = [];
  localCz: number[] = [];

  worldCx: number[] = [];
  worldCy: number[] = [];
  worldCz: number[] = [];
  worldHx: number[] = [];
  worldHy: number[] = [];
  worldHz: number[] = [];
  worldRadius: number[] = [];

  shape: number[] = [];
  yaw: number[] = [];
  hasTriggers: number = 0;
  hasStaticTriggers: number = 0;
  hasDynamicTriggers: number = 0;

  staticCount: number = 0;
  dynamicIndices: number[] = [];
  dynamicCount: number = 0;

  staticCoarseHead: number[] = [];
  staticCoarseUsedBuckets: number[] = [];
  staticCoarseEntriesCap: number = 0;
  staticCoarseEntriesObj: number[] = [];
  staticCoarseEntriesNext: number[] = [];
  staticCoarseEntriesCount: number = 0;
  staticCoarseCellSize: number = 32.0;
  staticCoarseInvCellSize: number = 1.0 / 32.0;
  staticCoarseCount: number = 0;
  staticCoarseSceneMinX: number = 0.0; staticCoarseSceneMaxX: number = 0.0;
  staticCoarseSceneMinY: number = 0.0; staticCoarseSceneMaxY: number = 0.0;
  staticCoarseSceneMinZ: number = 0.0; staticCoarseSceneMaxZ: number = 0.0;

  colossalStaticCap: number = 0;
  colossalStaticObjs: number[] = [];
  colossalStaticCount: number = 0;

  colossalDynamicCap: number = 0;
  colossalDynamicObjs: number[] = [];
  colossalDynamicCount: number = 0;

  minX: number[] = [];
  maxX: number[] = [];
  minY: number[] = [];
  maxY: number[] = [];
  minZ: number[] = [];
  maxZ: number[] = [];

  staticSceneMinX: number = 0.0; staticSceneMaxX: number = 0.0;
  staticSceneMinY: number = 0.0; staticSceneMaxY: number = 0.0;
  staticSceneMinZ: number = 0.0; staticSceneMaxZ: number = 0.0;

  dynSceneMinX: number = 0.0; dynSceneMaxX: number = 0.0;
  dynSceneMinY: number = 0.0; dynSceneMaxY: number = 0.0;
  dynSceneMinZ: number = 0.0; dynSceneMaxZ: number = 0.0;

  lastRebuildStep: number = -1;
  lastStaticVersion: number = -1;
  lastCompVersion: number = -1;
  staticTotal: number = 0;
  forceStaticRebuild: boolean = false;

  tempRayHit: RaycastHit = createRaycastHit();
  candidateOverlapHit: OverlapHit = createOverlapHit();

  constructor(scene: Scene) {
    this.scene = scene;
    const n = scene.objects.length;
    let cap = n < 64 ? 64 : n + 64;
    this.objCap = cap;

    this.dynHead = new Array(SGRID_CAP).fill(-1);
    this.dynNext = new Array(cap).fill(-1);
    this.dynCell = [];

    this.staticHead = [];
    this.staticUsedBuckets = [];
    this.staticEntriesCap = 0;
    this.staticEntriesObj = [];
    this.staticEntriesNext = [];

    this.localCx = [];
    this.localCy = [];
    this.localCz = [];

    // Linhas por objeto já com a capacidade da cena, via `new Array(cap).fill`:
    // elementos de array vivem fora do heap de células (Vec no host), então
    // isto não custa células, e `fill` é muito mais barato que crescer por
    // `push` no primeiro rebuild (~2.000 objetos: 5,5 ms -> ver first_rebuild.ts).
    this.worldCx = new Array(cap).fill(0.0);
    this.worldCy = new Array(cap).fill(0.0);
    this.worldCz = new Array(cap).fill(0.0);
    this.worldHx = new Array(cap).fill(0.5);
    this.worldHy = new Array(cap).fill(0.5);
    this.worldHz = new Array(cap).fill(0.5);
    this.worldRadius = new Array(cap).fill(0.5);

    this.shape = new Array(cap).fill(0);
    this.yaw = new Array(cap).fill(0.0);
    this.dynamicIndices = [];

    this.minX = new Array(cap).fill(0.0);
    this.maxX = new Array(cap).fill(0.0);
    this.minY = new Array(cap).fill(0.0);
    this.maxY = new Array(cap).fill(0.0);
    this.minZ = new Array(cap).fill(0.0);
    this.maxZ = new Array(cap).fill(0.0);
  }

  growLocalCenter(): void {
    const cap = this.objCap;
    while (this.localCx.length < cap) {
      this.localCx.push(0.0);
      this.localCy.push(0.0);
      this.localCz.push(0.0);
    }
  }

  growStatic(cap: number): void {
    while (this.worldCx.length < cap) {
      this.worldCx.push(0.0);
      this.worldCy.push(0.0);
      this.worldCz.push(0.0);
      this.worldHx.push(0.5);
      this.worldHy.push(0.5);
      this.worldHz.push(0.5);
      this.worldRadius.push(0.5);
      this.shape.push(0);
      this.yaw.push(0.0);
      this.minX.push(0.0);
      this.maxX.push(0.0);
      this.minY.push(0.0);
      this.maxY.push(0.0);
      this.minZ.push(0.0);
      this.maxZ.push(0.0);
    }
  }

  ensureObjCapacity(cap: number): void {
    if (this.objCap >= cap) return;
    let newCap = this.objCap < 64 ? 64 : (this.objCap + (this.objCap >> 1));
    if (newCap < cap) newCap = cap;
    if (newCap < this.objCap + 32) newCap = this.objCap + 32;
    ensureSharedVisitedCapacity(newCap);
    while (this.dynNext.length < newCap) {
      this.dynNext.push(-1);
    }
    if (this.localCx.length > 0 && this.localCx.length < newCap) {
      while (this.localCx.length < newCap) {
        this.localCx.push(0.0);
        this.localCy.push(0.0);
        this.localCz.push(0.0);
      }
    }
    this.objCap = newCap;
  }

  growStaticEntries(): void {
    if (this.staticEntriesCap === 0) {
      this.staticEntriesCap = 128;
      this.staticEntriesObj = new Array(128).fill(0);
      this.staticEntriesNext = new Array(128).fill(0);
      return;
    }
    const newCap = this.staticEntriesCap * 2;
    while (this.staticEntriesObj.length < newCap) {
      this.staticEntriesObj.push(0);
      this.staticEntriesNext.push(0);
    }
    this.staticEntriesCap = newCap;
  }

  growStaticCoarseEntries(): void {
    if (this.staticCoarseEntriesCap === 0) {
      this.staticCoarseEntriesCap = 128;
      this.staticCoarseEntriesObj = new Array(128).fill(0);
      this.staticCoarseEntriesNext = new Array(128).fill(0);
      return;
    }
    const newCap = this.staticCoarseEntriesCap * 2;
    while (this.staticCoarseEntriesObj.length < newCap) {
      this.staticCoarseEntriesObj.push(0);
      this.staticCoarseEntriesNext.push(0);
    }
    this.staticCoarseEntriesCap = newCap;
  }

  addColossalStatic(k: number): void {
    if (this.colossalStaticCap === 0) {
      this.colossalStaticCap = 16;
      this.colossalStaticObjs = new Array(16).fill(0);
    } else if (this.colossalStaticCount >= this.colossalStaticCap) {
      const newCap = this.colossalStaticCap * 2;
      while (this.colossalStaticObjs.length < newCap) this.colossalStaticObjs.push(0);
      this.colossalStaticCap = newCap;
    }
    this.colossalStaticObjs[this.colossalStaticCount] = k;
    this.colossalStaticCount = this.colossalStaticCount + 1;
  }

  addColossalDynamic(k: number): void {
    if (this.colossalDynamicCap === 0) {
      this.colossalDynamicCap = 16;
      this.colossalDynamicObjs = new Array(16).fill(0);
    } else if (this.colossalDynamicCount >= this.colossalDynamicCap) {
      const newCap = this.colossalDynamicCap * 2;
      while (this.colossalDynamicObjs.length < newCap) this.colossalDynamicObjs.push(0);
      this.colossalDynamicCap = newCap;
    }
    this.colossalDynamicObjs[this.colossalDynamicCount] = k;
    this.colossalDynamicCount = this.colossalDynamicCount + 1;
  }

  removeColossalDynamicBySlot(k: number): void {
    let ci = 0;
    while (ci < this.colossalDynamicCount) {
      if (this.colossalDynamicObjs[ci] === k) {
        const lastCi = this.colossalDynamicCount - 1;
        if (ci < lastCi) {
          this.colossalDynamicObjs[ci] = this.colossalDynamicObjs[lastCi];
        }
        this.colossalDynamicCount = this.colossalDynamicCount - 1;
        return;
      }
      ci = ci + 1;
    }
  }

  updateColossalDynamicSlot(oldK: number, newK: number): void {
    let ci = 0;
    while (ci < this.colossalDynamicCount) {
      if (this.colossalDynamicObjs[ci] === oldK) {
        this.colossalDynamicObjs[ci] = newK;
        return;
      }
      ci = ci + 1;
    }
  }

  clear(): void {
    if (this.staticHead.length > 0) {
      let b = 0;
      while (b < this.staticUsedBuckets.length) {
        this.staticHead[this.staticUsedBuckets[b]] = -1;
        b = b + 1;
      }
      this.staticUsedBuckets.length = 0;
      this.staticEntriesCount = 0;
    }

    if (this.staticCoarseHead.length > 0) {
      let cb = 0;
      while (cb < this.staticCoarseUsedBuckets.length) {
        this.staticCoarseHead[this.staticCoarseUsedBuckets[cb]] = -1;
        cb = cb + 1;
      }
      this.staticCoarseUsedBuckets.length = 0;
      this.staticCoarseEntriesCount = 0;
      this.staticCoarseCount = 0;
    }

    let di = 0;
    while (di < this.prevDynCount) {
      this.dynHead[this.dynCell[di]] = -1;
      di = di + 1;
    }
    this.prevDynCount = 0;
    this.colossalStaticCount = 0;
    this.colossalDynamicCount = 0;
    this.lastRebuildStep = -1;
    this.lastStaticVersion = -1;
    this.lastCompVersion = -1;
    this.staticTotal = 0;
    this.forceStaticRebuild = false;
    this.objs.length = 0;
    this.trs.length = 0;
    this.dynamicCount = 0;
    this.worldCx.length = 0;
    this.worldCy.length = 0;
    this.worldCz.length = 0;
    this.yaw.length = 0;
    this.minX.length = 0;
    this.maxX.length = 0;
    this.minY.length = 0;
    this.maxY.length = 0;
    this.minZ.length = 0;
    this.maxZ.length = 0;
    this.hasTriggers = 0;
    this.hasStaticTriggers = 0;
    this.hasDynamicTriggers = 0;
  }

  resolveCandidateTransform(k: number): void {
    if (k < this.staticTotal) {
      sCandCx = this.worldCx[k];
      sCandCy = this.worldCy[k];
      sCandCz = this.worldCz[k];
      sCandYaw = this.yaw[k];
      return;
    }
    const t = this.trs[k];
    sCandYaw = t.wry;
    if (this.hasDynamicLocalOffset === 0) {
      sCandCx = t.wx;
      sCandCy = t.wy;
      sCandCz = t.wz;
      return;
    }
    let cx = t.wx;
    let cy = t.wy;
    let cz = t.wz;
    const lcx = this.localCx[k];
    const lcy = this.localCy[k];
    const lcz = this.localCz[k];
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

  fillObjectRow(k: number, o: GameObject): number {
    const t = o.transform;
    const isStatic = bodyTypeOf(o) === BODY_STATIC ? 1 : 0;
    const shp = shapeOf(o);
    const trig = triggerOf(o);
    if (trig !== 0) {
      if (isStatic !== 0) this.hasStaticTriggers = 1;
      else this.hasDynamicTriggers = 1;
    }
    const lhx = halfLocalX(o);
    const lhy = halfLocalY(o);
    const lhz = halfLocalZ(o);
    const lcx = centerLocalX(o);
    const lcy = centerLocalY(o);
    const lcz = centerLocalZ(o);

    this.shape[k] = shp;
    if (lcx !== 0.0 || lcy !== 0.0 || lcz !== 0.0) {
      if (this.localCx.length < this.objCap) this.growLocalCenter();
      this.localCx[k] = lcx;
      this.localCy[k] = lcy;
      this.localCz[k] = lcz;
      this.hasDynamicLocalOffset = 1;
    } else if (this.localCx.length > 0) {
      this.localCx[k] = 0.0;
      this.localCy[k] = 0.0;
      this.localCz[k] = 0.0;
    }

    const hx = lhx * t.sx;
    const hy = lhy * t.sy;
    const hz = lhz * t.sz;

    this.worldHx[k] = hx;
    this.worldHy[k] = hy;
    this.worldHz[k] = hz;
    this.worldRadius[k] = hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz);
    const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

    if (isStatic !== 0) {
      if (this.worldCx.length <= k) this.growStatic(k + 1);
      this.yaw[k] = t.wry;
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
      this.worldCx[k] = cx; this.worldCy[k] = cy; this.worldCz[k] = cz;

      const minX = cx - hx; const maxX = cx + hx;
      const minY = cy - hy; const maxY = cy + hy;
      const minZ = cz - hz; const maxZ = cz + hz;
      this.minX[k] = minX; this.maxX[k] = maxX;
      this.minY[k] = minY; this.maxY[k] = maxY;
      this.minZ[k] = minZ; this.maxZ[k] = maxZ;
    }

    return maxH;
  }

  passesFilter(
    queryMask: number,
    queryLayer: number,
    includeTriggers: boolean,
    k: number,
  ): boolean {
    const o = this.objs[k];
    if (o.active === 0) return false;
    if ((queryMask & o.layer) === 0) return false;
    if ((o.mask & queryLayer) === 0) return false;
    if (!includeTriggers && this.hasTriggers !== 0 && triggerOf(o) !== 0) {
      return false;
    }
    return true;
  }

  rebuild(): void {
    const targetScene = this.scene;
    const statVer = targetScene.staticVersion;
    const compVer = targetScene.compVersion;

    const staticDirty = (this.lastStaticVersion !== statVer || this.forceStaticRebuild);
    const compDirty = (this.lastCompVersion !== compVer || staticDirty);

    if (staticDirty) {
      this.forceStaticRebuild = false;
      this.hasStaticTriggers = 0;
      const allObjs = targetScene.objects;
      const n = allObjs.length;
      this.ensureObjCapacity(n);

      this.objs.length = 0;
      this.trs.length = 0;
      let allStaticCount = 0;
      this.dynCollectCount = 0;

      let i = 0;
      while (i < n) {
        const o = allObjs[i];
        if (o.collideFlag !== 0 || o.colIdx >= 0) {
          if (bodyTypeOf(o) === BODY_STATIC) {
            if (o.active !== 0) {
              const k = this.objs.length;
              this.objs.push(o);
              const t = o.transform;
              this.trs.push(t);
              o.spatialSlot = k;
              o.spatialDynSlot = 0 - 1;

              const maxH = this.fillObjectRow(k, o);

              if (sSharedStaticIndices.length < allStaticCount + 1) sSharedStaticIndices.push(k);
              else sSharedStaticIndices[allStaticCount] = k;
              if (sSharedExtentBuffer.length < allStaticCount + 1) sSharedExtentBuffer.push(maxH);
              else sSharedExtentBuffer[allStaticCount] = maxH;
              allStaticCount = allStaticCount + 1;
            }
          } else {
            if (sSharedDynCollectCount >= sSharedDynCollectObjs.length) {
              sSharedDynCollectObjs.push(o);
            } else {
              sSharedDynCollectObjs[sSharedDynCollectCount] = o;
            }
            sSharedDynCollectCount = sSharedDynCollectCount + 1;
          }
        }
        i = i + 1;
      }

      this.staticTotal = this.objs.length;

      // Célula estática Tier 1 dimensionada pela MEDIANA das meias-extensões características
      let statCellSize = 2.0;
      if (allStaticCount > 0) {
        const medianExtent = quickselect(sSharedExtentBuffer, 0, allStaticCount - 1, allStaticCount >> 1);
        statCellSize = medianExtent * 2.0;
      }
      if (statCellSize < 2.0) statCellSize = 2.0;
      this.staticCellSize = statCellSize;
      this.staticInvCellSize = 1.0 / this.staticCellSize;

      // Limiar relativo à célula (§Item 1 do Claude)
      const tier1Threshold = 2.0 * this.staticCellSize;

      this.staticCount = 0;
      this.staticCoarseCount = 0;
      this.colossalStaticCount = 0;

      let coarseCandidatesCount = 0;
      let si = 0;
      while (si < allStaticCount) {
        const k = sSharedStaticIndices[si];
        const hx = this.worldHx[k];
        const hy = this.worldHy[k];
        const hz = this.worldHz[k];
        const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);
        if (maxH <= tier1Threshold) {
          if (sSharedStaticIndices.length < this.staticCount + 1) sSharedStaticIndices.push(k);
          else sSharedStaticIndices[this.staticCount] = k;
          this.staticCount = this.staticCount + 1;
        } else {
          if (sSharedStaticCoarseIndices.length < coarseCandidatesCount + 1) sSharedStaticCoarseIndices.push(k);
          else sSharedStaticCoarseIndices[coarseCandidatesCount] = k;
          if (sSharedExtentBuffer.length < coarseCandidatesCount + 1) sSharedExtentBuffer.push(maxH);
          else sSharedExtentBuffer[coarseCandidatesCount] = maxH;
          coarseCandidatesCount = coarseCandidatesCount + 1;
        }
        si = si + 1;
      }

      // Dimensiona Tier 2 (Coarse Grid) se houver candidatos
      let coarseCellSize = this.staticCellSize * 4.0;
      if (coarseCandidatesCount > 0) {
        const medianCoarse = quickselect(sSharedExtentBuffer, 0, coarseCandidatesCount - 1, coarseCandidatesCount >> 1);
        coarseCellSize = medianCoarse * 2.0;
        if (coarseCellSize < this.staticCellSize * 4.0) coarseCellSize = this.staticCellSize * 4.0;
      }
      this.staticCoarseCellSize = coarseCellSize;
      this.staticCoarseInvCellSize = 1.0 / this.staticCoarseCellSize;
      const tier2Threshold = 2.0 * this.staticCoarseCellSize;

      let cci = 0;
      let finalCoarseCount = 0;
      while (cci < coarseCandidatesCount) {
        const k = sSharedStaticCoarseIndices[cci];
        const hx = this.worldHx[k];
        const hy = this.worldHy[k];
        const hz = this.worldHz[k];
        const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);
        if (maxH <= tier2Threshold && maxH <= 128.0) {
          if (sSharedStaticCoarseIndices.length < finalCoarseCount + 1) sSharedStaticCoarseIndices.push(k);
          else sSharedStaticCoarseIndices[finalCoarseCount] = k;
          finalCoarseCount = finalCoarseCount + 1;
        } else {
          this.addColossalStatic(k);
        }
        cci = cci + 1;
      }
      this.staticCoarseCount = finalCoarseCount;

      // Limpa e popula buckets estáticos Tier 1 (Grid Fino)
      if (this.staticCount > 0) {
        if (this.staticHead.length === 0) {
          this.staticHead = new Array(SGRID_CAP).fill(-1);
          this.staticUsedBuckets = [];
          this.staticEntriesCap = Math.max(128, this.staticCount * 4);
          this.staticEntriesObj = new Array(this.staticEntriesCap).fill(0);
          this.staticEntriesNext = new Array(this.staticEntriesCap).fill(0);
        }
        let b = 0;
        while (b < this.staticUsedBuckets.length) {
          this.staticHead[this.staticUsedBuckets[b]] = -1;
          b = b + 1;
        }
        this.staticUsedBuckets.length = 0;
        this.staticEntriesCount = 0;

        let bMinX = 1e30; let bMaxX = -1e30;
        let bMinY = 1e30; let bMaxY = -1e30;
        let bMinZ = 1e30; let bMaxZ = -1e30;

        let ti = 0;
        while (ti < this.staticCount) {
          const k = sSharedStaticIndices[ti];
          const minX = this.minX[k]; const maxX = this.maxX[k];
          const minY = this.minY[k]; const maxY = this.maxY[k];
          const minZ = this.minZ[k]; const maxZ = this.maxZ[k];

          if (minX < bMinX) bMinX = minX;
          if (maxX > bMaxX) bMaxX = maxX;
          if (minY < bMinY) bMinY = minY;
          if (maxY > bMaxY) bMaxY = maxY;
          if (minZ < bMinZ) bMinZ = minZ;
          if (maxZ > bMaxZ) bMaxZ = maxZ;

          const minGx = mfloor(minX * this.staticInvCellSize);
          const maxGx = mfloor(maxX * this.staticInvCellSize);
          const minGy = mfloor(minY * this.staticInvCellSize);
          const maxGy = mfloor(maxY * this.staticInvCellSize);
          const minGz = mfloor(minZ * this.staticInvCellSize);
          const maxGz = mfloor(maxZ * this.staticInvCellSize);

          let gx = minGx;
          while (gx <= maxGx) {
            const hashX = gx * HASH_X;
            let gy = minGy;
            while (gy <= maxGy) {
              const gxy = hashX ^ (gy * HASH_Y);
              let gz = minGz;
              while (gz <= maxGz) {
                const bucket = (gxy ^ (gz * HASH_Z)) & SGRID_MASK;
                if (this.staticHead[bucket] === -1) {
                  this.staticUsedBuckets.push(bucket);
                }
                const entryIdx = this.staticEntriesCount;
                this.staticEntriesCount = this.staticEntriesCount + 1;
                if (this.staticEntriesCount >= this.staticEntriesCap) this.growStaticEntries();
                this.staticEntriesObj[entryIdx] = k;
                this.staticEntriesNext[entryIdx] = this.staticHead[bucket];
                this.staticHead[bucket] = entryIdx;
                gz = gz + 1;
              }
              gy = gy + 1;
            }
            gx = gx + 1;
          }
          ti = ti + 1;
        }
        this.staticSceneMinX = bMinX; this.staticSceneMaxX = bMaxX;
        this.staticSceneMinY = bMinY; this.staticSceneMaxY = bMaxY;
        this.staticSceneMinZ = bMinZ; this.staticSceneMaxZ = bMaxZ;
      }

      // Limpa e popula buckets estáticos Tier 2 (Grid Coarse)
      if (this.staticCoarseCount > 0) {
        if (this.staticCoarseHead.length === 0) {
          this.staticCoarseHead = new Array(SGRID_CAP).fill(-1);
          this.staticCoarseUsedBuckets = [];
          this.staticCoarseEntriesCap = Math.max(128, this.staticCoarseCount * 4);
          this.staticCoarseEntriesObj = new Array(this.staticCoarseEntriesCap).fill(0);
          this.staticCoarseEntriesNext = new Array(this.staticCoarseEntriesCap).fill(0);
        }
        let cb = 0;
        while (cb < this.staticCoarseUsedBuckets.length) {
          this.staticCoarseHead[this.staticCoarseUsedBuckets[cb]] = -1;
          cb = cb + 1;
        }
        this.staticCoarseUsedBuckets.length = 0;
        this.staticCoarseEntriesCount = 0;

        let bcMinX = 1e30; let bcMaxX = -1e30;
        let bcMinY = 1e30; let bcMaxY = -1e30;
        let bcMinZ = 1e30; let bcMaxZ = -1e30;

        let cii = 0;
        while (cii < this.staticCoarseCount) {
          const k = sSharedStaticCoarseIndices[cii];
          const minX = this.minX[k]; const maxX = this.maxX[k];
          const minY = this.minY[k]; const maxY = this.maxY[k];
          const minZ = this.minZ[k]; const maxZ = this.maxZ[k];

          if (minX < bcMinX) bcMinX = minX;
          if (maxX > bcMaxX) bcMaxX = maxX;
          if (minY < bcMinY) bcMinY = minY;
          if (maxY > bcMaxY) bcMaxY = maxY;
          if (minZ < bcMinZ) bcMinZ = minZ;
          if (maxZ > bcMaxZ) bcMaxZ = maxZ;

          const minGx = mfloor(minX * this.staticCoarseInvCellSize);
          const maxGx = mfloor(maxX * this.staticCoarseInvCellSize);
          const minGy = mfloor(minY * this.staticCoarseInvCellSize);
          const maxGy = mfloor(maxY * this.staticCoarseInvCellSize);
          const minGz = mfloor(minZ * this.staticCoarseInvCellSize);
          const maxGz = mfloor(maxZ * this.staticCoarseInvCellSize);

          let gx = minGx;
          while (gx <= maxGx) {
            const hashX = gx * HASH_X;
            let gy = minGy;
            while (gy <= maxGy) {
              const gxy = hashX ^ (gy * HASH_Y);
              let gz = minGz;
              while (gz <= maxGz) {
                const bucket = (gxy ^ (gz * HASH_Z)) & SGRID_MASK;
                if (this.staticCoarseHead[bucket] === -1) {
                  this.staticCoarseUsedBuckets.push(bucket);
                }
                const entryIdx = this.staticCoarseEntriesCount;
                this.staticCoarseEntriesCount = this.staticCoarseEntriesCount + 1;
                if (this.staticCoarseEntriesCount >= this.staticCoarseEntriesCap) this.growStaticCoarseEntries();
                this.staticCoarseEntriesObj[entryIdx] = k;
                this.staticCoarseEntriesNext[entryIdx] = this.staticCoarseHead[bucket];
                this.staticCoarseHead[bucket] = entryIdx;
                gz = gz + 1;
              }
              gy = gy + 1;
            }
            gx = gx + 1;
          }
          cii = cii + 1;
        }
        this.staticCoarseSceneMinX = bcMinX; this.staticCoarseSceneMaxX = bcMaxX;
        this.staticCoarseSceneMinY = bcMinY; this.staticCoarseSceneMaxY = bcMaxY;
        this.staticCoarseSceneMinZ = bcMinZ; this.staticCoarseSceneMaxZ = bcMaxZ;
      }

      this.lastStaticVersion = statVer;
    }

    // 2. SINCRONIZAÇÃO DA COMPOSIÇÃO DINÂMICA (quando compVersion mudar)
    if (compDirty) {
      if (!staticDirty && !targetScene.pendingDynamicOverflow && targetScene.pendingDynamicOps.length > 0) {
        const ops = targetScene.pendingDynamicOps;
        const objs = targetScene.pendingDynamicObjs;
        const numOps = ops.length;
        let oi = 0;
        while (oi < numOps) {
          const op = ops[oi];
          const o = objs[oi];
          if (op === DYN_OP_ADD) {
            if ((o.collideFlag !== 0 || o.colIdx >= 0) && bodyTypeOf(o) !== BODY_STATIC) {
              this.ensureObjCapacity(this.objs.length + 1);
              const k = this.objs.length;
              this.objs.push(o);
              const t = o.transform;
              this.trs.push(t);

              const maxH = this.fillObjectRow(k, o);

              if (this.localCx.length > 0 && (this.localCx[k] !== 0.0 || this.localCy[k] !== 0.0 || this.localCz[k] !== 0.0)) this.hasDynamicLocalOffset = 1;
              o.spatialSlot = k;

              if (maxH > 16.0) {
                this.addColossalDynamic(k);
                o.spatialDynSlot = 0 - 1;
              } else {
                o.spatialDynSlot = this.dynamicCount;
                if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else this.dynamicIndices[this.dynamicCount] = k;
                this.dynamicCount = this.dynamicCount + 1;
                if (maxH > this.dynamicMaxHalfExtent) this.dynamicMaxHalfExtent = maxH;
              }
            }
          } else if (op === DYN_OP_REMOVE) {
            const k = o.spatialSlot;
            if (k >= 0 && k < this.staticTotal) {
              if (this.objs[k] === o) {
                this.forceStaticRebuild = true;
                o.spatialSlot = 0 - 1;
                o.spatialDynSlot = 0 - 1;
                this.rebuild();
                return;
              }
              oi = oi + 1;
              continue;
            }
            if (k >= this.staticTotal && k < this.objs.length && this.objs[k] === o) {
              const dynSlot = o.spatialDynSlot;
              if (dynSlot >= 0 && dynSlot < this.dynamicCount && this.dynamicIndices[dynSlot] === k) {
                const lastDynSlot = this.dynamicCount - 1;
                if (dynSlot < lastDynSlot) {
                  const movedK = this.dynamicIndices[lastDynSlot];
                  this.dynamicIndices[dynSlot] = movedK;
                  this.objs[movedK].spatialDynSlot = dynSlot;
                }
                this.dynamicCount = this.dynamicCount - 1;
              } else {
                this.removeColossalDynamicBySlot(k);
              }
              o.spatialDynSlot = 0 - 1;

              const lastK = this.objs.length - 1;
              if (k < lastK) {
                const lastObj = this.objs[lastK];
                this.objs[k] = lastObj;
                this.trs[k] = this.trs[lastK];
                if (k < this.shape.length && lastK < this.shape.length) {
                  this.shape[k] = this.shape[lastK];
                  this.worldHx[k] = this.worldHx[lastK];
                  this.worldHy[k] = this.worldHy[lastK];
                  this.worldHz[k] = this.worldHz[lastK];
                  this.worldRadius[k] = this.worldRadius[lastK];
                }
                if (this.localCx.length > 0 && lastK < this.localCx.length) {
                  this.localCx[k] = this.localCx[lastK];
                  this.localCy[k] = this.localCy[lastK];
                  this.localCz[k] = this.localCz[lastK];
                }
                if (lastK < this.worldCx.length) {
                  this.yaw[k] = this.yaw[lastK];
                  this.worldCx[k] = this.worldCx[lastK];
                  this.worldCy[k] = this.worldCy[lastK];
                  this.worldCz[k] = this.worldCz[lastK];
                }

                lastObj.spatialSlot = k;
                if (lastObj.spatialDynSlot >= 0) {
                  this.dynamicIndices[lastObj.spatialDynSlot] = k;
                } else {
                  this.updateColossalDynamicSlot(lastK, k);
                }
              }
              this.objs.pop();
              this.trs.pop();
              o.spatialSlot = 0 - 1;
            }
          }
          oi = oi + 1;
        }
        ops.length = 0;
        objs.length = 0;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;
      } else if (staticDirty) {
        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        this.hasDynamicTriggers = 0;
        let maxDynamicHalfExtent: f64 = 0.5;
        let hasDynLocalOffset = 0;
        let dynMinX = 1e30; let dynMaxX = -1e30;
        let dynMinY = 1e30; let dynMaxY = -1e30;
        let dynMinZ = 1e30; let dynMaxZ = -1e30;

        let i = 0;
        while (i < sSharedDynCollectCount) {
          const o = sSharedDynCollectObjs[i];
          const k = this.objs.length;
          this.objs.push(o);
          const t = o.transform;
          this.trs.push(t);
          o.spatialSlot = k;

          const maxH = this.fillObjectRow(k, o);

          if (this.localCx.length > 0 && (this.localCx[k] !== 0.0 || this.localCy[k] !== 0.0 || this.localCz[k] !== 0.0)) hasDynLocalOffset = 1;
          if (maxH > 16.0) {
            this.addColossalDynamic(k);
            o.spatialDynSlot = 0 - 1;
          } else {
            if (maxH > maxDynamicHalfExtent) maxDynamicHalfExtent = maxH;
            if (t.wx < dynMinX) dynMinX = t.wx;
            if (t.wx > dynMaxX) dynMaxX = t.wx;
            if (t.wy < dynMinY) dynMinY = t.wy;
            if (t.wy > dynMaxY) dynMaxY = t.wy;
            if (t.wz < dynMinZ) dynMinZ = t.wz;
            if (t.wz > dynMaxZ) dynMaxZ = t.wz;
            o.spatialDynSlot = this.dynamicCount;
            if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else this.dynamicIndices[this.dynamicCount] = k;
            this.dynamicCount = this.dynamicCount + 1;
          }
          i = i + 1;
        }

        let ci = 0;
        while (ci < sSharedDynCollectCount) {
          sSharedDynCollectObjs[ci] = null as unknown as GameObject;
          ci = ci + 1;
        }
        sSharedDynCollectCount = 0;

        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      } else {
        const allObjs = targetScene.objects;
        const n = allObjs.length;
        this.ensureObjCapacity(n);

        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        this.hasDynamicTriggers = 0;
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
              const k = this.objs.length;
              this.objs.push(o);
              const t = o.transform;
              this.trs.push(t);
              o.spatialSlot = k;

              const maxH = this.fillObjectRow(k, o);

              if (this.localCx.length > 0 && (this.localCx[k] !== 0.0 || this.localCy[k] !== 0.0 || this.localCz[k] !== 0.0)) hasDynLocalOffset = 1;
              if (maxH > 16.0) {
                this.addColossalDynamic(k);
                o.spatialDynSlot = 0 - 1;
              } else {
                if (maxH > maxDynamicHalfExtent) maxDynamicHalfExtent = maxH;
                if (t.wx < dynMinX) dynMinX = t.wx;
                if (t.wx > dynMaxX) dynMaxX = t.wx;
                if (t.wy < dynMinY) dynMinY = t.wy;
                if (t.wy > dynMaxY) dynMaxY = t.wy;
                if (t.wz < dynMinZ) dynMinZ = t.wz;
                if (t.wz > dynMaxZ) dynMaxZ = t.wz;
                o.spatialDynSlot = this.dynamicCount;
                if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else this.dynamicIndices[this.dynamicCount] = k;
                this.dynamicCount = this.dynamicCount + 1;
              }
            }
          }
          i = i + 1;
        }

        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      }

      this.dynCellSize = this.dynamicMaxHalfExtent * 2.0;
      if (this.dynCellSize < 2.0) this.dynCellSize = 2.0;
      this.dynInvCellSize = 1.0 / this.dynCellSize;

      this.lastCompVersion = compVer;
    }

    // 3. Atualiza apenas os objetos dinâmicos através de FUNÇÃO LIVRE TIPADA
    while (this.dynCell.length < this.dynamicCount) this.dynCell.push(0);
    rebuildDynamicsInto(
      this.dynamicCount, this.dynamicIndices, this.trs,
      this.localCx, this.localCy, this.localCz,
      this.dynInvCellSize, this.dynHead, this.dynNext, this.dynCell,
      this.prevDynCount,
      this.hasDynamicLocalOffset,
      this.dynamicMaxHalfExtent,
      this,
    );

    this.prevDynCount = this.dynamicCount;
    this.lastRebuildStep = getSpatialStepId();
  }

  ensureIndex(): void {
    const curStep = getSpatialStepId();
    if (this.lastRebuildStep !== curStep ||
        this.lastCompVersion !== this.scene.compVersion ||
        this.lastStaticVersion !== this.scene.staticVersion ||
        this.forceStaticRebuild) {
      this.rebuild();
    }
  }

  raycastNonAlloc(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDistance: number,
    outHit: RaycastHit,
    mask: number = MASK_ALL,
    layer: number = LAYER_DEFAULT,
    includeTriggers: boolean = false,
  ): boolean {
    if (maxDistance <= 0.0 || maxDistance !== maxDistance) return false;
    this.ensureIndex();

    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 0.000000000001) return false;
    const invLen = 1.0 / math.sqrt(len2);
    const ndx = dx * invLen;
    const ndy = dy * invLen;
    const ndz = dz * invLen;

    sQueryStamp = (sQueryStamp + 1) | 0;
    if (sQueryStamp >= 2000000000) {
      sQueryStamp = 1;
      sSharedBucketStamp.fill(0);
      sSharedVisitedStamp.fill(0);
    }
    const stamp = sQueryStamp;
    const curStepId = getSpatialStepId();

    let closestDist = maxDistance;
    let found = false;

    // 1. Raycast contra estáticos Tier 1 (Grid Fino)
    if (this.staticCount > 0) {
      if (raycastStaticGridDDA(
        this,
        ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
        mask, layer, includeTriggers, curStepId, stamp,
        this.staticCellSize, this.staticInvCellSize,
        this.staticSceneMinX, this.staticSceneMaxX,
        this.staticSceneMinY, this.staticSceneMaxY,
        this.staticSceneMinZ, this.staticSceneMaxZ,
        this.staticHead, this.staticEntriesObj, this.staticEntriesNext,
      )) {
        closestDist = outHit.distance;
        found = true;
      }
    }

    // 2. Raycast contra estáticos Tier 2 (Grid Coarse)
    if (this.staticCoarseCount > 0) {
      if (raycastStaticGridDDA(
        this,
        ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
        mask, layer, includeTriggers, curStepId, stamp,
        this.staticCoarseCellSize, this.staticCoarseInvCellSize,
        this.staticCoarseSceneMinX, this.staticCoarseSceneMaxX,
        this.staticCoarseSceneMinY, this.staticCoarseSceneMaxY,
        this.staticCoarseSceneMinZ, this.staticCoarseSceneMaxZ,
        this.staticCoarseHead, this.staticCoarseEntriesObj, this.staticCoarseEntriesNext,
      )) {
        closestDist = outHit.distance;
        found = true;
      }
    }

    // 3. Raycast contra dinâmicos (DDA do raio engordado em maiorMeiaExtensãoDinâmica)
    if (this.dynamicCount > 0) {
      if (raycastDynamicsDDA(
        this,
        ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
        mask, layer, includeTriggers, curStepId, stamp,
        this.dynCellSize, this.dynInvCellSize, this.dynamicMaxHalfExtent,
        this.dynHead, this.dynNext, sSharedVisitedStamp, sSharedBucketStamp, this.tempRayHit,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape,
        this.worldHx, this.worldHy, this.worldHz, this.worldRadius,
      )) {
        closestDist = outHit.distance;
        found = true;
      }
    }

    // 4. Raycast contra estáticos colossais (terrenos gigantes)
    if (this.colossalStaticCount > 0) {
      let li = 0;
      while (li < this.colossalStaticCount) {
        const k = this.colossalStaticObjs[li];
        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          if (raycastObject(this, k, ox, oy, oz, ndx, ndy, ndz, closestDist, this.tempRayHit, includeTriggers, curStepId)) {
            if (this.tempRayHit.distance < closestDist) {
              closestDist = this.tempRayHit.distance;
              outHit.hit = true;
              outHit.bodyId = this.tempRayHit.bodyId;
              outHit.point[0] = this.tempRayHit.point[0];
              outHit.point[1] = this.tempRayHit.point[1];
              outHit.point[2] = this.tempRayHit.point[2];
              outHit.normal[0] = this.tempRayHit.normal[0];
              outHit.normal[1] = this.tempRayHit.normal[1];
              outHit.normal[2] = this.tempRayHit.normal[2];
              outHit.distance = this.tempRayHit.distance;
              outHit.stepId = this.tempRayHit.stepId;
              found = true;
            }
          }
        }
        li = li + 1;
      }
    }

    // 5. Raycast contra dinâmicos colossais (chefes gigantes)
    if (this.colossalDynamicCount > 0) {
      let li = 0;
      while (li < this.colossalDynamicCount) {
        const k = this.colossalDynamicObjs[li];
        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          if (raycastObject(this, k, ox, oy, oz, ndx, ndy, ndz, closestDist, this.tempRayHit, includeTriggers, curStepId)) {
            if (this.tempRayHit.distance < closestDist) {
              closestDist = this.tempRayHit.distance;
              outHit.hit = true;
              outHit.bodyId = this.tempRayHit.bodyId;
              outHit.point[0] = this.tempRayHit.point[0];
              outHit.point[1] = this.tempRayHit.point[1];
              outHit.point[2] = this.tempRayHit.point[2];
              outHit.normal[0] = this.tempRayHit.normal[0];
              outHit.normal[1] = this.tempRayHit.normal[1];
              outHit.normal[2] = this.tempRayHit.normal[2];
              outHit.distance = this.tempRayHit.distance;
              outHit.stepId = this.tempRayHit.stepId;
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

  overlapSphereNonAlloc(
    cx: number, cy: number, cz: number,
    radius: number,
    outHits: OverlapHit[],
    maxHits: number,
    mask: number = MASK_ALL,
    layer: number = LAYER_DEFAULT,
    includeTriggers: boolean = false,
  ): number {
    let effectiveMaxHits = maxHits;
    if (outHits.length < effectiveMaxHits) {
      effectiveMaxHits = outHits.length;
    }
    if (effectiveMaxHits <= 0) return 0;

    this.ensureIndex();

    sQueryStamp = (sQueryStamp + 1) | 0;
    if (sQueryStamp >= 2000000000) {
      sQueryStamp = 1;
      sSharedBucketStamp.fill(0);
      sSharedVisitedStamp.fill(0);
    }
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
    if (this.staticCount > 0 && maxQx >= this.staticSceneMinX && minQx <= this.staticSceneMaxX &&
        maxQy >= this.staticSceneMinY && minQy <= this.staticSceneMaxY &&
        maxQz >= this.staticSceneMinZ && minQz <= this.staticSceneMaxZ) {
      const minGx = mfloor(minQx * this.staticInvCellSize);
      const maxGx = mfloor(maxQx * this.staticInvCellSize);
      const minGy = mfloor(minQy * this.staticInvCellSize);
      const maxGy = mfloor(maxQy * this.staticInvCellSize);
      const minGz = mfloor(minQz * this.staticInvCellSize);
      const maxGz = mfloor(maxQz * this.staticInvCellSize);

      totalFound = overlapSphereInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticHead, this.staticEntriesObj, this.staticEntriesNext,
        sSharedVisitedStamp, stamp,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.candidateOverlapHit,
        0, 0,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 2. Estáticos Tier 2 (Grid Coarse)
    if (this.staticCoarseCount > 0 && maxQx >= this.staticCoarseSceneMinX && minQx <= this.staticCoarseSceneMaxX &&
        maxQy >= this.staticCoarseSceneMinY && minQy <= this.staticCoarseSceneMaxY &&
        maxQz >= this.staticCoarseSceneMinZ && minQz <= this.staticCoarseSceneMaxZ) {
      const minGx = mfloor(minQx * this.staticCoarseInvCellSize);
      const maxGx = mfloor(maxQx * this.staticCoarseInvCellSize);
      const minGy = mfloor(minQy * this.staticCoarseInvCellSize);
      const maxGy = mfloor(maxQy * this.staticCoarseInvCellSize);
      const minGz = mfloor(minQz * this.staticCoarseInvCellSize);
      const maxGz = mfloor(maxQz * this.staticCoarseInvCellSize);

      totalFound = overlapSphereInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticCoarseHead, this.staticCoarseEntriesObj, this.staticCoarseEntriesNext,
        sSharedVisitedStamp, stamp,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.candidateOverlapHit,
        storedCount, totalFound,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
    if (this.dynamicCount > 0 && maxQx >= this.dynSceneMinX && minQx <= this.dynSceneMaxX &&
        maxQy >= this.dynSceneMinY && minQy <= this.dynSceneMaxY &&
        maxQz >= this.dynSceneMinZ && minQz <= this.dynSceneMaxZ) {
      const dynH = this.dynamicMaxHalfExtent;
      const minGx = mfloor((minQx - dynH) * this.dynInvCellSize);
      const maxGx = mfloor((maxQx + dynH) * this.dynInvCellSize);
      const minGy = mfloor((minQy - dynH) * this.dynInvCellSize);
      const maxGy = mfloor((maxQy + dynH) * this.dynInvCellSize);
      const minGz = mfloor((minQz - dynH) * this.dynInvCellSize);
      const maxGz = mfloor((maxQz + dynH) * this.dynInvCellSize);

      totalFound = overlapSphereDynamicsInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.dynHead, this.dynNext, sSharedBucketStamp, stamp,
        this.candidateOverlapHit,
        storedCount, totalFound,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape, this.worldHx, this.worldHy, this.worldHz, this.worldRadius,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 4. Objetos colossais (estáticos e dinâmicos)
    if (this.colossalStaticCount > 0 || this.colossalDynamicCount > 0) {
      let colIdx = 0;
      const totalCol = this.colossalStaticCount + this.colossalDynamicCount;
      while (colIdx < totalCol) {
        const k = colIdx < this.colossalStaticCount
          ? this.colossalStaticObjs[colIdx]
          : this.colossalDynamicObjs[colIdx - this.colossalStaticCount];
        colIdx = colIdx + 1;

        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.objs[k].id;
          if (storedCount < effectiveMaxHits) {
            if (overlapSphereObject(this, k, cx, cy, cz, radius, outHits[storedCount], includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              insertHitSorted(outHits, storedCount, outHits[storedCount]);
              storedCount = storedCount + 1;
            }
          } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
            if (overlapSphereObject(this, k, cx, cy, cz, radius, this.candidateOverlapHit, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              copyOverlapHit(outHits[effectiveMaxHits - 1], this.candidateOverlapHit);
              insertHitSorted(outHits, effectiveMaxHits - 1, outHits[effectiveMaxHits - 1]);
            }
          } else if (testOverlapSphereObject(this, k, cx, cy, cz, radius)) {
            totalFound = totalFound + 1;
          }
        }
      }
    }

    return totalFound;
  }

  overlapBoxNonAlloc(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    outHits: OverlapHit[],
    maxHits: number,
    mask: number = MASK_ALL,
    layer: number = LAYER_DEFAULT,
    includeTriggers: boolean = false,
  ): number {
    let effectiveMaxHits = maxHits;
    if (outHits.length < effectiveMaxHits) {
      effectiveMaxHits = outHits.length;
    }
    if (effectiveMaxHits <= 0) return 0;

    this.ensureIndex();

    sQueryStamp = (sQueryStamp + 1) | 0;
    if (sQueryStamp >= 2000000000) {
      sQueryStamp = 1;
      sSharedBucketStamp.fill(0);
      sSharedVisitedStamp.fill(0);
    }
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
    if (this.staticCount > 0 && maxQx >= this.staticSceneMinX && minQx <= this.staticSceneMaxX &&
        maxQy >= this.staticSceneMinY && minQy <= this.staticSceneMaxY &&
        maxQz >= this.staticSceneMinZ && minQz <= this.staticSceneMaxZ) {
      const minGx = mfloor(minQx * this.staticInvCellSize);
      const maxGx = mfloor(maxQx * this.staticInvCellSize);
      const minGy = mfloor(minQy * this.staticInvCellSize);
      const maxGy = mfloor(maxQy * this.staticInvCellSize);
      const minGz = mfloor(minQz * this.staticInvCellSize);
      const maxGz = mfloor(maxQz * this.staticInvCellSize);

      totalFound = overlapBoxInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticHead, this.staticEntriesObj, this.staticEntriesNext,
        sSharedVisitedStamp, stamp,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.candidateOverlapHit,
        0, 0,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 2. Estáticos Tier 2 (Grid Coarse)
    if (this.staticCoarseCount > 0 && maxQx >= this.staticCoarseSceneMinX && minQx <= this.staticCoarseSceneMaxX &&
        maxQy >= this.staticCoarseSceneMinY && minQy <= this.staticCoarseSceneMaxY &&
        maxQz >= this.staticCoarseSceneMinZ && minQz <= this.staticCoarseSceneMaxZ) {
      const minGx = mfloor(minQx * this.staticCoarseInvCellSize);
      const maxGx = mfloor(maxQx * this.staticCoarseInvCellSize);
      const minGy = mfloor(minQy * this.staticCoarseInvCellSize);
      const maxGy = mfloor(maxQy * this.staticCoarseInvCellSize);
      const minGz = mfloor(minQz * this.staticCoarseInvCellSize);
      const maxGz = mfloor(maxQz * this.staticCoarseInvCellSize);

      totalFound = overlapBoxInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticCoarseHead, this.staticCoarseEntriesObj, this.staticCoarseEntriesNext,
        sSharedVisitedStamp, stamp,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.candidateOverlapHit,
        storedCount, totalFound,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 3. Dinâmicos: região expandida em maiorMeiaExtensãoDinâmica; sem duplicatas, sem visitedStamp (§5.3)
    if (this.dynamicCount > 0 && maxQx >= this.dynSceneMinX && minQx <= this.dynSceneMaxX &&
        maxQy >= this.dynSceneMinY && minQy <= this.dynSceneMaxY &&
        maxQz >= this.dynSceneMinZ && minQz <= this.dynSceneMaxZ) {
      const dynH = this.dynamicMaxHalfExtent;
      const minGx = mfloor((minQx - dynH) * this.dynInvCellSize);
      const maxGx = mfloor((maxQx + dynH) * this.dynInvCellSize);
      const minGy = mfloor((minQy - dynH) * this.dynInvCellSize);
      const maxGy = mfloor((maxQy + dynH) * this.dynInvCellSize);
      const minGz = mfloor((minQz - dynH) * this.dynInvCellSize);
      const maxGz = mfloor((maxQz + dynH) * this.dynInvCellSize);

      totalFound = overlapBoxDynamicsInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.dynHead, this.dynNext, sSharedBucketStamp, stamp,
        this.candidateOverlapHit,
        storedCount, totalFound,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape, this.worldHx, this.worldHy, this.worldHz, this.worldRadius,
      );
      storedCount = totalFound < effectiveMaxHits ? totalFound : effectiveMaxHits;
    }

    // 4. Objetos colossais (estáticos e dinâmicos)
    if (this.colossalStaticCount > 0 || this.colossalDynamicCount > 0) {
      let colIdx = 0;
      const totalCol = this.colossalStaticCount + this.colossalDynamicCount;
      while (colIdx < totalCol) {
        const k = colIdx < this.colossalStaticCount
          ? this.colossalStaticObjs[colIdx]
          : this.colossalDynamicObjs[colIdx - this.colossalStaticCount];
        colIdx = colIdx + 1;

        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.objs[k].id;
          if (storedCount < effectiveMaxHits) {
            if (overlapBoxObject(this, k, cx, cy, cz, hx, hy, hz, outHits[storedCount], includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              insertHitSorted(outHits, storedCount, outHits[storedCount]);
              storedCount = storedCount + 1;
            }
          } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
            if (overlapBoxObject(this, k, cx, cy, cz, hx, hy, hz, this.candidateOverlapHit, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              copyOverlapHit(outHits[effectiveMaxHits - 1], this.candidateOverlapHit);
              insertHitSorted(outHits, effectiveMaxHits - 1, outHits[effectiveMaxHits - 1]);
            }
          } else if (testOverlapBoxObject(this, k, cx, cy, cz, hx, hy, hz)) {
            totalFound = totalFound + 1;
          }
        }
      }
    }

    return totalFound;
  }
}

export function getSpatialIndex(sc: Scene): SpatialIndex {
  if (sc.spatialIndex === null || sc.spatialIndex === undefined) {
    sc.spatialIndex = new SpatialIndex(sc);
  }
  return sc.spatialIndex as SpatialIndex;
}

export function setSpatialScene(sc: Scene | null): void {
  sActiveScene = sc;
}

export function getSpatialScene(): Scene | null {
  return sActiveScene;
}

export function spatialRebuildIndex(sc?: Scene): void {
  const targetScene = sc !== undefined && sc !== null ? sc : sActiveScene;
  if (targetScene === null) return;
  getSpatialIndex(targetScene).rebuild();
}

export function spatialGridRebuildCost(sc: Scene): { timeMs: f64; cellCount: number; objCount: number } {
  const idx = getSpatialIndex(sc);
  const t0 = performance.now();
  idx.rebuild();
  const timeMs = performance.now() - t0;
  return {
    timeMs: timeMs,
    cellCount: idx.dynamicCount,
    objCount: idx.objs.length,
  };
}

function rebuildDynamicsInto(
  dynamicCount: number,
  dynamicIndices: number[],
  trs: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  invCellSize: f64,
  dynHead: number[],
  dynNext: number[],
  dynCell: number[],
  prevDynCount: number,
  hasLocalOffset: number,
  maxExtent: f64,
  idx: SpatialIndex,
): void {
  const mask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

  // 1. Limpa APENAS os buckets sujos na passada anterior (no máximo prevDynCount)
  let k = 0;
  const kLimit = prevDynCount - 3;
  while (k < kLimit) {
    dynHead[dynCell[k]] = -1;
    dynHead[dynCell[k + 1]] = -1;
    dynHead[dynCell[k + 2]] = -1;
    dynHead[dynCell[k + 3]] = -1;
    k = k + 4;
  }
  while (k < prevDynCount) {
    dynHead[dynCell[k]] = -1;
    k = k + 1;
  }

  let minX = 1e30; let maxX = -1e30;
  let minY = 1e30; let maxY = -1e30;
  let minZ = 1e30; let maxZ = -1e30;

  // 2. Insere cada objeto dinâmico no grid pelo centro e atualiza os limites da cena dinâmica a cada passo
  if (hasLocalOffset === 0) {
    let di = 0;
    const diLimit = dynamicCount - 3;
    while (di < diLimit) {
      let objIdx = dynamicIndices[di];
      let t: Transform = trs[objIdx];
      let wx = t.wx; let wy = t.wy; let wz = t.wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      let fx = wx * invCellSize; let tx = fx | 0; let gx = tx > fx ? tx - 1 : tx;
      let fy = wy * invCellSize; let ty = fy | 0; let gy = ty > fy ? ty - 1 : ty;
      let fz = wz * invCellSize; let tz = fz | 0; let gz = tz > fz ? tz - 1 : tz;
      let bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);
      dynCell[di] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;

      objIdx = dynamicIndices[di + 1];
      t = trs[objIdx];
      wx = t.wx; wy = t.wy; wz = t.wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      fx = wx * invCellSize; tx = fx | 0; gx = tx > fx ? tx - 1 : tx;
      fy = wy * invCellSize; ty = fy | 0; gy = ty > fy ? ty - 1 : ty;
      fz = wz * invCellSize; tz = fz | 0; gz = tz > fz ? tz - 1 : tz;
      bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);
      dynCell[di + 1] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;

      objIdx = dynamicIndices[di + 2];
      t = trs[objIdx];
      wx = t.wx; wy = t.wy; wz = t.wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      fx = wx * invCellSize; tx = fx | 0; gx = tx > fx ? tx - 1 : tx;
      fy = wy * invCellSize; ty = fy | 0; gy = ty > fy ? ty - 1 : ty;
      fz = wz * invCellSize; tz = fz | 0; gz = tz > fz ? tz - 1 : tz;
      bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);
      dynCell[di + 2] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;

      objIdx = dynamicIndices[di + 3];
      t = trs[objIdx];
      wx = t.wx; wy = t.wy; wz = t.wz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      fx = wx * invCellSize; tx = fx | 0; gx = tx > fx ? tx - 1 : tx;
      fy = wy * invCellSize; ty = fy | 0; gy = ty > fy ? ty - 1 : ty;
      fz = wz * invCellSize; tz = fz | 0; gz = tz > fz ? tz - 1 : tz;
      bucket = (((gx * hxMult) ^ (gy * hyMult) ^ (gz * hzMult)) & mask);
      dynCell[di + 3] = bucket;
      dynNext[objIdx] = dynHead[bucket];
      dynHead[bucket] = objIdx;

      di = di + 4;
    }
    while (di < dynamicCount) {
      const objIdx = dynamicIndices[di];
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

  if (dynamicCount > 0) {
    const dynH = maxExtent + 0.01;
    idx.dynSceneMinX = minX - dynH;
    idx.dynSceneMaxX = maxX + dynH;
    idx.dynSceneMinY = minY - dynH;
    idx.dynSceneMaxY = maxY + dynH;
    idx.dynSceneMinZ = minZ - dynH;
    idx.dynSceneMaxZ = maxZ + dynH;
  } else {
    idx.dynSceneMinX = 0.0; idx.dynSceneMaxX = 0.0;
    idx.dynSceneMinY = 0.0; idx.dynSceneMaxY = 0.0;
    idx.dynSceneMinZ = 0.0; idx.dynSceneMaxZ = 0.0;
  }
}

function raycastObject(
  idx: SpatialIndex,
  k: number,
  ox: f64, oy: f64, oz: f64,
  ndx: f64, ndy: f64, ndz: f64,
  maxDistance: f64,
  outHit: RaycastHit,
  includeTriggers: boolean,
  curStepId: number,
): boolean {
  idx.resolveCandidateTransform(k);
  const cx = sCandCx;
  const cy = sCandCy;
  const cz = sCandCz;
  const yaw = sCandYaw;
  const shape = idx.shape[k];

  if (shape === COL_SPHERE) {
    const r = idx.worldRadius[k];
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
        outHit.bodyId = idx.objs[k].id;
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
    outHit.bodyId = idx.objs[k].id;
    outHit.point[0] = px; outHit.point[1] = py; outHit.point[2] = pz;
    outHit.normal[0] = (px - cx) / r;
    outHit.normal[1] = (py - cy) / r;
    outHit.normal[2] = (pz - cz) / r;
    outHit.distance = hitDist;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_BOX) {
    const hx = idx.worldHx[k];
    const hy = idx.worldHy[k];
    const hz = idx.worldHz[k];

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
      outHit.bodyId = idx.objs[k].id;
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
    outHit.bodyId = idx.objs[k].id;
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
    const hid = hullIdOf(idx.objs[k]);
    const hull = hullAt(hid);
    if (hull === null) {
      // Degenera para caixa
      return false;
    }
    const t = idx.trs[k];
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
      outHit.bodyId = idx.objs[k].id;
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
    outHit.bodyId = idx.objs[k].id;
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

function copyRaycastHit(dst: RaycastHit, src: RaycastHit): void {
  dst.hit = src.hit;
  dst.bodyId = src.bodyId;
  const dp = dst.point; const sp = src.point;
  dp[0] = sp[0]; dp[1] = sp[1]; dp[2] = sp[2];
  const dn = dst.normal; const sn = src.normal;
  dn[0] = sn[0]; dn[1] = sn[1]; dn[2] = sn[2];
  dst.distance = src.distance;
  dst.stepId = src.stepId;
}

function raycastStaticGridDDA(
  idx: SpatialIndex,
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
    const bucket = cellHash(gx, gy, gz);
    let entry = head[bucket];
    while (entry !== -1) {
      const k = entriesObj[entry];
      if (sSharedVisitedStamp[k] !== stamp) {
        sSharedVisitedStamp[k] = stamp;
        if (idx.passesFilter(mask, layer, includeTriggers, k)) {
          const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, idx.tempRayHit, includeTriggers, curStepId);
          if (hit) {
            if (idx.tempRayHit.distance < closestDist) {
              closestDist = idx.tempRayHit.distance;
              if (closestDist < tEndLoop) tEndLoop = closestDist;
              outHit.hit = true;
              outHit.bodyId = idx.tempRayHit.bodyId;
              outHit.point[0] = idx.tempRayHit.point[0];
              outHit.point[1] = idx.tempRayHit.point[1];
              outHit.point[2] = idx.tempRayHit.point[2];
              outHit.normal[0] = idx.tempRayHit.normal[0];
              outHit.normal[1] = idx.tempRayHit.normal[1];
              outHit.normal[2] = idx.tempRayHit.normal[2];
              outHit.distance = idx.tempRayHit.distance;
              outHit.stepId = idx.tempRayHit.stepId;
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

function raycastDynamicsDDA(
  idx: SpatialIndex,
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
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
): boolean {
  let tMin = 0.0;
  let tMax = maxDistance;

  const dynMinX = idx.dynSceneMinX;
  const dynMaxX = idx.dynSceneMaxX;
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

  const dynMinY = idx.dynSceneMinY;
  const dynMaxY = idx.dynSceneMaxY;
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

  const dynMinZ = idx.dynSceneMinZ;
  const dynMaxZ = idx.dynSceneMaxZ;
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

  const gridMask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

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
                if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {
                  if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {
                    const o = idx.objs[k];
                    const t = trsArr[k];
                    const shp = shapeOf(o);
                    const lhx = halfLocalX(o);
                    const lhy = halfLocalY(o);
                    const lhz = halfLocalZ(o);
                    const hx = lhx * t.sx;
                    const hy = lhy * t.sy;
                    const hz = lhz * t.sz;
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
                      const tr = shp === 0 ? radiusOfCol(o, t) : (hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz));
                      const ocX = ox - cx;
                      const ocY = oy - cy;
                      const ocZ = oz - cz;
                      const b = ocX * ndx + ocY * ndy + ocZ * ndz;
                      const c = ocX * ocX + ocY * ocY + ocZ * ocZ - tr * tr;
                      if (c <= 0.0) { // Origem dentro da esfera
                        if (idx.objs[k].active !== 0) {
                          closestDist = 0.0;
                          if (closestDist < tEndLoop) tEndLoop = closestDist;
                          outHit.hit = true;
                          outHit.bodyId = idx.objs[k].id;
                          outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
                          outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
                          outHit.distance = 0.0;
                          outHit.stepId = curStepId;
                          found = true;
                        }
                      } else if (b <= 0.0) {
                        const disc = b * b - c;
                        if (disc >= 0.0) {
                          const dist = (0.0 - b) - math.sqrt(disc);
                          if (dist >= 0.0 && dist < closestDist) {
                            if (idx.objs[k].active !== 0) {
                              closestDist = dist;
                              if (closestDist < tEndLoop) tEndLoop = closestDist;
                              const hxPoint = ox + ndx * dist;
                              const hyPoint = oy + ndy * dist;
                              const hzPoint = oz + ndz * dist;
                              outHit.hit = true;
                              outHit.bodyId = idx.objs[k].id;
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
                      }
                    } else if (shp === 1) { // COL_BOX
                      // hx, hy, hz computed above
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
                        if (idx.objs[k].active !== 0) {
                          closestDist = 0.0;
                          if (closestDist < tEndLoop) tEndLoop = closestDist;
                          outHit.hit = true;
                          outHit.bodyId = idx.objs[k].id;
                          outHit.point[0] = ox; outHit.point[1] = oy; outHit.point[2] = oz;
                          outHit.normal[0] = 0.0 - ndx; outHit.normal[1] = 0.0 - ndy; outHit.normal[2] = 0.0 - ndz;
                          outHit.distance = 0.0;
                          outHit.stepId = curStepId;
                          found = true;
                        }
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
                          if (idx.objs[k].active !== 0) {
                            closestDist = tmin;
                            if (closestDist < tEndLoop) tEndLoop = closestDist;
                            let nxBox = hitNormX; let nyBox = hitNormY; let nzBox = hitNormZ;
                            if (yaw !== 0.0) {
                              const cosY = math.cos(yaw); const sinY = math.sin(yaw);
                              nxBox = hitNormX * cosY - hitNormZ * sinY;
                              nzBox = hitNormX * sinY + hitNormZ * cosY;
                            }
                            outHit.hit = true;
                            outHit.bodyId = idx.objs[k].id;
                            outHit.point[0] = ox + ndx * tmin;
                            outHit.point[1] = oy + ndy * tmin;
                            outHit.point[2] = oz + ndz * tmin;
                            outHit.normal[0] = nxBox; outHit.normal[1] = nyBox; outHit.normal[2] = nzBox;
                            outHit.distance = tmin;
                            outHit.stepId = curStepId;
                            found = true;
                          }
                        }
                      }
                    } else { // Fallback para COL_HULL
                      const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);
                      if (hit && tempHit.distance < closestDist) {
                        if (idx.objs[k].active !== 0) {
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
  const targetScene = sc !== undefined && sc !== null ? sc : sActiveScene;
  if (targetScene === null) return false;
  return getSpatialIndex(targetScene).raycastNonAlloc(ox, oy, oz, dx, dy, dz, maxDistance, outHit, mask, layer, includeTriggers);
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

function overlapSphereObject(
  idx: SpatialIndex,
  k: number,
  cx: f64, cy: f64, cz: f64,
  radius: f64,
  outHit: OverlapHit,
  includeTriggers: boolean,
  curStepId: number,
): boolean {
  idx.resolveCandidateTransform(k);
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;
  const shape = idx.shape[k];
  const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;

  if (shape === COL_SPHERE) {
    const tr = idx.worldRadius[k];
    const dx = tcx - cx;
    const dy = tcy - cy;
    const dz = tcz - cz;
    const dist2 = dx * dx + dy * dy + dz * dz;
    const rSum = radius + tr;
    if (dist2 >= rSum * rSum) return false;

    const dist = math.sqrt(dist2);
    outHit.hit = true;
    outHit.bodyId = idx.objs[k].id;
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
    const thx = idx.worldHx[k];
    const thy = idx.worldHy[k];
    const thz = idx.worldHz[k];

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
    outHit.bodyId = idx.objs[k].id;
    outHit.depth = isTrigger ? 0.0 : depth;
    const norm = outHit.normal;
    norm[0] = wnx; norm[1] = wny; norm[2] = wnz;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_HULL) {
    const hid = hullIdOf(idx.objs[k]);
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = idx.trs[k];
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
    outHit.bodyId = idx.objs[k].id;
    outHit.depth = isTrigger ? 0.0 : sHullContactOut.depth;
    outHit.normal[0] = wnx; outHit.normal[1] = wny; outHit.normal[2] = wnz;
    outHit.stepId = curStepId;
    return true;
  }

  return false;
}

function testOverlapSphereObject(
  idx: SpatialIndex,
  k: number,
  cx: number, cy: number, cz: number,
  radius: number,
): boolean {
  idx.resolveCandidateTransform(k);
  const shape = idx.shape[k];
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;

  if (shape === COL_SPHERE) {
    const rTarget = idx.worldRadius[k];
    const dx = tcx - cx;
    const dy = tcy - cy;
    const dz = tcz - cz;
    const rSum = radius + rTarget;
    return (dx * dx + dy * dy + dz * dz < rSum * rSum);
  }

  if (shape === COL_BOX) {
    const thx = idx.worldHx[k];
    const thy = idx.worldHy[k];
    const thz = idx.worldHz[k];

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
    const hid = hullIdOf(idx.objs[k]);
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = idx.trs[k];
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

const sAllocScratchHits: OverlapHit[] = [];

function ensureAllocScratch(required: number): void {
  while (sAllocScratchHits.length < required) {
    sAllocScratchHits.push(createOverlapHit());
  }
}

function cloneOverlapHit(src: OverlapHit): OverlapHit {
  const h = createOverlapHit();
  copyOverlapHit(h, src);
  return h;
}

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
  idx: SpatialIndex,
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
  minXArr: f64[], maxXArr: f64[],
  minYArr: f64[], maxYArr: f64[],
  minZArr: f64[], maxZArr: f64[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
): number {
  const gridMask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

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
            if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {
              if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {
                if (minXArr[k] <= maxQx && maxXArr[k] >= minQx &&
                    minYArr[k] <= maxQy && maxYArr[k] >= minQy &&
                    minZArr[k] <= maxQz && maxZArr[k] >= minQz) {
                  if (storedCount < maxHits) {
                    if (overlapSphereObject(idx, k, cx, cy, cz, radius, outHits[storedCount], includeTriggers, curStepId)) {
                      if (idx.objs[k].active !== 0) {
                        totalFound = totalFound + 1;
                        const candId = outHits[storedCount].bodyId;
                        insertHitSorted(outHits, storedCount, outHits[storedCount]);
                        storedCount = storedCount + 1;
                      }
                    }
                  } else {
                    const candId = idx.objs[k].id;
                    if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          copyOverlapHit(outHits[maxHits - 1], candHit);
                          insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
                        }
                      }
                    } else {
                      if (testOverlapSphereObject(idx, k, cx, cy, cz, radius)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                        }
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
  idx: SpatialIndex,
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
  dynHead: number[],
  dynNext: number[],
  bucketStamp: number[],
  stamp: number,
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
  trsArr: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  hasLocalOffset: number,
  shapeArr: number[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
): number {
  const gridMask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

  let storedCount = startStoredCount;
  let totalFound = startTotalFound;
  const r2 = radius * radius;

  let gx = minGx;
  while (gx <= maxGx) {
    const hashX = gx * hxMult;
    let gy = minGy;
    while (gy <= maxGy) {
      const gxy = hashX ^ (gy * hyMult);
      let gz = minGz;
      while (gz <= maxGz) {
        const bucket = (gxy ^ (gz * hzMult)) & gridMask;
        if (bucketStamp[bucket] !== stamp) {
          bucketStamp[bucket] = stamp;
          let k = dynHead[bucket];
          while (k !== -1) {
            const isTrig = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;
            if (includeTriggers || !isTrig) {
              const o = idx.objs[k];
              if ((mask & o.layer) !== 0 && (o.mask & layer) !== 0) {
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
                    const ox = lcx * t.sx; const oz = lcz * t.sz;
                    if (yaw === 0.0) {
                      cxObj = cxObj + ox; czObj = czObj + oz;
                    } else {
                      const cs = math.cos(yaw); const sn = math.sin(yaw);
                      cxObj = cxObj + (ox * cs + oz * sn);
                      czObj = czObj + (0.0 - ox * sn + oz * cs);
                    }
                  }
                  if (lcy !== 0.0) cyObj = cyObj + lcy * t.sy;
                }

                const lhx = halfLocalX(o);
                const lhy = halfLocalY(o);
                const lhz = halfLocalZ(o);
                const hx = lhx * t.sx;
                const hy = lhy * t.sy;
                const hz = lhz * t.sz;

                if (cxObj + hx >= minQx && cxObj - hx <= maxQx &&
                    cyObj + hy >= minQy && cyObj - hy <= maxQy &&
                    czObj + hz >= minQz && czObj - hz <= maxQz) {
                  const rx = cx - cxObj;
                  const ry = cy - cyObj;
                  const rz = cz - czObj;
                  const shp = shapeOf(o);
                  const candId = o.id;
                  const needsFullHit = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;

                  if (shp === 0) { // COL_SPHERE
                    const tr = radiusOfCol(o, t);
                    const d2 = rx * rx + ry * ry + rz * rz;
                    const rSum = radius + tr;
                    if (d2 < rSum * rSum) {
                      if (o.active !== 0) {
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
  writeHitCore(outHits[storedCount], candId, depth, curStepId);
  writeHitNormal(outHits[storedCount], nx, ny, nz);
  insertHitSorted(outHits, storedCount, outHits[storedCount]);
  storedCount = storedCount + 1;
} else {
  writeHitCore(outHits[maxHits - 1], candId, depth, curStepId);
  writeHitNormal(outHits[maxHits - 1], nx, ny, nz);
  insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
}
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
                      if (o.active !== 0) {
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

                          let wnx = lnx;
                          let wny = lny;
                          let wnz = lnz;
                          if (yaw !== 0.0) {
                            const cosY = math.cos(yaw);
                            const sinY = math.sin(yaw);
                            wnx = lnx * cosY - lnz * sinY;
                            wnz = lnx * sinY + lnz * cosY;
                          }
if (storedCount < maxHits) {
  writeHitCore(outHits[storedCount], candId, depth, curStepId);
  writeHitNormal(outHits[storedCount], wnx, wny, wnz);
  insertHitSorted(outHits, storedCount, outHits[storedCount]);
  storedCount = storedCount + 1;
} else {
  writeHitCore(outHits[maxHits - 1], candId, depth, curStepId);
  writeHitNormal(outHits[maxHits - 1], wnx, wny, wnz);
  insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
}
                        }
                      }
                    }
                  } else { // Fallback para COL_HULL
                    if (storedCount < maxHits) {
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, outHits[storedCount], includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, outHits[storedCount]);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          copyOverlapHit(outHits[maxHits - 1], candHit);
                          insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
                        }
                      }
                    } else if (testOverlapSphereObject(idx, k, cx, cy, cz, radius)) {
                      if (o.active !== 0) {
                        totalFound = totalFound + 1;
                      }
                    }
                  }
                }
              }
            }
            k = dynNext[k];
          }
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
  let effectiveMaxHits = maxHits;
  if (outHits.length < effectiveMaxHits) {
    effectiveMaxHits = outHits.length;
  }
  if (effectiveMaxHits <= 0) return 0;

  const targetScene = sc !== undefined && sc !== null ? sc : sActiveScene;
  if (targetScene === null) return 0;
  return getSpatialIndex(targetScene).overlapSphereNonAlloc(cx, cy, cz, radius, outHits, effectiveMaxHits, mask, layer, includeTriggers);
}

export function overlapSphere(
  cx: number, cy: number, cz: number,
  radius: number,
  filter?: SpatialFilter,
  sc?: Scene,
): OverlapHit[] {
  const mask = filter !== undefined && filter.mask !== undefined ? filter.mask : MASK_ALL;
  const layer = filter !== undefined && filter.layer !== undefined ? filter.layer : LAYER_DEFAULT;
  const includeTriggers = filter !== undefined && filter.includeTriggers !== undefined ? filter.includeTriggers : false;

  ensureAllocScratch(64);
  let totalFound = overlapSphereNonAlloc(
    cx, cy, cz, radius,
    sAllocScratchHits,
    sAllocScratchHits.length,
    mask, layer, includeTriggers,
    sc,
  );

  if (totalFound > sAllocScratchHits.length) {
    ensureAllocScratch(totalFound);
    totalFound = overlapSphereNonAlloc(
      cx, cy, cz, radius,
      sAllocScratchHits,
      sAllocScratchHits.length,
      mask, layer, includeTriggers,
      sc,
    );
  }

  const count = totalFound < sAllocScratchHits.length ? totalFound : sAllocScratchHits.length;
  const result: OverlapHit[] = new Array(count);
  let i = 0;
  while (i < count) {
    result[i] = cloneOverlapHit(sAllocScratchHits[i]);
    i = i + 1;
  }
  return result;
}

function overlapBoxObject(
  idx: SpatialIndex,
  k: number,
  cx: f64, cy: f64, cz: f64,
  hx: f64, hy: f64, hz: f64,
  outHit: OverlapHit,
  includeTriggers: boolean,
  curStepId: number,
): boolean {
  idx.resolveCandidateTransform(k);
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;
  const shape = idx.shape[k];
  const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;

  if (shape === COL_SPHERE) {
    // Esfera contra caixa (simétrico a overlapSphereObject)
    const tr = idx.worldRadius[k];
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
    outHit.bodyId = idx.objs[k].id;
    outHit.depth = isTrigger ? 0.0 : depth;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = curStepId;
    return true;
  }

  if (shape === COL_BOX) {
    const thx = idx.worldHx[k];
    const thy = idx.worldHy[k];
    const thz = idx.worldHz[k];

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
      outHit.bodyId = idx.objs[k].id;
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
    outHit.bodyId = idx.objs[k].id;
    outHit.depth = isTrigger ? 0.0 : minPen;
    outHit.normal[0] = nx; outHit.normal[1] = ny; outHit.normal[2] = nz;
    outHit.stepId = curStepId;
    return true;
  }

  return false;
}


function testOverlapBoxObject(
  idx: SpatialIndex,
  k: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
): boolean {
  idx.resolveCandidateTransform(k);
  const shape = idx.shape[k];
  const tcx = sCandCx;
  const tcy = sCandCy;
  const tcz = sCandCz;
  const yaw = sCandYaw;

  if (shape === COL_SPHERE) {
    const rTarget = idx.worldRadius[k];
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
    const thx = idx.worldHx[k];
    const thy = idx.worldHy[k];
    const thz = idx.worldHz[k];

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
    const hid = hullIdOf(idx.objs[k]);
    const hull = hullAt(hid);
    if (hull === null) return false;

    const t = idx.trs[k];
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
  idx: SpatialIndex,
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
  minXArr: f64[], maxXArr: f64[],
  minYArr: f64[], maxYArr: f64[],
  minZArr: f64[], maxZArr: f64[],
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
): number {
  const gridMask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

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
            if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {
              if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {
                if (minXArr[k] <= maxQx && maxXArr[k] >= minQx &&
                    minYArr[k] <= maxQy && maxYArr[k] >= minQy &&
                    minZArr[k] <= maxQz && maxZArr[k] >= minQz) {
                  if (storedCount < maxHits) {
                    if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, outHits[storedCount], includeTriggers, curStepId)) {
                      if (idx.objs[k].active !== 0) {
                        totalFound = totalFound + 1;
                        const candId = outHits[storedCount].bodyId;
                        insertHitSorted(outHits, storedCount, outHits[storedCount]);
                        storedCount = storedCount + 1;
                      }
                    }
                  } else {
                    const candId = idx.objs[k].id;
                    if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          copyOverlapHit(outHits[maxHits - 1], candHit);
                          insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
                        }
                      }
                    } else {
                      if (testOverlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                        }
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
  idx: SpatialIndex,
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
  dynHead: number[],
  dynNext: number[],
  bucketStamp: number[],
  stamp: number,
  candHit: OverlapHit,
  startStoredCount: number,
  startTotalFound: number,
  trsArr: Transform[],
  localCxArr: f64[], localCyArr: f64[], localCzArr: f64[],
  hasLocalOffset: number,
  shapeArr: number[],
  worldHxArr: f64[], worldHyArr: f64[], worldHzArr: f64[],
  worldRadiusArr: f64[],
): number {
  const gridMask = SGRID_MASK;
  const hxMult = HASH_X;
  const hyMult = HASH_Y;
  const hzMult = HASH_Z;

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
        if (bucketStamp[bucket] !== stamp) {
          bucketStamp[bucket] = stamp;
          let k = dynHead[bucket];
          while (k !== -1) {
            const isTrig = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;
            if (includeTriggers || !isTrig) {
              const o = idx.objs[k];
              if ((mask & o.layer) !== 0 && (o.mask & layer) !== 0) {
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
                    const ox = lcx * t.sx; const oz = lcz * t.sz;
                    if (yaw === 0.0) {
                      cxObj = cxObj + ox; czObj = czObj + oz;
                    } else {
                      const cs = math.cos(yaw); const sn = math.sin(yaw);
                      cxObj = cxObj + (ox * cs + oz * sn);
                      czObj = czObj + (0.0 - ox * sn + oz * cs);
                    }
                  }
                  if (lcy !== 0.0) cyObj = cyObj + lcy * t.sy;
                }

                const lhx = halfLocalX(o);
                const lhy = halfLocalY(o);
                const lhz = halfLocalZ(o);
                const thx = lhx * t.sx;
                const thy = lhy * t.sy;
                const thz = lhz * t.sz;

                if (cxObj + thx >= minQx && cxObj - thx <= maxQx &&
                    cyObj + thy >= minQy && cyObj - thy <= maxQy &&
                    czObj + thz >= minQz && czObj - thz <= maxQz) {
                  const rx = cxObj - cx;
                  const ry = cyObj - cy;
                  const rz = czObj - cz;
                  const absRx = math.abs(rx);
                  const absRy = math.abs(ry);
                  const absRz = math.abs(rz);
                  const shp = shapeOf(o);
                  const candId = o.id;

                  if (shp === 0) { // COL_SPHERE (caixa query vs esfera dyn)
                    const tr = radiusOfCol(o, t);
                    let qx = rx;
                    if (qx < 0.0 - hx) qx = 0.0 - hx; else if (qx > hx) qx = hx;
                    let qy = ry;
                    if (qy < 0.0 - hy) qy = 0.0 - hy; else if (qy > hy) qy = hy;
                    let qz = rz;
                    if (qz < 0.0 - hz) qz = 0.0 - hz; else if (qz > hz) qz = hz;

                    const vx = rx - qx; const vy = ry - qy; const vz = rz - qz;
                    const d2 = vx * vx + vy * vy + vz * vz;
                    const r2 = tr * tr;
                    if (d2 < r2) {
                      if (o.active !== 0) {
                        totalFound = totalFound + 1;
                        const needsFull = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;
                        if (needsFull) {
                          const dist = math.sqrt(d2);
                          let depth = 0.0;
                          let nx = 0.0; let ny = 0.0; let nz = 0.0;
                          if (dist > 0.0000001) {
                            depth = tr - dist;
                            nx = vx / dist; ny = vy / dist; nz = vz / dist;
                          } else {
                            const penX = hx - absRx;
                            const penY = hy - absRy;
                            const penZ = hz - absRz;
                            if (penX <= penY && penX <= penZ) {
                              nx = rx >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penX;
                            } else if (penY <= penX && penY <= penZ) {
                              ny = ry >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penY;
                            } else {
                              nz = rz >= 0.0 ? 1.0 : 0.0 - 1.0; depth = tr + penZ;
                            }
                          }
if (storedCount < maxHits) {
  writeHitCore(outHits[storedCount], candId, isTrig ? 0.0 : depth, curStepId);
  writeHitNormal(outHits[storedCount], nx, ny, nz);
  insertHitSorted(outHits, storedCount, outHits[storedCount]);
  storedCount = storedCount + 1;
} else {
  writeHitCore(outHits[maxHits - 1], candId, isTrig ? 0.0 : depth, curStepId);
  writeHitNormal(outHits[maxHits - 1], nx, ny, nz);
  insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
}
                        }
                      }
                    }
                  } else if (shp === 1) { // COL_BOX (caixa vs caixa)
                    if (yaw === 0.0) { // AABB vs AABB direto
                      const dx = absRx - (hx + thx);
                      const dy = absRy - (hy + thy);
                      const dz = absRz - (hz + thz);
                      if (dx < 0.0 && dy < 0.0 && dz < 0.0) {
                        if (o.active !== 0) {
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
  writeHitCore(outHits[storedCount], candId, isTrig ? 0.0 : depth, curStepId);
  writeHitNormal(outHits[storedCount], nx, ny, nz);
  insertHitSorted(outHits, storedCount, outHits[storedCount]);
  storedCount = storedCount + 1;
} else {
  writeHitCore(outHits[maxHits - 1], candId, isTrig ? 0.0 : depth, curStepId);
  writeHitNormal(outHits[maxHits - 1], nx, ny, nz);
  insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
}
                          }
                        }
                      }
                    } else { // Caixa rotacionada -> overlapBoxObject
                      if (storedCount < maxHits) {
                        if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, outHits[storedCount], includeTriggers, curStepId)) {
                          if (o.active !== 0) {
                            totalFound = totalFound + 1;
                            insertHitSorted(outHits, storedCount, outHits[storedCount]);
                            storedCount = storedCount + 1;
                          }
                        }
                      } else if (candId < outHits[maxHits - 1].bodyId) {
                        if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                          if (o.active !== 0) {
                            totalFound = totalFound + 1;
                            copyOverlapHit(outHits[maxHits - 1], candHit);
                            insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
                          }
                        }
                      } else if (testOverlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  } else { // Fallback COL_HULL
                    if (storedCount < maxHits) {
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, outHits[storedCount], includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, outHits[storedCount]);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          copyOverlapHit(outHits[maxHits - 1], candHit);
                          insertHitSorted(outHits, maxHits - 1, outHits[maxHits - 1]);
                        }
                      }
                    } else if (testOverlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz)) {
                      if (o.active !== 0) {
                        totalFound = totalFound + 1;
                      }
                    }
                  }
                }
              }
            }
            k = dynNext[k];
          }
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
  let effectiveMaxHits = maxHits;
  if (outHits.length < effectiveMaxHits) {
    effectiveMaxHits = outHits.length;
  }
  if (effectiveMaxHits <= 0) return 0;

  const targetScene = sc !== undefined && sc !== null ? sc : sActiveScene;
  if (targetScene === null) return 0;
  return getSpatialIndex(targetScene).overlapBoxNonAlloc(cx, cy, cz, hx, hy, hz, outHits, effectiveMaxHits, mask, layer, includeTriggers);
}

export function overlapBox(
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  filter?: SpatialFilter,
  sc?: Scene,
): OverlapHit[] {
  const mask = filter !== undefined && filter.mask !== undefined ? filter.mask : MASK_ALL;
  const layer = filter !== undefined && filter.layer !== undefined ? filter.layer : LAYER_DEFAULT;
  const includeTriggers = filter !== undefined && filter.includeTriggers !== undefined ? filter.includeTriggers : false;

  ensureAllocScratch(64);
  let totalFound = overlapBoxNonAlloc(
    cx, cy, cz, hx, hy, hz,
    sAllocScratchHits,
    sAllocScratchHits.length,
    mask, layer, includeTriggers,
    sc,
  );

  if (totalFound > sAllocScratchHits.length) {
    ensureAllocScratch(totalFound);
    totalFound = overlapBoxNonAlloc(
      cx, cy, cz, hx, hy, hz,
      sAllocScratchHits,
      sAllocScratchHits.length,
      mask, layer, includeTriggers,
      sc,
    );
  }

  const count = totalFound < sAllocScratchHits.length ? totalFound : sAllocScratchHits.length;
  const result: OverlapHit[] = new Array(count);
  let i = 0;
  while (i < count) {
    result[i] = cloneOverlapHit(sAllocScratchHits[i]);
    i = i + 1;
  }
  return result;
}

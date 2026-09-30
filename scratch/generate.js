const fs = require('fs');

const orig = fs.readFileSync('scratch/spatial_queries_orig.ts', 'utf8').replace(/\r\n/g, '\n');
const lines = orig.split('\n');

function strictReplace(str, pattern, replacement, label) {
  if (typeof pattern === 'string') {
    if (!str.includes(pattern)) {
      throw new Error(`strictReplace failed for "${label}": pattern not found:\n${pattern}`);
    }
    return str.replace(pattern, replacement);
  } else {
    if (!pattern.test(str)) {
      throw new Error(`strictReplace failed for "${label}": regex not matched:\n${pattern}`);
    }
    return str.replace(pattern, replacement);
  }
}

function getLines(start, end) {
  // start and end are 1-based inclusive
  return lines.slice(start - 1, end).join('\n');
}

let out = '';

let header = getLines(1, 100);
header = strictReplace(header, 'const SGRID_CAP = 8192;\nconst SGRID_MASK = 8191;', 'const SGRID_CAP = 1024;\nconst SGRID_MASK = 1023;', 'SGRID_CAP');
out += header + '\n\n';

// 2. recordOverlapHit helper
out += `function recordOverlapHit(
  outHits: OverlapHit[],
  storedCount: number,
  maxHits: number,
  candId: number,
  depth: f64,
  nx: f64, ny: f64, nz: f64,
  curStepId: number,
): number {
  if (storedCount < maxHits) {
    const target = outHits[storedCount];
    target.hit = true;
    target.bodyId = candId;
    target.depth = depth;
    target.normal[0] = nx;
    target.normal[1] = ny;
    target.normal[2] = nz;
    target.stepId = curStepId;
    insertHitSorted(outHits, storedCount, target);
    return storedCount + 1;
  }
  const target = outHits[maxHits - 1];
  target.hit = true;
  target.bodyId = candId;
  target.depth = depth;
  target.normal[0] = nx;
  target.normal[1] = ny;
  target.normal[2] = nz;
  target.stepId = curStepId;
  insertHitSorted(outHits, maxHits - 1, target);
  return storedCount;
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

`;

// quickselect (lines 260-284)
out += getLines(260, 284) + '\n\n';

// mfloor (lines 386-390)
out += getLines(386, 390) + '\n\n';

// getSpatialStepId (lines 691-696)
out += getLines(691, 696) + '\n\n';

// 3. export class SpatialIndex
out += `// ═══════════════════════════════════════════════════════════════════════════
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

    this.worldCx = [];
    this.worldCy = [];
    this.worldCz = [];
    this.worldHx = [];
    this.worldHy = [];
    this.worldHz = [];
    this.worldRadius = [];

    this.shape = [];
    this.yaw = [];
    this.dynamicIndices = [];

    this.minX = [];
    this.maxX = [];
    this.minY = [];
    this.maxY = [];
    this.minZ = [];
    this.maxZ = [];
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
            const target = outHits[storedCount];
            if (overlapSphereObject(this, k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              insertHitSorted(outHits, storedCount, target);
              storedCount = storedCount + 1;
            }
          } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
            if (overlapSphereObject(this, k, cx, cy, cz, radius, this.candidateOverlapHit, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              const target = outHits[effectiveMaxHits - 1];
              copyOverlapHit(target, this.candidateOverlapHit);
              insertHitSorted(outHits, effectiveMaxHits - 1, target);
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
            const target = outHits[storedCount];
            if (overlapBoxObject(this, k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              insertHitSorted(outHits, storedCount, target);
              storedCount = storedCount + 1;
            }
          } else if (candId < outHits[effectiveMaxHits - 1].bodyId) {
            if (overlapBoxObject(this, k, cx, cy, cz, hx, hy, hz, this.candidateOverlapHit, includeTriggers, curStepId)) {
              totalFound = totalFound + 1;
              const target = outHits[effectiveMaxHits - 1];
              copyOverlapHit(target, this.candidateOverlapHit);
              insertHitSorted(outHits, effectiveMaxHits - 1, target);
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

`;

// 4. rebuildDynamicsInto (free typed function)
out += `function rebuildDynamicsInto(
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

`;

// 5. raycastObject (extract lines 1310 to 1581, with replacements)
let raycastObjStr = getLines(1310, 1581);
raycastObjStr = strictReplace(raycastObjStr, 'function raycastObject(\n  k: number,', 'function raycastObject(\n  idx: SpatialIndex,\n  k: number,', 'raycastObject signature');
raycastObjStr = strictReplace(raycastObjStr, 'resolveCandidateTransform(k);', 'idx.resolveCandidateTransform(k);', 'raycastObj resolveCandidate');
raycastObjStr = strictReplace(raycastObjStr, /sShape\[k\]/g, 'idx.shape[k]', 'raycastObj sShape');
raycastObjStr = strictReplace(raycastObjStr, /sWorldRadius\[k\]/g, 'idx.worldRadius[k]', 'raycastObj sWorldRadius');
raycastObjStr = strictReplace(raycastObjStr, /sBodyId\[k\]/g, 'idx.objs[k].id', 'raycastObj sBodyId');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHx\[k\]/g, 'idx.worldHx[k]', 'raycastObj sWorldHx');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHy\[k\]/g, 'idx.worldHy[k]', 'raycastObj sWorldHy');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHz\[k\]/g, 'idx.worldHz[k]', 'raycastObj sWorldHz');
raycastObjStr = strictReplace(raycastObjStr, /sHullId\[k\]/g, 'hullIdOf(idx.objs[k])', 'raycastObj sHullId');
raycastObjStr = strictReplace(raycastObjStr, /sTrs\[k\]/g, 'idx.trs[k]', 'raycastObj sTrs');
out += raycastObjStr + '\n\n';

// 6. raycastStaticGridDDA (extract lines 1587 to 1742, with replacements)
let rStaticStr = getLines(1587, 1742);
rStaticStr = strictReplace(rStaticStr, 'function raycastStaticGridDDA(', 'function raycastStaticGridDDA(\n  idx: SpatialIndex,', 'raycastStaticGridDDA signature');
rStaticStr = strictReplace(rStaticStr, 'if (sVisitedStamp[k] !== stamp) {', 'if (sSharedVisitedStamp[k] !== stamp) {', 'rStatic sVisitedStamp check');
rStaticStr = strictReplace(rStaticStr, 'sVisitedStamp[k] = stamp;', 'sSharedVisitedStamp[k] = stamp;', 'rStatic sVisitedStamp set');
rStaticStr = strictReplace(rStaticStr, 'if (passesFilter(mask, layer, includeTriggers, k)) {', 'if (idx.passesFilter(mask, layer, includeTriggers, k)) {', 'rStatic passesFilter');
rStaticStr = strictReplace(rStaticStr, 'const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, sTempRayHit, includeTriggers, curStepId);',
  'const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, idx.tempRayHit, includeTriggers, curStepId);', 'rStatic raycastObject call');
rStaticStr = strictReplace(rStaticStr, /sTempRayHit\./g, 'idx.tempRayHit.', 'rStatic sTempRayHit');
out += rStaticStr + '\n\n';

// 7. raycastDynamicsDDA (extract lines 1790 to 2183, with replacements)
let rDynStr = getLines(1790, 2183);
rDynStr = strictReplace(rDynStr, 'function raycastDynamicsDDA(', 'function raycastDynamicsDDA(\n  idx: SpatialIndex,', 'raycastDynamicsDDA signature');
rDynStr = strictReplace(rDynStr, '  triggerArr: number[],\n  layerArr: number[],\n  maskArr: number[],\n  bodyIdArr: number[],\n', '', 'rDyn remove trigger layer mask bodyId args');
rDynStr = strictReplace(rDynStr, '  hullIdArr: number[],\n', '', 'rDyn remove hullId arg');
rDynStr = strictReplace(rDynStr, 'const dynMinX = sDynSceneMinX;', 'const dynMinX = idx.dynSceneMinX;', 'rDyn dynMinX');
rDynStr = strictReplace(rDynStr, 'const dynMaxX = sDynSceneMaxX;', 'const dynMaxX = idx.dynSceneMaxX;', 'rDyn dynMaxX');
rDynStr = strictReplace(rDynStr, 'const dynMinY = sDynSceneMinY;', 'const dynMinY = idx.dynSceneMinY;', 'rDyn dynMinY');
rDynStr = strictReplace(rDynStr, 'const dynMaxY = sDynSceneMaxY;', 'const dynMaxY = idx.dynSceneMaxY;', 'rDyn dynMaxY');
rDynStr = strictReplace(rDynStr, 'const dynMinZ = sDynSceneMinZ;', 'const dynMinZ = idx.dynSceneMinZ;', 'rDyn dynMinZ');
rDynStr = strictReplace(rDynStr, 'const dynMaxZ = sDynSceneMaxZ;', 'const dynMaxZ = idx.dynSceneMaxZ;', 'rDyn dynMaxZ');
rDynStr = strictReplace(rDynStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'rDyn trigger check');
rDynStr = strictReplace(rDynStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'rDyn layer mask check');
rDynStr = strictReplace(rDynStr, /bodyIdArr\[k\]/g, 'idx.objs[k].id', 'rDyn bodyIdArr');
rDynStr = strictReplace(rDynStr, 'const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);',
  'const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);', 'rDyn raycastObject call');
rDynStr = strictReplace(rDynStr, /sObjs\[k\]\.active/g, 'idx.objs[k].active', 'rDyn sObjs.active');
rDynStr = strictReplace(rDynStr, 'const shp = shapeArr[k];\n                    const t = trsArr[k];',
  'const o = idx.objs[k];\n                    const t = trsArr[k];\n                    const shp = shapeOf(o);\n                    const lhx = halfLocalX(o);\n                    const lhy = halfLocalY(o);\n                    const lhz = halfLocalZ(o);\n                    const hx = lhx * t.sx;\n                    const hy = lhy * t.sy;\n                    const hz = lhz * t.sz;',
  'rDyn compute shp and extents');
rDynStr = strictReplace(rDynStr, 'const tr = worldRadiusArr[k];',
  'const tr = shp === 0 ? radiusOfCol(o, t) : (hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz));',
  'rDyn compute tr');
rDynStr = strictReplace(rDynStr, 'const hx = worldHxArr[k];\n                      const hy = worldHyArr[k];\n                      const hz = worldHzArr[k];',
  '// hx, hy, hz computed above',
  'rDyn skip box extents');
out += rDynStr + '\n\n';

// 8. raycastNonAlloc and raycast (standalone delegators)
out += `export function raycastNonAlloc(
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

`;

// 9. overlapSphereObject (lines 2325 to 2486)
let sphObjStr = getLines(2325, 2486);
sphObjStr = strictReplace(sphObjStr, 'function overlapSphereObject(\n  k: number,', 'function overlapSphereObject(\n  idx: SpatialIndex,\n  k: number,', 'overlapSphereObject signature');
sphObjStr = strictReplace(sphObjStr, 'resolveCandidateTransform(k);', 'idx.resolveCandidateTransform(k);', 'sphObj resolveCandidate');
sphObjStr = strictReplace(sphObjStr, /sShape\[k\]/g, 'idx.shape[k]', 'sphObj sShape');
sphObjStr = strictReplace(sphObjStr, 'const isTrigger = sTrigger[k] !== 0;', 'const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;', 'sphObj sTrigger');
sphObjStr = strictReplace(sphObjStr, /sWorldRadius\[k\]/g, 'idx.worldRadius[k]', 'sphObj sWorldRadius');
sphObjStr = strictReplace(sphObjStr, /sBodyId\[k\]/g, 'idx.objs[k].id', 'sphObj sBodyId');
sphObjStr = strictReplace(sphObjStr, /sWorldHx\[k\]/g, 'idx.worldHx[k]', 'sphObj sWorldHx');
sphObjStr = strictReplace(sphObjStr, /sWorldHy\[k\]/g, 'idx.worldHy[k]', 'sphObj sWorldHy');
sphObjStr = strictReplace(sphObjStr, /sWorldHz\[k\]/g, 'idx.worldHz[k]', 'sphObj sWorldHz');
sphObjStr = strictReplace(sphObjStr, /sHullId\[k\]/g, 'hullIdOf(idx.objs[k])', 'sphObj sHullId');
sphObjStr = strictReplace(sphObjStr, /sTrs\[k\]/g, 'idx.trs[k]', 'sphObj sTrs');
out += sphObjStr + '\n\n';

// 10. testOverlapSphereObject (lines 2488 to 2564)
let testSphStr = getLines(2488, 2564);
testSphStr = strictReplace(testSphStr, 'function testOverlapSphereObject(\n  k: number,', 'function testOverlapSphereObject(\n  idx: SpatialIndex,\n  k: number,', 'testOverlapSphereObject signature');
testSphStr = strictReplace(testSphStr, 'resolveCandidateTransform(k);', 'idx.resolveCandidateTransform(k);', 'testSph resolveCandidate');
testSphStr = strictReplace(testSphStr, /sShape\[k\]/g, 'idx.shape[k]', 'testSph sShape');
testSphStr = strictReplace(testSphStr, /sWorldRadius\[k\]/g, 'idx.worldRadius[k]', 'testSph sWorldRadius');
testSphStr = strictReplace(testSphStr, /sWorldHx\[k\]/g, 'idx.worldHx[k]', 'testSph sWorldHx');
testSphStr = strictReplace(testSphStr, /sWorldHy\[k\]/g, 'idx.worldHy[k]', 'testSph sWorldHy');
testSphStr = strictReplace(testSphStr, /sWorldHz\[k\]/g, 'idx.worldHz[k]', 'testSph sWorldHz');
testSphStr = strictReplace(testSphStr, /sHullId\[k\]/g, 'hullIdOf(idx.objs[k])', 'testSph sHullId');
testSphStr = strictReplace(testSphStr, /sTrs\[k\]/g, 'idx.trs[k]', 'testSph sTrs');
out += testSphStr + '\n\n';

// 11. sAllocScratchHits, cloneOverlapHit, copyOverlapHit (lines 2567 to 2589)
out += getLines(2567, 2589) + '\n\n';

// 12. overlapSphereInto (lines 2591 to 2699)
let sphIntoStr = getLines(2591, 2699);
sphIntoStr = strictReplace(sphIntoStr, 'function overlapSphereInto(\n  cx: f64,', 'function overlapSphereInto(\n  idx: SpatialIndex,\n  cx: f64,', 'overlapSphereInto signature');
sphIntoStr = strictReplace(sphIntoStr, '  triggerArr: number[],\n  layerArr: number[],\n  maskArr: number[],\n', '', 'sphInto remove trigger layer mask args');
sphIntoStr = strictReplace(sphIntoStr, '  bodyIdArr: number[],\n', '', 'sphInto remove bodyId arg');
sphIntoStr = strictReplace(sphIntoStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'sphInto trigger check');
sphIntoStr = strictReplace(sphIntoStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'sphInto layer mask check');
sphIntoStr = strictReplace(sphIntoStr, 'const candId = bodyIdArr[k];', 'const candId = idx.objs[k].id;', 'sphInto candId');
sphIntoStr = strictReplace(sphIntoStr, /overlapSphereObject\(k,/g, 'overlapSphereObject(idx, k,', 'sphInto overlapSphereObject');
sphIntoStr = strictReplace(sphIntoStr, /testOverlapSphereObject\(k,/g, 'testOverlapSphereObject(idx, k,', 'sphInto testOverlapSphereObject');
sphIntoStr = strictReplace(sphIntoStr, /sObjs\[k\]\.active/g, 'idx.objs[k].active', 'sphInto sObjs.active');
sphIntoStr = strictReplace(
  sphIntoStr,
`                          const target = outHits[maxHits - 1];
                          target.hit = true;
                          target.bodyId = candId;
                          target.depth = candHit.depth;
                          const tn = target.normal;
                          const sn = candHit.normal;
                          tn[0] = sn[0]; tn[1] = sn[1]; tn[2] = sn[2];
                          target.stepId = curStepId;`,
`                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, candHit);`,
  'sphInto copyOverlapHit'
);
out += sphIntoStr + '\n\n';

// 13. overlapSphereDynamicsInto (lines 2700 to 2945)
// We provide clean 2-space indented overlapSphereDynamicsInto with recordOverlapHit!
out += `function overlapSphereDynamicsInto(
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
                          storedCount = recordOverlapHit(outHits, storedCount, maxHits, candId, depth, nx, ny, nz, curStepId);
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

                          storedCount = recordOverlapHit(outHits, storedCount, maxHits, candId, depth, wnx, wny, wnz, curStepId);
                        }
                      }
                    }
                  } else { // Fallback para COL_HULL
                    if (storedCount < maxHits) {
                      const target = outHits[storedCount];
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, target, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, target);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, candHit);
                          insertHitSorted(outHits, maxHits - 1, target);
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
`;


// 14. overlapSphereNonAlloc and overlapSphere (standalone delegators)
out += `export function overlapSphereNonAlloc(
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

`;

// 15. overlapBoxObject (lines 3134 to 3311)
let boxObjStr = getLines(3134, 3311);
boxObjStr = strictReplace(boxObjStr, 'function overlapBoxObject(\n  k: number,', 'function overlapBoxObject(\n  idx: SpatialIndex,\n  k: number,', 'overlapBoxObject signature');
boxObjStr = strictReplace(boxObjStr, 'resolveCandidateTransform(k);', 'idx.resolveCandidateTransform(k);', 'boxObj resolveCandidate');
boxObjStr = strictReplace(boxObjStr, /sShape\[k\]/g, 'idx.shape[k]', 'boxObj sShape');
boxObjStr = strictReplace(boxObjStr, 'const isTrigger = sTrigger[k] !== 0;', 'const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;', 'boxObj sTrigger');
boxObjStr = strictReplace(boxObjStr, /sWorldRadius\[k\]/g, 'idx.worldRadius[k]', 'boxObj sWorldRadius');
boxObjStr = strictReplace(boxObjStr, /sBodyId\[k\]/g, 'idx.objs[k].id', 'boxObj sBodyId');
boxObjStr = strictReplace(boxObjStr, /sWorldHx\[k\]/g, 'idx.worldHx[k]', 'boxObj sWorldHx');
boxObjStr = strictReplace(boxObjStr, /sWorldHy\[k\]/g, 'idx.worldHy[k]', 'boxObj sWorldHy');
boxObjStr = strictReplace(boxObjStr, /sWorldHz\[k\]/g, 'idx.worldHz[k]', 'boxObj sWorldHz');
out += boxObjStr + '\n\n';

// 16. testOverlapBoxObject (lines 3312 to 3407)
let testBoxStr = getLines(3312, 3407);
testBoxStr = strictReplace(testBoxStr, 'function testOverlapBoxObject(\n  k: number,', 'function testOverlapBoxObject(\n  idx: SpatialIndex,\n  k: number,', 'testOverlapBoxObject signature');
testBoxStr = strictReplace(testBoxStr, 'resolveCandidateTransform(k);', 'idx.resolveCandidateTransform(k);', 'testBox resolveCandidate');
testBoxStr = strictReplace(testBoxStr, /sShape\[k\]/g, 'idx.shape[k]', 'testBox sShape');
testBoxStr = strictReplace(testBoxStr, /sWorldRadius\[k\]/g, 'idx.worldRadius[k]', 'testBox sWorldRadius');
testBoxStr = strictReplace(testBoxStr, /sWorldHx\[k\]/g, 'idx.worldHx[k]', 'testBox sWorldHx');
testBoxStr = strictReplace(testBoxStr, /sWorldHy\[k\]/g, 'idx.worldHy[k]', 'testBox sWorldHy');
testBoxStr = strictReplace(testBoxStr, /sWorldHz\[k\]/g, 'idx.worldHz[k]', 'testBox sWorldHz');
testBoxStr = strictReplace(testBoxStr, /sHullId\[k\]/g, 'hullIdOf(idx.objs[k])', 'testBox sHullId');
testBoxStr = strictReplace(testBoxStr, /sTrs\[k\]/g, 'idx.trs[k]', 'testBox sTrs');
out += testBoxStr + '\n\n';

// 17. overlapBoxInto (lines 3408 to 3510)
let boxIntoStr = getLines(3408, 3510);
boxIntoStr = strictReplace(boxIntoStr, 'function overlapBoxInto(\n  cx: f64,', 'function overlapBoxInto(\n  idx: SpatialIndex,\n  cx: f64,', 'overlapBoxInto signature');
boxIntoStr = strictReplace(boxIntoStr, '  triggerArr: number[],\n  layerArr: number[],\n  maskArr: number[],\n', '', 'boxInto remove trigger layer mask args');
boxIntoStr = strictReplace(boxIntoStr, '  bodyIdArr: number[],\n', '', 'boxInto remove bodyId arg');
boxIntoStr = strictReplace(boxIntoStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'boxInto trigger check');
boxIntoStr = strictReplace(boxIntoStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'boxInto layer mask check');
boxIntoStr = strictReplace(boxIntoStr, 'const candId = bodyIdArr[k];', 'const candId = idx.objs[k].id;', 'boxInto candId');
boxIntoStr = strictReplace(boxIntoStr, /overlapBoxObject\(k,/g, 'overlapBoxObject(idx, k,', 'boxInto overlapBoxObject');
boxIntoStr = strictReplace(boxIntoStr, /testOverlapBoxObject\(k,/g, 'testOverlapBoxObject(idx, k,', 'boxInto testOverlapBoxObject');
boxIntoStr = strictReplace(boxIntoStr, /sObjs\[k\]\.active/g, 'idx.objs[k].active', 'boxInto sObjs.active');
out += boxIntoStr + '\n\n';

// 18. overlapBoxDynamicsInto (clean 2-space indentation with recordOverlapHit)
out += `function overlapBoxDynamicsInto(
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
                          storedCount = recordOverlapHit(outHits, storedCount, maxHits, candId, isTrig ? 0.0 : depth, nx, ny, nz, curStepId);
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
                            storedCount = recordOverlapHit(outHits, storedCount, maxHits, candId, isTrig ? 0.0 : depth, nx, ny, nz, curStepId);
                          }
                        }
                      }
                    } else { // Caixa rotacionada -> overlapBoxObject
                      if (storedCount < maxHits) {
                        const target = outHits[storedCount];
                        if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                          if (o.active !== 0) {
                            totalFound = totalFound + 1;
                            insertHitSorted(outHits, storedCount, target);
                            storedCount = storedCount + 1;
                          }
                        }
                      } else if (candId < outHits[maxHits - 1].bodyId) {
                        if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                          if (o.active !== 0) {
                            totalFound = totalFound + 1;
                            const target = outHits[maxHits - 1];
                            copyOverlapHit(target, candHit);
                            insertHitSorted(outHits, maxHits - 1, target);
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
                      const target = outHits[storedCount];
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, target);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                        if (o.active !== 0) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, candHit);
                          insertHitSorted(outHits, maxHits - 1, target);
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
`;


// 19. overlapBoxNonAlloc and overlapBox (standalone delegators)
out += `export function overlapBoxNonAlloc(
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
`;

fs.writeFileSync('scratch/spatial_queries_gen.ts', out, 'utf8');
console.log('Successfully generated scratch/spatial_queries_gen.ts! Total lines:', out.split('\n').length);

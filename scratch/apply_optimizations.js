const fs = require('fs');

let gen = fs.readFileSync('scratch/generate.js', 'utf8').replace(/\r\n/g, '\n');

function replaceExact(str, find, rep, desc) {
  if (!str.includes(find)) {
    throw new Error('Failed to find in generate.js: ' + desc + '\nSearch text:\n' + find.substring(0, 100));
  }
  return str.replace(find, rep);
}

// 1. Properties
gen = replaceExact(
  gen,
`  shape: number[] = [];
  trigger: number[] = [];
  hullId: number[] = [];
  layer: number[] = [];
  mask: number[] = [];

  bodyId: number[] = [];
  yaw: number[] = [];`,
`  shape: number[] = [];
  yaw: number[] = [];
  hasTriggers: number = 0;
  hasStaticTriggers: number = 0;
  hasDynamicTriggers: number = 0;`,
  'properties'
);

// 2. Constructor
gen = replaceExact(
  gen,
`    io.print("ctor: cap=" + cap);
    this.worldHx = new Array(cap).fill(0.5);
    io.print("ctor: worldHx");
    this.worldHy = new Array(cap).fill(0.5);
    io.print("ctor: worldHy");
    this.worldHz = new Array(cap).fill(0.5);
    io.print("ctor: worldHz");
    this.worldRadius = new Array(cap).fill(0.5);
    io.print("ctor: worldRadius");

    this.shape = new Array(cap).fill(0);
    io.print("ctor: shape");
    this.trigger = new Array(cap).fill(0);
    io.print("ctor: trigger");
    this.hullId = new Array(cap).fill(0);
    io.print("ctor: hullId");
    this.layer = new Array(cap).fill(0);
    io.print("ctor: layer");
    this.mask = new Array(cap).fill(0);
    io.print("ctor: mask");

    this.bodyId = new Array(cap).fill(0);
    io.print("ctor: bodyId");
    this.yaw = [];

    this.dynamicIndices = new Array(cap).fill(0);
    io.print("ctor: dynamicIndices");`,
`    this.worldHx = new Array(cap).fill(0.5);
    this.worldHy = new Array(cap).fill(0.5);
    this.worldHz = new Array(cap).fill(0.5);
    this.worldRadius = new Array(cap).fill(0.5);

    this.shape = new Array(cap).fill(0);
    this.yaw = [];
    this.dynamicIndices = new Array(cap).fill(0);`,
  'constructor'
);

// 3. ensureObjCapacity
gen = replaceExact(
  gen,
`        this.worldHx.push(0.5); this.worldHy.push(0.5); this.worldHz.push(0.5);
        this.worldRadius.push(0.5);
        this.shape.push(0); this.trigger.push(0); this.hullId.push(0);
        this.layer.push(0); this.mask.push(0);
        this.bodyId.push(0);
        this.dynamicIndices.push(0);
        this.dynNext.push(-1);
        this.dynCell.push(0);`,
`        this.worldHx.push(0.5); this.worldHy.push(0.5); this.worldHz.push(0.5);
        this.worldRadius.push(0.5);
        this.shape.push(0);
        this.dynamicIndices.push(0);
        this.dynNext.push(-1);
        this.dynCell.push(0);`,
  'ensureObjCapacity'
);

// 4. clear
gen = replaceExact(
  gen,
`    this.minZ.length = 0;
    this.maxZ.length = 0;
  }`,
`    this.minZ.length = 0;
    this.maxZ.length = 0;
    this.hasTriggers = 0;
    this.hasStaticTriggers = 0;
    this.hasDynamicTriggers = 0;
  }`,
  'clear'
);

// 5. fillObjectRow and passesFilter
gen = replaceExact(
  gen,
`  fillObjectRow(k: number, o: GameObject): number {
    const t = o.transform;
    const isStatic = bodyTypeOf(o) === BODY_STATIC ? 1 : 0;
    const shp = shapeOf(o);
    const trig = triggerOf(o);
    const hid = hullIdOf(o);
    const lhx = halfLocalX(o);
    const lhy = halfLocalY(o);
    const lhz = halfLocalZ(o);
    const lcx = centerLocalX(o);
    const lcy = centerLocalY(o);
    const lcz = centerLocalZ(o);

    this.shape[k] = shp;
    this.trigger[k] = trig;
    this.hullId[k] = hid;
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
    this.layer[k] = o.layer;
    this.mask[k] = o.mask;
    this.bodyId[k] = o.id;

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
    if (!includeTriggers && this.trigger[k] !== 0) {
      return false;
    }
    const targetLayer = this.layer[k];
    const targetMask = this.mask[k];
    if ((queryMask & targetLayer) === 0) return false;
    if ((targetMask & queryLayer) === 0) return false;
    if (this.objs[k].active === 0) return false;
    return true;
  }`,
`  fillObjectRow(k: number, o: GameObject): number {
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
  }`,
  'fillObjectRow & passesFilter'
);

// 6. rebuild static branch
gen = replaceExact(
  gen,
`    if (staticDirty) {
      this.forceStaticRebuild = false;
      const allObjs = targetScene.objects;`,
`    if (staticDirty) {
      this.forceStaticRebuild = false;
      this.hasStaticTriggers = 0;
      const allObjs = targetScene.objects;`,
  'rebuild hasStaticTriggers reset'
);

// 7. rebuildDynamicGrid incremental
gen = replaceExact(
  gen,
`                this.shape[k] = this.shape[lastK];
                this.trigger[k] = this.trigger[lastK];
                this.hullId[k] = this.hullId[lastK];
                if (this.localCx.length > 0) {
                  this.localCx[k] = this.localCx[lastK];
                  this.localCy[k] = this.localCy[lastK];
                  this.localCz[k] = this.localCz[lastK];
                }
                this.layer[k] = this.layer[lastK];
                this.mask[k] = this.mask[lastK];
                this.bodyId[k] = this.bodyId[lastK];
                this.worldHx[k] = this.worldHx[lastK];`,
`                this.shape[k] = this.shape[lastK];
                if (this.localCx.length > 0) {
                  this.localCx[k] = this.localCx[lastK];
                  this.localCy[k] = this.localCy[lastK];
                  this.localCz[k] = this.localCz[lastK];
                }
                this.worldHx[k] = this.worldHx[lastK];`,
  'rebuildDynamicGrid compaction'
);

gen = replaceExact(
  gen,
`        ops.length = 0;
        objs.length = 0;
      } else if (staticDirty) {`,
`        ops.length = 0;
        objs.length = 0;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;
      } else if (staticDirty) {`,
  'rebuildDynamicGrid incremental hasTriggers update'
);

// 8. rebuildDynamicGrid non-incremental (staticDirty)
gen = replaceExact(
  gen,
`      } else if (staticDirty) {
        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        let maxDynamicHalfExtent: f64 = 0.5;`,
`      } else if (staticDirty) {
        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        this.hasDynamicTriggers = 0;
        let maxDynamicHalfExtent: f64 = 0.5;`,
  'rebuildDynamicGrid non-incremental staticDirty'
);

gen = replaceExact(
  gen,
`        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      } else {`,
`        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      } else {`,
  'rebuildDynamicGrid non-incremental staticDirty hasTriggers update'
);

// 9. rebuildDynamicGrid non-incremental (!staticDirty)
gen = replaceExact(
  gen,
`      } else {
        const allObjs = targetScene.objects;
        const n = allObjs.length;
        this.ensureObjCapacity(n);

        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        let maxDynamicHalfExtent: f64 = 0.5;`,
`      } else {
        const allObjs = targetScene.objects;
        const n = allObjs.length;
        this.ensureObjCapacity(n);

        this.objs.length = this.staticTotal;
        this.trs.length = this.staticTotal;
        this.dynamicCount = 0;
        this.colossalDynamicCount = 0;
        this.hasDynamicTriggers = 0;
        let maxDynamicHalfExtent: f64 = 0.5;`,
  'rebuildDynamicGrid non-incremental !staticDirty'
);

gen = replaceExact(
  gen,
`        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      }

      this.dynCellSize = this.dynamicMaxHalfExtent * 2.0;`,
`        this.hasDynamicLocalOffset = hasDynLocalOffset;
        this.dynamicMaxHalfExtent = maxDynamicHalfExtent;
        this.hasTriggers = this.hasStaticTriggers | this.hasDynamicTriggers;

        targetScene.pendingDynamicOps.length = 0;
        targetScene.pendingDynamicObjs.length = 0;
        targetScene.pendingDynamicOverflow = false;
      }

      this.dynCellSize = this.dynamicMaxHalfExtent * 2.0;`,
  'rebuildDynamicGrid non-incremental !staticDirty hasTriggers update'
);

// 10. raycastNonAlloc call to raycastDynamicsDDA
gen = replaceExact(
  gen,
`      if (raycastDynamicsDDA(
        ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
        mask, layer, includeTriggers, curStepId, stamp,
        this.dynCellSize, this.dynInvCellSize, this.dynamicMaxHalfExtent,
        this.dynHead, this.dynNext, sSharedVisitedStamp, sSharedBucketStamp, this.tempRayHit,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape, this.trigger, this.layer, this.mask, this.bodyId,
        this.worldHx, this.worldHy, this.worldHz, this.worldRadius, this.hullId,
        this,
      )) {`,
`      if (raycastDynamicsDDA(
        this,
        ox, oy, oz, ndx, ndy, ndz, closestDist, outHit,
        mask, layer, includeTriggers, curStepId, stamp,
        this.dynCellSize, this.dynInvCellSize, this.dynamicMaxHalfExtent,
        this.dynHead, this.dynNext, sSharedVisitedStamp, sSharedBucketStamp, this.tempRayHit,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape,
        this.worldHx, this.worldHy, this.worldHz, this.worldRadius,
      )) {`,
  'raycastNonAlloc call'
);

// 11. overlapSphereNonAlloc calls & colossal
gen = replaceExact(
  gen,
`      totalFound = overlapSphereInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticHead, this.staticEntriesObj, this.staticEntriesNext,
        sSharedVisitedStamp, stamp,
        this.trigger, this.layer, this.mask,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.bodyId, this.candidateOverlapHit,
        0, 0,
      );`,
`      totalFound = overlapSphereInto(
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
      );`,
  'overlapSphereNonAlloc static call'
);

gen = replaceExact(
  gen,
`      totalFound = overlapSphereInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticCoarseHead, this.staticCoarseEntriesObj, this.staticCoarseEntriesNext,
        sSharedVisitedStamp, stamp,
        this.trigger, this.layer, this.mask,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.bodyId, this.candidateOverlapHit,
        storedCount, totalFound,
      );`,
`      totalFound = overlapSphereInto(
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
      );`,
  'overlapSphereNonAlloc coarse static call'
);

gen = replaceExact(
  gen,
`      totalFound = overlapSphereDynamicsInto(
        this,
        cx, cy, cz, radius,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.dynHead, this.dynNext, sSharedBucketStamp, stamp,
        this.trigger, this.layer, this.mask, this.bodyId, this.candidateOverlapHit,
        storedCount, totalFound,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape, this.worldHx, this.worldHy, this.worldHz, this.worldRadius, this.hullId,
      );`,
`      totalFound = overlapSphereDynamicsInto(
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
      );`,
  'overlapSphereNonAlloc dynamic call'
);

gen = replaceExact(
  gen,
`        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.bodyId[k];
          if (storedCount < effectiveMaxHits) {`,
`        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.objs[k].id;
          if (storedCount < effectiveMaxHits) {`,
  'overlapSphereNonAlloc colossal candId'
);

// 12. overlapBoxNonAlloc calls & colossal
gen = replaceExact(
  gen,
`      totalFound = overlapBoxInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticHead, this.staticEntriesObj, this.staticEntriesNext,
        sSharedVisitedStamp, stamp,
        this.trigger, this.layer, this.mask,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.bodyId, this.candidateOverlapHit,
        0, 0,
      );`,
`      totalFound = overlapBoxInto(
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
      );`,
  'overlapBoxNonAlloc static call'
);

gen = replaceExact(
  gen,
`      totalFound = overlapBoxInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.staticCoarseHead, this.staticCoarseEntriesObj, this.staticCoarseEntriesNext,
        sSharedVisitedStamp, stamp,
        this.trigger, this.layer, this.mask,
        this.minX, this.maxX, this.minY, this.maxY, this.minZ, this.maxZ,
        this.bodyId, this.candidateOverlapHit,
        storedCount, totalFound,
      );`,
`      totalFound = overlapBoxInto(
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
      );`,
  'overlapBoxNonAlloc coarse static call'
);

gen = replaceExact(
  gen,
`      totalFound = overlapBoxDynamicsInto(
        this,
        cx, cy, cz, hx, hy, hz,
        minGx, maxGx, minGy, maxGy, minGz, maxGz,
        minQx, maxQx, minQy, maxQy, minQz, maxQz,
        outHits, effectiveMaxHits, mask, layer, includeTriggers, curStepId,
        this.dynHead, this.dynNext, sSharedBucketStamp, stamp,
        this.trigger, this.layer, this.mask, this.bodyId, this.candidateOverlapHit,
        storedCount, totalFound,
        this.trs, this.localCx, this.localCy, this.localCz, this.hasDynamicLocalOffset,
        this.shape, this.worldHx, this.worldHy, this.worldHz, this.worldRadius, this.hullId,
      );`,
`      totalFound = overlapBoxDynamicsInto(
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
      );`,
  'overlapBoxNonAlloc dynamic call'
);

gen = replaceExact(
  gen,
`        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.bodyId[k];
          if (storedCount < effectiveMaxHits) {`,
`        if (this.passesFilter(mask, layer, includeTriggers, k)) {
          const candId = this.objs[k].id;
          if (storedCount < effectiveMaxHits) {`,
  'overlapBoxNonAlloc colossal candId'
);

// 13. raycastObject replacements
gen = replaceExact(
  gen,
`raycastObjStr = strictReplace(raycastObjStr, /sBodyId\\[k\\]/g, 'idx.bodyId[k]', 'raycastObj sBodyId');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHx\\[k\\]/g, 'idx.worldHx[k]', 'raycastObj sWorldHx');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHy\\[k\\]/g, 'idx.worldHy[k]', 'raycastObj sWorldHy');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'raycastObj sWorldHz');
raycastObjStr = strictReplace(raycastObjStr, /sHullId\\[k\\]/g, 'idx.hullId[k]', 'raycastObj sHullId');`,
`raycastObjStr = strictReplace(raycastObjStr, /sBodyId\\[k\\]/g, 'idx.objs[k].id', 'raycastObj sBodyId');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHx\\[k\\]/g, 'idx.worldHx[k]', 'raycastObj sWorldHx');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHy\\[k\\]/g, 'idx.worldHy[k]', 'raycastObj sWorldHy');
raycastObjStr = strictReplace(raycastObjStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'raycastObj sWorldHz');
raycastObjStr = strictReplace(raycastObjStr, /sHullId\\[k\\]/g, 'hullIdOf(idx.objs[k])', 'raycastObj sHullId');`,
  'raycastObject replacements'
);

// 14. raycastDynamicsDDA replacements
gen = replaceExact(
  gen,
`// 7. raycastDynamicsDDA (extract lines 1790 to 2183, with replacements)
let rDynStr = getLines(1790, 2183);
rDynStr = strictReplace(rDynStr, '  hullIdArr: number[],\\n): boolean {', '  hullIdArr: number[],\\n  idx: SpatialIndex,\\n): boolean {', 'raycastDynamicsDDA signature');
rDynStr = strictReplace(rDynStr, 'const dynMinX = sDynSceneMinX;', 'const dynMinX = idx.dynSceneMinX;', 'rDyn dynMinX');
rDynStr = strictReplace(rDynStr, 'const dynMaxX = sDynSceneMaxX;', 'const dynMaxX = idx.dynSceneMaxX;', 'rDyn dynMaxX');
rDynStr = strictReplace(rDynStr, 'const dynMinY = sDynSceneMinY;', 'const dynMinY = idx.dynSceneMinY;', 'rDyn dynMinY');
rDynStr = strictReplace(rDynStr, 'const dynMaxY = sDynSceneMaxY;', 'const dynMaxY = idx.dynSceneMaxY;', 'rDyn dynMaxY');
rDynStr = strictReplace(rDynStr, 'const dynMinZ = sDynSceneMinZ;', 'const dynMinZ = idx.dynSceneMinZ;', 'rDyn dynMinZ');
rDynStr = strictReplace(rDynStr, 'const dynMaxZ = sDynSceneMaxZ;', 'const dynMaxZ = idx.dynSceneMaxZ;', 'rDyn dynMaxZ');
rDynStr = strictReplace(rDynStr, 'const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);',
  'const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);', 'rDyn raycastObject call');
rDynStr = strictReplace(rDynStr, /sObjs\\[k\\]\\.active/g, 'idx.objs[k].active', 'rDyn sObjs.active');
out += rDynStr + '\\n\\n';`,
`// 7. raycastDynamicsDDA (extract lines 1790 to 2183, with replacements)
let rDynStr = getLines(1790, 2183);
rDynStr = strictReplace(rDynStr, 'function raycastDynamicsDDA(', 'function raycastDynamicsDDA(\\n  idx: SpatialIndex,', 'raycastDynamicsDDA signature');
rDynStr = strictReplace(rDynStr, '  triggerArr: number[],\\n  layerArr: number[],\\n  maskArr: number[],\\n  bodyIdArr: number[],\\n', '', 'rDyn remove trigger layer mask bodyId args');
rDynStr = strictReplace(rDynStr, '  hullIdArr: number[],\\n', '', 'rDyn remove hullId arg');
rDynStr = strictReplace(rDynStr, 'const dynMinX = sDynSceneMinX;', 'const dynMinX = idx.dynSceneMinX;', 'rDyn dynMinX');
rDynStr = strictReplace(rDynStr, 'const dynMaxX = sDynSceneMaxX;', 'const dynMaxX = idx.dynSceneMaxX;', 'rDyn dynMaxX');
rDynStr = strictReplace(rDynStr, 'const dynMinY = sDynSceneMinY;', 'const dynMinY = idx.dynSceneMinY;', 'rDyn dynMinY');
rDynStr = strictReplace(rDynStr, 'const dynMaxY = sDynSceneMaxY;', 'const dynMaxY = idx.dynSceneMaxY;', 'rDyn dynMaxY');
rDynStr = strictReplace(rDynStr, 'const dynMinZ = sDynSceneMinZ;', 'const dynMinZ = idx.dynSceneMinZ;', 'rDyn dynMinZ');
rDynStr = strictReplace(rDynStr, 'const dynMaxZ = sDynSceneMaxZ;', 'const dynMaxZ = idx.dynSceneMaxZ;', 'rDyn dynMaxZ');
rDynStr = strictReplace(rDynStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'rDyn trigger check');
rDynStr = strictReplace(rDynStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'rDyn layer mask check');
rDynStr = strictReplace(rDynStr, /bodyIdArr\\[k\\]/g, 'idx.objs[k].id', 'rDyn bodyIdArr');
rDynStr = strictReplace(rDynStr, 'const hit = raycastObject(k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);',
  'const hit = raycastObject(idx, k, ox, oy, oz, ndx, ndy, ndz, closestDist, tempHit, includeTriggers, curStepId);', 'rDyn raycastObject call');
rDynStr = strictReplace(rDynStr, /sObjs\\[k\\]\\.active/g, 'idx.objs[k].active', 'rDyn sObjs.active');
out += rDynStr + '\\n\\n';`,
  'raycastDynamicsDDA replacements'
);

// 15. overlapSphereObject & testOverlapSphereObject replacements
gen = replaceExact(
  gen,
`sphObjStr = strictReplace(sphObjStr, /sShape\\[k\\]/g, 'idx.shape[k]', 'sphObj sShape');
sphObjStr = strictReplace(sphObjStr, /sTrigger\\[k\\]/g, 'idx.trigger[k]', 'sphObj sTrigger');
sphObjStr = strictReplace(sphObjStr, /sWorldRadius\\[k\\]/g, 'idx.worldRadius[k]', 'sphObj sWorldRadius');
sphObjStr = strictReplace(sphObjStr, /sBodyId\\[k\\]/g, 'idx.bodyId[k]', 'sphObj sBodyId');
sphObjStr = strictReplace(sphObjStr, /sWorldHx\\[k\\]/g, 'idx.worldHx[k]', 'sphObj sWorldHx');
sphObjStr = strictReplace(sphObjStr, /sWorldHy\\[k\\]/g, 'idx.worldHy[k]', 'sphObj sWorldHy');
sphObjStr = strictReplace(sphObjStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'sphObj sWorldHz');
sphObjStr = strictReplace(sphObjStr, /sHullId\\[k\\]/g, 'idx.hullId[k]', 'sphObj sHullId');
sphObjStr = strictReplace(sphObjStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'sphObj sTrs');`,
`sphObjStr = strictReplace(sphObjStr, /sShape\\[k\\]/g, 'idx.shape[k]', 'sphObj sShape');
sphObjStr = strictReplace(sphObjStr, 'const isTrigger = sTrigger[k] !== 0;', 'const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;', 'sphObj sTrigger');
sphObjStr = strictReplace(sphObjStr, /sWorldRadius\\[k\\]/g, 'idx.worldRadius[k]', 'sphObj sWorldRadius');
sphObjStr = strictReplace(sphObjStr, /sBodyId\\[k\\]/g, 'idx.objs[k].id', 'sphObj sBodyId');
sphObjStr = strictReplace(sphObjStr, /sWorldHx\\[k\\]/g, 'idx.worldHx[k]', 'sphObj sWorldHx');
sphObjStr = strictReplace(sphObjStr, /sWorldHy\\[k\\]/g, 'idx.worldHy[k]', 'sphObj sWorldHy');
sphObjStr = strictReplace(sphObjStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'sphObj sWorldHz');
sphObjStr = strictReplace(sphObjStr, /sHullId\\[k\\]/g, 'hullIdOf(idx.objs[k])', 'sphObj sHullId');
sphObjStr = strictReplace(sphObjStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'sphObj sTrs');`,
  'overlapSphereObject replacements'
);

gen = replaceExact(
  gen,
`testSphStr = strictReplace(testSphStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'testSph sWorldHz');
testSphStr = strictReplace(testSphStr, /sHullId\\[k\\]/g, 'idx.hullId[k]', 'testSph sHullId');
testSphStr = strictReplace(testSphStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'testSph sTrs');`,
`testSphStr = strictReplace(testSphStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'testSph sWorldHz');
testSphStr = strictReplace(testSphStr, /sHullId\\[k\\]/g, 'hullIdOf(idx.objs[k])', 'testSph sHullId');
testSphStr = strictReplace(testSphStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'testSph sTrs');`,
  'testOverlapSphereObject replacements'
);

// 16. overlapSphereInto replacements
gen = replaceExact(
  gen,
`let sphIntoStr = getLines(2591, 2699);
sphIntoStr = strictReplace(sphIntoStr, 'function overlapSphereInto(\\n  cx: f64,', 'function overlapSphereInto(\\n  idx: SpatialIndex,\\n  cx: f64,', 'overlapSphereInto signature');
sphIntoStr = strictReplace(sphIntoStr, /overlapSphereObject\\(k,/g, 'overlapSphereObject(idx, k,', 'sphInto overlapSphereObject');`,
`let sphIntoStr = getLines(2591, 2699);
sphIntoStr = strictReplace(sphIntoStr, 'function overlapSphereInto(\\n  cx: f64,', 'function overlapSphereInto(\\n  idx: SpatialIndex,\\n  cx: f64,', 'overlapSphereInto signature');
sphIntoStr = strictReplace(sphIntoStr, '  triggerArr: number[],\\n  layerArr: number[],\\n  maskArr: number[],\\n', '', 'sphInto remove trigger layer mask args');
sphIntoStr = strictReplace(sphIntoStr, '  bodyIdArr: number[],\\n', '', 'sphInto remove bodyId arg');
sphIntoStr = strictReplace(sphIntoStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'sphInto trigger check');
sphIntoStr = strictReplace(sphIntoStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'sphInto layer mask check');
sphIntoStr = strictReplace(sphIntoStr, 'const candId = bodyIdArr[k];', 'const candId = idx.objs[k].id;', 'sphInto candId');
sphIntoStr = strictReplace(sphIntoStr, /overlapSphereObject\\(k,/g, 'overlapSphereObject(idx, k,', 'sphInto overlapSphereObject');`,
  'overlapSphereInto replacements'
);

// 17. overlapSphereDynamicsInto function definition
gen = replaceExact(
  gen,
`// 13. overlapSphereDynamicsInto (lines 2700 to 2945)
// We provide clean 2-space indented overlapSphereDynamicsInto with recordOverlapHit!
out += \`function overlapSphereDynamicsInto(
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

                const hx = worldHxArr[k];
                const hy = worldHyArr[k];
                const hz = worldHzArr[k];

                if (cxObj + hx >= minQx && cxObj - hx <= maxQx &&
                    cyObj + hy >= minQy && cyObj - hy <= maxQy &&
                    czObj + hz >= minQz && czObj - hz <= maxQz) {
                  const rx = cx - cxObj;
                  const ry = cy - cyObj;
                  const rz = cz - czObj;
                  const shp = shapeArr[k];
                  const candId = bodyIdArr[k];
                  const needsFullHit = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;

                  if (shp === 0) { // COL_SPHERE
                    const tr = worldRadiusArr[k];
                    const d2 = rx * rx + ry * ry + rz * rz;
                    const rSum = radius + tr;
                    if (d2 < rSum * rSum) {
                      if (idx.objs[k].active !== 0) {
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
                      if (idx.objs[k].active !== 0) {
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
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, target);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapSphereObject(idx, k, cx, cy, cz, radius, candHit, includeTriggers, curStepId)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, candHit);
                          insertHitSorted(outHits, maxHits - 1, target);
                        }
                      }
                    } else if (testOverlapSphereObject(idx, k, cx, cy, cz, radius)) {
                      if (idx.objs[k].active !== 0) {
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
\`;`,
`// 13. overlapSphereDynamicsInto (lines 2700 to 2945)
// We provide clean 2-space indented overlapSphereDynamicsInto with recordOverlapHit!
out += \`function overlapSphereDynamicsInto(
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

                const hx = worldHxArr[k];
                const hy = worldHyArr[k];
                const hz = worldHzArr[k];

                if (cxObj + hx >= minQx && cxObj - hx <= maxQx &&
                    cyObj + hy >= minQy && cyObj - hy <= maxQy &&
                    czObj + hz >= minQz && czObj - hz <= maxQz) {
                  const rx = cx - cxObj;
                  const ry = cy - cyObj;
                  const rz = cz - czObj;
                  const shp = shapeArr[k];
                  const candId = o.id;
                  const needsFullHit = storedCount < maxHits || candId < outHits[maxHits - 1].bodyId;

                  if (shp === 0) { // COL_SPHERE
                    const tr = worldRadiusArr[k];
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
\`;`,
  'overlapSphereDynamicsInto function'
);

// 18. overlapBoxObject & testOverlapBoxObject replacements
gen = replaceExact(
  gen,
`boxObjStr = strictReplace(boxObjStr, /sShape\\[k\\]/g, 'idx.shape[k]', 'boxObj sShape');
boxObjStr = strictReplace(boxObjStr, /sTrigger\\[k\\]/g, 'idx.trigger[k]', 'boxObj sTrigger');
boxObjStr = strictReplace(boxObjStr, /sWorldRadius\\[k\\]/g, 'idx.worldRadius[k]', 'boxObj sWorldRadius');
boxObjStr = strictReplace(boxObjStr, /sBodyId\\[k\\]/g, 'idx.bodyId[k]', 'boxObj sBodyId');`,
`boxObjStr = strictReplace(boxObjStr, /sShape\\[k\\]/g, 'idx.shape[k]', 'boxObj sShape');
boxObjStr = strictReplace(boxObjStr, 'const isTrigger = sTrigger[k] !== 0;', 'const isTrigger = idx.hasTriggers !== 0 && triggerOf(idx.objs[k]) !== 0;', 'boxObj sTrigger');
boxObjStr = strictReplace(boxObjStr, /sWorldRadius\\[k\\]/g, 'idx.worldRadius[k]', 'boxObj sWorldRadius');
boxObjStr = strictReplace(boxObjStr, /sBodyId\\[k\\]/g, 'idx.objs[k].id', 'boxObj sBodyId');`,
  'overlapBoxObject replacements'
);

gen = replaceExact(
  gen,
`testBoxStr = strictReplace(testBoxStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'testBox sWorldHz');
testBoxStr = strictReplace(testBoxStr, /sHullId\\[k\\]/g, 'idx.hullId[k]', 'testBox sHullId');
testBoxStr = strictReplace(testBoxStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'testBox sTrs');`,
`testBoxStr = strictReplace(testBoxStr, /sWorldHz\\[k\\]/g, 'idx.worldHz[k]', 'testBox sWorldHz');
testBoxStr = strictReplace(testBoxStr, /sHullId\\[k\\]/g, 'hullIdOf(idx.objs[k])', 'testBox sHullId');
testBoxStr = strictReplace(testBoxStr, /sTrs\\[k\\]/g, 'idx.trs[k]', 'testBox sTrs');`,
  'testOverlapBoxObject replacements'
);

// 19. overlapBoxInto replacements
gen = replaceExact(
  gen,
`let boxIntoStr = getLines(3408, 3510);
boxIntoStr = strictReplace(boxIntoStr, 'function overlapBoxInto(\\n  cx: f64,', 'function overlapBoxInto(\\n  idx: SpatialIndex,\\n  cx: f64,', 'overlapBoxInto signature');
boxIntoStr = strictReplace(boxIntoStr, /overlapBoxObject\\(k,/g, 'overlapBoxObject(idx, k,', 'boxInto overlapBoxObject');`,
`let boxIntoStr = getLines(3408, 3510);
boxIntoStr = strictReplace(boxIntoStr, 'function overlapBoxInto(\\n  cx: f64,', 'function overlapBoxInto(\\n  idx: SpatialIndex,\\n  cx: f64,', 'overlapBoxInto signature');
boxIntoStr = strictReplace(boxIntoStr, '  triggerArr: number[],\\n  layerArr: number[],\\n  maskArr: number[],\\n', '', 'boxInto remove trigger layer mask args');
boxIntoStr = strictReplace(boxIntoStr, '  bodyIdArr: number[],\\n', '', 'boxInto remove bodyId arg');
boxIntoStr = strictReplace(boxIntoStr, 'if (includeTriggers || triggerArr[k] === 0) {', 'if (includeTriggers || idx.hasTriggers === 0 || triggerOf(idx.objs[k]) === 0) {', 'boxInto trigger check');
boxIntoStr = strictReplace(boxIntoStr, 'if ((mask & layerArr[k]) !== 0 && (maskArr[k] & layer) !== 0) {', 'if ((mask & idx.objs[k].layer) !== 0 && (idx.objs[k].mask & layer) !== 0) {', 'boxInto layer mask check');
boxIntoStr = strictReplace(boxIntoStr, 'const candId = bodyIdArr[k];', 'const candId = idx.objs[k].id;', 'boxInto candId');
boxIntoStr = strictReplace(boxIntoStr, /overlapBoxObject\\(k,/g, 'overlapBoxObject(idx, k,', 'boxInto overlapBoxObject');`,
  'overlapBoxInto replacements'
);

// 20. overlapBoxDynamicsInto function definition
gen = replaceExact(
  gen,
`// 18. overlapBoxDynamicsInto (clean 2-space indentation with recordOverlapHit)
out += \`function overlapBoxDynamicsInto(
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

                const thx = worldHxArr[k];
                const thy = worldHyArr[k];
                const thz = worldHzArr[k];

                if (cxObj + thx >= minQx && cxObj - thx <= maxQx &&
                    cyObj + thy >= minQy && cyObj - thy <= maxQy &&
                    czObj + thz >= minQz && czObj - thz <= maxQz) {
                  const rx = cxObj - cx;
                  const ry = cyObj - cy;
                  const rz = czObj - cz;
                  const absRx = math.abs(rx);
                  const absRy = math.abs(ry);
                  const absRz = math.abs(rz);
                  const shp = shapeArr[k];
                  const candId = bodyIdArr[k];

                  if (shp === 0) { // COL_SPHERE (caixa query vs esfera dyn)
                    const tr = worldRadiusArr[k];
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
                      if (idx.objs[k].active !== 0) {
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
                        if (idx.objs[k].active !== 0) {
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
                          if (idx.objs[k].active !== 0) {
                            totalFound = totalFound + 1;
                            insertHitSorted(outHits, storedCount, target);
                            storedCount = storedCount + 1;
                          }
                        }
                      } else if (candId < outHits[maxHits - 1].bodyId) {
                        if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                          if (idx.objs[k].active !== 0) {
                            totalFound = totalFound + 1;
                            const target = outHits[maxHits - 1];
                            copyOverlapHit(target, candHit);
                            insertHitSorted(outHits, maxHits - 1, target);
                          }
                        }
                      } else if (testOverlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                        }
                      }
                    }
                  } else { // Fallback COL_HULL
                    if (storedCount < maxHits) {
                      const target = outHits[storedCount];
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, target, includeTriggers, curStepId)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          insertHitSorted(outHits, storedCount, target);
                          storedCount = storedCount + 1;
                        }
                      }
                    } else if (candId < outHits[maxHits - 1].bodyId) {
                      if (overlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz, candHit, includeTriggers, curStepId)) {
                        if (idx.objs[k].active !== 0) {
                          totalFound = totalFound + 1;
                          const target = outHits[maxHits - 1];
                          copyOverlapHit(target, candHit);
                          insertHitSorted(outHits, maxHits - 1, target);
                        }
                      }
                    } else if (testOverlapBoxObject(idx, k, cx, cy, cz, hx, hy, hz)) {
                      if (idx.objs[k].active !== 0) {
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
\`;`,
`// 18. overlapBoxDynamicsInto (clean 2-space indentation with recordOverlapHit)
out += \`function overlapBoxDynamicsInto(
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

                const thx = worldHxArr[k];
                const thy = worldHyArr[k];
                const thz = worldHzArr[k];

                if (cxObj + thx >= minQx && cxObj - thx <= maxQx &&
                    cyObj + thy >= minQy && cyObj - thy <= maxQy &&
                    czObj + thz >= minQz && czObj - thz <= maxQz) {
                  const rx = cxObj - cx;
                  const ry = cyObj - cy;
                  const rz = czObj - cz;
                  const absRx = math.abs(rx);
                  const absRy = math.abs(ry);
                  const absRz = math.abs(rz);
                  const shp = shapeArr[k];
                  const candId = o.id;

                  if (shp === 0) { // COL_SPHERE (caixa query vs esfera dyn)
                    const tr = worldRadiusArr[k];
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
\`;`,
  'overlapBoxDynamicsInto function'
);

fs.writeFileSync('scratch/generate.js', gen, 'utf8');
console.log('Successfully updated scratch/generate.js!');

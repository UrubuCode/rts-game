const fs = require('fs');

let gen = fs.readFileSync('scratch/generate.js', 'utf8');

// 1. SGRID_CAP from 2048 to 1024
gen = gen.replace("const SGRID_CAP = 2048;\\nconst SGRID_MASK = 2047;", "const SGRID_CAP = 1024;\\nconst SGRID_MASK = 1023;");

// 2. SpatialIndex constructor: empty arrays for static and dynamic lists
const oldCtor = `    this.dynHead = new Array(SGRID_CAP).fill(-1);
    this.dynNext = new Array(cap).fill(-1);
    this.dynCell = new Array(cap).fill(0);

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
    this.worldHx = new Array(cap).fill(0.5);
    this.worldHy = new Array(cap).fill(0.5);
    this.worldHz = new Array(cap).fill(0.5);
    this.worldRadius = new Array(cap).fill(0.5);

    this.shape = new Array(cap).fill(0);
    this.yaw = [];
    this.dynamicIndices = new Array(cap).fill(0);`;

const newCtor = `    this.dynHead = new Array(SGRID_CAP).fill(-1);
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
    this.dynamicIndices = [];`;

if (gen.includes(oldCtor)) {
  gen = gen.replace(oldCtor, newCtor);
}

// 3. Update growStatic to also grow worldHx, worldHy, worldHz, worldRadius, shape
const oldGrowStatic = `  growStatic(cap: number): void {
    while (this.worldCx.length < cap) {
      this.worldCx.push(0.0);
      this.worldCy.push(0.0);
      this.worldCz.push(0.0);
      this.yaw.push(0.0);
      this.minX.push(0.0);
      this.maxX.push(0.0);
      this.minY.push(0.0);
      this.maxY.push(0.0);
      this.minZ.push(0.0);
      this.maxZ.push(0.0);
    }
  }`;

const newGrowStatic = `  growStatic(cap: number): void {
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
  }`;

if (gen.includes(oldGrowStatic)) {
  gen = gen.replace(oldGrowStatic, newGrowStatic);
}

// 4. Update ensureObjCapacity: only grow dynNext and localCx/Cy/Cz
const oldEnsureObjCap = `  ensureObjCapacity(cap: number): void {
    if (this.objCap >= cap) return;
    let newCap = this.objCap < 64 ? 64 : (this.objCap + (this.objCap >> 1));
    if (newCap < cap) newCap = cap;
    if (newCap < this.objCap + 32) newCap = this.objCap + 32;
    ensureSharedVisitedCapacity(newCap);
    const diff = newCap - this.worldHx.length;
    if (diff > 0) {
      let d = 0;
      while (d < diff) {
        this.worldHx.push(0.5); this.worldHy.push(0.5); this.worldHz.push(0.5);
        this.worldRadius.push(0.5);
        this.shape.push(0);
        this.dynamicIndices.push(0);
        this.dynNext.push(-1);
        this.dynCell.push(0);
        d = d + 1;
      }
    }
    if (this.localCx.length > 0 && this.localCx.length < newCap) {
      while (this.localCx.length < newCap) {
        this.localCx.push(0.0);
        this.localCy.push(0.0);
        this.localCz.push(0.0);
      }
    }
    this.objCap = newCap;
  }`;

const newEnsureObjCap = `  ensureObjCapacity(cap: number): void {
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
  }`;

if (gen.includes(oldEnsureObjCap)) {
  gen = gen.replace(oldEnsureObjCap, newEnsureObjCap);
}

// 5. Update fillObjectRow: do NOT write worldHx/Hy/Hz/Radius/shape for dynamic objects
const oldFillObj = `    this.shape[k] = shp;
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

      if (t.wry !== 0.0) {
        const csA = math.abs(math.cos(t.wry));
        const snA = math.abs(math.sin(t.wry));
        const rHx = hx * csA + hz * snA;
        const rHz = hx * snA + hz * csA;
        this.minX[k] = cx - rHx; this.maxX[k] = cx + rHx;
        this.minY[k] = minY;      this.maxY[k] = maxY;
        this.minZ[k] = cz - rHz; this.maxZ[k] = cz + rHz;
      } else {
        this.minX[k] = minX; this.maxX[k] = maxX;
        this.minY[k] = minY; this.maxY[k] = maxY;
        this.minZ[k] = minZ; this.maxZ[k] = maxZ;
      }

      if (maxH > this.staticMaxHalfExtent) {
        this.staticMaxHalfExtent = maxH;
      }
    } else {
      if (maxH > this.dynamicMaxHalfExtent) {
        this.dynamicMaxHalfExtent = maxH;
      }
    }

    return maxH;`;

const newFillObj = `    const hx = lhx * t.sx;
    const hy = lhy * t.sy;
    const hz = lhz * t.sz;
    const maxH = hx > hy ? (hx > hz ? hx : hz) : (hy > hz ? hy : hz);

    if (isStatic !== 0) {
      if (this.worldCx.length <= k) this.growStatic(k + 1);
      this.shape[k] = shp;
      this.worldHx[k] = hx;
      this.worldHy[k] = hy;
      this.worldHz[k] = hz;
      this.worldRadius[k] = hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz);
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

      if (t.wry !== 0.0) {
        const csA = math.abs(math.cos(t.wry));
        const snA = math.abs(math.sin(t.wry));
        const rHx = hx * csA + hz * snA;
        const rHz = hx * snA + hz * csA;
        this.minX[k] = cx - rHx; this.maxX[k] = cx + rHx;
        this.minY[k] = minY;      this.maxY[k] = maxY;
        this.minZ[k] = cz - rHz; this.maxZ[k] = cz + rHz;
      } else {
        this.minX[k] = minX; this.maxX[k] = maxX;
        this.minY[k] = minY; this.maxY[k] = maxY;
        this.minZ[k] = minZ; this.maxZ[k] = maxZ;
      }

      if (maxH > this.staticMaxHalfExtent) {
        this.staticMaxHalfExtent = maxH;
      }
    } else {
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
      if (maxH > this.dynamicMaxHalfExtent) {
        this.dynamicMaxHalfExtent = maxH;
      }
    }

    return maxH;`;

if (gen.includes(oldFillObj)) {
  gen = gen.replace(oldFillObj, newFillObj);
}

// 6. dynamicIndices assignment (push vs indexed)
gen = gen.replace(/this\.dynamicIndices\[this\.dynamicCount\] = k;/g, 
  "if (this.dynamicIndices.length <= this.dynamicCount) this.dynamicIndices.push(k); else this.dynamicIndices[this.dynamicCount] = k;");

// 7. Ensure dynCell has enough elements before rebuildDynamicsInto
const oldRebuildDynCall = `    // 3. Atualiza apenas os objetos dinâmicos através de FUNÇÃO LIVRE TIPADA
    rebuildDynamicsInto(`;

const newRebuildDynCall = `    // 3. Atualiza apenas os objetos dinâmicos através de FUNÇÃO LIVRE TIPADA
    while (this.dynCell.length < this.dynamicCount) this.dynCell.push(0);
    rebuildDynamicsInto(`;

if (gen.includes(oldRebuildDynCall)) {
  gen = gen.replace(oldRebuildDynCall, newRebuildDynCall);
}

// 8. Swap-with-last in DYN_OP_REMOVE: only copy shape / worldHx if in static range
const oldSwapLast = `                this.shape[k] = this.shape[lastK];
                if (this.localCx.length > 0) {
                  this.localCx[k] = this.localCx[lastK];
                  this.localCy[k] = this.localCy[lastK];
                  this.localCz[k] = this.localCz[lastK];
                }
                this.worldHx[k] = this.worldHx[lastK];
                this.worldHy[k] = this.worldHy[lastK];
                this.worldHz[k] = this.worldHz[lastK];
                this.worldRadius[k] = this.worldRadius[lastK];`;

const newSwapLast = `                if (k < this.shape.length && lastK < this.shape.length) {
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
                }`;

if (gen.includes(oldSwapLast)) {
  gen = gen.replace(oldSwapLast, newSwapLast);
}

// 9. In raycastObject: if dynamic, compute shape, extents, and radius on the fly
const oldRaycastObjHdr = `  const shape = idx.shape[k];

  if (shape === COL_SPHERE) {
    const r = idx.worldRadius[k];`;

const newRaycastObjHdr = `  const o = idx.objs[k];
  const t = idx.trs[k];
  let shape = 0;
  let hx = 0.5; let hy = 0.5; let hz = 0.5;
  let r = 0.5;
  if (o.stationary === 1 && k < idx.shape.length) {
    shape = idx.shape[k];
    r = idx.worldRadius[k];
    hx = idx.worldHx[k];
    hy = idx.worldHy[k];
    hz = idx.worldHz[k];
  } else {
    shape = shapeOf(o);
    hx = halfLocalX(o) * t.sx;
    hy = halfLocalY(o) * t.sy;
    hz = halfLocalZ(o) * t.sz;
    r = shape === 0 ? radiusOfCol(o, t) : (hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz));
  }

  if (shape === COL_SPHERE) {`;

if (gen.includes(oldRaycastObjHdr)) {
  gen = gen.replace(oldRaycastObjHdr, newRaycastObjHdr);
}

const oldRaycastObjBox = `  if (shape === COL_BOX) {
    const hx = idx.worldHx[k];
    const hy = idx.worldHy[k];
    const hz = idx.worldHz[k];`;

const newRaycastObjBox = `  if (shape === COL_BOX) {`;

if (gen.includes(oldRaycastObjBox)) {
  gen = gen.replace(oldRaycastObjBox, newRaycastObjBox);
}

// 10. In rDynStr: add strictReplace for dynamic shape and extents
const oldRDynRepl = `rDynStr = strictReplace(rDynStr, /sObjs\\[k\\]\\.active/g, 'idx.objs[k].active', 'rDyn sObjs.active');`;
const newRDynRepl = `rDynStr = strictReplace(rDynStr, /sObjs\\[k\\]\\.active/g, 'idx.objs[k].active', 'rDyn sObjs.active');
rDynStr = strictReplace(rDynStr, 'const shp = shapeArr[k];\\n                    const t = trsArr[k];',
  'const o = idx.objs[k];\\n                    const t = trsArr[k];\\n                    const shp = shapeOf(o);\\n                    const lhx = halfLocalX(o);\\n                    const lhy = halfLocalY(o);\\n                    const lhz = halfLocalZ(o);\\n                    const hx = lhx * t.sx;\\n                    const hy = lhy * t.sy;\\n                    const hz = lhz * t.sz;',
  'rDyn compute shp and extents');
rDynStr = strictReplace(rDynStr, 'const tr = worldRadiusArr[k];',
  'const tr = shp === 0 ? radiusOfCol(o, t) : (hx < hy ? (hx < hz ? hx : hz) : (hy < hz ? hy : hz));',
  'rDyn compute tr');
rDynStr = strictReplace(rDynStr, 'const hx = worldHxArr[k];\\n                      const hy = worldHyArr[k];\\n                      const hz = worldHzArr[k];',
  '// hx, hy, hz computed above',
  'rDyn skip box extents');`;

if (gen.includes(oldRDynRepl)) {
  gen = gen.replace(oldRDynRepl, newRDynRepl);
}

// 11. In overlapSphereDynamicsInto: compute extents and radius on the fly
const oldSphDynCheck = `                const hx = worldHxArr[k];
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
                    const tr = worldRadiusArr[k];`;

const newSphDynCheck = `                const lhx = halfLocalX(o);
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
                    const tr = radiusOfCol(o, t);`;

if (gen.includes(oldSphDynCheck)) {
  gen = gen.replace(oldSphDynCheck, newSphDynCheck);
}

// 12. In overlapBoxDynamicsInto: compute extents and radius on the fly
const oldBoxDynCheck = `                const thx = worldHxArr[k];
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
                    const tr = worldRadiusArr[k];`;

const newBoxDynCheck = `                const lhx = halfLocalX(o);
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
                    const tr = radiusOfCol(o, t);`;

if (gen.includes(oldBoxDynCheck)) {
  gen = gen.replace(oldBoxDynCheck, newBoxDynCheck);
}

fs.writeFileSync('scratch/generate.js', gen, 'utf8');
console.log("Successfully updated generate.js!");

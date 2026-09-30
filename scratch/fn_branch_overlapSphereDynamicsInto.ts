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

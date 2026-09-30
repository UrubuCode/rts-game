import io from "@compat/io.ts";
export interface OverlapHit {
  hit: boolean;
  bodyId: number;
  depth: number;
  normal: [number, number, number];
  stepId: number;
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

function insertHitSorted(outHits: OverlapHit[], startIndex: number, target: OverlapHit): void {
  const candId = target.bodyId;
  let p = startIndex;
  while (p > 0 && outHits[p - 1].bodyId > candId) {
    outHits[p] = outHits[p - 1];
    p = p - 1;
  }
  outHits[p] = target;
}

function recordOverlapHit(
  outHits: OverlapHit[],
  storedCount: number,
  maxHits: number,
  candId: number,
  depth: f64,
  nx: f64, ny: f64, nz: f64,
  curStepId: number,
): number {
  outHits[maxHits - 1].hit = true;
  outHits[maxHits - 1].bodyId = candId;
  outHits[maxHits - 1].depth = depth;
  outHits[maxHits - 1].normal[0] = nx;
  outHits[maxHits - 1].normal[1] = ny;
  outHits[maxHits - 1].normal[2] = nz;
  outHits[maxHits - 1].stepId = curStepId;
  return storedCount;
}

const outHits: OverlapHit[] = [];
let oi = 0;
while (oi < 16) { outHits.push(createOverlapHit()); oi = oi + 1; }
let stored = 0;
let i = 0;
while (i < 100000) {
  if (stored >= 16) stored = 0;
  stored = recordOverlapHit(outHits, stored, 16, (i * 7919) & 1023, 0.5, 0.0, 1.0, 0.0, 3);
  i = i + 1;
}
io.print("[rec] " + stored);

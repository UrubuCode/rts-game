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
  // Retorno único e sem ligar `outHits[slot]` a um local: no RTS atual, uma
  // escrita de propriedade num elemento de array dentro de um bloco que também
  // faz `return` aloca ~2 células por chamada (medido com RTS_GC_DEBUG:
  // 20.000 overlaps = 23 coletas / 1 M células; com esta forma, zero).
  let slot = maxHits - 1;
  let next = storedCount;
  if (storedCount < maxHits) {
    slot = storedCount;
    next = storedCount + 1;
  }
  outHits[slot].hit = true;
  outHits[slot].bodyId = candId;
  outHits[slot].depth = depth;
  outHits[slot].normal[0] = nx;
  outHits[slot].normal[1] = ny;
  outHits[slot].normal[2] = nz;
  outHits[slot].stepId = curStepId;
  insertHitSorted(outHits, slot, outHits[slot]);
  return next;
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

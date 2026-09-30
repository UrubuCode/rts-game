function insertHitSorted(outHits: OverlapHit[], startIndex: number, target: OverlapHit): void {
  const candId = target.bodyId;
  let p = startIndex;
  while (p > 0 && outHits[p - 1].bodyId > candId) {
    outHits[p] = outHits[p - 1];
    p = p - 1;
  }
  outHits[p] = target;
}

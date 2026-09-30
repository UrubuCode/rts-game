function copyOverlapHit(dst: OverlapHit, src: OverlapHit): void {
  dst.hit = src.hit;
  dst.bodyId = src.bodyId;
  dst.depth = src.depth;
  dst.normal[0] = src.normal[0];
  dst.normal[1] = src.normal[1];
  dst.normal[2] = src.normal[2];
  dst.stepId = src.stepId;
}

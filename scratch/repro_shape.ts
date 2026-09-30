import io from "@compat/io.ts";
interface OverlapHit { hit: boolean; bodyId: number; depth: number; normal: [number, number, number]; stepId: number; }
const hits: OverlapHit[] = [];
let i = 0;
while (i < 16) { hits.push({ hit: false, bodyId: 0, depth: 0.0, normal: [0.0, 0.0, 0.0], stepId: 0 }); i = i + 1; }
function writeEarlyReturn(arr: OverlapHit[], slot: number, max: number): number {
  if (slot < max) {
    arr[slot].hit = true;
    return slot + 1;
  }
  return slot;
}
let s = 0; i = 0;
while (i < 100000) { if (s >= 16) s = 0; s = writeEarlyReturn(hits, s, 16); i = i + 1; }
io.print("[shape5] " + s);

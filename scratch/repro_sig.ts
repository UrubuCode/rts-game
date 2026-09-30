import io from "@compat/io.ts";
interface Hit { hit: boolean; id: number; }
const hits: Hit[] = [];
let i = 0;
while (i < 16) { hits.push({ hit: false, id: 0 }); i = i + 1; }
function writeEarlyReturn(arr: Hit[], slot: number, max: number, candId: number, depth: f64, nx: f64, ny: f64, nz: f64, step: number): number {
  if (slot < max) {
    arr[slot].hit = true;
    return slot + 1;
  }
  return slot;
}
let s = 0; i = 0;
while (i < 100000) { if (s >= 16) s = 0; s = writeEarlyReturn(hits, s, 16, i, 0.5, 0.0, 1.0, 0.0, 3); i = i + 1; }
io.print("[sig9] " + s);

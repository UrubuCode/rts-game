import io from "@compat/io.ts";
interface Hit { hit: boolean; id: number; }
const hits: Hit[] = [];
let i0 = 0;
while (i0 < 16) { hits.push({ hit: false, id: 0 }); i0 = i0 + 1; }
function w4(arr: Hit[], slot: number, max: number, e0: number): number { if (slot < max) { arr[slot].hit = true; return slot + 1; } return slot; }
let s4 = 0; let i4 = 0; while (i4 < 100000) { if (s4 >= 16) s4 = 0; s4 = w4(hits, s4, 16, 1); i4 = i4 + 1; } io.print("[params 4] " + s4);
function w5(arr: Hit[], slot: number, max: number, e0: number, e1: number): number { if (slot < max) { arr[slot].hit = true; return slot + 1; } return slot; }
let s5 = 0; let i5 = 0; while (i5 < 100000) { if (s5 >= 16) s5 = 0; s5 = w5(hits, s5, 16, 1, 1); i5 = i5 + 1; } io.print("[params 5] " + s5);
function w6(arr: Hit[], slot: number, max: number, e0: number, e1: number, e2: number): number { if (slot < max) { arr[slot].hit = true; return slot + 1; } return slot; }
let s6 = 0; let i6 = 0; while (i6 < 100000) { if (s6 >= 16) s6 = 0; s6 = w6(hits, s6, 16, 1, 1, 1); i6 = i6 + 1; } io.print("[params 6] " + s6);
function w7(arr: Hit[], slot: number, max: number, e0: number, e1: number, e2: number, e3: number): number { if (slot < max) { arr[slot].hit = true; return slot + 1; } return slot; }
let s7 = 0; let i7 = 0; while (i7 < 100000) { if (s7 >= 16) s7 = 0; s7 = w7(hits, s7, 16, 1, 1, 1, 1); i7 = i7 + 1; } io.print("[params 7] " + s7);
function w8(arr: Hit[], slot: number, max: number, e0: number, e1: number, e2: number, e3: number, e4: number): number { if (slot < max) { arr[slot].hit = true; return slot + 1; } return slot; }
let s8 = 0; let i8 = 0; while (i8 < 100000) { if (s8 >= 16) s8 = 0; s8 = w8(hits, s8, 16, 1, 1, 1, 1, 1); i8 = i8 + 1; } io.print("[params 8] " + s8);

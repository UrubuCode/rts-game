import io from "@compat/io.ts";

function makeBig(n: number) {
  const arr: any[] = [];
  let i = 0;
  while (i < n) {
    arr.push({ x: i, y: i });
    i = i + 1;
  }
  return arr;
}

function processBig(arr: any[]): number {
  return arr.length;
}

const r0 = processBig(makeBig(30000));
io.print("r0: " + r0);
const r1 = processBig(makeBig(30000));
io.print("r1: " + r1);
const r2 = processBig(makeBig(30000));
io.print("r2: " + r2);
const r3 = processBig(makeBig(30000));
io.print("r3: " + r3);
const r4 = processBig(makeBig(30000));
io.print("r4: " + r4);
const r5 = processBig(makeBig(30000));
io.print("r5: " + r5);
const r6 = processBig(makeBig(30000));
io.print("r6: " + r6);
const r7 = processBig(makeBig(30000));
io.print("r7: " + r7);
const r8 = processBig(makeBig(30000));
io.print("r8: " + r8);
const r9 = processBig(makeBig(30000));
io.print("r9: " + r9);
const r10 = processBig(makeBig(30000));
io.print("r10: " + r10);
const r11 = processBig(makeBig(30000));
io.print("r11: " + r11);
const r12 = processBig(makeBig(30000));
io.print("r12: " + r12);
const r13 = processBig(makeBig(30000));
io.print("r13: " + r13);
const r14 = processBig(makeBig(30000));
io.print("r14: " + r14);
const r15 = processBig(makeBig(30000));
io.print("r15: " + r15);
const r16 = processBig(makeBig(30000));
io.print("r16: " + r16);
const r17 = processBig(makeBig(30000));
io.print("r17: " + r17);
const r18 = processBig(makeBig(30000));
io.print("r18: " + r18);
const r19 = processBig(makeBig(30000));
io.print("r19: " + r19);

io.print("Done sequential top-level!");

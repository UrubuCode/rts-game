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

let step = 0;
while (step < 20) {
  const len = processBig(makeBig(30000));
  io.print("Step " + step + " processed len=" + len);
  step = step + 1;
}
io.print("Finished without heap exhaustion!");

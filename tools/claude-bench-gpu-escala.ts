// Só o lado GPU, em n alto: é onde o grid tem de aparecer.
import io from "../compat/io.ts";
import { scene } from "../editor/control/session";
import { rbAvailable, rbInit, rbSetBody, rbUpload, rbService, rbSyncStatics } from "../engine/rigid/gpurigid";

function gpu(n: number, frames: number): number {
  rbInit(n);
  const lado = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    rbSetBody(i, (i % lado) * 1.5 - lado * 0.75, 8.0 + ((i / lado) | 0) * 0.05,
              (((i / lado) | 0)) * 1.5 - lado * 0.75, 0.25, 0.25, 0.25, 1.0);
  }
  rbUpload();
  rbSyncStatics(scene);
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) { rbService(1); }
  return (Date.now() - t0) / frames;
}

if (rbAvailable() === 0) { io.print("sem GPU"); } else {
  io.print("   n    |  GPU ms/frame");
  for (const n of [1000, 2000, 4000, 8000, 16000, 32000]) {
    io.print(("" + n).padEnd(8) + "|" + gpu(n, 60).toFixed(2).padStart(9));
  }
}

// vsync em TEMPO DE EXECUÇÃO pelo mesmo caminho do comando WS `vsync` (gpu3d.setVsync):
// liga (padrão), desliga no meio do laço, religa. Task 10.5, passo 5.
//   ui_fixture.exe bench/claude-bench-vsync-runtime.ts
import { openWindow, isOpen, pump, beginFrame, endFrame, setVsync as eguiSetVsync } from "rts:egui";
import process from "@compat/process.ts";
import { setVsync } from "@engine/render/gpu3d";
const win = openWindow("BENCH-VSYNC", 400, 300, 0);
function medir(q: number): f64 {
  let f = 0; const t0 = performance.now();
  while (f < q && isOpen(win)) { pump(win); beginFrame(win); endFrame(win); f = f + 1; }
  return (performance.now() - t0) / q;
}
medir(30);
const liga = medir(120);
setVsync(win, 0); medir(10);
const desl = medir(600);
setVsync(win, 1); medir(10);
const religa = medir(120);
// o nativo também aceita boolean agora
eguiSetVsync(win, false); medir(10);
const bool0 = medir(600);
eguiSetVsync(win, true); medir(10);
println("[vsync-runtime] ligado " + liga.toFixed(2) + " ms | vsync 0 em runtime " + desl.toFixed(2) + " ms | religado " + religa.toFixed(2) + " ms | setVsync(false) " + bool0.toFixed(2) + " ms");

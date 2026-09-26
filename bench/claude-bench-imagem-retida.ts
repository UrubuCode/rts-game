// Custo de desenhar N miniaturas 48×48 por quadro: `imagem` (textura nova por
// chamada) contra `imagemId` (textura registrada uma vez). Task 10.5, passo 3.
//   ui_fixture.exe bench/claude-bench-imagem-retida.ts
import { openWindow, isOpen, pump, beginFrame, endFrame, setVsync } from "rts:egui";
import { janela2D, imagemEm, imagem, imagemId, registrarImagem } from "@compat/draw2d.ts";
const win = openWindow("BENCH-IMAGEM-RETIDA", 900, 600, 0);
setVsync(win, 0);
janela2D(win);
const N = 40; const LADO = 48; const QUADROS = 600;
const px = new Uint8Array(LADO * LADO * 4);
let i = 0; while (i < px.length) { px[i] = (i * 7) & 255; i = i + 1; }
const ids: number[] = [];
function medir(retida: number): f64 {
  let f = 0; let t0: f64 = 0.0;
  while (f < QUADROS + 60 && isOpen(win)) {
    if (f === 60) t0 = performance.now();
    pump(win); beginFrame(win);
    let k = 0;
    while (k < N) {
      imagemEm((k % 10) * 60.0 + 10.0, ((k / 10) | 0) * 60.0 + 10.0, 48.0, 48.0);
      if (retida !== 0) { if (ids.length <= k) ids.push(registrarImagem(px, LADO, LADO)); imagemId(ids[k]); }
      else imagem(px, LADO, LADO);
      k = k + 1;
    }
    endFrame(win); f = f + 1;
  }
  return (performance.now() - t0) / QUADROS;
}
const a = medir(0); const b = medir(1); const c = medir(0); const d = medir(1);
println("[imagem-retida] N=" + N + " upload por quadro: " + a.toFixed(3) + " / " + c.toFixed(3) + " ms/quadro; retida: " + b.toFixed(3) + " / " + d.toFixed(3) + " ms/quadro");

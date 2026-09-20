// Onde estão os 4,6 us de um drawRect: no objeto que o TS constrói por chamada,
// ou do lado nativo (empréstimo do contexto + 8 leituras de membro + 2 Vec)?
import { openWindow, isOpen, pump, beginFrame, endFrame, drawRect, winWidth } from "rts:egui";
const win = openWindow("bench 2d 2", 800, 600, 0);
const N = 2000;
// UM objeto reusado: se o custo cair, ele estava na construção/alocação
const fixo = { x: 1.0, y: 1.0, w: 2.0, h: 2.0, fill: 0x40404080, strokeW: 0, stroke: 0, radius: 0 };
// objeto MENOR: 4 campos em vez de 8, para ver quanto custa CADA leitura nativa
const curto = { x: 1.0, y: 1.0, w: 2.0, h: 2.0 };
let frame = 0;
while (isOpen(win) && frame < 40) {
  pump(win); beginFrame(win);
  const t0 = performance.now();
  let i = 0;
  while (i < N) { drawRect(win, { x: 1.0, y: 1.0, w: 2.0, h: 2.0, fill: 0x40404080, strokeW: 0, stroke: 0, radius: 0 }); i = i + 1; }
  const t1 = performance.now();
  i = 0;
  while (i < N) { drawRect(win, fixo); i = i + 1; }
  const t2 = performance.now();
  i = 0;
  while (i < N) { drawRect(win, curto); i = i + 1; }
  const t3 = performance.now();
  i = 0;
  let acc = 0;
  while (i < N) { acc = acc + winWidth(win); i = i + 1; }   // nativo SEM objeto nenhum
  const t4 = performance.now();
  if (frame === 39) {
    println("literal por chamada : " + ((t1 - t0) * 1000.0 / N).toFixed(3) + " us");
    println("objeto reusado (8)  : " + ((t2 - t1) * 1000.0 / N).toFixed(3) + " us");
    println("objeto reusado (4)  : " + ((t3 - t2) * 1000.0 / N).toFixed(3) + " us");
    println("winWidth (0 campos) : " + ((t4 - t3) * 1000.0 / N).toFixed(3) + " us   acc=" + acc);
  }
  endFrame(win); frame = frame + 1;
}

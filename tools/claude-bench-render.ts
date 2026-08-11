// Quanto custa DESENHAR n objetos, sem física nenhuma.
//
// A física já foi medida (12,05 ms na CPU, 0,35 na GPU com 500 corpos). Se o
// editor fica em 40 fps (25 ms/frame) com a física na GPU, o resto do frame é
// isto — e "isto" nunca tinha sido medido.
//
// Um `drawMesh` por objeto atravessa a fronteira TS→nativo uma vez, e do lado
// de lá `options()` lê 12 membros com `get_member`, cada um internando o nome.
// Com 500 objetos são 6000 internações por frame só aqui.
import {
  openWindow, pump, isOpen, close, beginFrame, endFrame,
  meshUpload, setCamera, setLight, drawMesh, drawText, drawRect,
} from "rts:egui";

function esfera(h: number, v: number): Float32Array {
  const d: number[] = [];
  for (let i = 0; i <= v; i++) {
    const phi = (i / v) * Math.PI;
    for (let j = 0; j <= h; j++) {
      const th = (j / h) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      d.push(x, y, z, x, y, z, j / h, i / v);
    }
  }
  return new Float32Array(d);
}
function idx(h: number, v: number): Uint32Array {
  const a: number[] = [];
  for (let i = 0; i < v; i++) for (let j = 0; j < h; j++) {
    const p = i * (h + 1) + j, q = p + h + 1;
    a.push(p, q, p + 1, q, q + 1, p + 1);
  }
  return new Uint32Array(a);
}

const win = openWindow("bench de render", 900, 600, 0);
if (win <= 0) { println("sem janela"); } else {
  const malha = meshUpload(win, esfera(16, 12), idx(16, 12));
  setLight(win, { x: 8, y: 18, z: -6, ambient: 0.3 });

  println("   n   | ms/frame |  fps  | so o drawMesh");
  println("-------+----------+-------+---------------");
  for (const n of [0, 100, 250, 500, 1000, 2000]) {
    // Aquecimento: o primeiro frame paga a criação de recursos.
    for (let w = 0; w < 10; w++) {
      pump(win); beginFrame(win);
      setCamera(win, { x: 0, y: 12, z: 30, yaw: Math.PI, pitch: -0.3, fov: 1.0, aspect: 1.5 });
      for (let i = 0; i < n; i++) drawMesh(win, { mesh: malha, x: (i % 40) - 20, y: 0, z: ((i / 40) | 0) - 12, color: 0xFF4FC3F7 });
      endFrame(win);
    }
    const F = 60;
    const t0 = Date.now();
    for (let f = 0; f < F; f++) {
      pump(win); beginFrame(win);
      setCamera(win, { x: 0, y: 12, z: 30, yaw: Math.PI, pitch: -0.3, fov: 1.0, aspect: 1.5 });
      for (let i = 0; i < n; i++) drawMesh(win, { mesh: malha, x: (i % 40) - 20, y: 0, z: ((i / 40) | 0) - 12, color: 0xFF4FC3F7 });
      drawText(win, { x: 20, y: 20, size: 16, color: 0xFFFFFFFF, text: "n=" + n });
      endFrame(win);
    }
    const ms = (Date.now() - t0) / F;
    println(("" + n).padEnd(7) + "|" + ms.toFixed(2).padStart(9) + " |" + (ms > 0 ? (1000 / ms).toFixed(0) : "-").padStart(6) + " | " + n + " chamadas");
  }
  close(win);
}

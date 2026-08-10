// REPRO MÍNIMO: o render corrompe um buffer de rts:gpu que ninguém toca.
//
// Sem física, sem kernel de compute, sem água. Um buffer é escrito UMA vez com
// um padrão conhecido e depois só LIDO, todo frame. Nada mais escreve nele.
// Em paralelo, a janela desenha N cubos por frame.
//
// Medido antes disto: a corrupção chega sempre por volta de 166 300 DRAWS
// ACUMULADOS — não por tempo (21,8 s com 128/frame contra 8,0 s com 348/frame)
// e não por memória (estável em ~185 MB).
import io from "../../compat/io.ts";
import math from "../../compat/math.ts";
import gpu from "rts:gpu";
import buffer from "rts:buffer";
import { initMeshes, setCam, setLgt, drawGPU } from "./engine/render/gpu3d";

const N = 352;                 // mesmos 352 vec4 do buffer do rígido
const BYTES = N * 16;
const DRAWS = 348;             // cubos desenhados por frame

if (gpu.available() === 0) { io.print("sem GPU"); } else {
  const g = gpu.buffer(BYTES);
  const cpu = buffer.alloc(BYTES);
  // padrão conhecido: cada float é o seu próprio índice
  let i = 0;
  while (i < N * 4) { buffer.write_f32(cpu, i * 4, i * 1.0); i = i + 1; }
  gpu.write(g, cpu, BYTES);

  const app = createAppAt("repro minimo — buffer intocado + N draws", 900, 560, 60, 40);
  initMeshes(app.win);
  setCam(app.win, 0.0, 8.0, 0.0 - 24.0, 0.0, 0.0 - 0.2, 1.0, 900.0 / 560.0);
  setLgt(app.win, 10.0, 20.0, 0.0 - 10.0, 0.4);

  const leitura = buffer.alloc(BYTES);
  let f = 0;
  let quebrou = -1;
  while (f < 900 && app.running()) {
    if (!app.beginFrame()) break;
    // LÊ o buffer que ninguém escreveu desde o início e confere o padrão.
    gpu.read(g, leitura, BYTES);
    let ruins = 0;
    let k = 0;
    while (k < N * 4) {
      const v = buffer.read_f32(leitura, k * 4);
      if (v !== k * 1.0) { ruins = ruins + 1; }
      k = k + 1;
    }
    if (ruins > 0 && quebrou < 0) {
      quebrou = f;
      io.print("[repro] CORROMPEU no frame " + f + ": " + ruins + "/" + (N * 4)
               + " floats errados | draws acumulados = " + (f * DRAWS));
      io.print("        float[0] = " + buffer.read_f32(leitura, 0) + " (esperado 0)");
      io.print("        float[1] = " + buffer.read_f32(leitura, 4) + " (esperado 1)");
      io.print("        float[2] = " + buffer.read_f32(leitura, 8) + " (esperado 2)");
    }
    let d = 0;
    while (d < DRAWS) {
      drawGPU(app.win, 1, (d % 20) * 2.0 - 20.0, 1.0, ((d / 20) | 0) * 2.0 - 16.0,
              0.0, 0.0, 1.0, 1.0, 1.0, 0xFFB0B0B0, 0, 0);
      d = d + 1;
    }
    app.endFrame();
    f = f + 1;
  }
  io.print(quebrou < 0
    ? "[repro] " + f + " frames (" + (f * DRAWS) + " draws): buffer INTACTO"
    : "[repro] corrompeu no frame " + quebrou + " — o RENDER corrompe um buffer de compute que ninguem usa");
  app.close();
}

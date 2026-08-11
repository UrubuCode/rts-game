// A aritmética de frustum ABERTA dentro de `drawSceneObjects` responde o mesmo
// que `inFrustumFast`? Se não responder, o editor desenha um conjunto diferente
// de objetos — e é a ÚNICA parte do laço que foi reescrita (cor, seleção,
// material e os argumentos de `drawGPU` saíram copiados).
//
// Varre 500 posições × 12 orientações de câmera e compara as duas respostas uma
// a uma. Um desacordo é uma falha, não uma aproximação.

import io from "../compat/io.ts";
import { frustumBegin, frustumParams, inFrustumFast } from "../engine/render/gpu3d";

const fp: f64[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/// A cópia exata do teste que vive dentro de `drawSceneObjects`.
function inlineTest(wx: f64, wy: f64, wz: f64, r: f64,
                    cx: f64, cy: f64, cz: f64, cyw: f64, syw: f64,
                    cpt: f64, spt: f64, tanH: f64, tanV: f64): number {
  const dx: f64 = wx - cx; const dy: f64 = wy - cy; const dz: f64 = wz - cz;
  const x1: f64 = dx * cyw - dz * syw;
  const z1: f64 = dx * syw + dz * cyw;
  const y2: f64 = dy * cpt - z1 * spt;
  const z2: f64 = dy * spt + z1 * cpt;
  if (z2 + r < 0.1) return 0;
  if (z2 - r > 500.0) return 0;
  const limH: f64 = z2 * tanH;
  if (x1 - r > limH) return 0;
  if (0.0 - x1 - r > limH) return 0;
  const limV: f64 = z2 * tanV;
  if (y2 - r > limV) return 0;
  if (0.0 - y2 - r > limV) return 0;
  return 1;
}

let casos = 0;
let visiveis = 0;
let falhas = 0;

// Orientações variadas DE PROPÓSITO: olhando para a cena, para longe, de cima,
// de baixo e de lado. Se todas descartassem tudo, o teste passaria sem provar
// nada — por isso o total de "visiveis" é impresso e checado no fim.
const yaws: f64[] = [0.0, 0.8, 1.5708, 3.14159, 4.2, 5.9];
const pitches: f64[] = [0.0 - 0.4, 0.6];

let yi = 0;
while (yi < yaws.length) {
  let pi = 0;
  while (pi < pitches.length) {
    frustumBegin(3.0, 6.0, 0.0 - 12.0, yaws[yi], pitches[pi], 1.05, 1.6);
    frustumParams(fp);
    let i = 0;
    while (i < 500) {
      const wx: f64 = (i % 25) * 2.0 - 25.0;
      const wy: f64 = ((i % 7) - 3) * 1.5;
      const wz: f64 = ((i / 25) | 0) * 2.0 - 20.0;
      const r: f64 = 0.4 + (i % 5) * 0.3;
      const a = inFrustumFast(wx, wy, wz, r);
      const b = inlineTest(wx, wy, wz, r, fp[0], fp[1], fp[2], fp[3], fp[4], fp[5], fp[6], fp[7], fp[8]);
      casos = casos + 1;
      if (a !== 0) visiveis = visiveis + 1;
      if (a !== b) {
        falhas = falhas + 1;
        if (falhas <= 3) {
          io.print("  DESACORDO em yaw=" + yaws[yi] + " pitch=" + pitches[pi] +
                   " obj=" + i + " inFrustumFast=" + a + " inline=" + b);
        }
      }
      i = i + 1;
    }
    pi = pi + 1;
  }
  yi = yi + 1;
}

io.print("[frustum] " + casos + " comparacoes, " + visiveis + " visiveis, " + falhas + " desacordos");
// Se NADA fosse visível o teste não provaria nada — a igualdade seria trivial.
if (visiveis < 100) io.print("[FALHOU] o teste nao exercitou o caso visivel");
else if (falhas !== 0) io.print("[FALHOU] a conta aberta diverge de inFrustumFast");
else io.print("[PASSOU] a conta aberta responde identico em todos os casos");

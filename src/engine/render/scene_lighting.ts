// Luz da cena por frame: coleta os Lights (até 8) e envia ao renderer; sem
// nenhum Light, a luz pontual legada (bloco "light" da cena / ws `light`) vale
// como antes. Sem alocação: buffers do módulo.
import type { Scene } from "../core/scene";
import { MAX_LUZES, FLOATS_POR_LUZ, LUZ_DIRECIONAL } from "../core/light";
import { setLightsBuf, setLgtBuf, setShadowBuf } from "./gpu3d";

/// Centro (y) e raio da caixa do shadow map — os valores que main.ts/game.ts usavam.
export const SOMBRA_CENTRO_Y: number = 1.0;
export const SOMBRA_RAIO: number = 24.0;
const luzBuf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const sombraBuf = new Float64Array(7);

export function luzesColetadas(): Float64Array { return luzBuf; }
export function sombraAtual(): Float64Array { return sombraBuf; }

/// `cam` = [x, y, z] de quem vê; `legado` = [x, y, z, ambiente] da luz pontual antiga.
export function aplicarLuzes(win: number, sc: Scene, cam: Float64Array, legado: Float64Array): number {
  const n = sc.collectLights(luzBuf, cam);
  setLightsBuf(win, luzBuf, n);
  setLgtBuf(win, legado);
  sombraBuf[3] = 0.0; sombraBuf[4] = SOMBRA_CENTRO_Y; sombraBuf[5] = 0.0; sombraBuf[6] = SOMBRA_RAIO;
  if (n === 0) {
    sombraBuf[0] = 0.0 - legado[0]; sombraBuf[1] = 0.0 - legado[1]; sombraBuf[2] = 0.0 - legado[2];
  } else if (luzBuf[0] === LUZ_DIRECIONAL && luzBuf[14] !== 0.0) {
    sombraBuf[0] = luzBuf[4]; sombraBuf[1] = luzBuf[5]; sombraBuf[2] = luzBuf[6];
  } else {
    sombraBuf[6] = 0.0;
  }
  setShadowBuf(win, sombraBuf);
  return n;
}

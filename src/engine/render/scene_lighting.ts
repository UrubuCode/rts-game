// Luz da cena por frame: coleta os Lights (até 8) e envia ao renderer; sem
// nenhum Light, a luz pontual legada (bloco "light" da cena / ws `light`) vale
// como antes. Sem alocação: buffers do módulo.
import type { Scene } from "../core/scene";
import { MAX_LUZES, FLOATS_POR_LUZ, LUZ_DIRECIONAL } from "../core/light";
import { setLightsBuf, setLgtBuf, setShadowBuf, setSkyBuf, setFogBuf, loadTexture } from "./gpu3d";
import { ambienteSync } from "../core/ambiente";
import { logWarn } from "../core/logger";

/// Centro (y) e raio da caixa do shadow map — os valores que main.ts/game.ts usavam.
export const SOMBRA_CENTRO_Y: number = 1.0;
export const SOMBRA_RAIO: number = 24.0;
const luzBuf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const sombraBuf = new Float64Array(7);
let ultimaN = 0;

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
  ultimaN = n;
  return n;
}

/// Direção padrão do sol sem direcional (a mesma de SOL_PADRAO no runtime).
const SOL_PADRAO_X: number = 0.0 - 0.3015113;
const SOL_PADRAO_Y: number = 0.0 - 0.9045340;
const SOL_PADRAO_Z: number = 0.0 - 0.3015113;
const solDir = new Float64Array(3);
let texturaCaminho = "";
let texturaId = 0;

/// Id da textura do panorama; carrega uma vez por caminho (0 = sem textura).
function texturaDoCeu(win: number, caminho: string): number {
  if (caminho !== texturaCaminho) {
    texturaCaminho = caminho; texturaId = 0;
    if (caminho.length > 0) {
      try { texturaId = loadTexture(win, caminho); }
      catch (e) { logWarn("Céu: textura '" + caminho + "' não carregou: " + String(e)); }
    }
  }
  return texturaId;
}
/// Envia setSky/setFog só quando o Ambiente (ou a direção do sol, ou a textura)
/// mudou. Trocar de cena copia os campos para o MESMO `scene.ambiente`, e a
/// comparação detecta a mudança.
export function aplicarAmbiente(win: number, sc: Scene): number {
  if (ultimaN > 0 && luzBuf[0] === LUZ_DIRECIONAL) { solDir[0] = luzBuf[4]; solDir[1] = luzBuf[5]; solDir[2] = luzBuf[6]; }
  else { solDir[0] = SOL_PADRAO_X; solDir[1] = SOL_PADRAO_Y; solDir[2] = SOL_PADRAO_Z; }
  const a = sc.ambiente;
  const bits = ambienteSync(a, solDir, texturaDoCeu(win, a.ceu.textura));
  if ((bits & 1) !== 0) setSkyBuf(win, a.pacote);
  if ((bits & 2) !== 0) setFogBuf(win, a.neblinaPacote);
  return bits;
}

// Luz da cena por frame: coleta os Lights (até 8) e envia ao renderer; sem
// nenhum Light, a luz pontual legada (bloco "light" da cena / ws `light`) vale
// como antes. Sem alocação: buffers do módulo.
import type { Scene } from "../core/scene";
import { registrarFalhaAsset } from "@engine/core/falhas";
import { MAX_LUZES, FLOATS_POR_LUZ, LUZ_DIRECIONAL, direcaoSol } from "../core/light";
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

// ── CACHE DO ENVIO (Task 10.5) ─────────────────────────────────────────────
// A coleta roda todo quadro (barata: pose e campos de cada Light em buffer fixo,
// sem alocação); o ENVIO ao renderer (setLights/setLight/setShadow) só sai quando
// o pacote coletado difere do último enviado. Uma luz parada e uma câmera parada
// não reenviam nada; mover a câmera só reenvia se a ORDEM das pontuais (por
// distância) mudar, porque o pacote é o mesmo quando a ordem é a mesma. Sem
// `markDirty`: quem mexe numa luz não precisa avisar ninguém — a comparação vê.
const enviadoLuz = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const enviadoLegado = new Float64Array(4);
const enviadoSombra = new Float64Array(7);
let enviadoN = 0 - 1;
let enviadoJanela = 0 - 1;
let enviadoCena: Scene | null = null;
let envios = 0;

/// Quantos envios (setLights+setLight+setShadow) já saíram — para testes e bench.
export function enviosDeLuz(): number { return envios; }
/// Esquece o último envio: o próximo `aplicarLuzes` reenvia tudo.
export function reenviarLuzes(): void { enviadoN = 0 - 1; }

function igual(a: Float64Array, b: Float64Array, n: number): boolean {
  let i = 0;
  while (i < n) { if (a[i] !== b[i]) return false; i = i + 1; }
  return true;
}
function copiar(dst: Float64Array, src: Float64Array, n: number): void {
  let i = 0;
  while (i < n) { dst[i] = src[i]; i = i + 1; }
}

/// `cam` = [x, y, z] de quem vê; `legado` = [x, y, z, ambiente] da luz pontual antiga.
export function aplicarLuzes(win: number, sc: Scene, cam: Float64Array, legado: Float64Array): number {
  const n = sc.collectLights(luzBuf, cam);
  sombraBuf[3] = 0.0; sombraBuf[4] = SOMBRA_CENTRO_Y; sombraBuf[5] = 0.0; sombraBuf[6] = SOMBRA_RAIO;
  if (n === 0) {
    sombraBuf[0] = 0.0 - legado[0]; sombraBuf[1] = 0.0 - legado[1]; sombraBuf[2] = 0.0 - legado[2];
  } else if (luzBuf[0] === LUZ_DIRECIONAL && luzBuf[14] !== 0.0) {
    sombraBuf[0] = luzBuf[4]; sombraBuf[1] = luzBuf[5]; sombraBuf[2] = luzBuf[6];
  } else {
    sombraBuf[0] = 0.0; sombraBuf[1] = 0.0; sombraBuf[2] = 0.0; sombraBuf[6] = 0.0;
  }
  ultimaN = n;
  const nf = n * FLOATS_POR_LUZ;
  if (enviadoN === n && enviadoJanela === win && enviadoCena === sc &&
      igual(luzBuf, enviadoLuz, nf) && igual(legado, enviadoLegado, 4) && igual(sombraBuf, enviadoSombra, 7)) return n;
  setLightsBuf(win, luzBuf, n);
  setLgtBuf(win, legado);
  setShadowBuf(win, sombraBuf);
  copiar(enviadoLuz, luzBuf, nf); copiar(enviadoLegado, legado, 4); copiar(enviadoSombra, sombraBuf, 7);
  enviadoN = n; enviadoJanela = win; enviadoCena = sc;
  envios = envios + 1;
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
/// `loadTexture` devolvendo <= 0 é tratado como falha (não deveria acontecer,
/// mas um id inválido no setSky quebraria o shader): fixa em 0 e avisa uma vez
/// só, pela mesma guarda de caminho (não repete por frame).
function texturaDoCeu(win: number, caminho: string): number {
  if (caminho !== texturaCaminho) {
    texturaCaminho = caminho; texturaId = 0;
    if (caminho.length > 0) carregarTexturaDoCeu(win, caminho);
  }
  return texturaId;
}
/// Fora de `texturaDoCeu` (que roda por quadro): no RTS uma função que contém
/// `try/catch` aloca a cada chamada, mesmo sem entrar no `try`.
function carregarTexturaDoCeu(win: number, caminho: string): void {
  try {
    const id = loadTexture(win, caminho);
    if (id > 0) texturaId = id;
    else { logWarn("Céu: textura '" + caminho + "' carregou com id invalido (" + id + "); usando sem textura."); registrarFalhaAsset("ceu", caminho, "id invalido (" + id + ")"); }
  }
  catch (e) { logWarn("Céu: textura '" + caminho + "' não carregou: " + String(e)); registrarFalhaAsset("ceu", caminho, String(e)); }
}
/// Envia setSky/setFog só quando o Ambiente (ou a direção do sol, ou a textura)
/// mudou. Trocar de cena copia os campos para o MESMO `scene.ambiente`, e a
/// comparação detecta a mudança.
///
/// ACOPLAMENTO DE ORDEM: chame isto DEPOIS de `aplicarLuzes` no mesmo frame —
/// o fallback do sol (quando `ambiente.sol` está vazio ou não acha a direcional
/// nomeada) usa `ultimaN`/`luzBuf`, que só `aplicarLuzes` preenche.
export function aplicarAmbiente(win: number, sc: Scene): number {
  // Prioridade da direção do sol do céu (independente do slot 0/sombra):
  // 1) a direcional nomeada em `ambiente.sol`; 2) a principal da última
  // `aplicarLuzes` (slot 0, escolhida por sombra); 3) SOL_PADRAO fixo.
  if (direcaoSol(sc, sc.ambiente.sol, solDir) === 0) {
    if (ultimaN > 0 && luzBuf[0] === LUZ_DIRECIONAL) { solDir[0] = luzBuf[4]; solDir[1] = luzBuf[5]; solDir[2] = luzBuf[6]; }
    else { solDir[0] = SOL_PADRAO_X; solDir[1] = SOL_PADRAO_Y; solDir[2] = SOL_PADRAO_Z; }
  }
  const a = sc.ambiente;
  const bits = ambienteSync(a, solDir, texturaDoCeu(win, a.ceu.textura));
  if ((bits & 1) !== 0) setSkyBuf(win, a.pacote);
  if ((bits & 2) !== 0) setFogBuf(win, a.neblinaPacote);
  return bits;
}

// Desenhos do cliente local fora da cena: arma em primeira pessoa e efeitos
// (marcas de tiro, traçadores, explosões). Um buffer DRAW_FLOATS reaproveitado
// e funções de no máximo 4 parâmetros (5+ alocam por chamada no RTS).
import { drawGPUBuf, DRAW_FLOATS, D_X, D_Y, D_Z, D_RX, D_RY, D_SX, D_SY, D_SZ, D_COR, D_EMISSIVO, D_TEX, D_TILE } from "@engine/render/gpu3d";
import { FpsWorld } from "./shared/world";
import { fpsModelos, fpsDesenharModelo, FPS_ESCALA_ARMA_TELA, FPS_GIRO_ARMA } from "./modelos";
import { FPS_CAM_X, FPS_CAM_Y, FPS_CAM_Z, FPS_CAM_YAW, FPS_CAM_PITCH } from "./render";
import {
  FPS_POOL_EFEITOS, FPS_EFEITO_MARCA, FPS_EFEITO_TRACADOR, FPS_EFEITO_EXPLOSAO, FPS_VIDA_EXPLOSAO, FPS_RAIO_EXPLOSAO,
} from "./shared/config";

// ── arma em primeira pessoa ────────────────────────────────────────────────
/// Posição da arma em primeira pessoa, relativa à câmera (unidades do mundo).
const FPS_ARMA_TELA_FRENTE: f64 = 0.5;
const FPS_ARMA_TELA_LADO: f64 = 0.2;
const FPS_ARMA_TELA_BAIXO: f64 = 0.17;

// ── efeitos ──────────────────────────────────────────────────────────────────
const FPS_COR_MARCA = 0x202020;
const FPS_COR_TRACADOR = 0xFFE080;
const FPS_COR_EXPLOSAO = 0xFF8020;
const FPS_TAM_MARCA: f64 = 0.12;
const FPS_TAM_TRACADOR: f64 = 0.05;
const FPS_PONTOS_TRACADOR = 6;
const FPS_MALHA_CUBO = 1;
const FPS_MALHA_ESFERA = 4;

/// Transform/material dos desenhos daqui, reaproveitado.
const fpsDrawEfeito = new Float64Array(DRAW_FLOATS);
/// Janela do `fpsDesenharEfeitos` em andamento (evita o 5º parâmetro).
let fpsEfJanela = 0;

/// Arma em primeira pessoa: canto inferior direito da vista, com a MESMA base
/// da câmera do renderer (rts-egui `view_proj`: direita (cos, 0, -sin), cima
/// (-sin·sp, cp, -cos·sp), frente (sin·cp, sp, cos·cp); pitch > 0 olha para
/// cima). Gira só em yaw: a matriz de modelo aplica o pitch no eixo X do MUNDO
/// depois do yaw, o que só inclina certo com yaw = 0. `cam` = `fpsCamera`.
export function fpsDesenharArmaNaTela(win: number, cam: Float64Array): void {
  if (!fpsModelos.pronto || fpsModelos.armas.length === 0) return;
  const yaw = cam[FPS_CAM_YAW]; const pitch = cam[FPS_CAM_PITCH];
  const sy = Math.sin(yaw); const cyw = Math.cos(yaw);
  const sp = Math.sin(pitch); const cp = Math.cos(pitch);
  const fx = sy * cp; const fy = sp; const fz = cyw * cp;
  const rx = cyw; const rz = 0.0 - sy;
  const ux = 0.0 - sy * sp; const uy = cp; const uz = 0.0 - cyw * sp;
  const d = fpsDrawEfeito;
  d[D_X] = cam[FPS_CAM_X] + fx * FPS_ARMA_TELA_FRENTE + rx * FPS_ARMA_TELA_LADO - ux * FPS_ARMA_TELA_BAIXO;
  d[D_Y] = cam[FPS_CAM_Y] + fy * FPS_ARMA_TELA_FRENTE - uy * FPS_ARMA_TELA_BAIXO;
  d[D_Z] = cam[FPS_CAM_Z] + fz * FPS_ARMA_TELA_FRENTE + rz * FPS_ARMA_TELA_LADO - uz * FPS_ARMA_TELA_BAIXO;
  d[D_RX] = 0.0; d[D_RY] = yaw + FPS_GIRO_ARMA;
  d[D_SX] = FPS_ESCALA_ARMA_TELA; d[D_SY] = FPS_ESCALA_ARMA_TELA; d[D_SZ] = FPS_ESCALA_ARMA_TELA;
  fpsDesenharModelo(win, fpsModelos.armas[0], d);
}

/// Todos os efeitos vivos do mundo.
export function fpsDesenharEfeitos(win: number, m: FpsWorld): void {
  fpsEfJanela = win;
  let e = 0;
  while (e < FPS_POOL_EFEITOS) {
    if (m.efVida[e] > 0.0) fpsDesenharEfeito(m, e);
    e = e + 1;
  }
}

/// Cubo/esfera com a posição já em `fpsDrawEfeito`: tamanho, cor e emissivo.
function fpsDesenharForma(malha: number, tam: f64, cor: number, emissivo: number): void {
  const d = fpsDrawEfeito;
  d[D_RX] = 0.0; d[D_RY] = 0.0; d[D_SX] = tam; d[D_SY] = tam; d[D_SZ] = tam;
  d[D_COR] = cor; d[D_EMISSIVO] = emissivo; d[D_TEX] = 0; d[D_TILE] = 0.0;
  drawGPUBuf(fpsEfJanela, malha, d);
}

function fpsDesenharEfeito(m: FpsWorld, e: number): void {
  const tipo = m.efTipo[e];
  const d = fpsDrawEfeito;
  if (tipo === FPS_EFEITO_MARCA) {
    d[D_X] = m.efX0[e]; d[D_Y] = m.efY0[e]; d[D_Z] = m.efZ0[e];
    fpsDesenharForma(FPS_MALHA_CUBO, FPS_TAM_MARCA, FPS_COR_MARCA, 0);
  } else if (tipo === FPS_EFEITO_TRACADOR) {
    let k = 1;
    while (k <= FPS_PONTOS_TRACADOR) {
      const f = k / (FPS_PONTOS_TRACADOR + 1.0);
      d[D_X] = m.efX0[e] + (m.efX1[e] - m.efX0[e]) * f;
      d[D_Y] = m.efY0[e] + (m.efY1[e] - m.efY0[e]) * f;
      d[D_Z] = m.efZ0[e] + (m.efZ1[e] - m.efZ0[e]) * f;
      fpsDesenharForma(FPS_MALHA_CUBO, FPS_TAM_TRACADOR, FPS_COR_TRACADOR, 1);
      k = k + 1;
    }
  } else if (tipo === FPS_EFEITO_EXPLOSAO) {
    const fr = m.efVida[e] / FPS_VIDA_EXPLOSAO;
    d[D_X] = m.efX0[e]; d[D_Y] = m.efY0[e]; d[D_Z] = m.efZ0[e];
    fpsDesenharForma(FPS_MALHA_ESFERA, FPS_RAIO_EXPLOSAO * 2.0 * (1.0 - fr * 0.5), FPS_COR_EXPLOSAO, 1);
  }
}

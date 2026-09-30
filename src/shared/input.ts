// Entrada de um jogador num tick. É a ÚNICA coisa que o cliente manda para a
// simulação (e, na entrega 2, para o servidor).
import { NetWriter, NetReader } from "../net/buffer";
import { FPS_ESCALA_PITCH_REDE } from "./config";

export interface FpsPlayerInput {
  seq: number;
  frente: number;     // -1, 0 ou 1
  lado: number;       // -1 (esquerda), 0 ou 1 (direita)
  pulo: boolean;
  yaw: f64;           // rad; frente = (sin yaw, cos yaw)
  pitch: f64;         // rad; positivo olha para cima
  atirar: boolean;
  recarregar: boolean;
  granada: boolean;
}

/// Bordas de tecla (apertou neste frame) ficam guardadas até um tick
/// consumi-las: num frame sem tick, o aperto não pode se perder.
export function fpsAcumularBorda(atual: boolean, apertouAgora: boolean): boolean {
  return atual || apertouAgora;
}

export function fpsInputVazio(): FpsPlayerInput {
  return {
    seq: 0, frente: 0, lado: 0, pulo: false, yaw: 0.0, pitch: 0.0,
    atirar: false, recarregar: false, granada: false,
  };
}

/// Formato de rede do input: 7 bytes (frente+1, lado+1, bits, yaw u16, pitch i16).
export const FPS_TAM_INPUT_REDE = 7;
const FPS_BIT_PULO = 1;
const FPS_BIT_ATIRAR = 2;
const FPS_BIT_RECARREGAR = 4;
const FPS_BIT_GRANADA = 8;

export function fpsEscreverInput(w: NetWriter, inp: FpsPlayerInput): void {
  w.u8(inp.frente + 1);
  w.u8(inp.lado + 1);
  let bits = 0;
  if (inp.pulo) bits = bits | FPS_BIT_PULO;
  if (inp.atirar) bits = bits | FPS_BIT_ATIRAR;
  if (inp.recarregar) bits = bits | FPS_BIT_RECARREGAR;
  if (inp.granada) bits = bits | FPS_BIT_GRANADA;
  w.u8(bits);
  w.angulo(inp.yaw);
  w.i16(Math.round(inp.pitch * FPS_ESCALA_PITCH_REDE));
}

export function fpsLerInput(r: NetReader, inp: FpsPlayerInput): void {
  const frente = r.u8() - 1;
  const lado = r.u8() - 1;
  const bits = r.u8();
  const yaw = r.angulo();
  const pitch = r.i16() / FPS_ESCALA_PITCH_REDE;
  if (r.erro) return;
  inp.frente = frente < -1 ? -1 : (frente > 1 ? 1 : frente);
  inp.lado = lado < -1 ? -1 : (lado > 1 ? 1 : lado);
  inp.pulo = (bits & FPS_BIT_PULO) !== 0;
  inp.atirar = (bits & FPS_BIT_ATIRAR) !== 0;
  inp.recarregar = (bits & FPS_BIT_RECARREGAR) !== 0;
  inp.granada = (bits & FPS_BIT_GRANADA) !== 0;
  inp.yaw = yaw;
  inp.pitch = pitch;
}

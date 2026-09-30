// Teclado e mouse → FpsPlayerInput, compartilhado pelos dois clientes.
import input from "rts:input";
import { mouseLock } from "rts:egui";
import { FpsPlayerInput, fpsInputVazio, fpsAcumularBorda } from "./shared/input";
import { FPS_PITCH_MAX } from "./shared/config";

// códigos neutros do rts-egui: A..Z = 100..125, F1..F12 = 140..151
export const FPS_TECLA_A = 100;
export const FPS_TECLA_D = 103;
export const FPS_TECLA_G = 106;
export const FPS_TECLA_M = 112;
export const FPS_TECLA_N = 113;
export const FPS_TECLA_R = 117;
export const FPS_TECLA_S = 118;
export const FPS_TECLA_W = 122;
export const FPS_TECLA_ESC = 2;
export const FPS_TECLA_ESPACO = 3;
export const FPS_TECLA_F3 = 142;
export const FPS_BOTAO_ESQ = 0;
const FPS_SENS_MOUSE: f64 = 0.0025;

export class FpsEntrada {
  inp: FpsPlayerInput;
  travado: number;
  yaw: f64;
  pitch: f64;
  seq: number;

  constructor(yaw: f64) {
    this.inp = fpsInputVazio();
    this.travado = 0;
    this.yaw = yaw;
    this.pitch = 0.0;
    this.seq = 0;
  }

  ler(app: any, win: number): void {
    if (this.travado === 0 && input.mouseClicked(win, FPS_BOTAO_ESQ)) {
      this.travado = 1;
      mouseLock(win, 1);
    } else if (this.travado !== 0 && app.keyPressed(FPS_TECLA_ESC) !== 0) {
      this.travado = 0;
      mouseLock(win, 0);
    }
    if (this.travado !== 0) {
      this.yaw = this.yaw + input.mouseDeltaX(win) * FPS_SENS_MOUSE;
      this.pitch = this.pitch - input.mouseDeltaY(win) * FPS_SENS_MOUSE;
      if (this.pitch > FPS_PITCH_MAX) this.pitch = FPS_PITCH_MAX;
      if (this.pitch < 0.0 - FPS_PITCH_MAX) this.pitch = 0.0 - FPS_PITCH_MAX;
    }
    const inp = this.inp;
    this.seq = this.seq + 1;
    inp.seq = this.seq;
    inp.frente = app.keyDown(FPS_TECLA_W) - app.keyDown(FPS_TECLA_S);
    inp.lado = app.keyDown(FPS_TECLA_D) - app.keyDown(FPS_TECLA_A);
    inp.pulo = app.keyDown(FPS_TECLA_ESPACO) !== 0;
    inp.yaw = this.yaw;
    inp.pitch = this.pitch;
    inp.atirar = this.travado !== 0 && input.mouseDown(win, FPS_BOTAO_ESQ);
    inp.recarregar = fpsAcumularBorda(inp.recarregar, app.keyPressed(FPS_TECLA_R) !== 0);
    inp.granada = fpsAcumularBorda(inp.granada, app.keyPressed(FPS_TECLA_G) !== 0);
  }

  /// Bordas de tecla valem um tick só.
  consumirBordas(): void {
    this.inp.granada = false;
    this.inp.recarregar = false;
  }
}

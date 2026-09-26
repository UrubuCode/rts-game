// Controle de câmera de estratégia (jogo): pan em XZ com WASD relativo ao yaw,
// zoom (altura) com a roda entre zoomMin e zoomMax e inclinação fixa. Supõe um
// objeto raiz.
import { Behavior } from "@engine/core/behavior";
import math from "@compat/math.ts";
import { limitarZoom } from "./camera_matematica";
import { TECLA_W, TECLA_S, TECLA_A, TECLA_D, eixoTeclas, rodaMouse } from "@engine/core/entrada";

const RAD_POR_GRAU: number = 0.017453292519943295;

/**
 * @componentCategory Câmera
 * @componentDescription Câmera de estratégia: WASD move no plano, roda muda a altura, inclinação fixa.
 * @componentKeywords camera câmera rts estratégia estrategia pan zoom topo
 */
export class CameraRTS extends Behavior {
  /** Unidades de mundo por segundo. */
  velocidade: number = 12.0;
  zoomMin: number = 5.0;
  zoomMax: number = 60.0;
  /** Altura atual da câmera. */
  zoom: number = 20.0;
  /** Altura por passo da roda do mouse. */
  passoZoom: number = 2.0;
  /**
   * Graus abaixo do horizonte.
   * @range 10 89
   */
  inclinacao: number = 55.0;

  constructor() { super(); }
  onValidate(field: string): void {
    if (this.zoomMin > this.zoomMax) { const m = this.zoomMin; this.zoomMin = this.zoomMax; this.zoomMax = m; }
    this.zoom = limitarZoom(this.zoom, 0.0, this.zoomMin, this.zoomMax);
  }
  update(dt: f64): void {
    const t = this.host;
    const frente = eixoTeclas(TECLA_W, TECLA_S);
    const lado = eixoTeclas(TECLA_D, TECLA_A);
    const passo = this.velocidade * dt;
    const cy = math.cos(t.ry); const sy = math.sin(t.ry);
    // fwd horizontal = (sin ry, 0, cos ry); right = (cos ry, 0, −sin ry)
    t.px = t.px + (sy * frente + cy * lado) * passo;
    t.pz = t.pz + (cy * frente - sy * lado) * passo;
    this.zoom = limitarZoom(this.zoom, 0.0 - rodaMouse() * this.passoZoom, this.zoomMin, this.zoomMax);
    t.py = this.zoom;
    t.rx = 0.0 - this.inclinacao * RAD_POR_GRAU;
  }
}

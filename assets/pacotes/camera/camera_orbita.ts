// Controle de câmera em órbita (jogo): gira em volta do objeto `alvo` com o
// botão direito e aproxima/afasta com a roda. Supõe um objeto raiz.
import { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { olharFps, orbitaPose, limitarZoom } from "./camera_matematica";
import { acharAlvo } from "./alvo";
import { BOTAO_DIREITO, mouseSegurado, mouseDX, mouseDY, rodaMouse } from "@engine/core/entrada";

/// Faixa da distância ao alvo (a mesma do @range do campo).
const DIST_MIN: number = 0.5;
const DIST_MAX: number = 1000.0;

/**
 * @componentCategory Câmera
 * @componentDescription Órbita em volta de um alvo (nome do objeto): botão direito gira, roda aproxima.
 * @componentKeywords camera câmera órbita orbita orbit alvo terceira pessoa zoom
 */
export class CameraOrbita extends Behavior {
  /** Nome do GameObject a orbitar. */
  alvo: string = "";
  /** @range 0.5 1000 */
  distancia: number = 6.0;
  /** Radianos por pixel de mouse. */
  sensibilidade: number = 0.005;
  /** Distância por passo da roda do mouse. */
  passoZoom: number = 0.5;
  private cache: GameObject | null = null;
  private ang: Float64Array = new Float64Array(3);
  private centro: Float64Array = new Float64Array(3);
  private pose: Float64Array = new Float64Array(5);

  constructor() { super(); }
  /// Move o transform da câmera: o voo embutido do jogo não soma a este controle.
  controlaCamera(): number { return 1; }
  update(dt: f64): void {
    this.cache = acharAlvo(this.alvo, this.cache);
    const alvo = this.cache;
    if (alvo !== null) {
      const t = this.host;
      this.ang[0] = t.ry; this.ang[1] = t.rx;
      if (mouseSegurado(BOTAO_DIREITO)) olharFps(this.ang, mouseDX(), mouseDY(), this.sensibilidade);
      this.distancia = limitarZoom(this.distancia, 0.0 - rodaMouse() * this.passoZoom, DIST_MIN, DIST_MAX);
      this.ang[2] = this.distancia;
      this.centro[0] = alvo.transform.wx; this.centro[1] = alvo.transform.wy; this.centro[2] = alvo.transform.wz;
      orbitaPose(this.centro, this.ang, this.pose);
      t.px = this.pose[0]; t.py = this.pose[1]; t.pz = this.pose[2]; t.ry = this.pose[3]; t.rx = this.pose[4];
    }
  }
}

// Script de exemplo: gira o objeto em torno de Y (e opcionalmente X).
// Estende Behavior e só mexe no próprio transform — o padrão MonoBehaviour.

import { Behavior } from "../engine/core/behavior";

/**
 * @componentDescription Gira o objeto continuamente.
 * @componentKeywords girar rotação
 */
export class Spinner extends Behavior {
  /** @label SpdY */
  speedY: f64;
  /** @label SpdX */
  speedX: f64;

  constructor(speedY: f64 = 1.0, speedX: f64 = 0.0) {
    super();
    this.speedY = speedY;
    this.speedX = speedX;
  }

  update(dt: f64): void {
    this.host.ry = this.host.ry + this.speedY * dt;
    this.host.rx = this.host.rx + this.speedX * dt;
  }

  toData(): any {
    return { type: "spin", sy: this.speedY, sx: this.speedX };
  }


}

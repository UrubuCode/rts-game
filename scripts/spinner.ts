// Script de exemplo: gira o objeto em torno de Y (e opcionalmente X).
// Estende Behavior e só mexe no próprio transform — o padrão MonoBehaviour.

import { Behavior } from "../engine/core/behavior";

export class Spinner extends Behavior {
  speedY: f64;
  speedX: f64;

  constructor(speedY: f64, speedX: f64) {
    super();
    this.speedY = speedY;
    this.speedX = speedX;
  }

  update(dt: f64): void {
    this.host.ry = this.host.ry + this.speedY * dt;
    this.host.rx = this.host.rx + this.speedX * dt;
  }
}

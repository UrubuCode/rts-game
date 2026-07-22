// Script de física: Rigidbody simples — gravidade + colisão com o chão (y=0) +
// quique. É um MonoBehaviour: só mexe no próprio transform. A meia-altura vem da
// escala do objeto (host.sx * 0.5), então o corpo assenta com a base no chão.

import { Behavior } from "../engine/core/behavior";
import math from "rts:math";

export class Rigidbody extends Behavior {
  g: f64;       // gravidade (negativa)
  bounce: f64;  // restituição (0 = não quica, 1 = elástico)

  constructor(g: f64, bounce: f64) {
    super();
    this.g = g;
    this.bounce = bounce;
  }

  update(dt: f64): void {
    // velocidade vertical vive no Transform (host.vy) — a colisão de cena a lê.
    this.host.vy = this.host.vy + this.g * dt;
    this.host.py = this.host.py + this.host.vy * dt;
    const rest: f64 = this.host.sx * 0.5;   // base no chão (y=0)
    if (this.host.py < rest) {
      this.host.py = rest;
      if (this.host.vy < 0) this.host.vy = 0 - this.host.vy * this.bounce;
      // assenta: quiques minúsculos param (evita jitter infinito)
      if (math.abs(this.host.vy) < 0.15) this.host.vy = 0.0;
    }
  }

  toData(): any {
    return { type: "rigidbody", g: this.g, bounce: this.bounce };
  }
}

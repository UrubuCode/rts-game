// Script Mover: move o objeto em linha reta com velocidade constante (vx,vy,vz).

import { Behavior } from "../engine/core/behavior";

/**
 * @componentDescription Move o objeto em uma direção.
 * @componentKeywords mover translação
 */
export class Mover extends Behavior {
  vx: f64; vy: f64; vz: f64;

  constructor(vx: f64 = 1.0, vy: f64 = 0.0, vz: f64 = 0.0) {
    super();
    this.vx = vx; this.vy = vy; this.vz = vz;
  }

  update(dt: f64): void {
    this.host.px = this.host.px + this.vx * dt;
    this.host.py = this.host.py + this.vy * dt;
    this.host.pz = this.host.pz + this.vz * dt;
  }

  toData(): any {
    return { type: "mover", vx: this.vx, vy: this.vy, vz: this.vz };
  }


}

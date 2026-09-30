// Script de exemplo: faz o objeto flutuar em Y (senoide). Mantém um relógio
// interno acumulando dt.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

/**
 * @componentDescription Move o objeto para cima e baixo.
 * @componentKeywords flutuar oscilar
 */
export class Bobber extends Behavior {
  amp: f64;
  freq: f64;
  baseY: f64;
  private t: f64;

  constructor(amp: f64 = 0.6, freq: f64 = 1.5, baseY: f64 = 2.0) {
    super();
    this.amp = amp;
    this.freq = freq;
    this.baseY = baseY;
    this.t = 0.0;
  }

  update(dt: f64): void {
    this.t = this.t + dt;
    this.host.py = this.baseY + math.sin(this.t * this.freq) * this.amp;
  }

  toData(): any {
    return { type: "bob", amp: this.amp, freq: this.freq, base: this.baseY };
  }


}

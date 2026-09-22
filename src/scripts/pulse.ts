// Script Pulse: faz a escala do objeto pulsar (senoide) em torno de uma base.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

/**
 * @componentDescription Varia a escala periodicamente.
 * @componentKeywords pulsar escala
 */
export class Pulse extends Behavior {
  amp: f64; freq: f64; base: f64;
  private t: f64;

  constructor(amp: f64 = 0.3, freq: f64 = 2.0, base: f64 = 1.0) {
    super();
    this.amp = amp; this.freq = freq; this.base = base;
    this.t = 0.0;
  }

  update(dt: f64): void {
    this.t = this.t + dt;
    const s: f64 = this.base + math.sin(this.t * this.freq) * this.amp;
    this.host.sx = s; this.host.sy = s; this.host.sz = s;
  }

  toData(): any {
    return { type: "pulse", amp: this.amp, freq: this.freq, base: this.base };
  }


}

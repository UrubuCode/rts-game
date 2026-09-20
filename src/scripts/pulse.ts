// Script Pulse: faz a escala do objeto pulsar (senoide) em torno de uma base.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

export class Pulse extends Behavior {
  amp: f64; freq: f64; base: f64; t: f64;

  constructor(amp: f64, freq: f64, base: f64) {
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

  typeName(): string { return "Pulse"; }
  fieldCount(): number { return 3; }
  fieldLabel(i: number): string { if (i === 0) return "Amp"; if (i === 1) return "Freq"; return "Base"; }
  fieldGet(i: number): f64 { if (i === 0) return this.amp; if (i === 1) return this.freq; return this.base; }
  fieldSet(i: number, v: f64): void { if (i === 0) this.amp = v; else if (i === 1) this.freq = v; else this.base = v; }

}

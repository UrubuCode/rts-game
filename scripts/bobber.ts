// Script de exemplo: faz o objeto flutuar em Y (senoide). Mantém um relógio
// interno acumulando dt.

import { Behavior } from "../engine/core/behavior";
import math from "rts:math";

export class Bobber extends Behavior {
  amp: f64;
  freq: f64;
  baseY: f64;
  t: f64;

  constructor(amp: f64, freq: f64, baseY: f64) {
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

  typeName(): string { return "Bobber"; }
  fieldCount(): number { return 3; }
  fieldLabel(i: number): string { if (i === 0) return "Amp"; if (i === 1) return "Freq"; return "Base"; }
  fieldGet(i: number): f64 { if (i === 0) return this.amp; if (i === 1) return this.freq; return this.baseY; }
  fieldSet(i: number, v: f64): void { if (i === 0) this.amp = v; else if (i === 1) this.freq = v; else this.baseY = v; }

}

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
}

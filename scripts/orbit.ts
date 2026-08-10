// COMPONENTE CUSTOM DE EXEMPLO — orbita o objeto em torno de um centro no plano
// XZ, com raio e velocidade configuráveis. Mostra como o dev "importa um script
// que altera o comportamento": escreve um Behavior aqui e registra 1 linha em
// editor/components.ts — ele aparece na lista "Add Component" com config completa.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

export class Orbit extends Behavior {
  radius: f64;
  speed: f64;
  cx: f64;
  cz: f64;
  t: f64;

  constructor(radius: f64, speed: f64, cx: f64, cz: f64) {
    super();
    this.radius = radius;
    this.speed = speed;
    this.cx = cx;
    this.cz = cz;
    this.t = 0.0;
  }

  update(dt: f64): void {
    this.t = this.t + dt * this.speed;
    this.host.px = this.cx + math.cos(this.t) * this.radius;
    this.host.pz = this.cz + math.sin(this.t) * this.radius;
  }

  toData(): any {
    return { type: "orbit", radius: this.radius, speed: this.speed, cx: this.cx, cz: this.cz };
  }

  // ── config no inspector (autodescrição) ──
  typeName(): string { return "Orbit"; }
  fieldCount(): number { return 4; }
  fieldLabel(i: number): string {
    if (i === 0) return "Raio";
    if (i === 1) return "Vel";
    if (i === 2) return "Cx";
    return "Cz";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.radius;
    if (i === 1) return this.speed;
    if (i === 2) return this.cx;
    return this.cz;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.radius = v;
    else if (i === 1) this.speed = v;
    else if (i === 2) this.cx = v;
    else this.cz = v;
  }
}

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

  toData(): any {
    return { type: "spin", sy: this.speedY, sx: this.speedX };
  }

  typeName(): string { return "Spinner"; }
  fieldCount(): number { return 2; }
  fieldLabel(i: number): string { if (i === 0) return "SpdY"; return "SpdX"; }
  fieldGet(i: number): f64 { if (i === 0) return this.speedY; return this.speedX; }
  fieldSet(i: number, v: f64): void { if (i === 0) this.speedY = v; else this.speedX = v; }

}

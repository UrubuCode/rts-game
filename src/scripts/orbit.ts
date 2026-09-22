// COMPONENTE CUSTOM DE EXEMPLO — orbita o objeto em torno de um centro no plano
// XZ, com raio e velocidade configuráveis. Mostra como o dev "importa um script
// que altera o comportamento": exporte um Behavior aqui e recompile. A descoberta
// de classes e campos publicos e feita pelo gerador, sem registro no editor.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

/**
 * @componentDescription Move o objeto em uma órbita.
 * @componentKeywords orbita círculo
 */
export class Orbit extends Behavior {
  radius: f64;
  speed: f64;
  cx: f64;
  cz: f64;
  private t: f64;

  constructor(radius: f64 = 4.0, speed: f64 = 1.0, cx: f64 = 0.0, cz: f64 = 0.0) {
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

}

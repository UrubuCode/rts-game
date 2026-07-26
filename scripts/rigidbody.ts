// Script de física: Rigidbody — integra gravidade e velocidade. O CONTATO é da
// colisão de cena (`solvePair`), que já resolve separação, impulso e atrito
// sobre `mass`/`restitution`/`friction` do Transform.
//
// O chão implícito em y=0 continua como REDE DE SEGURANÇA para cenas sem chão
// de verdade, mas agora só age abaixo de `floorY`, que o usuário pode empurrar
// para muito baixo (-1e9) quando a cena tem um chão real. Antes ele era fixo em
// y=0 e brigava com uma plataforma: o corpo pousava na plataforma e o script o
// puxava de volta para y=0.

import { Behavior } from "../engine/core/behavior";
import math from "rts:math";

/// Velocidade máxima de queda (ver o teto anti-tunneling em `update`).
const MAX_FALL: f64 = 60.0;

export class Rigidbody extends Behavior {
  g: f64;        // gravidade (negativa)
  bounce: f64;   // restituição (0 = não quica, 1 = elástico)
  mass: f64;     // 0 = massa infinita (não é movido por impulso)
  drag: f64;     // arrasto do ar por segundo (0 = nenhum)
  floorY: f64;   // chão implícito; -1e9 desliga (a cena tem chão de verdade)

  constructor(g: f64, bounce: f64) {
    super();
    this.g = g;
    this.bounce = bounce;
    this.mass = 1.0;
    this.drag = 0.0;
    this.floorY = 0.0;
  }

  mount(): void {
    // publica o material físico no Transform, que é o que a colisão lê
    this.host.mass = this.mass;
    this.host.restitution = this.bounce;
  }

  update(dt: f64): void {
    const t = this.host;
    // corpo DORMINDO não integra — é o contrato do sleeping da colisão; ela o
    // acorda quando um contato de verdade chegar
    if (t.asleep !== 0) return;
    // mantém em dia se o usuário editar pelo inspector
    t.mass = this.mass;
    t.restitution = this.bounce;
    t.vy = t.vy + this.g * dt;
    // TETO DE VELOCIDADE (anti-tunneling). Um corpo rápido o bastante percorre
    // mais que a espessura do colisor num único frame e o ATRAVESSA — e, uma vez
    // abaixo do chão, a gravidade o acelera para sempre. Medido: com vy=-200 a
    // bola passava direto por um chão de 1 unidade e ia a y=-59 em 20 frames.
    //
    // O teto é a solução barata e estável (o correto seria varredura contínua,
    // que custa uma raiz por par e não cabe no orçamento do broad-phase atual).
    // 60 u/s a 60 fps = 1 unidade por frame: qualquer colisor mais espesso que
    // isso é sempre visto.
    if (t.vy < 0.0 - MAX_FALL) t.vy = 0.0 - MAX_FALL;
    if (this.drag > 0.0) {
      let k: f64 = 1.0 - this.drag * dt;
      if (k < 0.0) k = 0.0;
      t.vx = t.vx * k; t.vy = t.vy * k; t.vz = t.vz * k;
    }
    // integra os TRÊS eixos: sem vx/vz não há momento horizontal, e um corpo
    // empurrado de lado pela colisão voltava a ficar parado no frame seguinte.
    t.px = t.px + t.vx * dt;
    t.py = t.py + t.vy * dt;
    t.pz = t.pz + t.vz * dt;
    // rede de segurança (ver o cabeçalho): só age se ainda estiver ligada
    if (this.floorY > 0.0 - 1e8) {
      const rest: f64 = this.floorY + t.sy * 0.5;
      if (t.py < rest) {
        t.py = rest;
        if (t.vy < 0.0) t.vy = 0.0 - t.vy * this.bounce;
        // assenta: quiques minúsculos param (evita jitter infinito)
        if (math.abs(t.vy) < 0.15) t.vy = 0.0;
      }
    }
  }

  toData(): any {
    return { type: "rigidbody", g: this.g, bounce: this.bounce,
             mass: this.mass, drag: this.drag, floorY: this.floorY };
  }

  typeName(): string { return "Rigidbody"; }
  fieldCount(): number { return 5; }
  fieldLabel(i: number): string {
    if (i === 0) return "Grav";
    if (i === 1) return "Bounce";
    if (i === 2) return "Massa";
    if (i === 3) return "Drag";
    return "ChaoY";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.g;
    if (i === 1) return this.bounce;
    if (i === 2) return this.mass;
    if (i === 3) return this.drag;
    return this.floorY;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.g = v;
    else if (i === 1) { this.bounce = v; this.host.restitution = v; }
    else if (i === 2) { this.mass = v; this.host.mass = v; }
    else if (i === 3) this.drag = v;
    else this.floorY = v;
  }
}

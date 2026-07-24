// Script de exemplo: PATRULHA — vai e volta entre dois pontos no eixo X,
// em torno da posição onde o objeto estava quando entrou na cena.
// É o padrão MonoBehaviour da engine: estende Behavior, mexe só no próprio
// transform (this.host) e se autodescreve pro inspector.

import { Behavior } from "../engine/core/behavior";

export class Patrol extends Behavior {
  range: f64;    // metade da distância percorrida (unidades de mundo)
  speed: f64;    // unidades por segundo
  baseX: f64;    // centro da patrulha (capturado no mount)
  dir: f64;      // 1 = indo pro +X, -1 = voltando
  started: number;

  constructor(range: f64, speed: f64) {
    super();
    this.range = range;
    this.speed = speed;
    this.baseX = 0.0;
    this.dir = 1.0;
    this.started = 0;
  }

  /// mount roda UMA vez quando o objeto entra na cena (o Start do Unity).
  mount(): void {
    this.baseX = this.host.px;
    this.started = 1;
  }

  /// update roda todo frame; dt vem em SEGUNDOS.
  update(dt: f64): void {
    // se a cena foi carregada sem passar pelo mount, ancora no primeiro frame
    if (this.started === 0) { this.baseX = this.host.px; this.started = 1; }
    this.host.px = this.host.px + this.dir * this.speed * dt;
    // inverte o sentido ao bater nos extremos
    if (this.host.px > this.baseX + this.range) { this.host.px = this.baseX + this.range; this.dir = 0.0 - 1.0; }
    if (this.host.px < this.baseX - this.range) { this.host.px = this.baseX - this.range; this.dir = 1.0; }
  }

  /// Serialização: o que vai pro array `scripts` da cena no save.
  /// O `type` é a chave que recreateBehavior (editor/sceneio.ts) usa no load.
  toData(): any {
    return { type: "patrol", range: this.range, speed: this.speed };
  }

  // ── config editável no inspector (campos numéricos) ───────────────────────
  typeName(): string { return "Patrol"; }
  fieldCount(): number { return 2; }
  fieldLabel(i: number): string {
    if (i === 0) return "Alcance";
    return "Veloc";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.range;
    return this.speed;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.range = v;
    else this.speed = v;
  }
}

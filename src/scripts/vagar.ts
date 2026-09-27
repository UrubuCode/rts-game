// Script de exemplo: VAGAR — anda até um ponto sorteado em volta de onde
// começou, e ao chegar sorteia outro. Unidades ociosas de um RTS fazem isso.
// O sorteio usa o gerador central (`aleatorio`), então com a mesma semente
// (`seed` na porta de controle) o caminho se repete.

import { Behavior } from "../engine/core/behavior";
import { aleatorioEntre } from "../engine/core/aleatorio";

/// Distância em que o alvo conta como alcançado.
const CHEGOU: f64 = 0.05;

/**
 * @componentDescription Anda entre pontos sorteados em volta da posição inicial.
 * @componentKeywords vagar aleatorio passear ocioso
 */
export class Vagar extends Behavior {
  /// Raio (unidades de mundo) em volta do ponto inicial.
  raio: f64 = 3.0;
  /// Unidades por segundo.
  velocidade: f64 = 1.5;
  private cx: f64 = 0.0;
  private cz: f64 = 0.0;
  private alvoX: f64 = 0.0;
  private alvoZ: f64 = 0.0;
  private iniciado: number = 0;

  private sortear(): void {
    this.alvoX = this.cx + aleatorioEntre(0.0 - this.raio, this.raio);
    this.alvoZ = this.cz + aleatorioEntre(0.0 - this.raio, this.raio);
  }

  update(dt: f64): void {
    const t = this.host;
    if (this.iniciado === 0) { this.cx = t.px; this.cz = t.pz; this.iniciado = 1; this.sortear(); }
    const dx = this.alvoX - t.px;
    const dz = this.alvoZ - t.pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    const passo = this.velocidade * dt;
    if (d <= CHEGOU || passo >= d) {
      t.px = this.alvoX; t.pz = this.alvoZ;
      this.sortear();
      return;
    }
    t.px = t.px + dx / d * passo;
    t.pz = t.pz + dz / d * passo;
  }
}

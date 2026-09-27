import { Behavior } from "@engine/core/behavior";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";

/**
 * @componentCategory Demo
 * @componentDescription Bench do DomCanvas: modo 1 troca o texto de #l0 a cada quadro (bench/claude-frame-bench.mjs).
 * @componentKeywords bench dom hud html
 */
export class BenchHudDom extends Behavior {
  /// 0 = HUD parado; 1 = um texto novo por quadro.
  modo: number = 0;
  private canvas: DomCanvas | null = null;
  private no: number = 0 - 1;
  private quadro: number = 0;
  mount(): void { this.ligar(); }
  onDomReload(): void { this.ligar(); }
  private ligar(): void {
    this.canvas = domCanvasDe(this.owner);
    this.no = this.canvas !== null ? this.canvas.documento.querySelector("#l0") : 0 - 1;
  }
  update(dt: f64): void {
    if (this.modo === 0 || this.canvas === null || this.no < 0) return;
    this.quadro = (this.quadro + 1) % 1000;
    this.canvas.documento.setNumero(this.no, this.quadro, 0);
  }
}

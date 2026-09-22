import { Behavior } from "@engine/core/behavior";
import { createComponent } from "@engine/components";

/**
 * @componentDescription Exemplo: campos públicos viram controles automaticamente.
 * @componentKeywords exemplo movimento velocidade texto booleano
 */
export class MotionSettings extends Behavior {
  /** @range 0 20 */
  public speed: number = 2;
  public moving: boolean = true;
  public label: string = "Movimento";
  private elapsed: number = 0;

  // Scripts tambem podem criar componentes do registro; metodos nao viram campos.
  createHelper(): Behavior { return createComponent("Spinner"); }

  update(dt: f64): void {
    this.elapsed = this.elapsed + dt;
    if (this.moving) this.host.px = this.host.px + this.speed * dt;
  }
}

// Controle de câmera que segue o objeto `alvo` (jogo) com amortecimento
// crítico até alvo + deslocamento, sem ultrapassar; pode olhar para o alvo.
// Supõe um objeto raiz.
import { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import math from "@compat/math.ts";
import { amortecerCritico } from "./camera_matematica";
import { acharAlvo } from "./alvo";

/**
 * @componentCategory Câmera
 * @componentDescription Segue um alvo (nome do objeto) a um deslocamento, com suavização, olhando para ele.
 * @componentKeywords camera câmera seguir follow alvo terceira pessoa suave
 */
export class CameraSeguir extends Behavior {
  /** Nome do GameObject a seguir. */
  alvo: string = "";
  deslocX: number = 0.0;
  deslocY: number = 3.0;
  deslocZ: number = 0.0 - 6.0;
  /**
   * Tempo aproximado para alcançar o ponto, em segundos.
   * @range 0.01 10
   */
  suavizacao: number = 0.3;
  olharAlvo: boolean = true;
  /// [pos, vel] de x, y e z; [tempo de suavização, dt].
  private est: Float64Array = new Float64Array(6);
  private cfg: Float64Array = new Float64Array(2);
  /// A velocidade zera quando o alvo é (re)encontrado.
  private iniciado: boolean = false;
  private cache: GameObject | null = null;

  constructor() { super(); }
  /// Move o transform da câmera: o voo embutido do jogo não soma a este controle.
  controlaCamera(): number { return 1; }
  update(dt: f64): void {
    this.cache = acharAlvo(this.alvo, this.cache);
    const alvo = this.cache;
    if (alvo === null) this.iniciado = false;
    else {
      const t = this.host; const e = this.est;
      if (!this.iniciado) { e[1] = 0.0; e[3] = 0.0; e[5] = 0.0; this.iniciado = true; }
      // a posição vem do transform: um script ou o Inspector que mova a câmera é respeitado
      e[0] = t.px; e[2] = t.py; e[4] = t.pz;
      this.cfg[0] = this.suavizacao; this.cfg[1] = dt;
      const at = alvo.transform;
      amortecerCritico(e, 0, at.wx + this.deslocX, this.cfg);
      amortecerCritico(e, 1, at.wy + this.deslocY, this.cfg);
      amortecerCritico(e, 2, at.wz + this.deslocZ, this.cfg);
      t.px = e[0]; t.py = e[2]; t.pz = e[4];
      if (this.olharAlvo) {
        const dx = at.wx - t.px; const dy = at.wy - t.py; const dz = at.wz - t.pz;
        t.ry = math.atan2(dx, dz);
        t.rx = math.atan2(dy, math.sqrt(dx * dx + dz * dz));
      }
    }
  }
}

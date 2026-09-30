// Controle de câmera em primeira pessoa (jogo): olha com o mouse e anda com
// WASD pelo eixo da vista; espaço sobe. Supõe um objeto raiz: escreve o
// transform local. Sem janela de entrada (testes) fica parado.
import { Behavior } from "@engine/core/behavior";
import math from "@compat/math.ts";
import { olharFps } from "./camera_matematica";
import { TECLA_W, TECLA_S, TECLA_A, TECLA_D, TECLA_ESPACO, BOTAO_DIREITO,
         teclaSegurada, eixoTeclas, mouseSegurado, mouseDX, mouseDY } from "@engine/core/entrada";

/**
 * @componentCategory Câmera
 * @componentDescription Primeira pessoa: olhar com o mouse (botão direito) e andar com WASD; espaço sobe.
 * @componentKeywords camera câmera fps primeira pessoa wasd mouse controle voar
 */
export class CameraPrimeiraPessoa extends Behavior {
  /** Unidades de mundo por segundo. */
  velocidade: number = 6.0;
  /** Radianos por pixel de mouse. */
  sensibilidade: number = 0.005;
  /** Olhar só com o botão direito segurado (desligado: o mouse sempre gira a vista). */
  exigirBotaoDireito: boolean = true;
  /// [yaw, pitch, -] de trabalho (sem alocação por quadro).
  private ang: Float64Array = new Float64Array(3);

  constructor() { super(); }
  /// Move o transform da câmera: o voo embutido do jogo não soma a este controle.
  controlaCamera(): number { return 1; }
  update(dt: f64): void {
    const t = this.host;
    this.ang[0] = t.ry; this.ang[1] = t.rx;
    if (!this.exigirBotaoDireito || mouseSegurado(BOTAO_DIREITO)) olharFps(this.ang, mouseDX(), mouseDY(), this.sensibilidade);
    t.ry = this.ang[0]; t.rx = this.ang[1];
    const frente = eixoTeclas(TECLA_W, TECLA_S);
    const lado = eixoTeclas(TECLA_D, TECLA_A);
    const sobe = teclaSegurada(TECLA_ESPACO) ? 1.0 : 0.0;
    const passo = this.velocidade * dt;
    const cy = math.cos(t.ry); const sy = math.sin(t.ry); const cp = math.cos(t.rx); const sp = math.sin(t.rx);
    // fwd = (sin yaw·cos p, sin p, cos yaw·cos p); right = (cos yaw, 0, −sin yaw)
    t.px = t.px + (sy * cp * frente + cy * lado) * passo;
    t.py = t.py + (sp * frente + sobe) * passo;
    t.pz = t.pz + (cy * cp * frente - sy * lado) * passo;
  }
}

import { Behavior } from "@engine/core/behavior";
import type { ContactInfo } from "@engine/core/contact_events";

/**
 * Porta automática — exemplo de corrotina (engine/core/coroutine_scheduler.ts):
 * ao receber um gatilho ela sobe, espera alguns segundos de TEMPO DE JOGO
 * (respeita pausa/step/timescale do Play, como qualquer `waitForSeconds`) e
 * desce sozinha. Um novo gatilho enquanto está aberta reinicia a espera (para
 * a corrotina anterior antes de começar outra — nunca duas rodando ao mesmo
 * tempo pro mesmo componente).
 *
 * @componentCategory Demo
 * @componentDescription Porta que abre ao receber um gatilho, espera e fecha sozinha (exemplo de startCoroutine/waitForSeconds).
 * @componentKeywords demo corrotina porta gatilho startCoroutine waitForSeconds coroutine
 */
export class AutomaticDoor extends Behavior {
  /// Quanto a porta sobe (unidades de mundo) quando aberta.
  public openOffsetY: number = 2.5;
  /// Quanto tempo (segundos de JOGO) a porta fica aberta antes de fechar.
  public openSeconds: number = 2.0;

  private closedY: number = 0.0;
  private open: boolean = false;
  private routine: number = 0 - 1;

  mount(): void {
    this.closedY = this.host.py;
  }

  onTriggerEnter(c: ContactInfo): void {
    // Reinicia a espera em vez de empilhar corrotinas: só UMA por vez cuida
    // desta porta (pararCorrotina antes de começar outra).
    if (this.routine >= 0) this.stopCoroutine(this.routine);
    this.open = true;
    this.host.py = this.closedY + this.openOffsetY;
    this.routine = this.startCoroutine(async () => {
      await this.waitForSeconds(this.openSeconds);
      this.host.py = this.closedY;
      this.open = false;
      this.routine = 0 - 1;
    });
  }
}

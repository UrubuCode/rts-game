import { Behavior } from "@engine/core/behavior";
import type { ContactInfo } from "@engine/core/contact_events";
import { vitrine } from "./VitrineEstado";

/**
 * @componentCategory Demo
 * @componentDescription Conta os contatos e gatilhos que este objeto recebe (cena vitrine).
 * @componentKeywords demo vitrine contato evento
 */
export class VitrineContador extends Behavior {
  public contatos: number = 0;

  onCollisionEnter(c: ContactInfo): void {
    this.contatos = this.contatos + 1;
    vitrine.contatos = vitrine.contatos + 1;
  }
  onTriggerEnter(c: ContactInfo): void {
    vitrine.gatilhos = vitrine.gatilhos + 1;
  }
}

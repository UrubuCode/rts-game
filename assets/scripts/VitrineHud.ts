import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { scene } from "@editor/control/session";
import { rigidBackendName } from "@engine/core/physics_backend";
import { vitrine } from "./VitrineEstado";

/**
 * @componentCategory Demo
 * @componentDescription HUD da cena vitrine: fps, objetos, contatos e backend; o botao "Derrubar" empurra as caixas.
 * @componentKeywords demo vitrine hud fps
 */
export class VitrineHud extends Behavior {
  public titulo: string = "RTS - vitrine";
  /// Nome dos objetos que o botão empurra (prefixo).
  public alvo: string = "Caixa";
  private fps: number = 60;
  private acumulado: number = 0;
  private dono: GameObject | null = null;
  private ultimoTexto: string = "";

  /// Quem é o GameObject deste script: o único cujo transform é o `host`.
  private acharDono(): GameObject | null {
    if (this.dono !== null && this.dono.transform === this.host) return this.dono;
    const objs = scene.objects;
    let i = 0;
    while (i < objs.length) {
      if (objs[i].transform === this.host) { this.dono = objs[i]; return this.dono; }
      i = i + 1;
    }
    return null;
  }

  update(dt: f64): void {
    if (dt > 0.0) this.fps = this.fps * 0.9 + (1.0 / dt) * 0.1;
    // Atualiza o texto só 10x por segundo: uma string nova por frame seria lixo à toa.
    this.acumulado = this.acumulado + dt;
    if (this.acumulado < 0.1) return;
    this.acumulado = 0.0;
    const o = this.acharDono();
    if (o === null || o.uiIdx < 0) return;
    const texto = this.titulo + " | " + (this.fps | 0) + " fps | " + scene.objects.length + " objetos | contatos " +
      vitrine.contatos + " | gatilhos " + vitrine.gatilhos + " | fisica " + rigidBackendName();
    if (texto !== this.ultimoTexto) { this.ultimoTexto = texto; o.behaviors[o.uiIdx].setUITitle(texto); }
  }

  ultimo(): string { return this.ultimoTexto; }

  onUIClick(name: string): void {
    if (name !== "Derrubar") return;
    const objs = scene.objects;
    let i = 0;
    while (i < objs.length) {
      const g = objs[i];
      if (g.stationary === 0 && g.name.indexOf(this.alvo) === 0) {
        g.transform.vy = 7.0;
        g.transform.vx = (i % 3 - 1) * 2.0;
        g.transform.asleep = 0;
        vitrine.derrubadas = vitrine.derrubadas + 1;
      }
      i = i + 1;
    }
  }
}

// Estado mutável COMPARTILHADO do editor — um singleton que main + comandos usam.
export class Session {
  camX: f64; camY: f64; camZ: f64; camYaw: f64; camPitch: f64;
  selected: number; playing: number;
  wsServer: number; wsClient: number;
  constructor() {
    this.camX = 0.0; this.camY = 11.0; this.camZ = -15.0;
    this.camYaw = 0.0; this.camPitch = 0 - 0.5;
    this.selected = 0; this.playing = 1;
    this.wsServer = 0; this.wsClient = 0;
  }
}
export const S = new Session();

// cena compartilhada (singleton) — main + comandos operam nela
import { Scene } from "../../engine/core/scene";
export const scene = new Scene("Main");

// Estado mutável COMPARTILHADO do editor — um singleton que main + comandos usam.
export class Session {
  camX: f64; camY: f64; camZ: f64; camYaw: f64; camPitch: f64;
  selected: number; playing: number;
  selection: number[];   // multi-seleção (índices); vazio = usa só `selected`. O gizmo aplica em todos.
  wsServer: number; wsClient: number;
  drawnLast: number;
  win: number;        // handle da janela egui (pra comandos que sobem mesh/textura)
  tool: number;       // ferramenta de manipulação: 0=seleção, 1=Move, 2=Rotate, 3=Scale
  snap: number;       // 1 = snap to grid no gizmo (move 0.5, rotate 15°)
  constructor() {
    this.camX = 0.0; this.camY = 11.0; this.camZ = -15.0;
    this.camYaw = 0.0; this.camPitch = 0 - 0.5;
    this.selected = 0; this.playing = 1;
    this.selection = [];
    this.wsServer = 0; this.wsClient = 0;
    this.drawnLast = 0;
    this.win = 0;
    this.tool = 1;   // Move por padrão
    this.snap = 0;
  }
}
export const S = new Session();

// cena compartilhada (singleton) — main + comandos operam nela
import { Scene } from "../../engine/core/scene";
export const scene = new Scene("Main");

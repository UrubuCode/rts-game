// `rts:input` com a ENTRADA SIMULADA por cima (ver input_sim.ts).
//
// É o ÚNICO lugar do editor e do jogo que lê o teclado e o mouse: app.ts,
// main.ts, widgets, Inspector, Project, Console, UIButton e entrada.ts
// importam daqui em vez de `rts:input`. Com a simulação desligada, cada
// leitura é a nativa mais um `if`; ligada, a resposta vem do estado simulado e
// a janela real é ignorada.
//
// A forma é a de `rts:input` (mesmos nomes e argumentos), para que trocar o
// import seja a única mudança em quem lê.
import {
  mouseX as nMouseX, mouseY as nMouseY, mouseDown as nMouseDown, mousePressed as nMousePressed,
  mouseReleased as nMouseReleased, mouseClicked as nMouseClicked, mouseDoubleClicked as nMouseDoubleClicked,
  mouseDeltaX as nMouseDeltaX, mouseDeltaY as nMouseDeltaY, dragging as nDragging, wheel as nWheel,
  setCursor as nSetCursor, key as nKey, modCtrl as nModCtrl, modShift as nModShift, modAlt as nModAlt,
  textInput as nTextInput,
} from "rts:input";
import {
  simAtiva, simMouseX, simMouseY, simMouseDown, simMousePressed, simMouseReleased, simMouseClicked,
  simMouseDeltaX, simMouseDeltaY, simArrastando, simRodaQuadro, simTecla, simCtrl, simShift, simAlt, simTextoQuadro,
} from "./input_sim.ts";

export default {
  mouseX(win: number): f64 { return simAtiva() ? simMouseX() : nMouseX(win); },
  mouseY(win: number): f64 { return simAtiva() ? simMouseY() : nMouseY(win); },
  mouseDown(win: number, b: number): boolean { return simAtiva() ? simMouseDown(b) : nMouseDown(win, b); },
  mousePressed(win: number, b: number): boolean { return simAtiva() ? simMousePressed(b) : nMousePressed(win, b); },
  mouseReleased(win: number, b: number): boolean { return simAtiva() ? simMouseReleased(b) : nMouseReleased(win, b); },
  mouseClicked(win: number, b: number): boolean { return simAtiva() ? simMouseClicked(b) : nMouseClicked(win, b); },
  mouseDoubleClicked(win: number, b: number): boolean { return simAtiva() ? false : nMouseDoubleClicked(win, b); },
  mouseDeltaX(win: number): f64 { return simAtiva() ? simMouseDeltaX() : nMouseDeltaX(win); },
  mouseDeltaY(win: number): f64 { return simAtiva() ? simMouseDeltaY() : nMouseDeltaY(win); },
  dragging(win: number): boolean { return simAtiva() ? simArrastando() : nDragging(win); },
  wheel(win: number): f64 { return simAtiva() ? simRodaQuadro() : nWheel(win); },
  setCursor(win: number, kind: number): void { nSetCursor(win, kind); },
  key(win: number, code: number, phase: number): boolean { return simAtiva() ? simTecla(code, phase) : nKey(win, code, phase); },
  modCtrl(win: number): boolean { return simAtiva() ? simCtrl() : nModCtrl(win); },
  modShift(win: number): boolean { return simAtiva() ? simShift() : nModShift(win); },
  modAlt(win: number): boolean { return simAtiva() ? simAlt() : nModAlt(win); },
  textInput(win: number): string { return simAtiva() ? simTextoQuadro() : nTextInput(win); },
};

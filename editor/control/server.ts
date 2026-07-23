// Servidor de controle WebSocket — NÃO-BLOQUEANTE (ws.recv volta "" sem dados),
// então o editor renderiza normal sem travar. `ctrlServe` abre a porta,
// `ctrlPoll` roda 1x por frame: aceita cliente ou processa comando(s).
import ws from "rts:ws";

import { S } from "./session";
import { execCommand } from "./dispatch";

/// Abre a porta de controle (guarda o handle na Session).
export function ctrlServe(port: number): void {
  S.wsServer = ws.serve(port);
}

/// Poll não-bloqueante (chamar 1x por frame). w/h = tamanho lógico atual (p/ `res`).
export function ctrlPoll(w: number, h: number): void {
  if (S.wsServer === 0) return;
  if (S.wsClient === 0) {
    const c = ws.accept(S.wsServer);
    if (c !== 0) { S.wsClient = c; ws.send(S.wsClient, "[engine] editor conectado. envie 'help' para a lista de comandos."); }
    return;
  }
  const rr = ws.recvReady(S.wsClient);
  if (rr < 0) { ws.close(S.wsClient); S.wsClient = 0; return; }
  if (rr > 0) {
    const msg = ws.recv(S.wsClient);
    if (msg.length > 0) {
      const lines = msg.split("\n");
      let li = 0;
      while (li < lines.length) {
        const l = lines[li].split("\r")[0];
        if (l.length > 0) ws.send(S.wsClient, execCommand(w, h, l));
        li = li + 1;
      }
    }
  }
}

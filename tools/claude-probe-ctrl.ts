// O `ctrlServe`/`ctrlPoll` do editor, SEM janela — para saber se o problema é
// da porta de controle ou do laço de render em volta dela.
import io from "../compat/io.ts";
import { ctrlServe, ctrlPoll } from "../editor/control/server";
import { S } from "../editor/control/session";

io.print("[probe] antes do serve: S.wsServer=" + S.wsServer);
ctrlServe(7777);
io.print("[probe] depois do serve: S.wsServer=" + S.wsServer);

// 20 segundos de poll, como o editor faz por frame.
let i = 0;
while (i < 1200) {
  ctrlPoll(1200, 720);
  i = i + 1;
  if (i % 300 === 0) io.print("[probe] " + i + " polls | wsServer=" + S.wsServer + " clientes=" + S.wsClient);
}
io.print("[probe] fim");

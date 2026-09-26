// Teste SEM JANELA da porta de controle WebSocket: escuta só no loopback e
// recusa conexões cujo Host não é local (defesa contra DNS rebinding).
//   rts.exe run tests/test_ws_controle.ts
import io from "@compat/io.ts";
import { WebSocket } from "ws";
import net from "node:net";
import { ctrlServe, ctrlPoll, hostDeControleAceito, CONTROLE_HOST } from "@editor/control/server";
import { S } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const PORTA = 39277;

check(CONTROLE_HOST === "127.0.0.1", "escuta no loopback");
check(hostDeControleAceito("127.0.0.1:" + PORTA, PORTA) && hostDeControleAceito("localhost:" + PORTA, PORTA), "loopback com porta");
check(hostDeControleAceito("LOCALHOST", PORTA) && hostDeControleAceito("[::1]:" + PORTA, PORTA) && hostDeControleAceito("", PORTA), "sem porta, maiúsculas, IPv6, vazio");
check(!hostDeControleAceito("evil.example:" + PORTA, PORTA) && !hostDeControleAceito("192.168.0.10:" + PORTA, PORTA), "nome externo ou IP da rede: recusado");
check(!hostDeControleAceito("127.0.0.1.evil.example", PORTA) && !hostDeControleAceito("localhost:1", PORTA), "sufixo enganoso e outra porta: recusados");

// ao vivo: um cliente local recebe a saudação; um com Host externo é fechado
let saudacao = ""; let fechadoLocal = false;
ctrlServe(PORTA);
let volta = 0;
while (S.wsServer === 0 && volta < 200000) { ctrlPoll(800, 600); volta = volta + 1; }
check(S.wsServer === 1, "servidor escutando em " + CONTROLE_HOST);
const local = new WebSocket("ws://127.0.0.1:" + PORTA + "/");
local.on("message", (d: any) => { if (saudacao.length === 0) saudacao = String(d); });
local.on("close", () => { fechadoLocal = true; });
local.on("error", (_e: any) => { });
volta = 0;
while (saudacao.length === 0 && volta < 200000) { ctrlPoll(800, 600); volta = volta + 1; }
check(saudacao.indexOf("[engine] editor conectado") === 0 && S.wsClient === 1, "cliente local atendido: " + saudacao);
// Host externo: o cliente ws do runtime não deixa sobrepor o Host, então o
// pedido de upgrade vai cru por node:net, como o de uma página que resolveu
// o próprio domínio para 127.0.0.1 (DNS rebinding).
let resposta = ""; let externoFechou = false;
const cru = net.createConnection({ host: "127.0.0.1", port: PORTA }, () => {
  cru.write("GET / HTTP/1.1\r\nHost: evil.example:" + PORTA + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
});
cru.on("data", (d: any) => { resposta = resposta + d.toString("latin1"); });
cru.on("close", () => { externoFechou = true; });
cru.on("error", (_e: any) => { externoFechou = true; });
volta = 0;
// recusado = o servidor manda o frame de fechamento (opcode 0x88) ou derruba o TCP
function recusado(): boolean { return externoFechou || resposta.indexOf("\u0088") >= 0; }
while (!recusado() && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
check(recusado(), "Host externo: o servidor fecha a conexão");
cru.destroy();
check(resposta.indexOf("editor conectado") < 0 && S.wsClient === 1, "Host externo: sem saudação e sem contar cliente");
local.close();
io.print("[PASSOU] ws controle: loopback, Host local aceito, Host externo recusado");
process.exit(0);

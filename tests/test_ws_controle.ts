// Teste SEM JANELA da porta de controle WebSocket: escuta só no loopback e
// recusa conexões cujo Host não é local (defesa contra DNS rebinding).
//   rts.exe run tests/test_ws_controle.ts
import io from "@compat/io.ts";
import { WebSocket } from "ws";
import net from "node:net";
import { ctrlServe, ctrlPoll, hostDeControleAceito, CONTROLE_HOST, portaDeControle, CONTROLE_PORTA_PADRAO } from "@editor/control/server";
import { S, scene } from "@editor/control/session";
import { entradaQuadro, simAtiva } from "@compat/input_sim";
import { loteAtivo } from "@editor/control/lote";
import { instalarEditorReal } from "@editor/editor_host";

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
// ORDEM com resposta adiada: `input click` segura as linhas seguintes da
// conexão até o clique terminar; o lote numa mensagem vira begin + linhas + end.
instalarEditorReal();
const respostas: string[] = [];
local.on("message", (d: any) => { respostas.push(String(d)); });
local.send("input click 10 10\nres\ninput off");
volta = 0;
while (respostas.length < 3 && volta < 400000) { entradaQuadro(); ctrlPoll(800, 600); volta = volta + 1; }
check(respostas.length === 3 && respostas[0].indexOf("[ok] input click 10 10") === 0 && respostas[1].indexOf("[res]") === 0 &&
  respostas[2].indexOf("[ok] input off") === 0, "adiada segura a fila, em ordem: " + respostas.join(" || "));
respostas.length = 0;
local.send("batch\nspawn LoteWs 0 0 0\nmove LoteWs 1 2 3");
volta = 0;
while (respostas.length < 4 && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
check(respostas.length === 4 && respostas[0].indexOf("[ok] batch aberto") === 0 && respostas[3] === "[ok] batch: 2 comandos, 1 entrada de Desfazer",
  "lote numa mensagem: " + respostas.join(" || "));
check(portaDeControle("") === CONTROLE_PORTA_PADRAO && portaDeControle("7790") === 7790 && portaDeControle("x") === CONTROLE_PORTA_PADRAO &&
  portaDeControle("70000") === CONTROLE_PORTA_PADRAO, "RTS_CTRL_PORT");
// Cliente que CAI com um lote aberto e uma tecla segurada: o `close` cancela o
// lote (desfeito) e devolve a entrada real, sem ninguém mandar `input off`.
const antesQueda = scene.objects.length;
local.send("batch begin\nspawn Orfao 0 0 0\ninput key w down");
volta = 0;
while (respostas.length < 7 && volta < 400000) { entradaQuadro(); ctrlPoll(800, 600); volta = volta + 1; }
check(respostas.length === 7 && respostas[5].indexOf("[ok] spawn") === 0 && respostas[6].indexOf("[erro] batch linha 2") === 0,
  "lote aberto e input recusado dentro dele: " + respostas.join(" || "));
local.send("batch end\nbatch begin\nspawn Orfao 0 0 0\nstate");
volta = 0;
while (respostas.length < 11 && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
check(loteAtivo() && scene.objects.length === antesQueda + 1, "lote aberto com 1 objeto");
local.close();
volta = 0;
while (loteAtivo() && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
check(!loteAtivo() && scene.objects.length === antesQueda, "o close da conexao dona cancelou o lote");
const outro = new WebSocket("ws://127.0.0.1:" + PORTA + "/");
let segura = "";
outro.on("message", (d: any) => { segura = String(d); });
outro.on("error", (_e: any) => { });
volta = 0;
while (segura.indexOf("[engine]") !== 0 && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
outro.send("input key w down");
volta = 0;
while (segura.indexOf("[ok] input key w down") !== 0 && volta < 400000) { entradaQuadro(); ctrlPoll(800, 600); volta = volta + 1; }
check(simAtiva(), "tecla segurada pela conexao: " + segura);
outro.close();
volta = 0;
while (simAtiva() && volta < 400000) { ctrlPoll(800, 600); volta = volta + 1; }
check(!simAtiva(), "o close da conexao dona soltou a tecla e devolveu a entrada real");
io.print("[PASSOU] ws controle: loopback, Host local aceito, Host externo recusado, resposta adiada em ordem, lote numa mensagem, RTS_CTRL_PORT, close solta a entrada e cancela o lote");
process.exit(0);

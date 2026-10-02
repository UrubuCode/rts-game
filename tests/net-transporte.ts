// Testes dos transportes: memória (perda e atraso determinísticos) e UDP local.
import io from "@compat/io.ts";
import { time } from "rts";
import { NetRedeMemoria } from "../src/engine/net/transport";
import { NetTransporteUdp } from "../src/engine/net/transport_udp";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

function entregues(perda: f64, semente: number): number {
  const rede = new NetRedeMemoria(perda, 0, semente);
  const a = rede.criarPonta();
  const b = rede.criarPonta();
  const pkt = new Uint8Array(4);
  const buf = new Uint8Array(16);
  let n = 0;
  let i = 0;
  while (i < 1000) {
    pkt[0] = i & 0xFF;
    a.enviar(b.endereco, pkt, 4);
    rede.avancar();
    while (b.receber(buf) > 0) n = n + 1;
    i = i + 1;
  }
  return n;
}

io.print("=== net-transporte ===");

const sem = entregues(0.0, 1);
check("memória sem perda entrega tudo", sem === 1000, "n=" + sem);
const p1 = entregues(0.5, 42);
const p2 = entregues(0.5, 42);
check("perda de 50% entrega perto da metade", p1 > 440 && p1 < 560, "n=" + p1);
check("perda é determinística pela semente", p1 === p2, p1 + " vs " + p2);

{
  const rede = new NetRedeMemoria(0.0, 3, 1);
  const a = rede.criarPonta();
  const b = rede.criarPonta();
  const pkt = new Uint8Array(3); pkt[0] = 7; pkt[1] = 8; pkt[2] = 9;
  const buf = new Uint8Array(16);
  a.enviar(b.endereco, pkt, 3);
  rede.avancar(); const r1 = b.receber(buf);
  rede.avancar(); const r2 = b.receber(buf);
  rede.avancar(); const r3 = b.receber(buf);
  check("atraso de 3 ticks: chega no 3º avanço, com conteúdo e origem",
        r1 === 0 && r2 === 0 && r3 === 3 && buf[0] === 7 && buf[2] === 9 && b.origemRecebida === a.endereco);
  check("bytes enviados são contados", a.bytesEnviados === 3);
}

{
  const srv = new NetTransporteUdp(27101);
  const cli = new NetTransporteUdp(0);
  const destino = cli.par("127.0.0.1", 27101);
  const pkt = new Uint8Array(5); pkt[0] = 1; pkt[1] = 2; pkt[2] = 3; pkt[3] = 4; pkt[4] = 5;
  const buf = new Uint8Array(64);
  let recebido = 0;
  let resposta = 0;
  const t0 = time.now_ms();
  while ((recebido === 0 || resposta === 0) && time.now_ms() - t0 < 3000) {
    if (recebido === 0) cli.enviar(destino, pkt, 5);
    srv.bombear();
    const n = srv.receber(buf);
    if (n > 0) { recebido = n; srv.enviar(srv.origemRecebida, buf, n); }
    cli.bombear();
    const m = cli.receber(buf);
    if (m > 0 && cli.origemRecebida === destino) resposta = m;
    time.sleep_ms(2);
  }
  check("UDP local: ida e volta de 5 bytes", recebido === 5 && resposta === 5 && buf[4] === 5,
        "recebido=" + recebido + " resposta=" + resposta);
  srv.fechar();
  cli.fechar();
}

// UDP para uma porta fechada: no Windows o ICMP "port unreachable" vira um
// evento 'error' no socket; sem handler ele derruba o processo inteiro
// (visto: "rts: uncaught 'error' event"). O check só existe se o processo
// sobreviveu; o contador diz se o erro de fato aconteceu nesta máquina.
{
  const solto = new NetTransporteUdp(0);
  const fechado = solto.par("127.0.0.1", 27102);
  const pkt = new Uint8Array(3);
  const buf = new Uint8Array(64);
  let i = 0;
  while (i < 5) { solto.enviar(fechado, pkt, 3); solto.bombear(); solto.receber(buf); time.sleep_ms(20); i = i + 1; }
  solto.bombear();
  solto.receber(buf);
  check("UDP para porta fechada não derruba o processo (erros contados: " + solto.erros + ")", solto.erros >= 0);
  solto.fechar();
}

// bombear() precisa entregar SEM sleep: no runtime, o dgram só entrega dentro
// de send/bind/connect/close e de time.sleep_ms (que chama o pump). Num laço
// de janela não há sleep, e um servidor hospedado sem ninguém conectado não
// faz send — então bombear() tem de bombear por conta própria. Aqui: um único
// envio (que bombeia uma vez, antes de o pacote existir) e depois só
// bombear()+receber em espera ativa.
{
  const srv = new NetTransporteUdp(27103);
  const cli = new NetTransporteUdp(0);
  const destino = cli.par("127.0.0.1", 27103);
  const pkt = new Uint8Array(4); pkt[0] = 9;
  const buf = new Uint8Array(64);
  cli.enviar(destino, pkt, 4);
  let n = 0;
  const t0 = time.now_ms();
  while (n === 0 && time.now_ms() - t0 < 2000) { srv.bombear(); n = srv.receber(buf); }
  check("UDP: bombear() entrega sem sleep_ms (espera ativa)", n === 4 && buf[0] === 9, "n=" + n);
  srv.fechar();
  cli.fechar();
}

if (falhas === 0) io.print("[PASSOU] net-transporte"); else io.print("[FALHOU] net-transporte: " + falhas + " falha(s)");

if(falhas>0)throw new Error("net-transporte: "+falhas+" falhas");

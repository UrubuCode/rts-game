// Handshake, recusa, lixo na porta, tempo limite, reconexão e inputs redundantes.
import io from "@compat/io.ts";
import { NetRedeMemoria } from "../src/engine/net/transport";
import { NetServidor } from "../src/engine/net/server";
import { NetCliente } from "../src/engine/net/client";
import { NetWriter, NetReader } from "../src/engine/net/buffer";
import { NetCabecalho, netEscreverCabecalhoVersao, netLerCabecalho } from "../src/engine/net/protocol";
import {
  NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO, NET_ESTADO_DESCONECTADO, NET_RECUSA_LOTADO,
  NET_RECUSA_VERSAO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_MTU,
} from "../src/engine/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const DT: f64 = 1.0 / 60.0;
let relogio = 0;

function rodar(rede: NetRedeMemoria, srv: NetServidor | null, clis: NetCliente[], ticks: number): void {
  let t = 0;
  while (t < ticks) {
    const agora = relogio * DT;
    let k = 0;
    while (k < clis.length) { clis[k].passo(agora); clis[k].enviar(agora); k = k + 1; }
    rede.avancar();
    if (srv !== null) { srv.receber(agora); srv.verificarTempo(agora); srv.enviar(agora); }
    rede.avancar();
    relogio = relogio + 1;
    t = t + 1;
  }
}

io.print("=== net-conexao ===");

// 1. handshake com bytes de boas-vindas
const rede = new NetRedeMemoria(0.0, 1, 1);
const tS = rede.criarPonta();
const srv = new NetServidor(tS, 1, 60);
const bv = new Uint8Array(3); bv[0] = 7; bv[1] = 8; bv[2] = 9;
srv.definirBoasVindas(bv, 3);
const c1 = new NetCliente(rede.criarPonta());
c1.conectar(tS.endereco, 0.0);
rodar(rede, srv, [c1], 20);
check("conecta e recebe o BEMVINDO com os bytes do jogo",
      c1.estado === NET_ESTADO_CONECTADO && c1.clienteId === 0 && c1.boasVindasTam === 3 && c1.boasVindas[2] === 9);
check("servidor avisa o jogo do cliente novo", srv.proximoNovo() === 0 && srv.proximoNovo() === -1);

// 2. lotado
const c2 = new NetCliente(rede.criarPonta());
c2.conectar(tS.endereco, relogio * DT);
rodar(rede, srv, [c1, c2], 10);
check("servidor lotado recusa", c2.estado === NET_ESTADO_RECUSADO && c2.motivoRecusa === NET_RECUSA_LOTADO);

// 3. versão errada e lixo na porta
{
  const tR = rede.criarPonta();
  const w = new NetWriter(NET_MTU);
  netEscreverCabecalhoVersao(w, 99, NET_PKT_CONECTAR, 0, 0, 0, false);
  tR.enviar(tS.endereco, w.buf, w.pos);
  const lixo = new Uint8Array(20); lixo[0] = 1; lixo[1] = 2;
  tR.enviar(tS.endereco, lixo, 20);
  tR.enviar(tS.endereco, lixo, 3);
  rodar(rede, srv, [c1], 3);
  const buf = new Uint8Array(NET_MTU);
  const r = new NetReader(NET_MTU);
  const cab = new NetCabecalho();
  let motivo = -1;
  let n = tR.receber(buf);
  while (n > 0) {
    r.abrir(buf, 0, n);
    if (netLerCabecalho(r, cab) && cab.tipo === NET_PKT_RECUSADO) motivo = r.u8();
    n = tR.receber(buf);
  }
  check("versão errada é recusada com motivo", motivo === NET_RECUSA_VERSAO, "motivo=" + motivo);
  check("lixo na porta é ignorado sem derrubar ninguém", c1.estado === NET_ESTADO_CONECTADO && srv.conectado(0));
}

// 4. tempo limite nos dois lados e reconexão do mesmo par
{
  rodar(rede, srv, [], 5.2 * 60);
  check("servidor derruba cliente em silêncio por 5 s", srv.proximoSaido() === 0 && !srv.conectado(0));
  c1.conectar(tS.endereco, relogio * DT);
  rodar(rede, srv, [c1], 20);
  check("o mesmo par volta depois do tempo limite e ocupa a vaga liberada",
        c1.estado === NET_ESTADO_CONECTADO && srv.conectado(0) && srv.proximoNovo() === 0);
  const rede2 = new NetRedeMemoria(0.0, 1, 5);
  const tS2 = rede2.criarPonta();
  const srv2 = new NetServidor(tS2, 1, 60);
  const c4 = new NetCliente(rede2.criarPonta());
  c4.conectar(tS2.endereco, relogio * DT);
  rodar(rede2, srv2, [c4], 20);
  rodar(rede2, null, [c4], 5.2 * 60);
  check("cliente desiste de servidor mudo em 5 s", c4.estado === NET_ESTADO_DESCONECTADO);
}

// 5. inputs com 30% de perda: aplicados em sequência, sem buracos
{
  const redeP = new NetRedeMemoria(0.3, 1, 9);
  const tSP = redeP.criarPonta();
  const srvP = new NetServidor(tSP, 1, 60);
  const cP = new NetCliente(redeP.criarPonta());
  cP.conectar(tSP.endereco, 0.0);
  let t = 0;
  while (t < 60 && cP.estado !== NET_ESTADO_CONECTADO) {
    const agora = t * DT;
    cP.passo(agora); cP.enviar(agora); redeP.avancar();
    srvP.receber(agora); srvP.enviar(agora); redeP.avancar();
    t = t + 1;
  }
  const dado = new Uint8Array(2);
  const dst = new Uint8Array(32);
  let esperado = -1;
  let ultimoV = -1;
  let buracos = 0;
  let aplicados = 0;
  let seq = 0;
  while (seq < 600) {
    const agora = (t + seq) * DT;
    dado[0] = seq & 0xFF; dado[1] = (seq >> 8) & 0xFF;
    cP.enviarInput(seq, dado, 2);
    cP.passo(agora); cP.enviar(agora); redeP.avancar();
    srvP.receber(agora);
    const n = srvP.proximoInput(0, dst);
    if (n === 2) {
      const v = dst[0] | (dst[1] << 8);
      if (v !== ultimoV) {
        if (esperado >= 0 && v !== esperado) buracos = buracos + 1;
        aplicados = aplicados + 1;
        esperado = v + 1;
        ultimoV = v;
      }
    }
    srvP.enviar(agora); redeP.avancar();
    seq = seq + 1;
  }
  // um input só se perde se sumir nos 3 pacotes que o carregam: ~0,3³ = 2,7%
  check("com 30% de perda, ≥ 90% dos inputs aplicados e buracos só na faixa de perda³",
        aplicados >= 540 && buracos <= 40, "buracos=" + buracos + " aplicados=" + aplicados);
}

// 6. cliente já conectado chama conectar() de novo: deve encerrar a sessão
// antiga (DESCONECTAR) antes de reabrir, e não ficar preso esperando o
// servidor derrubá-lo por silêncio.
{
  c1.conectar(tS.endereco, relogio * DT);
  rodar(rede, srv, [c1], 30);
  let clientesConectados = 0;
  let k = 0;
  while (k < srv.conexoes.length) { if (srv.conexoes[k] !== null) clientesConectados = clientesConectados + 1; k = k + 1; }
  check("cliente conectado que chama conectar() de novo volta a CONECTADO com exatamente 1 cliente no servidor",
        c1.estado === NET_ESTADO_CONECTADO && clientesConectados === 1,
        "estado=" + c1.estado + " clientesConectados=" + clientesConectados);
}

if (falhas === 0) io.print("[PASSOU] net-conexao"); else io.print("[FALHOU] net-conexao: " + falhas + " falha(s)");

if(falhas>0)throw new Error("net-conexao: "+falhas+" falhas");

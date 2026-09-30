// Canal confiável ordenado sobre transporte com perda, atraso e volta de seq.
import io from "@compat/io.ts";
import { NetRedeMemoria, NetTransport } from "../src/net/transport";
import { NetConexao } from "../src/net/connection";
import { NetWriter, NetReader } from "../src/net/buffer";
import { NetCabecalho, netEscreverCabecalho, netLerCabecalho } from "../src/net/protocol";
import { NET_MTU, NET_PKT_DADOS, NET_MAX_TAM_NAO_CONFIAVEL, NET_ORCAMENTO_SNAPSHOT } from "../src/net/config";

let falhas = 0;
function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) { io.print("  [OK] " + nome); }
  else { falhas = falhas + 1; io.print("  [FALHOU] " + nome + (detalhe !== undefined ? " -- " + detalhe : "")); }
}

const w = new NetWriter(NET_MTU);
const r = new NetReader(NET_MTU);
const rm = new NetReader(64);
const cab = new NetCabecalho();
const buf = new Uint8Array(NET_MTU);
const msg = new Uint8Array(NET_MTU);

function drenar(t: NetTransport, con: NetConexao, agora: f64): void {
  let n = t.receber(buf);
  while (n > 0) {
    r.abrir(buf, 0, n);
    if (netLerCabecalho(r, cab)) con.receber(cab, r, agora);
    n = t.receber(buf);
  }
}

function cenario(nome: string, perda: f64, seqInicial: number, idInicial: number): void {
  const rede = new NetRedeMemoria(perda, 2, 42);
  const ta = rede.criarPonta();
  const tb = rede.criarPonta();
  const a = new NetConexao(tb.endereco, 0.0, seqInicial, idInicial);
  const b = new NetConexao(ta.endereco, 0.0, seqInicial, idInicial);
  const TOTAL = 1000;
  let enviadas = 0;
  let recebidas = 0;
  let emOrdem = true;
  const pedaco = new NetWriter(8);
  let t = 0;
  while (t < 4000 && (recebidas < TOTAL || a.pendentesConfiaveis() > 0)) {
    const agora = t / 60.0;
    let k = 0;
    while (k < 5 && enviadas < TOTAL) {
      pedaco.reiniciar(); pedaco.u32(enviadas);
      a.enfileirarConfiavel(pedaco.buf, pedaco.pos);
      enviadas = enviadas + 1; k = k + 1;
    }
    a.montar(w, agora); ta.enviar(tb.endereco, w.buf, w.pos);
    b.montar(w, agora); tb.enviar(ta.endereco, w.buf, w.pos);
    rede.avancar();
    drenar(tb, b, agora);
    drenar(ta, a, agora);
    let n = b.confiaveis.tirar(msg);
    while (n > 0) {
      rm.abrir(msg, 0, n);
      if (rm.u32() !== recebidas) emOrdem = false;
      recebidas = recebidas + 1;
      n = b.confiaveis.tirar(msg);
    }
    t = t + 1;
  }
  check(nome + ": 1.000 mensagens chegam, em ordem, sem duplicata",
        recebidas === TOTAL && emOrdem, "recebidas=" + recebidas + " emOrdem=" + emOrdem + " ticks=" + t);
  check(nome + ": remetente fica sem pendências e mede RTT",
        a.pendentesConfiaveis() === 0 && a.temRtt && a.rtt > 0.0 && !a.transbordou,
        "pendentes=" + a.pendentesConfiaveis() + " rtt=" + a.rtt);
}

io.print("=== net-confiavel ===");
cenario("sem perda", 0.0, 0, 0);
cenario("20% de perda", 0.2, 0, 0);
cenario("seq e id dando a volta", 0.2, 65500, 65400);

// não confiável: chega uma vez se não houver perda, e some sem reenvio
{
  const rede = new NetRedeMemoria(0.0, 0, 1);
  const ta = rede.criarPonta();
  const tb = rede.criarPonta();
  const a = new NetConexao(tb.endereco, 0.0, 0, 0);
  const b = new NetConexao(ta.endereco, 0.0, 0, 0);
  const um = new Uint8Array(1); um[0] = 42;
  a.enfileirarNaoConfiavel(um, 1);
  a.montar(w, 0.0); ta.enviar(tb.endereco, w.buf, w.pos);
  a.montar(w, 0.0); ta.enviar(tb.endereco, w.buf, w.pos);
  rede.avancar();
  drenar(tb, b, 0.0);
  const n1 = b.naoConfiaveis.tirar(msg);
  const n2 = b.naoConfiaveis.tirar(msg);
  check("não confiável chega uma vez e não é reenviada", n1 === 1 && msg[0] === 42 && n2 === 0);
}

// correção (revisão): pacote confiável truncado não pode entregar mensagem
// fantasma nem mudar estado (confEsperado/ackRemoto/ackBitsRemoto/pendentes).
{
  const b = new NetConexao(0, 0.0, 0, 0);

  // cabeçalho DADOS válido anunciando n=1 mensagem confiável, mas o pacote
  // termina logo em seguida: não sobra nem id, nem tam, nem corpo (truncado).
  const wt = new NetWriter(64);
  netEscreverCabecalho(wt, NET_PKT_DADOS, 0, 0, 0, false);
  wt.u8(1);   // n = 1 mensagem confiável anunciada...

  const rt = new NetReader(64);
  rt.abrir(wt.buf, 0, wt.pos);
  const cabTrunc = new NetCabecalho();
  const cabOk = netLerCabecalho(rt, cabTrunc);
  b.receber(cabTrunc, rt, 0.0);

  const antes = b.confiaveis.tirar(msg);
  check("pacote confiável truncado: nenhuma mensagem fantasma é entregue e nada muda",
        cabOk && antes === 0 && b.confEsperado === 0 && b.ackRemoto === 0 && !b.recebeuAlgum,
        "antes=" + antes + " confEsperado=" + b.confEsperado + " ackRemoto=" + b.ackRemoto + " recebeuAlgum=" + b.recebeuAlgum);

  // a seguir, a mensagem real (id 0) chega inteira e deve ser entregue normalmente
  const wt2 = new NetWriter(64);
  netEscreverCabecalho(wt2, NET_PKT_DADOS, 1, 0, 0, false);
  wt2.u8(1);  // n = 1
  wt2.u16(0); // id = 0
  wt2.u16(1); // tam = 1
  wt2.u8(77); // corpo completo
  wt2.u8(0);  // m = 0 mensagens não confiáveis

  const rt2 = new NetReader(64);
  rt2.abrir(wt2.buf, 0, wt2.pos);
  const cabReal = new NetCabecalho();
  netLerCabecalho(rt2, cabReal);
  b.receber(cabReal, rt2, 0.0);
  const depois = b.confiaveis.tirar(msg);
  check("pacote confiável truncado: a mensagem real id 0 chega depois e é entregue",
        depois === 1 && msg[0] === 77 && b.confEsperado === 1,
        "depois=" + depois + " confEsperado=" + b.confEsperado);
}

// correção (revisão): não confiável maior que o limite garantido (com
// confiáveis pendentes ocupando o orçamento) é recusada, e não trava a fila.
{
  check("NET_ORCAMENTO_SNAPSHOT continua abaixo do novo limite de não confiáveis",
        NET_ORCAMENTO_SNAPSHOT < NET_MAX_TAM_NAO_CONFIAVEL,
        "NET_ORCAMENTO_SNAPSHOT=" + NET_ORCAMENTO_SNAPSHOT + " NET_MAX_TAM_NAO_CONFIAVEL=" + NET_MAX_TAM_NAO_CONFIAVEL);

  const rede = new NetRedeMemoria(0.0, 0, 3);
  const ta = rede.criarPonta();
  const tb = rede.criarPonta();
  const a = new NetConexao(tb.endereco, 0.0, 0, 0);
  const b = new NetConexao(ta.endereco, 0.0, 0, 0);

  // enche de confiáveis pendentes para ocupar todo o orçamento do pacote
  const pedacoGrande = new NetWriter(64);
  let k = 0;
  while (k < 20) {
    pedacoGrande.reiniciar();
    let z = 0; while (z < 20) { pedacoGrande.u8(z); z = z + 1; }
    a.enfileirarConfiavel(pedacoGrande.buf, pedacoGrande.pos);
    k = k + 1;
  }

  const grandeDemais = new Uint8Array(NET_MAX_TAM_NAO_CONFIAVEL + 1);
  a.enfileirarNaoConfiavel(grandeDemais, grandeDemais.length);   // deve ser recusada
  const pequena = new Uint8Array(3); pequena[0] = 5; pequena[1] = 6; pequena[2] = 7;
  a.enfileirarNaoConfiavel(pequena, 3);

  check("não confiável maior que o limite é recusada, sem entrar na fila",
        a.ncPendentes() === 1, "ncPendentes=" + a.ncPendentes());

  a.montar(w, 0.0); ta.enviar(tb.endereco, w.buf, w.pos);
  rede.avancar();
  drenar(tb, b, 0.0);
  const nc = b.naoConfiaveis.tirar(msg);
  check("não confiável pequena chega no próximo pacote, não fica presa atrás da grande recusada",
        nc === 3 && msg[0] === 5 && msg[1] === 6 && msg[2] === 7, "nc=" + nc);
}

if (falhas === 0) io.print("[PASSOU] net-confiavel"); else io.print("[FALHOU] net-confiavel: " + falhas + " falha(s)");

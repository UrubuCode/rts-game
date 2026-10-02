// Transporte UDP (node:dgram). Particularidades medidas neste runtime:
// - o evento 'message' entrega Uint8Array (não Buffer);
// - os eventos só são entregues dentro de send/bind/connect/close do dgram e
//   de time.sleep_ms (que chama o pump do runtime) — address() NÃO entrega
//   (lido em rts-node/src/dgram/socket.rs e medido: na janela, 0 pacotes em
//   6 s só com address(); ~60/s com um send por quadro). Por isso bombear()
//   manda um datagrama de 0 bytes para a própria porta: o pump roda no começo
//   do send, e o datagrama vazio é descartado em chegou().
import dgram from "node:dgram";
import { NetTransport } from "./transport";
import { NetFila } from "./buffer";
import { NET_MTU } from "./config";

const NET_UDP_IP_LOCAL = "127.0.0.1";

export class NetTransporteUdp extends NetTransport {
  private closed:boolean=false;
  sock: any;
  ips: string[];
  portas: number[];
  chaves: string[];
  caixa: NetFila;
  erros: number;
  portaLocal: number;
  vazio: Uint8Array;

  constructor(porta: number) {
    super();
    this.ips = [];
    this.portas = [];
    this.chaves = [];
    this.caixa = new NetFila();
    this.erros = 0;
    this.sock = dgram.createSocket("udp4");
    const eu = this;
    this.sock.on("message", (msg: any, rinfo: any) => { eu.chegou(msg, rinfo.address, rinfo.port); });
    // Sem este handler um 'error' derruba o processo (medido: no Windows,
    // mandar UDP para uma porta fechada vira erro de socket no receive
    // seguinte — acontece toda vez que um par fecha antes do tempo limite).
    this.sock.on("error", (e: any) => { eu.erros = eu.erros + 1; });
    this.sock.bind(porta);
    this.portaLocal = this.sock.address().port;
    this.vazio = new Uint8Array(0);
  }

  /// Id numérico do par "ip:porta" (cria na primeira vez).
  par(ip: string, porta: number): number {
    const chave = ip + ":" + porta;
    let i = this.chaves.indexOf(chave);
    if (i < 0) {
      i = this.chaves.length;
      this.chaves.push(chave);
      this.ips.push(ip);
      this.portas.push(porta);
    }
    return i;
  }

  chegou(msg: any, ip: string, porta: number): void {
    if (msg.length === 0) return;   // o datagrama vazio de bombear(), ou lixo
    if(msg.length>NET_MTU)return;
    if(this.chaves.length>=256&&this.chaves.indexOf(ip+":"+porta)<0)return;
    this.caixa.por(this.par(ip, porta), msg, 0, msg.length);
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {
    if(this.closed)return;
    if (destino < 0 || destino >= this.ips.length) return;
    this.bytesEnviados = this.bytesEnviados + tamanho;
    this.sock.send(dados.subarray(0, tamanho), this.portas[destino], this.ips[destino]);
  }

  /// Entrega os pacotes pendentes: um send vazio à própria porta é o que faz
  /// o runtime rodar o pump (ver o cabeçalho). Sem alocação: buffer fixo.
  bombear(): void {
    if(this.closed)return;
    this.sock.send(this.vazio, this.portaLocal, NET_UDP_IP_LOCAL);
  }

  receber(dados: Uint8Array): number {
    const n = this.caixa.tirar(dados);
    if (n > 0) this.origemRecebida = this.caixa.origemTirada;
    return n;
  }

  fechar(): void {
    if(this.closed)return;
    this.closed=true;
    this.sock.close();
  }
}

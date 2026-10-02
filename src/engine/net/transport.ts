// Transporte plugável: a camada de conexão só vê "pares" numerados e bytes.
import { NetFila } from "./buffer";
import { NET_FAIXA_PAR_COMPOSTO } from "./config";

export class NetTransport {
  origemRecebida: number;
  bytesEnviados: number;

  constructor() {
    this.origemRecebida = -1;
    this.bytesEnviados = 0;
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {}
  /// Deixa os pacotes pendentes chegarem (no UDP: chama o dgram).
  bombear(): void {}
  /// Copia o próximo pacote para `dados` e devolve o tamanho (0 = nada).
  receber(dados: Uint8Array): number { return 0; }
  fechar(): void {}
}

/// Rede em memória para testes: perda e atraso em ticks, com PRNG semeado.
export class NetRedeMemoria {
  tick: number;
  perda: f64;
  atraso: number;
  semente: number;
  pontas: NetTransporteMemoria[];
  pOrigem: number[];
  pDestino: number[];
  pEntrega: number[];
  pDados: Uint8Array[];
  pTam: number[];

  constructor(perda: f64, atraso: number, semente: number) {
    this.tick = 0;
    this.perda = perda;
    this.atraso = atraso;
    this.semente = semente | 0;
    this.pontas = [];
    this.pOrigem = []; this.pDestino = []; this.pEntrega = []; this.pDados = []; this.pTam = [];
  }

  criarPonta(): NetTransporteMemoria {
    const p = new NetTransporteMemoria(this, this.pontas.length);
    this.pontas.push(p);
    return p;
  }

  rnd(): f64 {
    this.semente = ((this.semente * 1664525 + 1013904223) | 0);
    return (this.semente >>> 0) / 4294967296.0;
  }

  postar(origem: number, destino: number, dados: Uint8Array, n: number): void {
    if (destino < 0 || destino >= this.pontas.length) return;
    if (this.perda > 0.0 && this.rnd() < this.perda) return;
    const c = new Uint8Array(n);
    c.set(dados.subarray(0, n));
    this.pOrigem.push(origem);
    this.pDestino.push(destino);
    this.pEntrega.push(this.tick + this.atraso);
    this.pDados.push(c);
    this.pTam.push(n);
  }

  /// Um tick de rede: entrega o que venceu, em ordem de envio.
  avancar(): void {
    this.tick = this.tick + 1;
    let w = 0;
    let i = 0;
    while (i < this.pOrigem.length) {
      if (this.pEntrega[i] <= this.tick) {
        this.pontas[this.pDestino[i]].chegou(this.pOrigem[i], this.pDados[i], this.pTam[i]);
      } else {
        this.pOrigem[w] = this.pOrigem[i]; this.pDestino[w] = this.pDestino[i];
        this.pEntrega[w] = this.pEntrega[i]; this.pDados[w] = this.pDados[i]; this.pTam[w] = this.pTam[i];
        w = w + 1;
      }
      i = i + 1;
    }
    this.pOrigem.length = w; this.pDestino.length = w; this.pEntrega.length = w;
    this.pDados.length = w; this.pTam.length = w;
  }
}

export class NetTransporteMemoria extends NetTransport {
  rede: NetRedeMemoria;
  endereco: number;
  caixa: NetFila;

  constructor(rede: NetRedeMemoria, endereco: number) {
    super();
    this.rede = rede;
    this.endereco = endereco;
    this.caixa = new NetFila();
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {
    this.bytesEnviados = this.bytesEnviados + tamanho;
    this.rede.postar(this.endereco, destino, dados, tamanho);
  }

  chegou(origem: number, dados: Uint8Array, n: number): void {
    this.caixa.por(origem, dados, 0, n);
  }

  receber(dados: Uint8Array): number {
    const n = this.caixa.tirar(dados);
    if (n > 0) this.origemRecebida = this.caixa.origemTirada;
    return n;
  }
}

/// Dois transportes vistos como um: o servidor hospedado atende o jogador
/// local pela memória (parte A) e os remotos pelo UDP (parte B) com um único
/// NetServidor. Os pares da parte B ganham o deslocamento
/// NET_FAIXA_PAR_COMPOSTO; nada é copiado nem alocado por chamada.
export class NetTransporteComposto extends NetTransport {
  a: NetTransport;
  b: NetTransport;

  constructor(a: NetTransport, b: NetTransport) {
    super();
    this.a = a;
    this.b = b;
  }

  enviar(destino: number, dados: Uint8Array, tamanho: number): void {
    this.bytesEnviados = this.bytesEnviados + tamanho;
    if (destino < NET_FAIXA_PAR_COMPOSTO) this.a.enviar(destino, dados, tamanho);
    else this.b.enviar(destino - NET_FAIXA_PAR_COMPOSTO, dados, tamanho);
  }

  bombear(): void {
    this.a.bombear();
    this.b.bombear();
  }

  /// Esvazia a parte A antes da B: a ordem entre partes não importa para o
  /// protocolo (cada par tem a própria conexão).
  receber(dados: Uint8Array): number {
    let n = this.a.receber(dados);
    if (n > 0) { this.origemRecebida = this.a.origemRecebida; return n; }
    n = this.b.receber(dados);
    if (n > 0) this.origemRecebida = NET_FAIXA_PAR_COMPOSTO + this.b.origemRecebida;
    return n;
  }

  fechar(): void {
    this.a.fechar();
    this.b.fechar();
  }
}

// Servidor: aceita conexões (com versão e limite), entrega inputs ao jogo um
// por tick e envia um pacote por conexão a cada enviar().
import { NetTransport } from "./transport";
import { NetConexao } from "./connection";
import { NetWriter, NetReader } from "./buffer";
import { NetCabecalho, netEscreverCabecalho, netLerCabecalho, netSeqMaisNovo, netSeqDiferenca } from "./protocol";
import {
  NET_MTU, NET_VERSAO_PROTOCOLO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_PKT_DESCONECTAR, NET_PKT_DADOS,
  NET_MSG_BEMVINDO, NET_MSG_INPUT, NET_RECUSA_VERSAO, NET_RECUSA_LOTADO, NET_TEMPO_LIMITE_S,
  NET_REPETICOES_DESCONECTAR, NET_TAXA_SNAPSHOT, NET_JANELA_INPUT, NET_MAX_TAM_INPUT,
  NET_MAX_ATRASO_INPUT, NET_MAX_PACOTES_POR_ENVIO, NET_INPUTS_REDUNDANTES,
} from "./config";

export class NetServidor {
  t: NetTransport;
  maxClientes: number;
  taxaTick: number;
  tick: number;
  conexoes: (NetConexao | null)[];
  boasVindas: Uint8Array;
  boasVindasTam: number;
  novos: number[];
  saidos: number[];
  w: NetWriter;
  r: NetReader;
  rMsg: NetReader;
  cab: NetCabecalho;
  pacote: Uint8Array;
  msg: Uint8Array;
  inSeq: number[][];
  inDados: Uint8Array[][];
  inTam: number[][];
  inTem: boolean[];
  inMaior: number[];
  inAplicado: number[];
  inUltimo: Uint8Array[];
  inUltimoTam: number[];

  constructor(t: NetTransport, maxClientes: number, taxaTick: number) {
    this.t = t;
    this.maxClientes = maxClientes;
    this.taxaTick = taxaTick;
    this.tick = 0;
    this.conexoes = [];
    this.boasVindas = new Uint8Array(0);
    this.boasVindasTam = 0;
    this.novos = [];
    this.saidos = [];
    this.w = new NetWriter(NET_MTU);
    this.r = new NetReader(NET_MTU);
    this.rMsg = new NetReader(NET_MTU);
    this.cab = new NetCabecalho();
    this.pacote = new Uint8Array(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.inSeq = []; this.inDados = []; this.inTam = []; this.inTem = []; this.inMaior = [];
    this.inAplicado = []; this.inUltimo = []; this.inUltimoTam = [];
    let c = 0;
    while (c < maxClientes) {
      this.conexoes.push(null);
      const seqs: number[] = [];
      const dados: Uint8Array[] = [];
      const tams: number[] = [];
      let k = 0;
      while (k < NET_JANELA_INPUT) { seqs.push(-1); dados.push(new Uint8Array(NET_MAX_TAM_INPUT)); tams.push(0); k = k + 1; }
      this.inSeq.push(seqs); this.inDados.push(dados); this.inTam.push(tams);
      this.inTem.push(false); this.inMaior.push(0); this.inAplicado.push(0);
      this.inUltimo.push(new Uint8Array(NET_MAX_TAM_INPUT)); this.inUltimoTam.push(0);
      c = c + 1;
    }
  }

  definirBoasVindas(dados: Uint8Array, n: number): void {
    this.boasVindas = new Uint8Array(n);
    let i = 0;
    while (i < n) { this.boasVindas[i] = dados[i]; i = i + 1; }
    this.boasVindasTam = n;
  }

  conectado(c: number): boolean { return c >= 0 && c < this.maxClientes && this.conexoes[c] !== null; }

  clienteDoPar(par: number): number {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null && con.par === par) return c;
      c = c + 1;
    }
    return -1;
  }

  proximoNovo(): number {
    if (this.novos.length === 0) return -1;
    const c = this.novos[0];
    this.novos.splice(0, 1);
    return c;
  }

  proximoSaido(): number {
    if (this.saidos.length === 0) return -1;
    const c = this.saidos[0];
    this.saidos.splice(0, 1);
    return c;
  }

  receber(agora: f64): void {
    this.t.bombear();
    let n = this.t.receber(this.pacote);
    while (n > 0) {
      this.processarPacote(this.t.origemRecebida, n, agora);
      n = this.t.receber(this.pacote);
    }
  }

  processarPacote(origem: number, n: number, agora: f64): void {
    const r = this.r;
    r.abrir(this.pacote, 0, n);
    if (!netLerCabecalho(r, this.cab)) return;
    const c = this.clienteDoPar(origem);
    if (this.cab.tipo === NET_PKT_CONECTAR) {
      if (c < 0) this.aceitar(origem, agora);
      return;
    }
    if (c < 0 || this.cab.versao !== NET_VERSAO_PROTOCOLO) return;
    if (this.cab.tipo === NET_PKT_DESCONECTAR) { this.desconectar(c, false); return; }
    if (this.cab.tipo !== NET_PKT_DADOS) return;
    const con = this.conexoes[c];
    if (con === null) return;
    con.receber(this.cab, r, agora);
    let m = con.naoConfiaveis.tirar(this.msg);
    while (m > 0) {
      this.processarMensagem(c, m);
      m = con.naoConfiaveis.tirar(this.msg);
    }
    while (con.confiaveis.tirar(this.msg) > 0) { /* o cliente não manda confiáveis no subprojeto A */ }
  }

  aceitar(origem: number, agora: f64): void {
    if (this.cab.versao !== NET_VERSAO_PROTOCOLO) { this.recusar(origem, NET_RECUSA_VERSAO); return; }
    let c = -1;
    let i = 0;
    while (i < this.maxClientes && c < 0) { if (this.conexoes[i] === null) c = i; i = i + 1; }
    if (c < 0) { this.recusar(origem, NET_RECUSA_LOTADO); return; }
    const con = new NetConexao(origem, agora, 0, 0);
    this.conexoes[c] = con;
    this.inTem[c] = false;
    this.inUltimoTam[c] = 0;
    let k = 0;
    while (k < NET_JANELA_INPUT) { this.inSeq[c][k] = -1; k = k + 1; }
    const w = this.w;
    w.reiniciar();
    w.u8(NET_MSG_BEMVINDO);
    w.u8(c);
    w.u32(this.tick);
    w.u8(this.taxaTick);
    w.u8(NET_TAXA_SNAPSHOT);
    w.u16(this.boasVindasTam);
    w.bytes(this.boasVindas, this.boasVindasTam);
    con.enfileirarConfiavel(w.buf, w.pos);
    this.novos.push(c);
  }

  recusar(origem: number, motivo: number): void {
    const w = this.w;
    w.reiniciar();
    netEscreverCabecalho(w, NET_PKT_RECUSADO, 0, 0, 0, false);
    w.u8(motivo);
    this.t.enviar(origem, w.buf, w.pos);
  }

  processarMensagem(c: number, n: number): void {
    const r = this.rMsg;
    r.abrir(this.msg, 0, n);
    if (r.u8() !== NET_MSG_INPUT) return;
    const k = r.u8();
    let i = 0;
    while (i < k && !r.erro) {
      const seq = r.u16();
      const tam = r.u8();
      if (tam > NET_MAX_TAM_INPUT || tam > r.resta()) { r.erro = true; return; }
      if (!this.inTem[c] || netSeqMaisNovo(seq, this.inAplicado[c])) {
        const slot = seq % NET_JANELA_INPUT;
        this.inSeq[c][slot] = seq;
        r.bytes(this.inDados[c][slot], tam);
        this.inTam[c][slot] = tam;
        if (!this.inTem[c]) {
          this.inTem[c] = true;
          this.inAplicado[c] = (seq - 1) & 0xFFFF;
          this.inMaior[c] = seq;
        } else if (netSeqMaisNovo(seq, this.inMaior[c])) {
          this.inMaior[c] = seq;
        }
      } else {
        r.pos = r.pos + tam;
      }
      i = i + 1;
    }
  }

  /// O input a aplicar neste tick: o próximo em sequência se já chegou; senão
  /// repete o último. Devolve o tamanho (0 = ainda nenhum input).
  proximoInput(c: number, dst: Uint8Array): number {
    if (!this.inTem[c]) return 0;
    let alvo = (this.inAplicado[c] + 1) & 0xFFFF;
    let slot = alvo % NET_JANELA_INPUT;
    // Pula só o que já está comprovadamente perdido: cada input viaja nos
    // pacotes dos NET_INPUTS_REDUNDANTES ticks seguintes ao seu; se já chegou
    // um seq pelo menos NET_INPUTS_REDUNDANTES à frente do alvo, todos os
    // pacotes que poderiam carregá-lo já passaram, então ele nunca vai
    // chegar — esperar só acumula backlog sem motivo.
    while (this.inSeq[c][slot] !== alvo && netSeqDiferenca(this.inMaior[c], alvo) >= NET_INPUTS_REDUNDANTES) {
      alvo = (alvo + 1) & 0xFFFF;
      this.inAplicado[c] = (alvo - 1) & 0xFFFF;
      slot = alvo % NET_JANELA_INPUT;
    }
    // Sobrecarga real (fila cresceu além do razoável mesmo depois do passo
    // acima): salta direto para perto do mais novo.
    if (netSeqDiferenca(this.inMaior[c], this.inAplicado[c]) > NET_MAX_ATRASO_INPUT) {
      this.inAplicado[c] = (this.inMaior[c] - 1) & 0xFFFF;
      alvo = (this.inAplicado[c] + 1) & 0xFFFF;
      slot = alvo % NET_JANELA_INPUT;
    }
    if (this.inSeq[c][slot] === alvo) {
      const n = this.inTam[c][slot];
      const src = this.inDados[c][slot];
      const ult = this.inUltimo[c];
      ult.set(src.subarray(0, n));
      this.inUltimoTam[c] = n;
      this.inAplicado[c] = alvo;
    }
    const n = this.inUltimoTam[c];
    const ult = this.inUltimo[c];
    dst.set(ult.subarray(0, n));
    return n;
  }

  enviarConfiavel(c: number, dados: Uint8Array, n: number): void {
    const con = this.conexoes[c];
    if (con === null) return;
    con.enfileirarConfiavel(dados, n);
    if (con.transbordou) this.desconectar(c, true);
  }

  enviarConfiavelTodos(dados: Uint8Array, n: number): void {
    let c = 0;
    while (c < this.maxClientes) { if (this.conexoes[c] !== null) this.enviarConfiavel(c, dados, n); c = c + 1; }
  }

  enviarNaoConfiavelTodos(dados: Uint8Array, n: number): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null) con.enfileirarNaoConfiavel(dados, n);
      c = c + 1;
    }
  }

  enviar(agora: f64): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null) {
        let p = 0;
        let continuar = true;
        while (continuar) {
          con.montar(this.w, agora);
          this.t.enviar(con.par, this.w.buf, this.w.pos);
          p = p + 1;
          continuar = con.ncPendentes() > 0 && p < NET_MAX_PACOTES_POR_ENVIO;
        }
      }
      c = c + 1;
    }
  }

  verificarTempo(agora: f64): void {
    let c = 0;
    while (c < this.maxClientes) {
      const con = this.conexoes[c];
      if (con !== null && agora - con.ultimoContato > NET_TEMPO_LIMITE_S) this.desconectar(c, true);
      c = c + 1;
    }
  }

  desconectar(c: number, avisar: boolean): void {
    const con = this.conexoes[c];
    if (con === null) return;
    if (avisar) {
      const w = this.w;
      w.reiniciar();
      netEscreverCabecalho(w, NET_PKT_DESCONECTAR, 0, 0, 0, false);
      let k = 0;
      while (k < NET_REPETICOES_DESCONECTAR) { this.t.enviar(con.par, w.buf, w.pos); k = k + 1; }
    }
    this.conexoes[c] = null;
    this.inTem[c] = false;
    this.inUltimoTam[c] = 0;
    this.saidos.push(c);
  }
}

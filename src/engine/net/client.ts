// Cliente: conecta (repetindo CONECTAR até o BEMVINDO), manda os últimos
// inputs em todo pacote e separa as mensagens do servidor para o jogo.
import { NetTransport } from "./transport";
import { NetConexao } from "./connection";
import { NetWriter, NetReader, NetFila } from "./buffer";
import { NetCabecalho, writeControlHeader, netLerCabecalho } from "./protocol";
import {
  NET_MTU, NET_VERSAO_PROTOCOLO, NET_PKT_CONECTAR, NET_PKT_RECUSADO, NET_PKT_DESCONECTAR, NET_PKT_DADOS,
  NET_MSG_BEMVINDO, NET_MSG_INPUT, NET_INTERVALO_CONECTAR_S, NET_TEMPO_LIMITE_S, NET_INPUTS_REDUNDANTES,
  NET_MAX_TAM_INPUT, NET_REPETICOES_DESCONECTAR, NET_ESTADO_DESCONECTADO, NET_ESTADO_CONECTANDO,
  NET_ESTADO_CONECTADO, NET_ESTADO_RECUSADO,
} from "./config";

export class NetCliente {
  t: NetTransport;
  servidor: number;
  con: NetConexao | null;
  estado: number;
  clienteId: number;
  tickServidor: number;
  taxaTick: number;
  taxaSnapshot: number;
  motivoRecusa: number;
  boasVindas: Uint8Array;
  boasVindasTam: number;
  ultimoConectar: f64;
  mensagens: NetFila;
  instantaneos: NetFila;
  w: NetWriter;
  r: NetReader;
  rMsg: NetReader;
  cab: NetCabecalho;
  pacote: Uint8Array;
  msg: Uint8Array;
  inSeq: number[];
  inDados: Uint8Array[];
  inTam: number[];
  inN: number;

  constructor(t: NetTransport) {
    this.t = t;
    this.servidor = -1;
    this.con = null;
    this.estado = NET_ESTADO_DESCONECTADO;
    this.clienteId = -1;
    this.tickServidor = 0;
    this.taxaTick = 0;
    this.taxaSnapshot = 0;
    this.motivoRecusa = 0;
    this.boasVindas = new Uint8Array(0);
    this.boasVindasTam = 0;
    this.ultimoConectar = -1.0e9;
    this.mensagens = new NetFila();
    this.instantaneos = new NetFila();
    this.w = new NetWriter(NET_MTU);
    this.r = new NetReader(NET_MTU);
    this.rMsg = new NetReader(NET_MTU);
    this.cab = new NetCabecalho();
    this.pacote = new Uint8Array(NET_MTU);
    this.msg = new Uint8Array(NET_MTU);
    this.inSeq = []; this.inDados = []; this.inTam = [];
    let i = 0;
    while (i < NET_INPUTS_REDUNDANTES) { this.inSeq.push(0); this.inDados.push(new Uint8Array(NET_MAX_TAM_INPUT)); this.inTam.push(0); i = i + 1; }
    this.inN = 0;
  }

  conectar(servidor: number, agora: f64): void {
    // Se já está conectado, encerra a sessão antiga primeiro: sem isso, os
    // CONECTAR novos chegam do mesmo par e o servidor os ignora (já tem esse
    // par registrado), o BEMVINDO nunca volta e o cliente fica preso em
    // CONECTANDO até o servidor derrubá-lo por silêncio, 5 s depois.
    if (this.estado === NET_ESTADO_CONECTADO) this.desconectar();
    while (this.t.receber(this.pacote) > 0) { /* descarta pacotes de uma sessão anterior */ }
    this.servidor = servidor;
    this.estado = NET_ESTADO_CONECTANDO;
    this.con = new NetConexao(servidor, agora, 0, 0);
    this.ultimoConectar = -1.0e9;
    this.inN = 0;
  }

  passo(agora: f64): void {
    this.t.bombear();
    let n = this.t.receber(this.pacote);
    let received=0;
    while (n > 0 && received++ < 256) {
      if (this.t.origemRecebida === this.servidor) this.processarPacote(n, agora);
      n = this.t.receber(this.pacote);
    }
    if (this.estado === NET_ESTADO_CONECTANDO && agora - this.ultimoConectar >= NET_INTERVALO_CONECTAR_S) {
      const w = this.w;
      w.reiniciar();
      writeControlHeader(w, NET_PKT_CONECTAR);
      this.t.enviar(this.servidor, w.buf, w.pos);
      this.ultimoConectar = agora;
    }
    const con = this.con;
    if ((this.estado === NET_ESTADO_CONECTANDO || this.estado === NET_ESTADO_CONECTADO) &&
        con !== null && agora - con.ultimoContato > NET_TEMPO_LIMITE_S) {
      this.estado = NET_ESTADO_DESCONECTADO;
    }
  }

  processarPacote(n: number, agora: f64): void {
    const r = this.r;
    r.abrir(this.pacote, 0, n);
    if (!netLerCabecalho(r, this.cab) || this.cab.versao !== NET_VERSAO_PROTOCOLO) return;
    if (this.cab.tipo === NET_PKT_RECUSADO) { this.motivoRecusa = r.u8(); this.estado = NET_ESTADO_RECUSADO; return; }
    if (this.cab.tipo === NET_PKT_DESCONECTAR) { this.estado = NET_ESTADO_DESCONECTADO; return; }
    const con = this.con;
    if (this.cab.tipo !== NET_PKT_DADOS || con === null) return;
    if (this.estado !== NET_ESTADO_CONECTANDO && this.estado !== NET_ESTADO_CONECTADO) return;
    con.receber(this.cab, r, agora);
    let m = con.confiaveis.tirar(this.msg);
    while (m > 0) {
      if (this.msg[0] === NET_MSG_BEMVINDO) this.lerBemvindo(m);
      else this.mensagens.por(0, this.msg, 0, m);
      m = con.confiaveis.tirar(this.msg);
    }
    m = con.naoConfiaveis.tirar(this.msg);
    while (m > 0) {
      this.instantaneos.por(0, this.msg, 0, m);
      m = con.naoConfiaveis.tirar(this.msg);
    }
  }

  lerBemvindo(n: number): void {
    const r = this.rMsg;
    r.abrir(this.msg, 0, n);
    r.u8();
    this.clienteId = r.u8();
    this.tickServidor = r.u32();
    this.taxaTick = r.u8();
    this.taxaSnapshot = r.u8();
    const tam = r.u16();
    this.boasVindas = new Uint8Array(tam);
    r.bytes(this.boasVindas, tam);
    this.boasVindasTam = tam;
    if (!r.erro) this.estado = NET_ESTADO_CONECTADO;
  }

  /// Guarda o input mais novo; os NET_INPUTS_REDUNDANTES últimos vão em todo pacote.
  enviarInput(seq: number, dados: Uint8Array, n: number): void {
    if (n > NET_MAX_TAM_INPUT) return;
    if (this.inN < NET_INPUTS_REDUNDANTES) this.inN = this.inN + 1;
    else {
      let i = 0;
      while (i < NET_INPUTS_REDUNDANTES - 1) {
        this.inSeq[i] = this.inSeq[i + 1];
        const d = this.inDados[i]; this.inDados[i] = this.inDados[i + 1]; this.inDados[i + 1] = d;
        this.inTam[i] = this.inTam[i + 1];
        i = i + 1;
      }
    }
    const k = this.inN - 1;
    this.inSeq[k] = seq & 0xFFFF;
    let j = 0;
    while (j < n) { this.inDados[k][j] = dados[j]; j = j + 1; }
    this.inTam[k] = n;
  }

  enviar(agora: f64): void {
    const con = this.con;
    if (this.estado !== NET_ESTADO_CONECTADO || con === null) return;
    const w = this.w;
    if (this.inN > 0) {
      w.reiniciar();
      w.u8(NET_MSG_INPUT);
      w.u8(this.inN);
      let i = 0;
      while (i < this.inN) {
        w.u16(this.inSeq[i]);
        w.u8(this.inTam[i]);
        w.bytes(this.inDados[i], this.inTam[i]);
        i = i + 1;
      }
      con.enfileirarNaoConfiavel(w.buf, w.pos);
    }
    con.montar(w, agora);
    this.t.enviar(this.servidor, w.buf, w.pos);
  }

  desconectar(): void {
    if (this.servidor >= 0 && this.estado === NET_ESTADO_CONECTADO) {
      const w = this.w;
      w.reiniciar();
      writeControlHeader(w, NET_PKT_DESCONECTAR);
      let k = 0;
      while (k < NET_REPETICOES_DESCONECTAR) { this.t.enviar(this.servidor, w.buf, w.pos); k = k + 1; }
    }
    this.estado = NET_ESTADO_DESCONECTADO;
  }
}

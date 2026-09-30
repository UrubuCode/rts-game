// Estado de uma conexão: números de sequência e acks (seq/ack/ackBits), canal
// confiável ordenado por reenvio "de carona" e RTT. Tempo entra por parâmetro.
import { NetWriter, NetReader, NetFila } from "./buffer";
import { NetCabecalho, netEscreverCabecalho, netSeqDiferenca, netSeqMaisNovo } from "./protocol";
import {
  NET_PKT_DADOS, NET_JANELA_SEQ, NET_MAX_CONFIAVEIS_PENDENTES, NET_ORCAMENTO_CONFIAVEL,
  NET_MAX_TAM_CONFIAVEL, NET_MAX_TAM_NAO_CONFIAVEL, NET_ALFA_RTT, NET_TAM_CABECALHO, NET_MTU,
} from "./config";

export class NetConexao {
  par: number;
  seqEnvio: number;
  ackRemoto: number;
  ackBitsRemoto: number;
  recebeuAlgum: boolean;
  regSeq: number[];
  regTempo: f64[];
  regPrimeiro: number[];
  regUltimo: number[];
  confProximoId: number;
  pendId: number[];
  pendDados: Uint8Array[];
  pendTam: number[];
  confEsperado: number;
  adId: number[];
  adDados: Uint8Array[];
  adTam: number[];
  confiaveis: NetFila;
  naoConfiaveis: NetFila;
  ncSaida: NetFila;
  rtt: f64;
  temRtt: boolean;
  ultimoContato: f64;
  transbordou: boolean;

  constructor(par: number, agora: f64, seqInicial: number, idInicial: number) {
    this.par = par;
    this.seqEnvio = seqInicial & 0xFFFF;
    this.ackRemoto = 0;
    this.ackBitsRemoto = 0;
    this.recebeuAlgum = false;
    this.regSeq = []; this.regTempo = []; this.regPrimeiro = []; this.regUltimo = [];
    let i = 0;
    while (i < NET_JANELA_SEQ) {
      this.regSeq.push(-1); this.regTempo.push(0.0); this.regPrimeiro.push(-1); this.regUltimo.push(-1);
      i = i + 1;
    }
    this.confProximoId = idInicial & 0xFFFF;
    this.pendId = []; this.pendDados = []; this.pendTam = [];
    this.confEsperado = idInicial & 0xFFFF;
    this.adId = []; this.adDados = []; this.adTam = [];
    this.confiaveis = new NetFila();
    this.naoConfiaveis = new NetFila();
    this.ncSaida = new NetFila();
    this.rtt = 0.0;
    this.temRtt = false;
    this.ultimoContato = agora;
    this.transbordou = false;
  }

  pendentesConfiaveis(): number { return this.pendId.length; }

  enfileirarConfiavel(dados: Uint8Array, n: number): void {
    if (n > NET_MAX_TAM_CONFIAVEL || this.pendId.length >= NET_MAX_CONFIAVEIS_PENDENTES) {
      this.transbordou = true;
      return;
    }
    const c = new Uint8Array(n);
    let i = 0;
    while (i < n) { c[i] = dados[i]; i = i + 1; }
    this.pendId.push(this.confProximoId);
    this.pendDados.push(c);
    this.pendTam.push(n);
    this.confProximoId = (this.confProximoId + 1) & 0xFFFF;
  }

  enfileirarNaoConfiavel(dados: Uint8Array, n: number): void {
    // acima disso, não cabe garantidamente com confiáveis pendentes ocupando
    // todo o orçamento — recusar aqui evita que ela entope a cabeça da fila.
    if (n > NET_MAX_TAM_NAO_CONFIAVEL) return;
    this.ncSaida.por(0, dados, 0, n);
  }

  /// Monta um pacote DADOS: confiáveis pendentes (até o orçamento) e as não
  /// confiáveis que couberem. As que não couberem ficam para o próximo pacote.
  montar(w: NetWriter, agora: f64): void {
    w.reiniciar();
    const seq = this.seqEnvio;
    this.seqEnvio = (seq + 1) & 0xFFFF;
    netEscreverCabecalho(w, NET_PKT_DADOS, seq, this.ackRemoto, this.ackBitsRemoto, this.recebeuAlgum);

    const posN = w.pos;
    w.u8(0);
    const inicioConf = w.pos;
    let n = 0;
    let primeiro = -1;
    let ultimo = -1;
    let i = 0;
    while (i < this.pendId.length && n < 255) {
      const tam = this.pendTam[i];
      if (w.pos - inicioConf + 4 + tam > NET_ORCAMENTO_CONFIAVEL) i = this.pendId.length;
      else {
        w.u16(this.pendId[i]);
        w.u16(tam);
        w.bytes(this.pendDados[i], tam);
        if (primeiro < 0) primeiro = this.pendId[i];
        ultimo = this.pendId[i];
        n = n + 1;
        i = i + 1;
      }
    }
    w.u8Em(posN, n);

    const posM = w.pos;
    w.u8(0);
    let m = 0;
    const f = this.ncSaida;
    let cabeMais = true;
    while (cabeMais && f.inicio < f.origem.length && m < 255) {
      const tam = f.tam[f.inicio];
      if (!w.cabe(2 + tam)) cabeMais = false;          // o resto fica para o próximo pacote
      else {
        w.u16(tam);
        w.bytes(f.dados[f.inicio], tam);
        f.inicio = f.inicio + 1;
        m = m + 1;
      }
    }
    f.compactar();
    w.u8Em(posM, m);

    const slot = seq % NET_JANELA_SEQ;
    this.regSeq[slot] = seq;
    this.regTempo[slot] = agora;
    this.regPrimeiro[slot] = primeiro;
    this.regUltimo[slot] = ultimo;
  }

  ncPendentes(): number { return this.ncSaida.tamanho(); }

  receber(c: NetCabecalho, r: NetReader, agora: f64): void {
    // valida o corpo inteiro antes de aplicar qualquer coisa: um pacote
    // malformado/truncado é lixo e não pode mudar estado nenhum (nem
    // confEsperado/adiantados, nem ackRemoto/ackBitsRemoto/pendentes).
    const inicio = r.pos;
    if (!this.corpoValido(r)) return;
    r.pos = inicio;

    this.ultimoContato = agora;
    this.registrarRecebido(c.seq);
    if (c.ackValido) this.processarAcks(c.ack, c.ackBits, agora);
    const n = r.u8();
    let i = 0;
    while (i < n && !r.erro) {
      const id = r.u16();
      const tam = r.u16();
      if (tam > r.resta()) { r.erro = true; return; }
      const d = new Uint8Array(tam);
      r.bytes(d, tam);
      this.receberConfiavel(id, d, tam);
      i = i + 1;
    }
    const m = r.u8();
    let j = 0;
    while (j < m && !r.erro) {
      const tam = r.u16();
      if (tam > r.resta()) { r.erro = true; return; }
      this.naoConfiaveis.por(0, r.buf, r.pos, tam);
      r.pos = r.pos + tam;
      j = j + 1;
    }
  }

  /// Só lê e checa limites, sem aplicar nada: usado por `receber` para
  /// garantir que um corpo truncado nunca produz efeito colateral algum.
  corpoValido(r: NetReader): boolean {
    const n = r.u8();
    if (r.erro) return false;
    let i = 0;
    while (i < n) {
      r.u16();                       // id
      if (r.erro) return false;
      const tam = r.u16();
      if (r.erro) return false;
      if (tam > r.resta()) return false;
      r.pos = r.pos + tam;
      i = i + 1;
    }
    const m = r.u8();
    if (r.erro) return false;
    let j = 0;
    while (j < m) {
      const tam = r.u16();
      if (r.erro) return false;
      if (tam > r.resta()) return false;
      r.pos = r.pos + tam;
      j = j + 1;
    }
    return true;
  }

  registrarRecebido(seq: number): void {
    if (!this.recebeuAlgum) {
      this.recebeuAlgum = true;
      this.ackRemoto = seq;
      this.ackBitsRemoto = 0;
      return;
    }
    const d = netSeqDiferenca(seq, this.ackRemoto);
    if (d > 0) {
      const deslocado = d >= 32 ? 0 : ((this.ackBitsRemoto << d) >>> 0);
      const bitAntigo = d <= 32 ? ((1 << (d - 1)) >>> 0) : 0;
      this.ackBitsRemoto = (deslocado | bitAntigo) >>> 0;
      this.ackRemoto = seq;
    } else if (d < 0 && d >= -32) {
      this.ackBitsRemoto = (this.ackBitsRemoto | ((1 << (-d - 1)) >>> 0)) >>> 0;
    }
  }

  processarAcks(ack: number, bits: number, agora: f64): void {
    this.confirmar(ack, agora);
    let i = 0;
    while (i < 32) {
      if (((bits >>> i) & 1) === 1) this.confirmar((ack - 1 - i) & 0xFFFF, agora);
      i = i + 1;
    }
  }

  confirmar(seq: number, agora: f64): void {
    const slot = seq % NET_JANELA_SEQ;
    if (this.regSeq[slot] !== seq) return;
    this.regSeq[slot] = -1;
    const amostra = agora - this.regTempo[slot];
    if (!this.temRtt) { this.rtt = amostra; this.temRtt = true; }
    else this.rtt = this.rtt + (amostra - this.rtt) * NET_ALFA_RTT;
    if (this.regPrimeiro[slot] >= 0) this.removerConfirmadas(this.regPrimeiro[slot], this.regUltimo[slot]);
  }

  removerConfirmadas(primeiro: number, ultimo: number): void {
    const faixa = (ultimo - primeiro) & 0xFFFF;
    let w = 0;
    let i = 0;
    while (i < this.pendId.length) {
      if (((this.pendId[i] - primeiro) & 0xFFFF) > faixa) {
        this.pendId[w] = this.pendId[i];
        this.pendDados[w] = this.pendDados[i];
        this.pendTam[w] = this.pendTam[i];
        w = w + 1;
      }
      i = i + 1;
    }
    this.pendId.length = w;
    this.pendDados.length = w;
    this.pendTam.length = w;
  }

  receberConfiavel(id: number, dados: Uint8Array, tam: number): void {
    if (id === this.confEsperado) {
      this.confiaveis.por(0, dados, 0, tam);
      this.confEsperado = (this.confEsperado + 1) & 0xFFFF;
      let achou = true;
      while (achou) {
        achou = false;
        let i = 0;
        while (i < this.adId.length) {
          if (this.adId[i] === this.confEsperado) {
            this.confiaveis.por(0, this.adDados[i], 0, this.adTam[i]);
            this.confEsperado = (this.confEsperado + 1) & 0xFFFF;
            const u = this.adId.length - 1;
            this.adId[i] = this.adId[u]; this.adDados[i] = this.adDados[u]; this.adTam[i] = this.adTam[u];
            this.adId.length = u; this.adDados.length = u; this.adTam.length = u;
            achou = true;
            i = this.adId.length;
          } else {
            i = i + 1;
          }
        }
      }
    } else if (netSeqMaisNovo(id, this.confEsperado) && this.adId.indexOf(id) < 0) {
      this.adId.push(id);
      this.adDados.push(dados);
      this.adTam.push(tam);
    }
  }
}

// Cabeçalho de 12 bytes de todo pacote e aritmética de números de sequência.
import { NetWriter, NetReader } from "./buffer";
import { NET_MAGIA, NET_VERSAO_PROTOCOLO, NET_TAM_CABECALHO, NET_FLAG_ACK } from "./config";

export class NetCabecalho {
  tipo: number;
  versao: number;
  seq: number;
  ack: number;
  ackBits: number;
  ackValido: boolean;

  constructor() {
    this.tipo = 0;
    this.versao = 0;
    this.seq = 0;
    this.ack = 0;
    this.ackBits = 0;
    this.ackValido = false;
  }
}

export function netEscreverCabecalhoVersao(w: NetWriter, versao: number, tipo: number, seq: number,
                                          ack: number, ackBits: number, ackValido: boolean): void {
  w.u16(NET_MAGIA);
  w.u8(versao);
  w.u8(ackValido ? (tipo | NET_FLAG_ACK) : tipo);
  w.u16(seq);
  w.u16(ack);
  w.u32(ackBits);
}

export function netEscreverCabecalho(w: NetWriter, tipo: number, seq: number, ack: number,
                                     ackBits: number, ackValido: boolean): void {
  netEscreverCabecalhoVersao(w, NET_VERSAO_PROTOCOLO, tipo, seq, ack, ackBits, ackValido);
}

/// Lê o cabeçalho. false = não é um pacote nosso (curto ou magia errada).
export function netLerCabecalho(r: NetReader, c: NetCabecalho): boolean {
  if (r.resta() < NET_TAM_CABECALHO) return false;
  if (r.u16() !== NET_MAGIA) return false;
  c.versao = r.u8();
  const bruto = r.u8();
  c.tipo = bruto & 0x7F;
  c.ackValido = (bruto & NET_FLAG_ACK) !== 0;
  c.seq = r.u16();
  c.ack = r.u16();
  c.ackBits = r.u32();
  return !r.erro;
}

/// a - b com volta em 16 bits (-32768..32767).
export function netSeqDiferenca(a: number, b: number): number {
  let d = (a - b) & 0xFFFF;
  if (d >= 32768) d = d - 65536;
  return d;
}

export function netSeqMaisNovo(a: number, b: number): boolean {
  return netSeqDiferenca(a, b) > 0;
}

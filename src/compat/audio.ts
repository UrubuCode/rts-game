// `rts:audio` — a saída de som do motor (crate `rts-audio` do repo rts).
//
// O namespace é repassado como está: os doze membros já têm a forma que o
// jogo usa (≤ 3 argumentos, views tipadas, números). O que este arquivo
// acrescenta é o que a superfície de host não sabe fazer: criar um
// `Float32Array` para o OGG decodificado. `decode_ogg` preenche `info` e
// devolve um handle; `ogg_take` copia para a view que o TS criou.
//
// `open_output(0, 0, AUDIO_REAL)` devolve 0 numa máquina sem placa de som, e o
// jogo segue mudo (o mesmo contrato de antes). `AUDIO_NULO` abre um dispositivo
// que consome em tempo real e descarta: testes e CI.
import nativo from "rts:audio";

export const AUDIO_REAL: number = 0;
export const AUDIO_NULO: number = 1;
/// `stats(dev, out)`: consumidos, faltas, enfileirados, taxa, canais, nulo.
export const STATS_FLOATS: number = 6;
/// `decode_ogg(bytes, info)`: taxa, canais, quadros, erro.
export const OGG_INFO_FLOATS: number = 4;
/// Mensagem por código de erro de `decode_ogg` (índice = `info[3]`).
const OGG_ERROS: string[] = ["", "não é OGG/Vorbis", "mais de 2 canais", "longo demais (mais de 10 minutos)", "arquivo corrompido"];

export class OggDecodificado {
  rate: number;
  channels: number;
  samples: Float32Array;
  constructor() { this.rate = 0; this.channels = 0; this.samples = new Float32Array(0); }
}

const oggInfo = new Float64Array(OGG_INFO_FLOATS);
let oggErro: string = "";

/// Decodifica um `.ogg` inteiro. `null` em recusa; a mensagem em `oggUltimoErro()`.
export function decodeOgg(bytes: Uint8Array): OggDecodificado | null {
  oggErro = "";
  const h = nativo.decode_ogg(bytes, oggInfo);
  if (h === 0) {
    const codigo = oggInfo[3] | 0;
    oggErro = codigo > 0 && codigo < OGG_ERROS.length ? OGG_ERROS[codigo] : "não é OGG/Vorbis";
    return null;
  }
  const r = new OggDecodificado();
  r.rate = oggInfo[0];
  r.channels = oggInfo[1];
  r.samples = new Float32Array(oggInfo[2] * oggInfo[1]);
  nativo.ogg_take(h, r.samples);
  return r;
}

export function oggUltimoErro(): string { return oggErro; }

export default nativo;

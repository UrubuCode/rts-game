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

// ── escuta por loopback (rts:audio.escutar/escuta_iniciar/escuta_ler) ───────
//
// Três nativas do binário `rts.exe` de `feat/audio-escuta` (crate
// `rts-audio`), ausentes num binário mais antigo — daí o mesmo padrão de
// detecção de `rigid.ts`/`gpu.ts` (`typeof fn === "function"`), nunca uma
// chamada direta que quebraria a carga do módulo inteiro num binário sem elas.
//
// `escutar` BLOQUEIA a thread chamadora por `ms` (até 10 s) — não é chamada
// pelo editor/WS (ver `assets/pacotes/audio/audio_comandos.ts`), só existe
// aqui para quem precisar de uma amostra pontual fora do caminho por quadro.
/// `escutar(ms, out)`: rms, pico, silencio(0|1), quadros, taxa, canais.
export const ESCUTA_FLOATS: number = 6;
/// `escuta_ler(out)`: os seis de cima + energiaFreq + underruns.
export const ESCUTA_CONTINUA_FLOATS: number = 8;

/// 1 se o binário atual tem `escuta_iniciar`/`escuta_ler` (a escuta contínua,
/// não bloqueante, é a única usada pelo comando `audio`).
export function escutaDisponivel(): boolean {
  return typeof (nativo as any).escuta_iniciar === "function" && typeof (nativo as any).escuta_ler === "function";
}
/// BLOQUEANTE — nunca chamar por quadro nem do editor/WS. `out` precisa de
/// `ESCUTA_FLOATS`. 1 = sucesso; 0 = indisponível (binário antigo) ou falhou.
export function escutarBloqueante(ms: number, out: Float64Array): number {
  const fn = (nativo as any).escutar;
  if (typeof fn !== "function") { out[0] = 0 - 1; return 0; }
  return fn(ms, out);
}
/// Inicia a escuta contínua (assíncrona): 1 iniciou, 0 se já havia uma em
/// andamento, se o binário não tem a nativa, ou se o dispositivo recusou.
export function escutaIniciar(ms: number, freqHz: f64): number {
  const fn = (nativo as any).escuta_iniciar;
  return typeof fn === "function" ? fn(ms, freqHz) : 0;
}
/// NUNCA bloqueia — seguro por quadro. `out` precisa de
/// `ESCUTA_CONTINUA_FLOATS`. 0 enquanto roda (ou sem nativa/sem escuta
/// iniciada), 1 quando termina (uma vez).
export function escutaLer(out: Float64Array): number {
  const fn = (nativo as any).escuta_ler;
  return typeof fn === "function" ? fn(out) : 0;
}

export default nativo;

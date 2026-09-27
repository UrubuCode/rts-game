// AudioClip: o asset de som (spec §3.3). Carregado de arquivo uma vez por
// caminho e compartilhado por todas as fontes. As amostras ficam na TAXA DOS
// CLIPES — a do dispositivo aberto — para que o `pitch` seja o único
// reamostrador por voz.
//
// Estado de módulo em variáveis lidas por funções livres (regra do RTS sobre
// métodos de classe que leem nomes de módulo): a classe só tem campos e
// `static` que delegam.
import fs from "@compat/fs.ts";
import { decodeOgg, oggUltimoErro } from "@compat/audio.ts";
import { decodeWav, reamostrar } from "./wav";
import { logError } from "@engine/core/logger";

export const FORMA_SENO: number = 0;
export const FORMA_QUADRADA: number = 1;
export const FORMA_RUIDO: number = 2;
export const FORMAS_TOM: string[] = ["seno", "quadrada", "ruido"];
const CLP_TAXA_PADRAO: number = 48000;
const CLP_MAX_TONS: number = 64;
/// Ataque do envelope dos tons: sem ele, começar a onda no meio do ciclo estala.
const CLP_ATAQUE_S: f64 = 0.005;
const CLP_SEMENTE_RUIDO: number = 12345;
const CLP_BYTES_POR_KB: number = 1024;
const CLP_NOMES_CANAIS: string[] = ["", "mono", "estéreo"];

export class AudioClip {
  id: number;
  nome: string;
  /// "" para clipe procedural.
  caminho: string;
  canais: number;
  taxa: number;
  quadros: number;
  duracao: f64;
  amostras: Float32Array;
  /// Maior |amostra| — o medidor de grupo estima o pico por ele.
  pico: f64;
  /// Memória das amostras.
  bytes: number;
  constructor() {
    this.id = 0 - 1; this.nome = ""; this.caminho = ""; this.canais = 1; this.taxa = CLP_TAXA_PADRAO;
    this.quadros = 0; this.duracao = 0.0; this.amostras = new Float32Array(0); this.pico = 0.0; this.bytes = 0;
  }
  /// O clipe do arquivo (.wav ou .ogg), da cache; `null` e erro no Console (uma vez) se falhar.
  static load(caminho: string): AudioClip | null { return clipCarregar(caminho); }
  /// Um clipe de amostras intercaladas já na taxa dos clipes (`taxaDosClipes()`).
  static fromSamples(nome: string, amostras: Float32Array, canais: number): AudioClip { return clipDeAmostras(nome, amostras, canais); }
}

let clpTaxa: number = CLP_TAXA_PADRAO;
const clpLista: AudioClip[] = [];
const clpMapa: Map<string, AudioClip> = new Map<string, AudioClip>();
const clpFalhas: string[] = [];
let clpDecods: number = 0;
/// Cache dos tons: freq, dur e forma por entrada, e o id do clipe.
const clpTons = new Float64Array(CLP_MAX_TONS * 3);
const clpTonsId: number[] = [];
let clpNTons: number = 0;

/// A taxa do dispositivo. Chamado por `initAudio`. Mudar a taxa esvazia as
/// caches (os próximos `load` decodificam de novo na taxa nova).
export function definirTaxaDosClipes(taxa: number): void {
  if (taxa <= 0 || taxa === clpTaxa) return;
  clpTaxa = taxa;
  clpMapa.clear();
  clpNTons = 0; clpTonsId.length = 0;
}
export function taxaDosClipes(): number { return clpTaxa; }
export function clipPorId(id: number): AudioClip | null { return id >= 0 && id < clpLista.length ? clpLista[id] : null; }
export function clipDecodificacoes(): number { return clpDecods; }

function clipRegistrar(nome: string, caminho: string, amostras: Float32Array, canais: number): AudioClip {
  const c = new AudioClip();
  c.id = clpLista.length; c.nome = nome; c.caminho = caminho; c.canais = canais; c.taxa = clpTaxa;
  c.amostras = amostras; c.quadros = (amostras.length / canais) | 0; c.duracao = c.quadros / clpTaxa;
  c.bytes = amostras.length * 4;
  let pico = 0.0; let i = 0;
  while (i < amostras.length) { const v = Math.abs(amostras[i]); if (v > pico) pico = v; i = i + 1; }
  c.pico = pico;
  clpLista.push(c);
  return c;
}

export function clipDeAmostras(nome: string, amostras: Float32Array, canais: number): AudioClip {
  return clipRegistrar(nome, "", amostras, canais === 2 ? 2 : 1);
}

function clipNomeDoArquivo(caminho: string): string {
  const a = caminho.lastIndexOf("/"); const b = caminho.lastIndexOf("\\");
  return caminho.substring((a > b ? a : b) + 1);
}

export function clipCarregar(caminho: string): AudioClip | null {
  const achado = clpMapa.get(caminho);
  if (achado !== undefined) return achado;
  if (clpFalhas.indexOf(caminho) >= 0) return null;
  const c = clipDecodificar(caminho);
  if (c !== null) clpMapa.set(caminho, c);
  return c;
}

/// Caminho LENTO (carga): o único `try` do módulo fica aqui.
function clipDecodificar(caminho: string): AudioClip | null {
  let erro = "";
  let amostras = new Float32Array(0); let canais = 1; let taxa = clpTaxa;
  try {
    const baixo = caminho.toLowerCase();
    if (!fs.exists(caminho)) erro = "arquivo não encontrado";
    else if (baixo.endsWith(".wav")) {
      const w = decodeWav(fs.read_all(caminho));
      amostras = w.amostras; canais = w.canais; taxa = w.taxa;
    } else if (baixo.endsWith(".ogg")) {
      const o = decodeOgg(fs.read_all(caminho));
      if (o === null) erro = oggUltimoErro();
      else { amostras = o.samples; canais = o.channels; taxa = o.rate; }
    } else erro = "formato não suportado (use .wav ou .ogg)";
  } catch (e) {
    erro = (e as Error).message;
  }
  if (erro !== "") {
    clpFalhas.push(caminho);
    logError("Áudio: " + caminho + ": " + erro);
    return null;
  }
  clpDecods = clpDecods + 1;
  if (taxa !== clpTaxa) amostras = reamostrar(amostras, canais, taxa, clpTaxa);
  return clipRegistrar(clipNomeDoArquivo(caminho), caminho, amostras, canais);
}

/// "48000 Hz, estéreo, 1,00 s, 375 KB" — para o Inspector e `audio clip`.
export function clipInfo(c: AudioClip): string {
  return c.taxa + " Hz, " + CLP_NOMES_CANAIS[c.canais] + ", " + c.duracao.toFixed(2).replace(".", ",") + " s, " +
         Math.floor(c.bytes / CLP_BYTES_POR_KB) + " KB";
}

/// Um tom gerado uma vez (seno, quadrada ou ruído) com o envelope de hoje:
/// ataque linear de 5 ms e queda linear até o fim. Cache de até 64 tons; o 65º
/// distinto é gerado sem entrar na cache.
export function toneClip(freq: f64, dur: f64, forma: number): AudioClip {
  let k = 0;
  while (k < clpNTons) {
    const b = k * 3;
    if (clpTons[b] === freq && clpTons[b + 1] === dur && clpTons[b + 2] === forma) return clpLista[clpTonsId[k]];
    k = k + 1;
  }
  const quadros = Math.max(1, Math.round(dur * clpTaxa));
  const ataque = CLP_ATAQUE_S * clpTaxa;
  const a = new Float32Array(quadros);
  const passo: f64 = 2.0 * Math.PI * freq / clpTaxa;
  let semente = CLP_SEMENTE_RUIDO;
  let q = 0;
  while (q < quadros) {
    let env: f64 = (quadros - q) / quadros;
    if (q < ataque) env = env * (q / ataque);
    let s: f64 = 0.0;
    if (forma === FORMA_RUIDO) { semente = (semente * 1103515245 + 12345) & 0x7FFFFFFF; s = (semente % 2000) * 0.001 - 1.0; }
    else if (forma === FORMA_QUADRADA) s = ((q * passo) % (2.0 * Math.PI)) < Math.PI ? 1.0 : 0.0 - 1.0;
    else s = Math.sin(q * passo);
    a[q] = s * env;
    q = q + 1;
  }
  const c = clipRegistrar(FORMAS_TOM[forma] + " " + freq + " Hz", "", a, 1);
  if (clpNTons < CLP_MAX_TONS) {
    const b = clpNTons * 3;
    clpTons[b] = freq; clpTons[b + 1] = dur; clpTons[b + 2] = forma;
    clpTonsId.push(c.id);
    clpNTons = clpNTons + 1;
  }
  return c;
}

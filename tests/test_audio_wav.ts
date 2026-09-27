// Decodificador WAV por número: 5 formatos × mono/estéreo × 3 taxas, LIST no
// meio, EXTENSIBLE, recusas com mensagem e reamostragem 44,1 → 48 kHz.
//   $RTS run tests/test_audio_wav.ts
import io from "@compat/io.ts";
import { decodeWav, reamostrar, WavDecodificado } from "@engine/audio/wav";
import { EspecWav, escreverWav, amostraTeste } from "./wav_escritor";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function erroDe(bytes: Uint8Array): string {
  let msg = "";
  try { decodeWav(bytes); } catch (e) { msg = (e as Error).message; }
  return msg;
}
function espec(formato: number, bits: number, canais: number, taxa: number): EspecWav {
  const e = new EspecWav(); e.formato = formato; e.bits = bits; e.canais = canais; e.taxa = taxa; e.quadros = 480; return e;
}
function confere(e: EspecWav, w: WavDecodificado, tol: f64, nome: string): void {
  check(w.taxa === e.taxa && w.canais === e.canais && w.quadros === e.quadros, nome + ": taxa/canais/quadros");
  let pior = 0.0;
  let q = 0;
  while (q < e.quadros) {
    let c = 0;
    while (c < e.canais) {
      const d = Math.abs(w.amostras[q * e.canais + c] - amostraTeste(e, q, c));
      if (d > pior) pior = d;
      c = c + 1;
    }
    q = q + 1;
  }
  check(pior <= tol, nome + ": pior erro " + pior + " > " + tol);
}
function cruzamentos(a: Float32Array, canais: number): number {
  let n = 0; let q = 1;
  while (q < a.length / canais) { if ((a[(q - 1) * canais] < 0.0) !== (a[q * canais] < 0.0)) n = n + 1; q = q + 1; }
  return n;
}

// ── 30 combinações ──────────────────────────────────────────────────────────
const formatos = [1, 1, 1, 1, 3];
const bits = [8, 16, 24, 32, 32];
// Nota: fmt1/32b (índice 3) usa 1e-7, não 1e-8 — armazenamos em Float32Array,
// e o arredondamento para float32 (meio-ULP ~1,49e-8 na faixa [0,25; 0,5))
// já excede 1e-8 por conta própria, verificado numericamente; não é bug do
// decodificador. Mesma ordem de grandeza do formato 3 (float), que tem a
// mesma limitação de armazenamento.
const tolerancias = [0.0081, 0.00004, 0.0000002, 0.0000001, 0.0000001];
const taxas = [22050, 44100, 48000];
let casos = 0;
let f = 0;
while (f < formatos.length) {
  let canais = 1;
  while (canais <= 2) {
    let t = 0;
    while (t < taxas.length) {
      const e = espec(formatos[f], bits[f], canais, taxas[t]);
      confere(e, decodeWav(escreverWav(e)), tolerancias[f], "fmt" + formatos[f] + "/" + bits[f] + "b/" + canais + "ch/" + taxas[t]);
      casos = casos + 1;
      t = t + 1;
    }
    canais = canais + 1;
  }
  f = f + 1;
}
check(casos === 30, "30 combinações");

// ── chunks ──────────────────────────────────────────────────────────────────
const comList = espec(1, 16, 2, 44100); comList.listNoMeio = true;
confere(comList, decodeWav(escreverWav(comList)), 0.00004, "LIST ímpar no meio (byte de alinhamento)");
const ext = espec(1, 24, 2, 48000); ext.extensivel = true;
confere(ext, decodeWav(escreverWav(ext)), 0.0000002, "WAVE_FORMAT_EXTENSIBLE/PCM 24");
const extF = espec(3, 32, 1, 48000); extF.extensivel = true;
confere(extF, decodeWav(escreverWav(extF)), 0.0000001, "WAVE_FORMAT_EXTENSIBLE/float");

// ── recusas com mensagem ────────────────────────────────────────────────────
const inteiro = escreverWav(espec(1, 16, 1, 48000));
check(erroDe(inteiro.slice(0, inteiro.length - 10)).indexOf("truncado") >= 0, "data truncado");
check(erroDe(inteiro.slice(0, 8)).indexOf("incompleto") >= 0, "cabeçalho cortado");
check(erroDe(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).indexOf("não é WAV") >= 0, "sem RIFF/WAVE");
check(erroDe(escreverWav(espec(1, 16, 3, 48000))).indexOf("canais") >= 0, "3 canais");
check(erroDe(escreverWav(espec(2, 4, 1, 48000))).indexOf("ADPCM") >= 0, "ADPCM");
check(erroDe(escreverWav(espec(7, 8, 1, 8000))).indexOf("µ-law") >= 0, "µ-law");
check(erroDe(escreverWav(espec(3, 64, 1, 48000))).indexOf("64 bits") >= 0, "float64");
check(erroDe(escreverWav(espec(1, 12, 1, 48000))).indexOf("bits") >= 0, "PCM de 12 bits");

// ── reamostragem ────────────────────────────────────────────────────────────
const r = espec(1, 16, 2, 44100); r.quadros = 22050; r.freq = 1000.0;
const w = decodeWav(escreverWav(r));
const re = reamostrar(w.amostras, 2, 44100, 48000);
check(re.length === 24000 * 2, "0,5 s continua 0,5 s (24 000 quadros a 48 kHz)");
const antes = cruzamentos(w.amostras, 2);
const depois = cruzamentos(re, 2);
check(Math.abs(antes - depois) <= 2, "mesma frequência: " + antes + " x " + depois + " cruzamentos");
check(reamostrar(w.amostras, 2, 44100, 44100) === w.amostras, "mesma taxa devolve o próprio array");

// ── float fora de [−1, 1] e NaN: preso no decodificador ────────────────────
function wavFloatBruto(valores: f64[]): Uint8Array {
  const quadros = valores.length;
  const dataLen = quadros * 4;
  const total = 12 + 8 + 16 + 8 + dataLen;
  const b = new Uint8Array(total);
  const dv = new DataView(b.buffer);
  let p = 0;
  function id(s: string): void { let k = 0; while (k < 4) { b[p + k] = s.charCodeAt(k); k = k + 1; } p = p + 4; }
  function u16(v: number): void { b[p] = v & 255; b[p + 1] = (v >> 8) & 255; p = p + 2; }
  function u32(v: number): void { b[p] = v & 255; b[p + 1] = (v >> 8) & 255; b[p + 2] = (v >> 16) & 255; b[p + 3] = (v >>> 24) & 255; p = p + 4; }
  id("RIFF"); u32(total - 8); id("WAVE");
  id("fmt "); u32(16);
  u16(3); u16(1); u32(48000); u32(48000 * 4); u16(4); u16(32);
  id("data"); u32(dataLen);
  let q = 0;
  while (q < quadros) { dv.setFloat32(p, valores[q], true); p = p + 4; q = q + 1; }
  return b;
}
const bruto = wavFloatBruto([2.0, 0.0 - 3.0, NaN, 0.25]);
const wFloat = decodeWav(bruto);
check(wFloat.amostras[0] === 1.0, "float > 1 preso em 1: " + wFloat.amostras[0]);
check(wFloat.amostras[1] === 0.0 - 1.0, "float < -1 preso em -1: " + wFloat.amostras[1]);
check(wFloat.amostras[2] === 0.0, "NaN vira 0: " + wFloat.amostras[2]);
check(wFloat.amostras[3] === 0.25, "float dentro da faixa não muda: " + wFloat.amostras[3]);

io.print("[PASSOU] wav: 30 combinações, LIST ímpar, EXTENSIBLE, 8 recusas com mensagem, reamostragem 44,1→48 kHz, float preso em [-1,1] e NaN vira 0");

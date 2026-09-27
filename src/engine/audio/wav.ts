// Decodificador WAV em TypeScript (spec §3.2), no molde de render/png.ts:
// bytes de `fs.read_all`, validação com mensagem e um limite de tamanho.
// Aceita PCM 8 (sem sinal), 16, 24 e 32 bits, float 32, mono ou estéreo, e
// WAVE_FORMAT_EXTENSIBLE pelo subformato. Recusa com mensagem o resto: tocar
// ruído de um formato mal lido é pior que um erro no Console.
export const WAV_MAX_BYTES: number = 256 * 1024 * 1024;
const WAV_PCM: number = 1;
const WAV_ADPCM: number = 2;
const WAV_FLOAT: number = 3;
const WAV_ALAW: number = 6;
const WAV_MULAW: number = 7;
const WAV_EXTENSIBLE: number = 0xFFFE;
/// Tamanho mínimo do chunk `fmt ` e do EXTENSIBLE (com o GUID do subformato).
const WAV_FMT_MIN: number = 16;
const WAV_FMT_EXT_MIN: number = 40;
/// Deslocamento do subformato dentro do corpo do `fmt ` EXTENSIBLE.
const WAV_EXT_SUBFORMATO: number = 24;
const WAV_TAXA_MIN: number = 1000;
const WAV_TAXA_MAX: number = 384000;

export class WavDecodificado {
  taxa: number;
  canais: number;
  quadros: number;
  /// Intercalado, em [−1, 1].
  amostras: Float32Array;
  constructor() { this.taxa = 0; this.canais = 0; this.quadros = 0; this.amostras = new Float32Array(0); }
}

function wavU16(b: any, o: number): number { return b[o] | (b[o + 1] << 8); }
function wavU32(b: any, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
function wavId(b: any, o: number, id: string): boolean {
  return b[o] === id.charCodeAt(0) && b[o + 1] === id.charCodeAt(1) && b[o + 2] === id.charCodeAt(2) && b[o + 3] === id.charCodeAt(3);
}

export function decodeWav(bytes: any): WavDecodificado {
  if (bytes === undefined || bytes === null || bytes.length < 12) throw new Error("WAV incompleto");
  if (bytes.length > WAV_MAX_BYTES) throw new Error("WAV maior que o limite de " + (WAV_MAX_BYTES / 1048576) + " MB");
  if (!wavId(bytes, 0, "RIFF") || !wavId(bytes, 8, "WAVE")) throw new Error("não é WAV (RIFF/WAVE)");
  let formato = 0 - 1; let canais = 0; let taxa = 0; let bits = 0; let bloco = 0;
  let dataIni = 0 - 1; let dataLen = 0;
  let p = 12;
  while (p + 8 <= bytes.length) {
    const tam = wavU32(bytes, p + 4);
    const corpo = p + 8;
    if (wavId(bytes, p, "fmt ")) {
      if (tam < WAV_FMT_MIN || corpo + tam > bytes.length) throw new Error("WAV com chunk fmt truncado");
      formato = wavU16(bytes, corpo); canais = wavU16(bytes, corpo + 2); taxa = wavU32(bytes, corpo + 4);
      bloco = wavU16(bytes, corpo + 12); bits = wavU16(bytes, corpo + 14);
      if (formato === WAV_EXTENSIBLE) {
        if (tam < WAV_FMT_EXT_MIN) throw new Error("WAVE_FORMAT_EXTENSIBLE sem subformato");
        formato = wavU16(bytes, corpo + WAV_EXT_SUBFORMATO);
      }
    } else if (wavId(bytes, p, "data")) {
      if (corpo + tam > bytes.length) {
        throw new Error("WAV truncado: o chunk data declara " + tam + " bytes e o arquivo tem " + (bytes.length - corpo));
      }
      dataIni = corpo; dataLen = tam;
    }
    // Chunk de tamanho ímpar tem um byte de alinhamento depois do corpo.
    p = corpo + tam + (tam & 1);
  }
  if (formato < 0) throw new Error("WAV sem chunk fmt");
  if (dataIni < 0) throw new Error("WAV sem chunk data");
  if (formato === WAV_ADPCM) throw new Error("WAV ADPCM não suportado (converta para PCM)");
  if (formato === WAV_ALAW || formato === WAV_MULAW) throw new Error("WAV µ-law/A-law não suportado (converta para PCM)");
  if (formato !== WAV_PCM && formato !== WAV_FLOAT) throw new Error("formato WAV " + formato + " não suportado");
  if (canais < 1 || canais > 2) throw new Error("WAV com " + canais + " canais: só mono ou estéreo");
  if (taxa < WAV_TAXA_MIN || taxa > WAV_TAXA_MAX) throw new Error("taxa de amostragem inválida: " + taxa);
  if (formato === WAV_FLOAT && bits !== 32) throw new Error("float de " + bits + " bits não suportado (só 32)");
  if (formato === WAV_PCM && !(bits === 8 || bits === 16 || bits === 24 || bits === 32)) throw new Error("PCM de " + bits + " bits não suportado");
  const ba = bits >> 3;
  if (bloco !== ba * canais) throw new Error("WAV com blockAlign " + bloco + " inconsistente com " + canais + " × " + bits + " bits");
  const quadros = (dataLen / bloco) | 0;
  const n = quadros * canais;
  const out = new Float32Array(n);
  let i = 0;
  let o = dataIni;
  if (formato === WAV_FLOAT) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    while (i < n) { out[i] = dv.getFloat32(o, true); o = o + 4; i = i + 1; }
  } else if (bits === 8) {
    while (i < n) { out[i] = (bytes[o] - 128) / 128.0; o = o + 1; i = i + 1; }
  } else if (bits === 16) {
    while (i < n) { let v = bytes[o] | (bytes[o + 1] << 8); if (v >= 32768) v = v - 65536; out[i] = v / 32768.0; o = o + 2; i = i + 1; }
  } else if (bits === 24) {
    while (i < n) {
      let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      if ((v & 0x800000) !== 0) v = v - 0x1000000;
      out[i] = v / 8388608.0; o = o + 3; i = i + 1;
    }
  } else {
    while (i < n) { const v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24); out[i] = v / 2147483648.0; o = o + 4; i = i + 1; }
  }
  const r = new WavDecodificado();
  r.taxa = taxa; r.canais = canais; r.quadros = quadros; r.amostras = out;
  return r;
}

/// Reamostra na CARGA, com interpolação linear (spec §3.2). Mesma taxa devolve
/// o próprio array. Na redução de taxa isto gera algum aliasing; o filtro de 4
/// taps é da fase 2.
export function reamostrar(amostras: Float32Array, canais: number, taxaDe: number, taxaPara: number): Float32Array {
  if (taxaDe === taxaPara || canais <= 0 || taxaDe <= 0 || taxaPara <= 0) return amostras;
  const quadros = (amostras.length / canais) | 0;
  if (quadros === 0) return amostras;
  const saida = Math.round(quadros * taxaPara / taxaDe);
  const out = new Float32Array(saida * canais);
  const razao: f64 = taxaDe / taxaPara;
  let j = 0;
  while (j < saida) {
    const pos: f64 = j * razao;
    const i0 = Math.floor(pos) | 0;
    const frac: f64 = pos - i0;
    const i1 = i0 + 1 < quadros ? i0 + 1 : quadros - 1;
    let c = 0;
    while (c < canais) {
      const a = amostras[i0 * canais + c];
      out[j * canais + c] = a + (amostras[i1 * canais + c] - a) * frac;
      c = c + 1;
    }
    j = j + 1;
  }
  return out;
}

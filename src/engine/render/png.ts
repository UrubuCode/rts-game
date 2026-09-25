// Leitor de PNG em TypeScript: o runtime novo não tem `rts:imgdec`, e isto é o
// que permite `loadTexture` voltar a funcionar para PNG (texturas de Material)
// e o editor desenhar seus ícones. Suporta 8 bits por canal, sem interlace,
// cor RGBA (tipo 6) e RGB (tipo 2, sai com alfa 255), os cinco filtros de linha.
// Formato fora disso falha com mensagem, em vez de desenhar lixo.
import { inflateSync } from "node:zlib";

export class DecodedImage {
  width: number; height: number;
  /// RGBA8, `width * height * 4` bytes.
  pixels: Uint8Array;
  constructor(w: number, h: number, pixels: Uint8Array) { this.width = w; this.height = h; this.pixels = pixels; }
}

function pngU32(bytes: any, offset: number): number {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

function pngPaeth(a: number, b: number, c: number): number {
  const p = a + b - c; const da = Math.abs(p - a); const db = Math.abs(p - b); const dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

/// Decodifica `bytes` (conteúdo de um .png). `maxPixels` limita largura e
/// altura (proteção contra arquivo gigante ou corrompido).
export function decodePNG(bytes: any, maxPixels: number): DecodedImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes === undefined || bytes.length < 33) throw new Error("PNG incompleto");
  let i = 0;
  while (i < signature.length) { if (bytes[i] !== signature[i]) throw new Error("Assinatura PNG invalida"); i = i + 1; }
  let width = 0; let height = 0; let channels = 0;
  let offset = signature.length;
  // IDAT pode vir em vários chunks: primeiro mede, depois copia de uma vez.
  let idatTotal = 0;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = pngU32(bytes, offset); const type = pngU32(bytes, offset + 4); const data = offset + 8;
    if (data + length + 4 > bytes.length) throw new Error("Chunk PNG incompleto");
    if (type === 1229472850) { // IHDR
      if (length !== 13 || width !== 0) throw new Error("Cabecalho PNG invalido");
      width = pngU32(bytes, data); height = pngU32(bytes, data + 4);
      const depth = bytes[data + 8]; const color = bytes[data + 9];
      if (width < 1 || height < 1 || width > maxPixels || height > maxPixels) throw new Error("PNG de " + width + "x" + height + " fora do limite de " + maxPixels);
      if (depth !== 8 || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) throw new Error("PNG precisa de 8 bits por canal e sem interlace");
      if (color === 6) channels = 4;
      else if (color === 2) channels = 3;
      else throw new Error("PNG precisa ser RGBA ou RGB (tipo de cor " + color + ")");
    } else if (type === 1229209940) { // IDAT
      idatTotal = idatTotal + length;
    } else if (type === 1229278788) { ended = true; offset = bytes.length; } // IEND
    if (!ended) offset = data + length + 4;
  }
  if (!ended || width === 0 || idatTotal === 0) throw new Error("PNG sem dados");
  const compressed = new Uint8Array(idatTotal);
  let w = 0;
  offset = signature.length;
  while (offset + 12 <= bytes.length) {
    const length = pngU32(bytes, offset); const type = pngU32(bytes, offset + 4); const data = offset + 8;
    if (type === 1229209940) { i = 0; while (i < length) { compressed[w] = bytes[data + i]; w = w + 1; i = i + 1; } }
    if (type === 1229278788) offset = bytes.length; else offset = data + length + 4;
  }
  const raw = inflateSync(compressed);
  const stride = width * channels;
  if (raw === undefined || raw.length !== height * (stride + 1)) throw new Error("Pixels PNG invalidos");
  const linha = new Uint8Array(height * stride);
  let y = 0;
  while (y < height) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Filtro PNG invalido");
    let x = 0;
    while (x < stride) {
      const p = y * stride + x;
      const a = x >= channels ? linha[p - channels] : 0;
      const b = y > 0 ? linha[p - stride] : 0;
      const c = y > 0 && x >= channels ? linha[p - stride - channels] : 0;
      const prediction = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pngPaeth(a, b, c) : 0;
      linha[p] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
      x = x + 1;
    }
    y = y + 1;
  }
  if (channels === 4) return new DecodedImage(width, height, linha);
  const rgba = new Uint8Array(width * height * 4);
  let k = 0;
  while (k < width * height) {
    rgba[k * 4] = linha[k * 3]; rgba[k * 4 + 1] = linha[k * 3 + 1]; rgba[k * 4 + 2] = linha[k * 3 + 2]; rgba[k * 4 + 3] = 255;
    k = k + 1;
  }
  return new DecodedImage(width, height, rgba);
}

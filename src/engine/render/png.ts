// Leitor de PNG em TypeScript: o runtime novo não tem `rts:imgdec`, e isto é o
// que permite `loadTexture` voltar a funcionar para PNG (texturas de Material)
// e o editor desenhar seus ícones. Suporta 8 bits por canal, sem interlace,
// cor RGBA (tipo 6), RGB (tipo 2, sai com alfa 255) e paleta (tipo 3, com a
// transparência do chunk tRNS), cinza (0), cinza+alpha (4) e os cinco filtros de linha.
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

// As tabelas de cor são escritas como u32; a ordem dos bytes dentro dele
// depende da máquina, e um RGBA trocado só apareceria como cor errada na tela.
const PNG_LITTLE_ENDIAN: boolean = pngDetectLittleEndian();
function pngDetectLittleEndian(): boolean {
  const probe = new Uint32Array(1);
  probe[0] = 1;
  return new Uint8Array(probe.buffer)[0] === 1;
}

/// Empacota RGBA num u32 na ordem de bytes da máquina.
function pngPackRGBA(r: number, g: number, b: number, a: number): number {
  return PNG_LITTLE_ENDIAN
    ? (((a << 24) | (b << 16) | (g << 8) | r) >>> 0)
    : (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function pngPaeth(a: number, b: number, c: number): number {
  const p = a + b - c; const da = Math.abs(p - a); const db = Math.abs(p - b); const dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

/// Decodifica `bytes` (conteúdo de um .png). `maxPixels` limita largura e
/// altura (proteção contra arquivo gigante ou corrompido).
/// `checkpoint`, quando vem, é chamado a cada BANDA de linhas desfiltradas e
/// de pixels expandidos. Decodificar um atlas 1024x1024 é uma chamada só de
/// centenas de milissegundos e não se divide em passos sem guardar o estado
/// dos laços; o checkpoint deixa quem chamou (a carga de cena) desenhar a tela
/// de carregamento por dentro dela.
export function decodePNG(bytes: any, maxPixels: number, checkpoint?: () => void): DecodedImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes === undefined || bytes.length < 33) throw new Error("PNG incompleto");
  let i = 0;
  while (i < signature.length) { if (bytes[i] !== signature[i]) throw new Error("Assinatura PNG invalida"); i = i + 1; }
  let width = 0; let height = 0; let channels = 0;
  let paleta: number[] = [];      // RGB por entrada (tipo 3)
  let alfas: number[] = [];       // tRNS: alfa por entrada (o resto é 255)
  let indexada = false;
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
      else if (color === 3) { channels = 1; indexada = true; }
      else if (color === 0) channels = 1;
      else if (color === 4) channels = 2;
      else throw new Error("Tipo de cor PNG nao suportado: " + color);
    } else if (type === 1347179589) { // PLTE
      let q = 0; while (q < length) { paleta.push(bytes[data + q]); q = q + 1; }
    } else if (type === 1951551059) { // tRNS
      let q = 0; while (q < length) { alfas.push(bytes[data + q]); q = q + 1; }
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
  // Uma banda de linhas por checkpoint: chamar a cada linha custaria uma
  // chamada indireta a cada `stride` bytes, e 1024 chamadas não compram nada
  // além das ~64 que a tela de carregamento consegue desenhar.
  const band = height > 64 ? (height / 64) | 0 : 1;
  let y = 0;
  while (y < height) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Filtro PNG invalido");
    // O tipo de filtro vale para a LINHA inteira, e a cadeia de ternários que
    // o escolhia rodava DENTRO do laço por byte. Especializar tirou 3 desvios
    // e 2 condicionais de borda de cada byte.
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    let x = 0;
    if (filter === 0) {
      // Filtro None não tem dependência nenhuma: é cópia, e cópia de
      // Uint8Array é nativa. Os atlas da Kenney usam filtro 0 em TODAS as
      // linhas, então este ramo é o caminho real, não o caso de borda.
      linha.set(raw.subarray(src, src + stride), dst);
    } else if (filter === 1) {
      while (x < channels) { linha[dst + x] = raw[src + x]; x = x + 1; }
      while (x < stride) { linha[dst + x] = (raw[src + x] + linha[dst + x - channels]) & 255; x = x + 1; }
    } else if (filter === 2) {
      if (y === 0) { linha.set(raw.subarray(src, src + stride), dst); }
      else { while (x < stride) { linha[dst + x] = (raw[src + x] + linha[up + x]) & 255; x = x + 1; } }
    } else if (filter === 3) {
      if (y === 0) {
        while (x < channels) { linha[dst + x] = raw[src + x]; x = x + 1; }
        while (x < stride) { linha[dst + x] = (raw[src + x] + ((linha[dst + x - channels] >> 1) | 0)) & 255; x = x + 1; }
      } else {
        while (x < channels) { linha[dst + x] = (raw[src + x] + ((linha[up + x] >> 1) | 0)) & 255; x = x + 1; }
        while (x < stride) { linha[dst + x] = (raw[src + x] + (((linha[dst + x - channels] + linha[up + x]) >> 1) | 0)) & 255; x = x + 1; }
      }
    } else {
      if (y === 0) {
        // Sem linha de cima, b = c = 0 e o Paeth degenera para `a`.
        while (x < channels) { linha[dst + x] = raw[src + x]; x = x + 1; }
        while (x < stride) { linha[dst + x] = (raw[src + x] + linha[dst + x - channels]) & 255; x = x + 1; }
      } else {
        // Na primeira coluna a = c = 0 e o Paeth degenera para `b`.
        while (x < channels) { linha[dst + x] = (raw[src + x] + linha[up + x]) & 255; x = x + 1; }
        while (x < stride) {
          linha[dst + x] = (raw[src + x] + pngPaeth(linha[dst + x - channels], linha[up + x], linha[up + x - channels])) & 255;
          x = x + 1;
        }
      }
    }
    y = y + 1;
    if (checkpoint !== undefined && y % band === 0) checkpoint();
  }
  if (channels === 4) return new DecodedImage(width, height, linha);
  const rgba = new Uint8Array(width * height * 4);
  const total = width * height;
  // Depois que a desfiltragem de filtro 0 virou cópia nativa, é a EXPANSÃO que
  // domina o custo de um atlas: ela roda uma vez por pixel. Mesmo tamanho de
  // banda da desfiltragem, para o checkpoint acompanhar onde o tempo está.
  const step = total > 64 ? (total / 64) | 0 : total;
  const out = new Uint32Array(rgba.buffer);
  if (indexada) {
    if (paleta.length < 3) throw new Error("PNG de paleta sem PLTE");
    const entradas = (paleta.length / 3) | 0;
    // A paleta tem no máximo 256 entradas: montá-la UMA vez como RGBA
    // empacotado troca os 8 acessos de array por pixel por um `lut[i]` e uma
    // escrita de 32 bits. Índice fora da paleta cai na entrada 0, como antes.
    const lut = new Uint32Array(256);
    let e = 0;
    while (e < 256) {
      const v = e < entradas ? e : 0;
      lut[e] = pngPackRGBA(paleta[v * 3], paleta[v * 3 + 1], paleta[v * 3 + 2],
        v < alfas.length ? alfas[v] : 255);
      e = e + 1;
    }
    let q = 0;
    while (q < total) {
      const ate = q + step < total ? q + step : total;
      while (q < ate) { out[q] = lut[linha[q]]; q = q + 1; }
      if (checkpoint !== undefined) checkpoint();
    }
    return new DecodedImage(width, height, rgba);
  }
  if (channels === 1) {
    // Cinza: o valor do pixel é o próprio índice de uma tabela de 256.
    const lut = new Uint32Array(256);
    let v = 0;
    while (v < 256) { lut[v] = pngPackRGBA(v, v, v, 255); v = v + 1; }
    let q = 0;
    while (q < total) {
      const ate = q + step < total ? q + step : total;
      while (q < ate) { out[q] = lut[linha[q]]; q = q + 1; }
      if (checkpoint !== undefined) checkpoint();
    }
    return new DecodedImage(width, height, rgba);
  }
  // Cinza+alfa (2) e RGB (3): sem tabela possível, mas o número de canais sai
  // do laço — era um ternário por canal por pixel.
  let k = 0;
  while (k < total) {
    const ate = k + step < total ? k + step : total;
    if (channels === 2) {
      while (k < ate) { const g = linha[k * 2]; out[k] = pngPackRGBA(g, g, g, linha[k * 2 + 1]); k = k + 1; }
    } else {
      while (k < ate) { const b = k * 3; out[k] = pngPackRGBA(linha[b], linha[b + 1], linha[b + 2], 255); k = k + 1; }
    }
    if (checkpoint !== undefined) checkpoint();
  }
  return new DecodedImage(width, height, rgba);
}

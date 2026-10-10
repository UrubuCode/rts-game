import { decodePNG } from "@engine/render/png";
import { deflateSync } from "node:zlib";
import fs from "@compat/fs.ts";

// O decodificador de PNG é TypeScript (o runtime não tem `rts:imgdec`). A
// desfiltragem roda uma vez por byte e a expansão uma vez por pixel, e num
// atlas 1024x1024 isso era uma chamada só de centenas de milissegundos sem
// ceder nada para quem está desenhando uma tela de carregamento.
//
// Este teste trava o que a otimização não pode quebrar: o resultado de cada
// tipo de filtro, de cada tipo de cor que o leitor aceita, e a cessão de
// checkpoints.
function pngCheck(ok: boolean, label: string): void { if (!ok) throw new Error(label); }

function pngU32(out: number[], v: number): void {
  out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}
function pngCrc(bytes: number[], from: number, to: number): number {
  let c = 0xffffffff;
  let i = from;
  while (i < to) {
    c = c ^ bytes[i];
    let k = 0;
    while (k < 8) { c = (c >>> 1) ^ (0xedb88320 & (0 - (c & 1))); k = k + 1; }
    i = i + 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(out: number[], type: string, payload: number[]): void {
  pngU32(out, payload.length);
  const start = out.length;
  let i = 0;
  while (i < type.length) { out.push(type.charCodeAt(i)); i = i + 1; }
  i = 0;
  while (i < payload.length) { out.push(payload[i]); i = i + 1; }
  pngU32(out, pngCrc(out, start, out.length));
}
function pngPaethRef(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

// Monta um PNG a partir de linhas já em bytes crus, aplicando `filterMode`
// (0..4, ou 5 = um filtro diferente por linha, que é o caso real).
function pngBuild(w: number, h: number, channels: number, colorType: number,
                  samples: Uint8Array, filterMode: number, extra: number[][]): Uint8Array {
  const stride = w * channels;
  const raw: number[] = [];
  let y = 0;
  while (y < h) {
    const f = filterMode === 5 ? y % 5 : filterMode;
    raw.push(f);
    let x = 0;
    while (x < stride) {
      const p = y * stride + x;
      const a = x >= channels ? samples[p - channels] : 0;
      const b = y > 0 ? samples[p - stride] : 0;
      const c = y > 0 && x >= channels ? samples[p - stride - channels] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? Math.floor((a + b) / 2) : f === 4 ? pngPaethRef(a, b, c) : 0;
      raw.push((samples[p] - pred) & 255);
      x = x + 1;
    }
    y = y + 1;
  }
  const deflated = deflateSync(new Uint8Array(raw));
  const out: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr: number[] = [];
  pngU32(ihdr, w); pngU32(ihdr, h);
  ihdr.push(8, colorType, 0, 0, 0);
  pngChunk(out, "IHDR", ihdr);
  let e = 0;
  while (e < extra.length) { pngChunk(out, e === 0 ? "PLTE" : "tRNS", extra[e]); e = e + 1; }
  const idat: number[] = [];
  let d = 0;
  while (d < deflated.length) { idat.push(deflated[d]); d = d + 1; }
  pngChunk(out, "IDAT", idat);
  pngChunk(out, "IEND", []);
  return new Uint8Array(out);
}

const W = 7, H = 9;

// ── RGBA (tipo 6): os cinco filtros, puros e misturados ───────────────────
const rgbaSamples = new Uint8Array(H * W * 4);
let ry = 0;
while (ry < H) {
  let rx = 0;
  while (rx < W * 4) {
    rgbaSamples[ry * W * 4 + rx] = (ry * 37 + rx * 11 + ((rx * ry) & 31)) & 255;
    rx = rx + 1;
  }
  ry = ry + 1;
}
let mode = 0;
while (mode <= 5) {
  let yields = 0;
  const img = decodePNG(pngBuild(W, H, 4, 6, rgbaSamples, mode, []), 4096, (): void => { yields++; });
  pngCheck(img.width === W && img.height === H, "filtro " + mode + ": dimensões erradas");
  let i = 0;
  while (i < rgbaSamples.length) {
    pngCheck(img.pixels[i] === rgbaSamples[i],
      "filtro " + mode + ": byte " + i + " = " + img.pixels[i] + ", esperado " + rgbaSamples[i]);
    i = i + 1;
  }
  pngCheck(yields > 0, "filtro " + mode + ": desfiltragem não cedeu nenhum checkpoint");
  mode = mode + 1;
}
println("PASS png-decode RGBA: filtros 0-4 e mistos, checkpoints cedidos");

// ── Paleta (tipo 3), com e sem tRNS ───────────────────────────────────────
const palette = [[10, 20, 30], [200, 100, 50], [0, 255, 128], [255, 255, 255]];
const paletteAlphas = [255, 128, 0];   // a 4ª entrada não tem tRNS: alfa 255
const indexSamples = new Uint8Array(H * W);
let q = 0;
while (q < H * W) {
  // o último pixel usa um índice FORA da paleta de propósito
  indexSamples[q] = q === H * W - 1 ? 9 : q % palette.length;
  q = q + 1;
}
const plte: number[] = [];
let pe = 0;
while (pe < palette.length) { plte.push(palette[pe][0], palette[pe][1], palette[pe][2]); pe = pe + 1; }

let withTrns = 0;
while (withTrns <= 1) {
  const extra = withTrns === 1 ? [plte, paletteAlphas] : [plte];
  const img = decodePNG(pngBuild(W, H, 1, 3, indexSamples, 0, extra), 4096);
  let k = 0;
  while (k < H * W) {
    const rawIndex = indexSamples[k];
    const v = rawIndex >= palette.length ? 0 : rawIndex;   // fora da paleta cai na entrada 0
    const alpha = withTrns === 1 && v < paletteAlphas.length ? paletteAlphas[v] : 255;
    const want = [palette[v][0], palette[v][1], palette[v][2], alpha];
    let c = 0;
    while (c < 4) {
      pngCheck(img.pixels[k * 4 + c] === want[c],
        "paleta" + (withTrns === 1 ? "+tRNS" : "") + ": pixel " + k + " canal " + c +
        " = " + img.pixels[k * 4 + c] + ", esperado " + want[c]);
      c = c + 1;
    }
    k = k + 1;
  }
  withTrns = withTrns + 1;
}
println("PASS png-decode paleta: expansão RGBA, tRNS, índice fora da paleta");

// ── RGB (2), cinza (0) e cinza+alfa (4) ───────────────────────────────────
function fillRamp(n: number): Uint8Array {
  const s = new Uint8Array(n);
  let i = 0;
  while (i < n) { s[i] = (i * 23 + 7) & 255; i = i + 1; }
  return s;
}
const rgbSamples = fillRamp(H * W * 3);
const rgbImg = decodePNG(pngBuild(W, H, 3, 2, rgbSamples, 5, []), 4096);
let gi = 0;
while (gi < H * W) {
  pngCheck(rgbImg.pixels[gi * 4] === rgbSamples[gi * 3] &&
    rgbImg.pixels[gi * 4 + 1] === rgbSamples[gi * 3 + 1] &&
    rgbImg.pixels[gi * 4 + 2] === rgbSamples[gi * 3 + 2] &&
    rgbImg.pixels[gi * 4 + 3] === 255, "rgb: pixel " + gi + " errado");
  gi = gi + 1;
}
const graySamples = fillRamp(H * W);
const grayImg = decodePNG(pngBuild(W, H, 1, 0, graySamples, 5, []), 4096);
gi = 0;
while (gi < H * W) {
  const g = graySamples[gi];
  pngCheck(grayImg.pixels[gi * 4] === g && grayImg.pixels[gi * 4 + 1] === g &&
    grayImg.pixels[gi * 4 + 2] === g && grayImg.pixels[gi * 4 + 3] === 255,
    "cinza: pixel " + gi + " = " + grayImg.pixels[gi * 4] + "/" + grayImg.pixels[gi * 4 + 3] + ", esperado " + g + "/255");
  gi = gi + 1;
}
const grayAlphaSamples = fillRamp(H * W * 2);
const grayAlphaImg = decodePNG(pngBuild(W, H, 2, 4, grayAlphaSamples, 5, []), 4096);
gi = 0;
while (gi < H * W) {
  const g = grayAlphaSamples[gi * 2];
  const a = grayAlphaSamples[gi * 2 + 1];
  pngCheck(grayAlphaImg.pixels[gi * 4] === g && grayAlphaImg.pixels[gi * 4 + 1] === g &&
    grayAlphaImg.pixels[gi * 4 + 2] === g && grayAlphaImg.pixels[gi * 4 + 3] === a,
    "cinza+alfa: pixel " + gi + " errado");
  gi = gi + 1;
}
println("PASS png-decode RGB, cinza e cinza+alfa");

// ── Atlas real: mede o custo e confirma que o checkpoint acompanha ────────
const ATLAS = "assets/kenney/personagens/Textures/texture-a.png";
if (fs.exists(ATLAS)) {
  const bytes = fs.read_all(ATLAS);
  let yields = 0;
  const t = performance.now();
  const img = decodePNG(bytes, 4096, (): void => { yields++; });
  const ms = performance.now() - t;
  pngCheck(img.width === 1024 && img.height === 1024, "atlas: dimensões erradas");
  pngCheck(yields >= 64, "atlas: só " + yields + " checkpoints em 1024 linhas");
  println("PASS png-decode atlas 1024x1024: " + ms.toFixed(2) + " ms, " + yields + " checkpoints");
}

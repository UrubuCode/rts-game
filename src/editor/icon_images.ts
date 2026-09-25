import fs from "@compat/fs";
import { inflateSync } from "node:zlib";
import render from "@compat/render";
import { logWarn } from "@engine/core/logger";
import { UI_ICONS } from "./ui_config";

export class IconImage {
  width: number; height: number; pixels: Uint8Array;
  constructor(w: number, h: number, pixels: Uint8Array) { this.width = w; this.height = h; this.pixels = pixels; }
}
function u32(bytes: any, offset: number): number {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const da = Math.abs(p - a); const db = Math.abs(p - b); const dc = Math.abs(p - c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}
// Small, bounded PNG reader for editor artwork: RGBA8, non-interlaced, all five
// PNG row filters. Unsupported formats fail visibly rather than drawing junk.
export function decodeIconPNG(bytes: any): IconImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes === undefined || bytes.length < 33) throw new Error("PNG incompleto");
  let i = 0; while (i < signature.length) { if (bytes[i] !== signature[i]) throw new Error("Assinatura PNG invalida"); i = i + 1; }
  let width = 0; let height = 0; let offset = signature.length; const packed: number[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset); const type = u32(bytes, offset + 4); const data = offset + 8;
    if (data + length + 4 > bytes.length) throw new Error("Chunk PNG incompleto");
    if (type === 1229472850) { // IHDR
      if (length !== 13 || width !== 0) throw new Error("Cabecalho PNG invalido");
      width = u32(bytes, data); height = u32(bytes, data + 4);
      if (width < 1 || height < 1 || width > UI_ICONS.maxPixels || height > UI_ICONS.maxPixels || bytes[data + 8] !== 8 || bytes[data + 9] !== 6 || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) throw new Error("Icone requer PNG RGBA8 sem interlace");
    } else if (type === 1229209940) { // IDAT
      i = 0; while (i < length) { packed.push(bytes[data + i]); i = i + 1; }
    } else if (type === 1229278788) { ended = true; break; } // IEND
    offset = data + length + 4;
  }
  if (!ended || width === 0 || packed.length === 0) throw new Error("PNG sem dados");
  const compressed = new Uint8Array(packed.length); i = 0;
  while (i < packed.length) { compressed[i] = packed[i]; i = i + 1; }
  const raw = inflateSync(compressed);
  const channels = 4; const stride = width * channels;
  if (raw === undefined || raw.length !== height * (stride + 1)) throw new Error("Pixels PNG invalidos");
  const pixels = new Uint8Array(height * stride); let y = 0;
  while (y < height) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Filtro PNG invalido");
    let x = 0;
    while (x < stride) {
      const p = y * stride + x;
      const a = x >= channels ? pixels[p - channels] : 0;
      const b = y > 0 ? pixels[p - stride] : 0;
      const c = y > 0 && x >= channels ? pixels[p - stride - channels] : 0;
      const prediction = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0;
      pixels[p] = (raw[y * (stride + 1) + x + 1] + prediction) & 255; x = x + 1;
    }
    y = y + 1;
  }
  return new IconImage(width, height, pixels);
}
const iconCache = new Map<string, IconImage>();
const iconFailures = new Map<string, boolean>();
export function editorIcon(name: string): IconImage | null {
  const cached = iconCache.get(name); if (cached !== undefined) return cached;
  if (iconFailures.get(name) === true) return null;
  try {
    if (UI_ICONS.names.indexOf(name) < 0) throw new Error("Icone desconhecido");
    const decoded = decodeIconPNG(fs.read_all(UI_ICONS.directory + name + ".png"));
    iconCache.set(name, decoded); return decoded;
  } catch (error) { iconFailures.set(name, true); logWarn("Icone " + name + ": " + String(error)); return null; }
}
export function drawEditorIcon(win: number, name: string, x: number, y: number, size: number): boolean {
  const icon = editorIcon(name); if (icon === null) return false;
  render.image(win, x, y, size, size, icon.pixels, icon.width, icon.height); return true;
}

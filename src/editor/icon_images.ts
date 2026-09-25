import fs from "@compat/fs";
import { decodePNG } from "@engine/render/png";
import render from "@compat/render";
import { logWarn } from "@engine/core/logger";
import { UI_ICONS } from "./ui_config";

export class IconImage {
  width: number; height: number; pixels: Uint8Array;
  constructor(w: number, h: number, pixels: Uint8Array) { this.width = w; this.height = h; this.pixels = pixels; }
}
// O leitor de PNG agora é do motor (`@engine/render/png`), compartilhado com
// `loadTexture`; aqui só o limite de tamanho dos ícones.
export function decodeIconPNG(bytes: any): IconImage {
  const img = decodePNG(bytes, UI_ICONS.maxPixels);
  return new IconImage(img.width, img.height, img.pixels);
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

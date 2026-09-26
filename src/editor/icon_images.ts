import fs from "@compat/fs";
import { decodePNG } from "@engine/render/png";
import { imagemEm, imagem, imagemId, registrarImagem } from "@compat/draw2d.ts";
import { logWarn } from "@engine/core/logger";
import { UI_ICONS } from "./ui_config";

export class IconImage {
  width: number; height: number; pixels: Uint8Array;
  /// Textura retida na janela (0 = ainda não registrada): o ícone sobe uma vez.
  texId: number = 0;
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
/// Ícone `name` no quadrado do último `iconAt(x, y, lado)` (≤ 4 parâmetros por chamada).
export function iconAt(x: number, y: number, size: number): void { icX = x; icY = y; icS = size; }
let icX = 0.0; let icY = 0.0; let icS = 0.0;
export function drawEditorIcon(name: string): boolean {
  const icon = editorIcon(name); if (icon === null) return false;
  if (icon.texId === 0) icon.texId = registrarImagem(icon.pixels, icon.width, icon.height);
  imagemEm(icX, icY, icS, icS);
  if (icon.texId === 0) imagem(icon.pixels, icon.width, icon.height); else imagemId(icon.texId);
  return true;
}

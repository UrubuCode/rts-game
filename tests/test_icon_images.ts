import io from "@compat/io";
import fs from "@compat/fs";
import { editorIcon, decodeIconPNG } from "@editor/icon_images";
import { UI_ICONS } from "@editor/ui_config";
import { logEntries, setLogEcho, logClear } from "@engine/core/logger";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
setLogEcho(0); logClear();
let i = 0;
while (i < UI_ICONS.names.length) {
  const name = UI_ICONS.names[i]; const icon = editorIcon(name);
  check(icon !== null, "PNG loads: " + name);
  if (icon !== null) {
    check(icon.width === 32 && icon.height === 32 && icon.pixels.length === 4096, "RGBA dimensions: " + name);
    let transparent = 0; let opaque = 0; let partial = 0; let p = 3;
    while (p < icon.pixels.length) {
      const alpha = icon.pixels[p];
      if (alpha === 0) transparent = transparent + 1;
      else if (alpha === 255) opaque = opaque + 1;
      else partial = partial + 1;
      p = p + 4;
    }
    check(transparent > 0 && opaque > 0 && partial > 0, "transparent and antialiased pixels: " + name);
    check(editorIcon(name) === icon, "decoded image cache reused: " + name);
  }
  i = i + 1;
}
const warning = editorIcon("warning");
let golden = 0;
if (warning !== null) {
  i = 0; while (i < warning.pixels.length) {
    if (warning.pixels[i] > warning.pixels[i + 1] && warning.pixels[i + 1] > warning.pixels[i + 2] && warning.pixels[i + 3] === 255) golden = golden + 1;
    i = i + 4;
  }
}
check(golden > 0, "warning keeps golden RGB channels");
let rejected = false; try { decodeIconPNG(new Uint8Array(33)); } catch { rejected = true; }
check(rejected, "invalid signature rejected");
const bytes = fs.read_all(UI_ICONS.directory + "info.png");
const oversized = new Uint8Array(bytes.length); i = 0; while (i < bytes.length) { oversized[i] = bytes[i]; i = i + 1; }
oversized[16] = 1;
rejected = false; try { decodeIconPNG(oversized); } catch { rejected = true; }
check(rejected, "oversized dimensions rejected before inflate");
const truncated = new Uint8Array(34); i = 0; while (i < truncated.length) { truncated[i] = bytes[i]; i = i + 1; }
rejected = false; try { decodeIconPNG(truncated); } catch { rejected = true; }
check(rejected, "truncated PNG rejected");
check(editorIcon("missing") === null && editorIcon("missing") === null && logEntries().length === 1, "failed icon logged once, no retry per frame");
io.print("[PASSOU] PNG icons: decode, RGBA, alpha, antialias, cache and invalid data");

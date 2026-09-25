// Texturas de Material: leitor PNG do motor (RGB e RGBA, IDAT em vários
// chunks), erros com motivo, e o Material com Tiling/Procedural indo e voltando
// pela cena. O upload para a GPU precisa de janela (ver scratch/janela_tex.ts).
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { decodePNG } from "@engine/render/png";
import { Material } from "@engine/core/material";
import { GameObject } from "@engine/core/gameobject";
import { buildObject } from "@editor/sceneio";
import { componentToData } from "@engine/components";
import { createComponent } from "@editor/components";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── PNG RGB 4x2, IDAT em 2 chunks: pixel (x,y) = (60x, 100y, 200) ────────────
const rgb = decodePNG(fs.read_all("tests/fixtures_rgb_4x2.png"), 64);
check(rgb.width === 4 && rgb.height === 2 && rgb.pixels.length === 32, "RGB 4x2 vira RGBA 32 bytes");
let certo = 1;
let y = 0;
while (y < 2) {
  let x = 0;
  while (x < 4) {
    const i = (y * 4 + x) * 4;
    if (rgb.pixels[i] !== x * 60 || rgb.pixels[i + 1] !== y * 100 || rgb.pixels[i + 2] !== 200 || rgb.pixels[i + 3] !== 255) certo = 0;
    x = x + 1;
  }
  y = y + 1;
}
check(certo === 1, "cada pixel RGB decodificado certo, alfa 255");

// ── PNG RGBA (ícone do editor) continua funcionando ────────────────────────
const icone = decodePNG(fs.read_all("assets/editor/icons/info.png"), 64);
check(icone.width === 32 && icone.height === 32 && icone.pixels.length === 32 * 32 * 4, "icone RGBA 32x32");

// ── textura de exemplo do repo ─────────────────────────────────────────────
const tijolo = decodePNG(fs.read_all("assets/textures/tijolo.png"), 4096);
check(tijolo.width === 64 && tijolo.height === 64, "assets/textures/tijolo.png 64x64");

// ── erros com motivo ────────────────────────────────────────────────────────
let msg = "";
try { decodePNG(fs.read_all("tests/fixtures_rgb_4x2.png"), 2); } catch (e) { msg = String(e); }
check(msg.indexOf("fora do limite") >= 0, "limite de tamanho respeitado: " + msg);
msg = "";
try { decodePNG(new Uint8Array(40), 64); } catch (e) { msg = String(e); }
check(msg.indexOf("Assinatura") >= 0, "arquivo que nao e PNG falha com motivo: " + msg);

// ── Material: Tiling e Procedural no inspector e na cena ────────────────────
const m = createComponent("Material");
check(m.fieldCount() === 4 && m.fieldLabel(2) === "Tiling" && m.fieldLabel(3) === "Procedural", "inspector mostra Tiling e Procedural");
check(m.fieldType(2) === "number" && m.fieldType(3) === "string", "tipos dos campos novos");
m.fieldSet(2, 0.25);
m.fieldStringSet(3, "concreto");
check(m.matTile() === 0.25 && m.matProc() === "concreto", "matTile/matProc leem o que o inspector escreveu");
m.setMatTexture(7, "");
m.fieldStringSet(3, "tijolo");
check(m.matTexId() === 0, "trocar a procedural descarta o id resolvido");
const go = new GameObject("Parede");
go.addBehavior(m);
const volta = buildObject({ name: "Parede", pos: [0, 0, 0], rot: [0, 0], color: [255, 255, 255], scripts: [componentToData(m)] });
const mv = volta.behaviors[0] as Material;
check(mv.typeName() === "Material" && mv.tile === 0.25 && mv.procedural === "tijolo", "Tiling e Procedural voltam da cena");
check(volta.matIdx === 0, "matIdx cacheado no objeto restaurado");

io.print("[PASSOU] Texturas: PNG RGB/RGBA, erros, Material com Tiling/Procedural");

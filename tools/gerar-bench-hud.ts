// Gera as quatro cenas do bench do DomCanvas a partir de scenes/shadowdemo.json:
// sem HUD, HUD de 10 UIText, HUD HTML parado e HUD HTML com um texto por quadro.
//   rts.exe run tools/gerar-bench-hud.ts
import io from "@compat/io.ts";
import { writeFileSync } from "node:fs";
import { scene } from "@editor/control/session";
import { loadSceneFrom, sceneToJSON } from "@editor/sceneio";
import { GameObject } from "@engine/core/gameobject";
import { UIText } from "@engine/core/ui_text";
import { DomCanvas } from "@engine/core/dom_canvas";
import { BenchHudDom } from "../assets/scripts/BenchHudDom";

const BASE = "scenes/shadowdemo.json";
const LINHAS = 10; const MARGEM = 14; const LINHA_Y = 20; const TAMANHO = 16; const COR = 0xE8F0FFFF;
function salvar(caminho: string): void { writeFileSync(caminho, sceneToJSON()); io.print("[bench-hud] " + caminho + ": " + scene.objects.length + " objetos"); }
function hudDom(modo: number): void {
  const o = new GameObject("HUD");
  const c = new DomCanvas(); c.html = "assets/ui/claude-bench-hud.html"; c.bloqueiaCliques = false;
  const b = new BenchHudDom(); b.modo = modo;
  o.addBehavior(c); o.addBehavior(b);
  scene.add(o);
}
loadSceneFrom(BASE); salvar("scenes/claude-bench-hud-sem.json");
loadSceneFrom(BASE);
let i = 0;
while (i < LINHAS) {
  const o = new GameObject("Linha " + i);
  o.transform.px = MARGEM; o.transform.py = MARGEM + i * LINHA_Y;
  o.addBehavior(new UIText("linha " + i + " do HUD", TAMANHO, COR, 0));
  scene.add(o);
  i = i + 1;
}
salvar("scenes/claude-bench-hud-2d.json");
loadSceneFrom(BASE); hudDom(0); salvar("scenes/claude-bench-hud-dom.json");
loadSceneFrom(BASE); hudDom(1); salvar("scenes/claude-bench-hud-dom-texto.json");

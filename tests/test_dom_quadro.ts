// Teste SEM JANELA da integração com o quadro: drawGameUI faz UM render com
// DomCanvas e nenhum sem; área externa (aba Jogo); prévia do editor sem clique
// e com contorno; Play com clique; ponteiroSobreUI.
//   rts.exe run tests/test_dom_quadro.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { DomCanvas } from "@engine/core/dom_canvas";
import { drawGameUI, definirAreaUI } from "@engine/ui/game_ui";
import { domHostRenders, domHostDoc, domHostSeletorSobre } from "@engine/ui/dom_host";
import { ponteiroSobreUI, mouseApertadoNoMundo } from "@engine/core/entrada";
import { uiDoJogoNoEditor } from "@editor/game_ui_editor";
import { scene, S } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const DIR = "build/claude-dom";
fs.create_dir_all(DIR);
fs.write(DIR + "/q.html", "<div class=\"painel\"><span id=\"t\">x</span></div>");
function canvasEm(sc: Scene, nome: string): DomCanvas {
  const o = new GameObject(nome); const c = new DomCanvas(); c.html = DIR + "/q.html"; o.addBehavior(c); sc.add(o); return c;
}

const vazia = new Scene("vazia");
const r0 = domHostRenders();
drawGameUI(vazia, 0, 800, 600);
check(domHostRenders() === r0, "cena sem DomCanvas: nenhum render");

const sc = new Scene("quadro");
const c1 = canvasEm(sc, "A"); canvasEm(sc, "B");
drawGameUI(sc, 0, 800, 600);
check(domHostRenders() === r0 + 1, "dois canvases, um render");
const h = domHostDoc();
const regiao = dom.querySelector(h, "#dom-regiao");
check(dom.inlineProperty(h, regiao, "width") === "800px" && dom.inlineProperty(h, regiao, "left") === "0px", "sem área externa: a janela");
const area = new Float64Array(4); area[0] = 100; area[1] = 50; area[2] = 400; area[3] = 300;
definirAreaUI(area); drawGameUI(sc, 0, 800, 600); definirAreaUI(null);
check(dom.inlineProperty(h, regiao, "left") === "100px" && dom.inlineProperty(h, regiao, "height") === "300px", "área externa (aba Jogo)");

scene.clear();
const hud = canvasEm(scene, "HUD");
const raizHud = hud.documento.noDom(hud.documento.raiz());
S.simulating = 0; S.gameView = 0;
const r1 = domHostRenders();
uiDoJogoNoEditor(0, area, 800, 600);
check(domHostRenders() === r1, "aba Cena fora do Play: nada");
S.gameView = 1; S.selected = 0;
uiDoJogoNoEditor(0, area, 800, 600);
check(domHostRenders() === r1 + 1 && dom.inlineProperty(h, regiao, "pointer-events") === "none", "prévia na aba Jogo, sem clique");
check(dom.cssText(h, raizHud).indexOf("dashed") >= 0, "contorno no canvas selecionado");
S.simulating = 1;
uiDoJogoNoEditor(0, area, 800, 600);
check(dom.inlineProperty(h, regiao, "pointer-events") === "auto" && dom.cssText(h, raizHud).indexOf("dashed") < 0, "Play: cliques e sem contorno");
S.simulating = 0; S.gameView = 0;

domHostSeletorSobre(".forcado");
check(!ponteiroSobreUI(), "nada sob o ponteiro");
const v = c1.documento;
dom.setAttr(h, v.noDom(v.querySelector("#t")), "class", "forcado");
check(ponteiroSobreUI() && !mouseApertadoNoMundo(0), "sobre a UI: o mundo não recebe o clique (sem janela: nunca apertado)");
domHostSeletorSobre("");
sc.clear(); scene.clear();
io.print("[PASSOU] quadro: um render por quadro, nenhum sem canvas, área da aba Jogo, prévia, Play e sobre-UI");

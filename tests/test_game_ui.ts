// UI do jogo (UIText/UIButton + pass game_ui): âncoras, catálogo, serialização
// e entrega de clique — tudo sem janela (o desenho em si precisa de uma).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { UIText } from "@engine/core/ui_text";
import { UIButton } from "@engine/core/ui_button";
import { anchorX, anchorY, hitRect, ANCHOR_TL, ANCHOR_TR, ANCHOR_BL, ANCHOR_BR } from "@engine/ui/anchor";
import { collectGameUI, dispatchUIClick } from "@engine/ui/game_ui";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { buildObject } from "@editor/sceneio";
import { componentToData } from "@engine/components";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ── âncoras ────────────────────────────────────────────────────────────────
check(anchorX(ANCHOR_TL, 10, 800, 100) === 10, "TL: x = offset");
check(anchorX(ANCHOR_TR, 10, 800, 100) === 690, "TR: x = W - w - offset");
check(anchorY(ANCHOR_BL, 20, 600, 30) === 550, "BL: y = H - h - offset");
check(anchorY(ANCHOR_BR, 20, 600, 30) === 550 && anchorX(ANCHOR_BR, 10, 800, 100) === 690, "BR: ambos");
check(hitRect(15, 15, 10, 10, 20, 20) === 1 && hitRect(30, 15, 10, 10, 20, 20) === 0 && hitRect(9, 15, 10, 10, 20, 20) === 0, "hitRect: dentro/fora/borda");

// ── catálogo e fábrica ────────────────────────────────────────────────────
check(COMPONENT_NAMES.indexOf("UIText") >= 0 && COMPONENT_NAMES.indexOf("UIButton") >= 0, "UIText e UIButton no catalogo gerado");
const t = createComponent("UIText");
const b = createComponent("UIButton");
check(t.typeName() === "UIText" && b.typeName() === "UIButton", "fabrica cria pelos nomes");
check(t.fieldType(0) === "number", "UIText expoe campos numericos ao inspector");

// ── serialização ida e volta ─────────────────────────────────────────────
const src = new GameObject("Hud");
const ut = new UIText("Vida: 100", 18, 0xFF0000FF, ANCHOR_TR);
const ub = new UIButton("Jogar", 200, 40, ANCHOR_BR);
src.addBehavior(ut);
src.addBehavior(ub);
src.transform.px = 12; src.transform.py = 34;
const data: any = { name: src.name, pos: [12, 34, 0], rot: [0, 0], color: [1, 1, 1], scripts: [componentToData(ut), componentToData(ub)] };
const back = buildObject(data);
check(back.behaviors.length === 2, "os dois componentes voltaram");
const bt = back.behaviors[0] as UIText;
const bb = back.behaviors[1] as UIButton;
check(bt.typeName() === "UIText" && bt.text === "Vida: 100" && bt.size === 18 && bt.color === 0xFF0000FF && bt.anchor === ANCHOR_TR, "UIText preserva texto, tamanho, cor e ancora");
check(bb.typeName() === "UIButton" && bb.label === "Jogar" && bb.w === 200 && bb.h === 40 && bb.anchor === ANCHOR_BR, "UIButton preserva rotulo, tamanho e ancora");

// ── lista de UI mantida pela cena ──────────────────────────────────────
const sc = new Scene("UI");
let i = 0;
while (i < 50) { sc.add(new GameObject("obj" + i)); i = i + 1; }
check(collectGameUI(sc) === 0, "cena sem UI: zero objetos de UI");
sc.add(back);
check(collectGameUI(sc) === 1, "add de um objeto com UI entra na lista da cena");
const tarde = new GameObject("Tarde");
sc.add(tarde);
check(collectGameUI(sc) === 1, "objeto sem UI nao entra");
tarde.addBehavior(new UIText("depois"));
check(collectGameUI(sc) === 2, "componente de UI adicionado DEPOIS de estar na cena entra (uiChanged)");
tarde.removeBehavior(tarde.behaviors.length - 1);
check(collectGameUI(sc) === 1, "e sai quando o componente e removido");
sc.removeAt(sc.objects.indexOf(back));
check(collectGameUI(sc) === 0, "removeAt tira da lista");
sc.add(back);
check(collectGameUI(sc) === 1, "re-add volta");
sc.clear();
check(collectGameUI(sc) === 0 && back.uiOwner === null, "clear esvazia a lista e solta o dono");
sc.add(back);

// ── clique chega aos irmãos por onUIClick ────────────────────────────────
class Ouvinte extends Behavior {
  recebido: string = "";
  vezes: number = 0;
  onUIClick(name: string): void { this.recebido = name; this.vezes = this.vezes + 1; }
}
const ouv = new Ouvinte();
back.addBehavior(ouv);
const desligado = new Ouvinte();
desligado.enabled = 0;
back.addBehavior(desligado);
dispatchUIClick(back, "Jogar");
check(ouv.recebido === "Jogar" && ouv.vezes === 1, "onUIClick entregue ao script irmao com o rotulo");
check(desligado.vezes === 0, "behavior desabilitado nao recebe");
check(bb.uiClicked() === 0 && bb.uiName() === "Jogar", "botao sem janela: nao clicado; uiName = rotulo");

io.print("[PASSOU] Game UI: ancoras, catalogo, serializacao, coleta cacheada e onUIClick");

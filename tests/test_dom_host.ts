// Teste SEM JANELA do DomHost com a fachada real do rts: documento sob demanda,
// uma raiz por canvas, layout e visibilidade só quando mudam, região, prévia,
// destaque, clique -> onUIClick(data-acao|id), domHostSobreUI e liberação.
//   rts.exe run tests/test_dom_host.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { ANCHOR_BR } from "@engine/ui/anchor";
import { domHostRegistrar, domHostRemover, domHostConteudo, domHostLayout, domHostRender, domHostPump,
         domHostSobreUI, domHostSeletorSobre, domHostPrevia, domHostDestacar, domHostRaiz, domHostDoc,
         domHostEscopo, domHostAtivos, domHostRenders, DOM_NENHUM, DOM_LAYOUT_FLOATS,
         DL_ANCORAGEM, DL_LARGURA, DL_ALTURA, DL_ORDEM, DL_ESCALA, DL_BLOQUEIA } from "@engine/ui/dom_host";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Dono extends Behavior {
  cliques: string[];
  constructor() { super(); this.cliques = []; }
  onUIClick(nome: string): void { this.cliques.push(nome); }
}
const sc = new Scene("dom-host");
function dono(nome: string): Dono {
  const o = new GameObject(nome); const b = new Dono(); o.addBehavior(b); sc.add(o); return b;
}
function inline(h: number, no: number, prop: string): string { return dom.inlineProperty(h, no, prop); }
const area = new Float64Array(4); area[0] = 10; area[1] = 20; area[2] = 640; area[3] = 360;

// sem canvas: nada
const r0 = domHostRenders();
domHostRender(0, area); domHostPump();
check(domHostDoc() === 0 && domHostRenders() === r0 && !domHostSobreUI(), "sem canvas: sem documento, sem render");

// dois canvases, duas raízes em #dom-regiao
const a = dono("A"); const b = dono("B");
const oa = a.owner as GameObject; const ob = b.owner as GameObject;
const sa = domHostRegistrar(a); const sb = domHostRegistrar(b);
const h = domHostDoc();
check(h !== 0 && sa !== sb && domHostAtivos() === 2, "documento criado no primeiro registro");
const ra = domHostRaiz(sa); const rb = domHostRaiz(sb);
const regiao = dom.querySelector(h, "#dom-regiao");
check(dom.parentElement(h, ra) === regiao && dom.parentElement(h, rb) === regiao, "raízes filhas de #dom-regiao");
check(domHostEscopo(sa) === "[data-go=\"" + dom.getAttribute(h, ra, "data-go") + "\"]" && domHostEscopo(sa) !== domHostEscopo(sb), "escopo por serial");

// layout
const cfg = new Float64Array(DOM_LAYOUT_FLOATS);
cfg[DL_ANCORAGEM] = ANCHOR_BR; cfg[DL_LARGURA] = 200; cfg[DL_ALTURA] = 0; cfg[DL_ORDEM] = 5; cfg[DL_ESCALA] = 1.5; cfg[DL_BLOQUEIA] = 1;
a.host.px = 12; a.host.py = 8;
domHostLayout(sa, cfg);
domHostRender(0, area);
check(domHostRenders() === r0 + 1, "um render por quadro com dois canvases");
check(inline(h, ra, "right") === "12px" && inline(h, ra, "bottom") === "8px", "BR: right/bottom = deslocamento");
check(inline(h, ra, "width") === "200px" && inline(h, ra, "left") === "auto", "largura fixa");
check(inline(h, ra, "top") === "0px" && inline(h, ra, "height") === "auto", "altura 0 estica até a borda");
check(inline(h, ra, "z-index") === "5" && inline(h, ra, "font-size") === "24px", "ordem e escala");
check(inline(h, regiao, "left") === "10px" && inline(h, regiao, "top") === "20px" && inline(h, regiao, "height") === "360px", "região = área");
a.host.px = 30; domHostRender(0, area);
check(inline(h, ra, "right") === "30px", "mover o objeto reaplica o layout");

// visibilidade
check(inline(h, ra, "display") === "block", "visível");
oa.active = 0; domHostRender(0, area);
check(inline(h, ra, "display") === "none", "objeto inativo esconde");
oa.active = 1; a.enabled = 0; domHostRender(0, area);
check(inline(h, ra, "display") === "none", "componente desabilitado esconde");
a.enabled = 1; domHostRender(0, area);
check(inline(h, ra, "display") === "block", "volta a aparecer");
ob.parent = 0; oa.active = 0; domHostRender(0, area);
check(inline(h, rb, "display") === "none", "pai inativo esconde o filho");
oa.active = 1; ob.parent = 0 - 1; domHostRender(0, area);

// clique -> onUIClick
domHostConteudo(sa, "<div class=\"painel\"><button data-acao=\"jogar\"><span id=\"rot\">Jogar</span></button><p id=\"solto\">x</p><i>sem id</i></div>");
const span = dom.queryWithin(h, ra, "#rot");
dom.pushRawEvent(h, span, "click"); domHostPump();
check(a.cliques.length === 1 && a.cliques[0] === "jogar", "data-acao do ancestral vence o id do alvo");
dom.pushRawEvent(h, dom.queryWithin(h, ra, "#solto"), "click"); domHostPump();
check(a.cliques[1] === "solto", "sem data-acao: o id");
dom.pushRawEvent(h, dom.queryWithin(h, ra, "i"), "click"); domHostPump();
check(a.cliques.length === 2 && b.cliques.length === 0, "sem ação nem id na raiz: nada (o id de #dom-regiao não vaza)");

// sobre a UI (seletor substituível: :hover exige mouse real)
domHostSeletorSobre(".forcado");
check(!domHostSobreUI(), "nada marcado");
dom.setAttr(h, span, "class", "forcado");
check(domHostSobreUI(), "descendente sob o ponteiro bloqueia");
cfg[DL_BLOQUEIA] = 0; domHostLayout(sa, cfg);
check(!domHostSobreUI(), "bloqueiaCliques = false não bloqueia");
cfg[DL_BLOQUEIA] = 1; domHostLayout(sa, cfg);
dom.setAttr(h, span, "class", ""); dom.setAttr(h, ra, "class", "dom-canvas forcado");
check(!domHostSobreUI(), "a própria raiz (área inteira) não conta");
dom.setAttr(h, ra, "class", "dom-canvas"); dom.setAttr(h, span, "class", "forcado");
a.enabled = 0; domHostRender(0, area);
check(!domHostSobreUI(), "canvas escondido não bloqueia");
a.enabled = 1; domHostRender(0, area);
domHostSeletorSobre("");

// prévia e destaque
domHostPrevia(true);
check(inline(h, regiao, "pointer-events") === "none", "prévia não rouba clique dos painéis");
domHostPrevia(false);
check(inline(h, regiao, "pointer-events") === "auto", "Play: o clique volta");
domHostDestacar(oa, "2px dashed #6A9DD2");
check(dom.cssText(h, ra).indexOf("dashed") >= 0 && dom.cssText(h, rb).indexOf("dashed") < 0, "contorno só no selecionado");
domHostDestacar(null, "none");
check(dom.cssText(h, ra).indexOf("dashed") < 0, "sem seleção, sem contorno");

// liberação
const antes = dom.nodeCount(h);
let k = 0;
while (k < 50) { const c = dono("C" + k); const s = domHostRegistrar(c); domHostConteudo(s, "<p>x</p><p>y</p>"); domHostRemover(s); k = k + 1; }
check(dom.nodeCount(h) <= antes + 8, "registrar/remover 50 vezes não cresce a arena (releaseSubtree)");
domHostRemover(sa);
check(domHostAtivos() === 1 && domHostDoc() === h, "ainda há B");
domHostRemover(sb);
check(domHostAtivos() === 0 && domHostDoc() === 0, "o último canvas libera o documento");
domHostRemover(sb);   // repetido: no-op
const s2 = domHostRegistrar(b);
check(domHostDoc() !== 0 && domHostRaiz(s2) !== DOM_NENHUM, "novo documento sob demanda");
domHostRender(0, area);
sc.detachAll(); domHostRender(0, area);
check(inline(domHostDoc(), domHostRaiz(s2), "display") === "none", "objeto fora da cena (original guardado pelo Play) fica escondido");
domHostRemover(s2);
io.print("[PASSOU] DomHost: documento sob demanda, raízes, layout, visibilidade, região, prévia, destaque, clique, sobre-UI e liberação");

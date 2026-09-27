// Teste SEM JANELA do DomCanvas: catálogo, carga de .html/.css escopada,
// DomVista (cache por nó, ids por geração, setNumero), carga sob demanda,
// serialização, Play/Parar sem vazar raízes e remoção.
//   rts.exe run tests/test_dom_canvas.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";
import { DOM_VISTA_NENHUM, textoNumero, alternarClasse } from "@engine/ui/dom_vista";
import { domHostAtivos, domHostRender, domHostDoc, domHostPump } from "@engine/ui/dom_host";
import { ANCHOR_TL } from "@engine/ui/anchor";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { componentToData } from "@engine/components";
import { buildObject } from "@editor/sceneio";
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Ouvinte extends Behavior {
  ultimo: string; recargas: number;
  constructor() { super(); this.ultimo = ""; this.recargas = 0; }
  onUIClick(n: string): void { this.ultimo = n; }
  onDomReload(): void { this.recargas = this.recargas + 1; }
}
class Leitor extends Behavior {
  achou: number;
  constructor() { super(); this.achou = 0 - 1; }
  mount(): void { const c = domCanvasDe(this.owner); if (c !== null) this.achou = c.documento.querySelector("#vida"); }
}
const DIR = "build/claude-dom";
fs.create_dir_all(DIR);
fs.write(DIR + "/a.html", "<!doctype html><html><head><style>#vida{color:rgb(0, 128, 0)}</style></head><body>" +
  "<p id=\"vida\">100</p><p id=\"mun\">30</p><button data-acao=\"ok\">ok</button><script>x()</script></body></html>");
fs.write(DIR + "/a.css", "p{margin:0} #vida.alerta{color:rgb(255, 0, 0)}");
fs.write(DIR + "/b.html", "<style>#vida{color:rgb(0, 0, 255)}</style><p id=\"vida\">B</p>");
const area = new Float64Array(4); area[2] = 800; area[3] = 600;

check(textoNumero(1234, 0) === "1234" && textoNumero(7, 1) === "0.7" && textoNumero(-5, 2) === "-0.05" && textoNumero(573, 1) === "57.3", "textoNumero");
check(alternarClasse("a b", "c", true) === "a b c" && alternarClasse("a c b", "c", false) === "a b" && alternarClasse("a", "a", true) === "a", "alternarClasse");

check(COMPONENT_NAMES.indexOf("DomCanvas") >= 0, "DomCanvas no catálogo gerado");
const padrao = createComponent("DomCanvas") as DomCanvas;
check(padrao.escala === 1.0 && padrao.bloqueiaCliques && padrao.html === "" && padrao.largura === 0 && !padrao.montado(), "construtor sem argumentos com os padrões");

const sc = new Scene("dom-canvas");
function objetoCom(nome: string, html: string, css: string): DomCanvas {
  const o = new GameObject(nome); const c = new DomCanvas(); c.html = html; c.css = css; o.addBehavior(c); sc.add(o); return c;
}
const ativos0 = domHostAtivos();
const ca = objetoCom("A", DIR + "/a.html", DIR + "/a.css");
const ouv = new Ouvinte(); (ca.owner as GameObject).addBehavior(ouv);
const cb = objetoCom("B", DIR + "/b.html", "");
check(ca.montado() && cb.montado() && domHostAtivos() === ativos0 + 2 && ca.erro() === "", "montar registra e carrega");
const va = ca.documento; const vb = cb.documento;
const h = va.doc();
const vida = va.querySelector("#vida"); const vidaB = vb.querySelector("#vida");
check(vida >= 0 && vidaB >= 0 && va.querySelector("#nada") === DOM_VISTA_NENHUM, "querySelector limitado à raiz");
check(va.querySelector("#vida") === vida && va.valido(vida) && !va.valido(vidaB), "mesma consulta, mesmo id; id de outra vista não vale");
check(dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(0, 128, 0)", "estilo do próprio arquivo");
check(dom.computedProperty(h, vb.noDom(vidaB), "color", "") === "rgb(0, 0, 255)", "CSS escopado: um canvas não pinta o outro");
check(dom.queryAllWithinCount(h, va.noDom(va.raiz()), "script") === 0, "<script> removido");
check(va.getText(vida) === "100", "conteúdo do body");

// cache: mesmo valor não escreve
va.setText(vida, "90");
const e1 = va.escritas;
va.setText(vida, "90");
check(va.escritas === e1 && va.getText(vida) === "90", "mesmo texto: nenhuma escrita");
va.setNumero(vida, 57.4, 0);
check(va.getText(vida) === "57" && va.escritas === e1 + 1, "setNumero arredonda");
va.setNumero(vida, 57.2, 0);
check(va.escritas === e1 + 1, "mesmo inteiro: nenhuma escrita");
va.setNumero(vida, 57.24, 1);
check(va.getText(vida) === "57.2", "uma casa");
va.setNumero(vida, NaN, 0);
check(va.getText(vida) === "0", "setNumero com NaN não lança e vira 0");
va.setNumero(vida, 5, NaN);
check(va.getText(vida) === "5", "setNumero com casas NaN não lança e vira 0 casas");
va.setStyleNumero(vida, "width", NaN, "%");
check(dom.inlineProperty(h, va.noDom(vida), "width") === "0%", "setStyleNumero com NaN não lança e vira 0");
va.setClass(vida, "alerta", true);
const e2 = va.escritas;
va.setClass(vida, "alerta", true);
check(va.escritas === e2 && dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(255, 0, 0)", "setClass liga uma vez");
va.setClass(vida, "alerta", false);
check(dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(0, 128, 0)", "setClass desliga");
va.setStyle(vida, "font-size", "20px"); const e3 = va.escritas; va.setStyle(vida, "font-size", "20px");
check(va.escritas === e3 && dom.inlineProperty(h, va.noDom(vida), "font-size") === "20px", "setStyle com cache");
va.setStyleNumero(vida, "width", 42.4, "%"); const e4 = va.escritas; va.setStyleNumero(vida, "width", 42.2, "%");
check(va.escritas === e4 && dom.inlineProperty(h, va.noDom(vida), "width") === "42%", "setStyleNumero com cache");
va.setAttr(vida, "title", "t"); const e5 = va.escritas; va.setAttr(vida, "title", "t");
check(va.escritas === e5 && dom.getAttribute(h, va.noDom(vida), "title") === "t", "setAttr com cache");

// eventos
let alvo = 0 - 1;
const btn = va.querySelector("button");
va.on(btn, "click", (no: number): void => { alvo = no; });
dom.pushRawEvent(h, va.noDom(btn), "click"); domHostPump();
check(alvo === btn && ouv.ultimo === "ok", "on entrega o id da vista; data-acao chega ao onUIClick do irmão");

// script montado antes do canvas: carga sob demanda
const oc = new GameObject("C"); const leitor = new Leitor(); const cc = new DomCanvas(); cc.html = DIR + "/a.html";
oc.addBehavior(leitor); oc.addBehavior(cc); sc.add(oc);
check(leitor.achou >= 0 && cc.montado() && domHostAtivos() === ativos0 + 3, "documento sob demanda na primeira leitura");

// arquivo ausente
const cx = objetoCom("X", DIR + "/nao-existe.html", "");
check(cx.montado() && cx.erro().indexOf("nao-existe.html") >= 0, "arquivo ausente: raiz vazia e erro anotado");

// .html válido com .css ausente: erro aponta para o .css, não trava
const cy = objetoCom("Y", DIR + "/a.html", DIR + "/nao-existe.css");
check(cy.montado() && cy.erro().indexOf("nao-existe.css") >= 0, ".html válido com .css ausente: erro aponta para o .css");

// onValidate prende NaN (não propaga para Math.max/min nem trava o layout)
ca.escala = NaN; ca.ancoragem = NaN; ca.ordem = NaN; ca.largura = NaN; ca.altura = NaN;
ca.onValidate("escala");
check(ca.escala > 0 && ca.ancoragem === ANCHOR_TL && ca.ordem === 0 && ca.largura === 0 && ca.altura === 0,
  "onValidate prende NaN em escala/ancoragem/ordem/largura/altura");

// recarregar() num canvas destruído devolve false e não remonta
const cd = objetoCom("D", DIR + "/a.html", "");
check(cd.montado(), "D montado antes de destruir");
(cd.owner as GameObject).removeBehavior(0);
check(!cd.montado() && !cd.recarregar() && !cd.montado(), "recarregar() após destruído devolve false e não remonta");

// desabilitado: display none, ids válidos
ca.enabled = 0; domHostRender(0, area);
check(dom.inlineProperty(h, va.noDom(va.raiz()), "display") === "none", "desabilitado: display none");
va.setText(vida, "escondido");
check(va.getText(vida) === "escondido", "ids continuam válidos escondido");
ca.enabled = 1;

// serialização
ca.escala = 1.25; ca.ordem = 3; ca.bloqueiaCliques = false;
const dados = componentToData(ca);
const txt = JSON.stringify(dados);
check(txt.indexOf("a.html") >= 0 && txt.indexOf("1.25") >= 0 && txt.indexOf("slot") < 0 && txt.indexOf("ultimoErro") < 0, "campos públicos salvos, estado de execução não");
const rt = buildObject({ name: "Rt", pos: [0, 0, 0], rot: [0, 0], color: [0, 0, 0], scripts: [dados] });
const crt = domCanvasDe(rt) as DomCanvas;
check(crt !== null && crt.html === ca.html && crt.escala === 1.25 && crt.ordem === 3 && !crt.bloqueiaCliques && !crt.montado(), "ida e volta sem montar");

// Play/Parar na cena do editor
scene.clear();
const op = new GameObject("HUD"); const cp = new DomCanvas(); cp.html = DIR + "/a.html"; op.addBehavior(cp); scene.add(op);
const ativosEd = domHostAtivos();
check(playMode.play(), "Play aceita DomCanvas (cópia por componentToData)");
const copia = domCanvasDe(scene.objects[0]) as DomCanvas;
check(copia !== cp && copia.montado() && cp.montado() && domHostAtivos() === ativosEd + 1, "a cópia monta a própria raiz; o original fica guardado");
domHostRender(0, area);
const vo = cp.documento;
check(dom.inlineProperty(domHostDoc(), vo.noDom(vo.raiz()), "display") === "none", "original escondido durante o Play");
const vc = copia.documento; vc.setText(vc.querySelector("#vida"), "5");
playMode.stop();
check(domHostAtivos() === ativosEd && !copia.montado(), "Parar libera a raiz da cópia");
domHostRender(0, area);
check(vo.getText(vo.querySelector("#vida")) === "100" && dom.inlineProperty(domHostDoc(), vo.noDom(vo.raiz()), "display") === "block", "original intacto e visível de novo");
scene.removeAt(0);
check(!cp.montado() && domHostAtivos() === ativosEd - 1, "remover o objeto libera a raiz (onDestroy)");
(ca.owner as GameObject).removeBehavior(0);
check(!ca.montado() && ca.documento.raiz() === DOM_VISTA_NENHUM, "remover o componente libera; destruído não remonta");
sc.clear();
check(domHostAtivos() === ativos0, "clear libera todas as raízes");
io.print("[PASSOU] DomCanvas: catálogo, carga escopada, cache da vista, eventos, sob demanda, serialização, Play/Parar e remoção");

// Engine RTS — DomHost: o ÚNICO módulo que fala com a fachada do DOM do rts
// (parseDocument, pumpEventCallbacks). O rts de hoje pinta um documento por
// janela (spike-domcanvas §2), então todos os DomCanvas vivem num documento
// só: um <div data-go="<serial>"> por canvas, filho de #dom-regiao, que
// recorta a área do jogo (a aba Jogo no editor). Criado no primeiro registro e
// liberado quando o último canvas sai: cena sem DomCanvas não paga nada.
//
// Por quadro: domHostRender (visibilidade e layout só quando mudam, e UM
// render) e domHostPump depois do endFrame. Sem try/catch e sem string por
// quadro: as strings de estilo nascem só quando um valor muda. Não chama
// pumpTimerCallbacks: ela gira o loop inteiro do motor (WebSocket, processos)
// fora do ctrlPoll, e <script> de página é removido na carga.
//
// Outro arquivo que escrever os nomes de entrada da fachada (até em
// comentário) ganha uma cópia dela: tests/editor-static.test.mjs recusa.
import { render } from "rts:egui";
import { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { ANCHOR_TR, ANCHOR_BL, ANCHOR_BR } from "@engine/ui/anchor";
import { DOM_ATRIBUTO_ESCOPO, seletorEscopo } from "@engine/ui/dom_css";
import { dispatchUIClick } from "@engine/ui/ui_click";

export const DOM_NENHUM: number = 0 - 1;
/// Layout de um canvas: [ancoragem, largura, altura, ordem, escala, bloqueiaCliques].
export const DOM_LAYOUT_FLOATS: number = 6;
export const DL_ANCORAGEM: number = 0;
export const DL_LARGURA: number = 1;
export const DL_ALTURA: number = 2;
export const DL_ORDEM: number = 3;
export const DL_ESCALA: number = 4;
export const DL_BLOQUEIA: number = 5;
/// font-size da raiz com escala 1 (fase 1: `escala` vira tamanho de fonte).
export const DOM_FONTE_BASE_PX: number = 16;
/// Fundo transparente é obrigatório: sem ele o canvas do documento é branco e cobre o 3D.
const HTML_BASE: string = "<style>html,body{background:transparent;margin:0}</style>" +
  "<div id=\"dom-regiao\" style=\"position:absolute;left:0px;top:0px;width:100%;height:100%;overflow:hidden\"></div>";
const SELETOR_REGIAO: string = "#dom-regiao";
const ESTILO_RAIZ: string = "position:absolute";
const CLASSE_RAIZ: string = "dom-canvas";
const SELETOR_ACAO: string = "[data-acao]";
const ATRIBUTO_ACAO: string = "data-acao";
const SELETOR_ID: string = "[id]";
const ATRIBUTO_ID: string = "id";
const SELETOR_SOBRE_PADRAO: string = ":hover";
const EVENTO_CLIQUE: string = "click";
const NAO_APLICADO: number = 0 - 1;
const PX: string = "px";
const ZERO_PX: string = "0px";
const AUTO: string = "auto";
const P_LEFT: string = "left"; const P_RIGHT: string = "right"; const P_TOP: string = "top"; const P_BOTTOM: string = "bottom";
const P_WIDTH: string = "width"; const P_HEIGHT: string = "height"; const P_Z: string = "z-index"; const P_FONTE: string = "font-size";
const P_DISPLAY: string = "display"; const P_PONTEIRO: string = "pointer-events"; const P_CONTORNO: string = "outline";
const V_BLOCK: string = "block"; const V_NONE: string = "none";
/// Dono de um slot livre (nunca visível).
const SEM_DONO: Behavior = new Behavior();

class EstadoDomHost {
  doc: Document | null; h: number; regiao: number; serial: number; ativos: number; renders: number;
  raizes: number[]; donos: Behavior[]; escopos: string[]; visivel: number[]; sujo: number[];
  ultPx: number[]; ultPy: number[]; layout: Float64Array[]; livres: number[];
  area: Float64Array; previa: number; destaque: GameObject | null; contorno: string; seletorSobre: string;
  constructor() {
    this.doc = null; this.h = 0; this.regiao = DOM_NENHUM; this.serial = 0; this.ativos = 0; this.renders = 0;
    this.raizes = []; this.donos = []; this.escopos = []; this.visivel = []; this.sujo = [];
    this.ultPx = []; this.ultPy = []; this.layout = []; this.livres = [];
    this.area = new Float64Array(4); this.previa = NAO_APLICADO; this.destaque = null; this.contorno = "";
    this.seletorSobre = SELETOR_SOBRE_PADRAO;
  }
}
const est = new EstadoDomHost();

function garantirDocumento(): void {
  if (est.h !== 0) return;
  const d = parseDocument(HTML_BASE);
  est.doc = d;
  est.h = d._dom;
  est.regiao = dom.querySelector(est.h, SELETOR_REGIAO);
  est.area[2] = NAO_APLICADO; est.previa = NAO_APLICADO; est.destaque = null; est.contorno = "";
}
function liberarDocumento(): void {
  dom.free(est.h);
  est.doc = null; est.h = 0; est.regiao = DOM_NENHUM;
  est.raizes.length = 0; est.donos.length = 0; est.escopos.length = 0; est.visivel.length = 0; est.sujo.length = 0;
  est.ultPx.length = 0; est.ultPy.length = 0; est.layout.length = 0; est.livres.length = 0;
}
function novoSlot(): number {
  if (est.livres.length > 0) {
    const s = est.livres[est.livres.length - 1];
    est.livres.length = est.livres.length - 1;
    return s;
  }
  est.raizes.push(DOM_NENHUM); est.donos.push(SEM_DONO); est.escopos.push(""); est.visivel.push(NAO_APLICADO);
  est.sujo.push(1); est.ultPx.push(0.0); est.ultPy.push(0.0); est.layout.push(new Float64Array(DOM_LAYOUT_FLOATS));
  return est.raizes.length - 1;
}
/// Cria a raiz de um canvas (e o documento, no primeiro). Devolve o slot.
export function domHostRegistrar(b: Behavior): number {
  garantirDocumento();
  const slot = novoSlot();
  est.serial = est.serial + 1;
  const h = est.h;
  const raiz = dom.createElement(h, "div");
  dom.setAttr(h, raiz, DOM_ATRIBUTO_ESCOPO, "" + est.serial);
  dom.setAttr(h, raiz, "class", CLASSE_RAIZ);
  dom.setAttr(h, raiz, "style", ESTILO_RAIZ);
  dom.appendChild(h, est.regiao, raiz);
  dom.addListenerCbOptions(h, raiz, EVENTO_CLIQUE, (e: any): void => { cliqueNaRaiz(slot, e.target.nodeId); });
  est.raizes[slot] = raiz; est.donos[slot] = b; est.escopos[slot] = seletorEscopo(est.serial);
  est.visivel[slot] = NAO_APLICADO; est.sujo[slot] = 1;
  const cfg = est.layout[slot];
  cfg[DL_ANCORAGEM] = 0.0; cfg[DL_LARGURA] = 0.0; cfg[DL_ALTURA] = 0.0; cfg[DL_ORDEM] = 0.0; cfg[DL_ESCALA] = 1.0; cfg[DL_BLOQUEIA] = 1.0;
  est.destaque = null;   // o próximo domHostDestacar reaplica o contorno, inclusive nesta raiz
  est.ativos = est.ativos + 1;
  return slot;
}
export function domHostConteudo(slot: number, html: string): void {
  if (slot < 0 || slot >= est.raizes.length || est.raizes[slot] === DOM_NENHUM) return;
  dom.setInnerHtml(est.h, est.raizes[slot], html);
}
export function domHostLayout(slot: number, cfg: Float64Array): void {
  if (slot < 0 || slot >= est.raizes.length) return;
  const d = est.layout[slot];
  let i = 0;
  while (i < DOM_LAYOUT_FLOATS) { d[i] = cfg[i]; i = i + 1; }
  est.sujo[slot] = 1;
}
/// Tira a raiz do documento e recicla a subárvore; o último canvas libera o documento.
export function domHostRemover(slot: number): void {
  if (slot < 0 || slot >= est.raizes.length || est.raizes[slot] === DOM_NENHUM) return;
  const raiz = est.raizes[slot];
  dom.removeNode(est.h, raiz);
  dom.releaseSubtree(est.h, raiz);
  est.raizes[slot] = DOM_NENHUM; est.donos[slot] = SEM_DONO;
  est.livres.push(slot);
  est.ativos = est.ativos - 1;
  if (est.ativos === 0) liberarDocumento();
}
export function domHostRaiz(slot: number): number { return slot >= 0 && slot < est.raizes.length ? est.raizes[slot] : DOM_NENHUM; }
export function domHostEscopo(slot: number): string { return slot >= 0 && slot < est.escopos.length ? est.escopos[slot] : ""; }
export function domHostDoc(): number { return est.h; }
export function domHostAtivos(): number { return est.ativos; }
export function domHostRenders(): number { return est.renders; }

function visivelNoQuadro(b: Behavior): number {
  if (b.enabled === 0) return 0;
  const o = b.owner;
  if (o === null) return 0;
  const cena = o.uiOwner;
  if (cena === null) return 0;
  return cena.activeInHierarchy(o);
}
function aplicarLayout(i: number, b: Behavior): void {
  const cfg = est.layout[i]; const raiz = est.raizes[i]; const h = est.h;
  const px = b.host.px; const py = b.host.py;
  est.ultPx[i] = px; est.ultPy[i] = py; est.sujo[i] = 0;
  const anc = cfg[DL_ANCORAGEM] | 0;
  const direita = anc === ANCHOR_TR || anc === ANCHOR_BR;
  const baixo = anc === ANCHOR_BL || anc === ANCHOR_BR;
  const w = cfg[DL_LARGURA]; const al = cfg[DL_ALTURA];
  dom.setStyleProperty(h, raiz, direita ? P_RIGHT : P_LEFT, px + PX);
  dom.setStyleProperty(h, raiz, direita ? P_LEFT : P_RIGHT, w > 0.0 ? AUTO : ZERO_PX);
  dom.setStyleProperty(h, raiz, P_WIDTH, w > 0.0 ? w + PX : AUTO);
  dom.setStyleProperty(h, raiz, baixo ? P_BOTTOM : P_TOP, py + PX);
  dom.setStyleProperty(h, raiz, baixo ? P_TOP : P_BOTTOM, al > 0.0 ? AUTO : ZERO_PX);
  dom.setStyleProperty(h, raiz, P_HEIGHT, al > 0.0 ? al + PX : AUTO);
  dom.setStyleProperty(h, raiz, P_Z, "" + (cfg[DL_ORDEM] | 0));
  dom.setStyleProperty(h, raiz, P_FONTE, (DOM_FONTE_BASE_PX * cfg[DL_ESCALA]) + PX);
}
function atualizarRaiz(i: number): void {
  const b = est.donos[i];
  const vis = visivelNoQuadro(b);
  if (vis !== est.visivel[i]) {
    est.visivel[i] = vis;
    dom.setStyleProperty(est.h, est.raizes[i], P_DISPLAY, vis !== 0 ? V_BLOCK : V_NONE);
  }
  if (vis !== 0 && (est.sujo[i] !== 0 || b.host.px !== est.ultPx[i] || b.host.py !== est.ultPy[i])) aplicarLayout(i, b);
}
function aplicarRegiao(a: Float64Array): void {
  const r = est.area;
  if (a[0] === r[0] && a[1] === r[1] && a[2] === r[2] && a[3] === r[3]) return;
  r[0] = a[0]; r[1] = a[1]; r[2] = a[2]; r[3] = a[3];
  dom.setStyleProperty(est.h, est.regiao, P_LEFT, a[0] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_TOP, a[1] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_WIDTH, a[2] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_HEIGHT, a[3] + PX);
}
/// UM render por quadro para todos os canvases. `area` = [x, y, w, h] do jogo
/// na janela (do chamador). Sem canvas registrado: retorna sem render.
export function domHostRender(win: i64, area: Float64Array): void {
  if (est.ativos === 0) return;
  aplicarRegiao(area);
  const n = est.raizes.length;
  let i = 0;
  while (i < n) {
    if (est.raizes[i] !== DOM_NENHUM) atualizarRaiz(i);
    i = i + 1;
  }
  est.renders = est.renders + 1;
  render(win, est.h);
}
/// Depois do endFrame: os cliques vistos pelo hit-test viram callbacks (1 quadro de latência).
export function domHostPump(): void {
  const d = est.doc;
  if (d === null) return;
  pumpEventCallbacks(d);
}
function cliqueNaRaiz(slot: number, alvo: number): void {
  const b = est.donos[slot];
  const o = b.owner;
  if (o === null || b.enabled === 0) return;
  const h = est.h; const raiz = est.raizes[slot];
  let acao = "";
  const comAcao = dom.closest(h, alvo, SELETOR_ACAO);
  if (comAcao !== DOM_NENHUM && comAcao !== raiz && dom.contains(h, raiz, comAcao) !== 0) acao = dom.getAttribute(h, comAcao, ATRIBUTO_ACAO);
  else {
    const comId = dom.closest(h, alvo, SELETOR_ID);
    if (comId !== DOM_NENHUM && comId !== raiz && dom.contains(h, raiz, comId) !== 0) acao = dom.getAttribute(h, comId, ATRIBUTO_ID);
  }
  if (acao.length > 0) dispatchUIClick(o, acao);
}
/// O ponteiro está sobre um elemento de algum canvas visível com bloqueiaCliques?
/// Olha os DESCENDENTES da raiz (a raiz cobre a área inteira). :hover é do quadro anterior.
export function domHostSobreUI(): boolean {
  if (est.ativos === 0) return false;
  const n = est.raizes.length;
  let i = 0;
  while (i < n) {
    if (est.raizes[i] !== DOM_NENHUM && est.visivel[i] === 1 && est.layout[i][DL_BLOQUEIA] !== 0.0 &&
        dom.queryWithin(est.h, est.raizes[i], est.seletorSobre) !== DOM_NENHUM) return true;
    i = i + 1;
  }
  return false;
}
/// Só para testes sem janela (o :hover real exige mouse). "" volta ao padrão.
export function domHostSeletorSobre(sel: string): void { est.seletorSobre = sel.length > 0 ? sel : SELETOR_SOBRE_PADRAO; }
/// Prévia do editor fora do Play: a região não recebe clique (os painéis continuam clicáveis).
export function domHostPrevia(on: boolean): void {
  const v = on ? 1 : 0;
  if (est.h === 0 || v === est.previa) return;
  est.previa = v;
  dom.setStyleProperty(est.h, est.regiao, P_PONTEIRO, on ? V_NONE : AUTO);
}
function contornar(o: GameObject | null, valor: string): void {
  if (o === null) return;
  let i = 0;
  while (i < est.raizes.length) {
    if (est.raizes[i] !== DOM_NENHUM && est.donos[i].owner === o) dom.setStyleProperty(est.h, est.raizes[i], P_CONTORNO, valor);
    i = i + 1;
  }
}
/// Contorno nas raízes do objeto selecionado (o retângulo da região na prévia).
export function domHostDestacar(o: GameObject | null, contorno: string): void {
  if (est.h === 0 || (o === est.destaque && contorno === est.contorno)) return;
  contornar(est.destaque, V_NONE);
  est.destaque = o; est.contorno = contorno;
  contornar(o, contorno);
}

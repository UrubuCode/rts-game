// Engine RTS — CSS e HTML de um DomCanvas preparados para o documento único da
// janela: o CSS de cada canvas ganha o prefixo [data-go="<serial>"] (um canvas
// não pinta o outro) e o HTML perde <script>, cabeçalho e o que não é corpo.
// Funções puras, sem janela e sem a fachada do DOM: rodam na carga, nunca por quadro.

export const DOM_ATRIBUTO_ESCOPO: string = "data-go";
/// Seletores que designam o documento inteiro: viram a raiz do canvas.
const RAIZES_CSS: string[] = [":root", "html", "body"];
/// At-rules com regras dentro que precisam do prefixo; as demais passam intactas.
/// `@layer a, b;` (sem bloco) passa intacto pelo ramo do `;`.
/// Os nomes de `@keyframes` (e de `@font-face`) não ganham escopo: são globais no
/// documento único, então dois canvases com o mesmo nome de animação colidem.
const AT_PREFIXADAS: string[] = ["media", "supports", "layer"];
const C_ESPACO: number = 32; const C_TAB: number = 9; const C_NL: number = 10; const C_CR: number = 13;
const C_MAIOR: number = 62; const C_ARROBA: number = 64; const C_VIRGULA: number = 44;
const C_ABRE_CHAVE: number = 123; const C_FECHA_CHAVE: number = 125;
const C_ABRE_PAR: number = 40; const C_FECHA_PAR: number = 41; const C_ABRE_COL: number = 91; const C_FECHA_COL: number = 93;
const C_HIFEN: number = 45; const C_SUB: number = 95;

export function seletorEscopo(serial: number): string { return "[" + DOM_ATRIBUTO_ESCOPO + "=\"" + serial + "\"]"; }

function ehEspaco(c: number): boolean { return c === C_ESPACO || c === C_TAB || c === C_NL || c === C_CR; }
function ehNome(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === C_HIFEN || c === C_SUB;
}
function semComentarios(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const a = css.indexOf("/*", i);
    if (a < 0) { out = out + css.substring(i); break; }
    out = out + css.substring(i, a);
    const b = css.indexOf("*/", a + 2);
    if (b < 0) break;
    i = b + 2;
  }
  return out;
}
/// Índice do `}` que fecha o `{` em `abre` (blocos aninhados contam), ou o fim.
function fechaBloco(css: string, abre: number): number {
  let prof = 0;
  let i = abre;
  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (c === C_ABRE_CHAVE) prof = prof + 1;
    else if (c === C_FECHA_CHAVE) { prof = prof - 1; if (prof === 0) return i; }
    i = i + 1;
  }
  return css.length;
}
function tamanhoRaiz(s: string): number {
  let k = 0;
  while (k < RAIZES_CSS.length) {
    const r = RAIZES_CSS[k];
    if (s.indexOf(r) === 0 && (s.length === r.length || !ehNome(s.charCodeAt(r.length)))) return r.length;
    k = k + 1;
  }
  return 0;
}
export function prefixarSeletor(sel: string, escopo: string): string {
  let s = sel.trim();
  let n = tamanhoRaiz(s);
  if (n === 0) return escopo + " " + s;
  // `>` depois da última raiz: `body > .x` = filho direto da raiz do canvas
  let filho = false;
  while (n > 0) {
    s = s.substring(n);
    // composto colado à raiz (body.escuro, html:hover) continua colado ao escopo
    if (s.length > 0 && !ehEspaco(s.charCodeAt(0)) && s.charCodeAt(0) !== C_MAIOR) return escopo + s;
    s = s.trim();
    filho = s.length > 0 && s.charCodeAt(0) === C_MAIOR;
    if (filho) s = s.substring(1).trim();
    n = tamanhoRaiz(s);
  }
  if (s.length === 0) return escopo;
  return filho ? escopo + " > " + s : escopo + " " + s;
}
function prefixarLista(lista: string, escopo: string): string {
  let out = "";
  let prof = 0;
  let ini = 0;
  let i = 0;
  while (i <= lista.length) {
    const c = i < lista.length ? lista.charCodeAt(i) : C_VIRGULA;
    if (c === C_ABRE_PAR || c === C_ABRE_COL) prof = prof + 1;
    else if (c === C_FECHA_PAR || c === C_FECHA_COL) prof = prof - 1;
    else if (c === C_VIRGULA && prof === 0) {
      const sel = lista.substring(ini, i).trim();
      if (sel.length > 0) out = out.length === 0 ? prefixarSeletor(sel, escopo) : out + ", " + prefixarSeletor(sel, escopo);
      ini = i + 1;
    }
    i = i + 1;
  }
  return out;
}
function junta(out: string, regra: string): string { return out.length === 0 ? regra : out + "\n" + regra; }
function nomeAt(cabeca: string): string {
  let j = 1;
  while (j < cabeca.length && ehNome(cabeca.charCodeAt(j))) j = j + 1;
  return cabeca.substring(1, j).toLowerCase();
}
function prefixarRegras(src: string, escopo: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && ehEspaco(src.charCodeAt(i))) i = i + 1;
    if (i >= n) break;
    const abre = src.indexOf("{", i);
    if (src.charCodeAt(i) === C_ARROBA) {
      const pv = src.indexOf(";", i);
      if (pv >= 0 && (abre < 0 || pv < abre)) { out = junta(out, src.substring(i, pv + 1).trim()); i = pv + 1; continue; }
      if (abre < 0) break;
      const fim = fechaBloco(src, abre);
      const cabeca = src.substring(i, abre).trim();
      const dentro = src.substring(abre + 1, fim);
      if (AT_PREFIXADAS.indexOf(nomeAt(cabeca)) >= 0) out = junta(out, cabeca + "{" + prefixarRegras(dentro, escopo) + "}");
      else out = junta(out, cabeca + "{" + dentro + "}");
      i = fim + 1;
      continue;
    }
    if (abre < 0) break;
    const fecha = fechaBloco(src, abre);
    out = junta(out, prefixarLista(src.substring(i, abre), escopo) + "{" + src.substring(abre + 1, fecha) + "}");
    i = fecha + 1;
  }
  return out;
}
/// CSS com cada seletor de topo limitado à raiz `escopo`; `:root`/`html`/`body`
/// viram a raiz; `@media`/`@supports` prefixados por dentro; demais at-rules intactas.
export function prefixarCss(css: string, escopo: string): string { return prefixarRegras(semComentarios(css), escopo); }

/// Estado de uma separação (classe sem métodos, instância de módulo).
export class PartesHtml {
  estilos: string; corpo: string; scripts: number;
  constructor() { this.estilos = ""; this.corpo = ""; this.scripts = 0; }
}
/// Tira os blocos <tag ...>...</tag>; guarda o miolo em `p.estilos` (style) ou conta (script).
function tirarBlocos(src: string, tag: string, p: PartesHtml, guardar: boolean): string {
  const low = src.toLowerCase();
  const abre = "<" + tag;
  const fecha = "</" + tag + ">";
  let out = "";
  let i = 0;
  while (i < src.length) {
    const a = low.indexOf(abre, i);
    if (a < 0) { out = out + src.substring(i); break; }
    const fimAbre = low.indexOf(">", a);
    const b = fimAbre < 0 ? 0 - 1 : low.indexOf(fecha, fimAbre);
    out = out + src.substring(i, a);
    if (b < 0) break;
    const miolo = src.substring(fimAbre + 1, b);
    if (guardar) p.estilos = p.estilos.length === 0 ? miolo : p.estilos + "\n" + miolo;
    else p.scripts = p.scripts + 1;
    i = b + fecha.length;
  }
  return out;
}
function tirarMarca(src: string, marca: string): string {
  const a = src.toLowerCase().indexOf(marca);
  if (a < 0) return src;
  const b = src.indexOf(">", a);
  return b < 0 ? src.substring(0, a) : src.substring(0, a) + src.substring(b + 1);
}
function tirarCabeca(src: string): string {
  const low = src.toLowerCase();
  const a = low.indexOf("<head");
  if (a < 0) return src;
  const b = low.indexOf("</head>", a);
  return b < 0 ? src.substring(0, a) : src.substring(0, a) + src.substring(b + 7);
}
export function separarHtml(html: string, p: PartesHtml): void {
  p.estilos = ""; p.corpo = ""; p.scripts = 0;
  let s = tirarBlocos(html, "style", p, true);
  s = tirarBlocos(s, "script", p, false);
  const low = s.toLowerCase();
  const ib = low.indexOf("<body");
  if (ib >= 0) {
    const ab = low.indexOf(">", ib);
    const fb = low.indexOf("</body>", ab);
    s = s.substring(ab + 1, fb >= 0 ? fb : s.length);
  } else {
    s = tirarCabeca(tirarMarca(tirarMarca(tirarMarca(s, "<!doctype"), "<html"), "</html"));
  }
  p.corpo = s.trim();
}
const partes = new PartesHtml();
/// Conteúdo final da raiz: um <style> com os estilos do arquivo + `css`, prefixados, e o corpo.
export function prepararHtml(html: string, css: string, escopo: string): string {
  separarHtml(html, partes);
  let todos = partes.estilos;
  if (css.length > 0) todos = todos.length > 0 ? todos + "\n" + css : css;
  const prefixado = todos.length > 0 ? prefixarCss(todos, escopo) : "";
  return prefixado.length > 0 ? "<style>" + prefixado + "</style>" + partes.corpo : partes.corpo;
}
/// Quantos <script> a última `prepararHtml` removeu (o DomCanvas avisa no Console).
export function scriptsRemovidos(): number { return partes.scripts; }

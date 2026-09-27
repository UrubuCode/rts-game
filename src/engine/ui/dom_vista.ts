// Engine RTS — DomVista: o que um script vê do HTML do seu DomCanvas. Tudo
// limitado à raiz do canvas, com cache do último valor escrito por nó: no rts
// cada mutação refaz o layout do documento inteiro (spike: +0,3 a 0,45 ms por
// quadro com UMA troca de texto), então escrever o mesmo valor não toca o DOM.
//
// Nós são ids da vista, não o NodeId do rts: `querySelector` devolve um id
// válido até a próxima recarga do HTML; depois dela ids antigos viram no-op (a
// geração muda) e o script refaz as consultas em `onDomReload`. Usa só o
// namespace cru `dom` do rts, no máximo 4 parâmetros por método e nenhuma
// string montada quando o valor não muda.
//
// O cache supõe que só a vista escreve nesses nós: `setAttr` recusa "class" e
// "style" (use `setClass`/`setStyle`), senão o cache ficaria velho e uma
// escrita posterior com o valor "igual" seria pulada.
import { logWarn } from "@engine/core/logger";

export type DomEventoFn = (no: number) => void;
export const DOM_VISTA_NENHUM: number = 0 - 1;
/// Nós guardáveis por geração (id = geracao * isto + índice).
export const DOM_VISTA_MAX_NOS: number = 4096;
/// Inteiros escalados 0..DOM_NUM_CACHE-1 viram texto uma vez só (tabela preguiçosa
/// por número de casas): placares 0..9999, cronômetros 0..999.9 com 1 casa.
export const DOM_NUM_CACHE: number = 10000;
export const DOM_CASAS_MAX: number = 3;
const SEM_NUMERO: number = 0 - 9007199254740991;
const DESCONHECIDO: string = "\u0001";
const POTENCIAS: number[] = [1, 10, 100, 1000];
const TIPO_ESTILO: number = 0;
const TIPO_CLASSE: number = 1;
const TIPO_ATRIBUTO: number = 2;
const LIGADA: string = "1";
const DESLIGADA: string = "0";
const ATRIBUTO_CLASSE: string = "class";
const ATRIBUTO_ESTILO: string = "style";
const SEM_ENTRADA: number = 0 - 1;

/// Linhas vazias até o primeiro uso de cada número de casas (preenchidas com "").
function criarTabelaNumeros(): string[][] {
  const t: string[][] = [];
  let c = 0;
  while (c <= DOM_CASAS_MAX) { t.push([]); c = c + 1; }
  return t;
}
const NUMEROS: string[][] = criarTabelaNumeros();
function preencher(linha: string[]): void {
  while (linha.length < DOM_NUM_CACHE) linha.push("");
}
/// Gerações vêm de um contador do módulo, não da vista: assim o id de uma vista
/// nunca é válido em outra (duas vistas recém-carregadas teriam a mesma geração).
class GeracoesVista { ultima: number; constructor() { this.ultima = 0; } }
const geracoes = new GeracoesVista();

/// Texto de k / 10^casas com exatamente `casas` casas (k inteiro).
export function textoNumero(k: number, casas: number): string {
  if (casas <= 0) return "" + k;
  const neg = k < 0;
  const a = neg ? 0 - k : k;
  const p = POTENCIAS[casas];
  const inteiro = Math.floor(a / p);
  let frac = "" + (a - inteiro * p);
  while (frac.length < casas) frac = "0" + frac;
  return (neg ? "-" : "") + inteiro + "." + frac;
}
/// `k` finito e inteiro (os setters trocam NaN/±Infinity por 0).
function numeroEmCache(k: number, casas: number): string {
  if (!(k >= 0 && k < DOM_NUM_CACHE)) return textoNumero(k, casas);
  const linha = NUMEROS[casas];
  if (linha.length === 0) preencher(linha);
  let s = linha[k];
  if (s.length === 0) { s = textoNumero(k, casas); linha[k] = s; }
  return s;
}
/// Unidades de estilo com tabela própria ("%", "px"...): barras que mudam todo
/// quadro não montam "57%" de novo. Além deste número, monta a string.
const DOM_UNIDADES_MAX: number = 8;
const UNIDADES: string[] = [];
const COM_UNIDADE: string[][] = [];
function linhaVazia(): string[] {
  const l: string[] = [];
  preencher(l);
  return l;
}
function numeroComUnidade(k: number, unidade: string): string {
  if (!(k >= 0 && k < DOM_NUM_CACHE)) return textoNumero(k, 0) + unidade;
  let u = 0;
  while (u < UNIDADES.length && UNIDADES[u] !== unidade) u = u + 1;
  if (u === UNIDADES.length) {
    if (u >= DOM_UNIDADES_MAX) return numeroEmCache(k, 0) + unidade;
    UNIDADES.push(unidade); COM_UNIDADE.push(linhaVazia());
  }
  const linha = COM_UNIDADE[u];
  let s = linha[k];
  if (s.length === 0) { s = numeroEmCache(k, 0) + unidade; linha[k] = s; }
  return s;
}
/// NaN e ±Infinity (ex.: hp/0) viram 0: o quadro não pode quebrar por um número.
function finito(k: number): number { return k - k === 0 ? k : 0; }
/// Lista de classes com `classe` ligada ou desligada (sem repetir).
export function alternarClasse(lista: string, classe: string, ligada: boolean): string {
  const partes = lista.split(" ");
  let out = "";
  let i = 0;
  while (i < partes.length) {
    const p = partes[i];
    if (p.length > 0 && p !== classe) out = out.length === 0 ? p : out + " " + p;
    i = i + 1;
  }
  if (ligada) out = out.length === 0 ? classe : out + " " + classe;
  return out;
}

export class DomVista {
  h: number; raizNo: number; geracao: number; base: number;
  nos: number[]; textos: string[]; numK: number[]; numCasas: number[];
  /// Cache de estilo/classe/atributo: lista encadeada por nó (primeira entrada do
  /// nó em `cPrimeira`, próxima em `cProx`), sem varrer as entradas dos outros nós.
  cPrimeira: number[]; cProx: number[]; cTipo: number[]; cNome: string[]; cValor: string[]; cNum: number[];
  avisouAtributo: boolean;
  /// Mutações feitas no DOM (testes e diagnóstico: "mesmo valor não escreve").
  escritas: number;
  constructor() {
    this.h = 0; this.raizNo = DOM_VISTA_NENHUM; this.geracao = 0; this.base = 0;
    this.nos = []; this.textos = []; this.numK = []; this.numCasas = [];
    this.cPrimeira = []; this.cProx = []; this.cTipo = []; this.cNome = []; this.cValor = []; this.cNum = [];
    this.avisouAtributo = false;
    this.escritas = 0;
  }
  ligar(h: number, raizNo: number): void { this.h = h; this.raizNo = raizNo; this.recomecar(); }
  soltar(): void { this.h = 0; this.raizNo = DOM_VISTA_NENHUM; this.recomecar(); }
  /// Nova geração (única entre todas as vistas): ids antigos viram no-op; a raiz é o primeiro id.
  recomecar(): void {
    geracoes.ultima = geracoes.ultima + 1;
    this.geracao = geracoes.ultima;
    this.base = this.geracao * DOM_VISTA_MAX_NOS;
    this.nos.length = 0; this.textos.length = 0; this.numK.length = 0; this.numCasas.length = 0;
    this.cPrimeira.length = 0; this.cProx.length = 0; this.cTipo.length = 0; this.cNome.length = 0; this.cValor.length = 0; this.cNum.length = 0;
    if (this.h !== 0) this.guardar(this.raizNo);
  }
  private guardar(n: number): number {
    this.nos.push(n); this.textos.push(DESCONHECIDO); this.numK.push(SEM_NUMERO); this.numCasas.push(0);
    this.cPrimeira.push(SEM_ENTRADA);
    return this.base + this.nos.length - 1;
  }
  private indice(no: number): number {
    const i = no - this.base;
    return i >= 0 && i < this.nos.length ? i : DOM_VISTA_NENHUM;
  }
  private entrada(i: number, tipo: number, nome: string): number {
    let k = this.cPrimeira[i];
    while (k !== SEM_ENTRADA) {
      if (this.cTipo[k] === tipo && this.cNome[k] === nome) return k;
      k = this.cProx[k];
    }
    this.cProx.push(this.cPrimeira[i]); this.cTipo.push(tipo); this.cNome.push(nome); this.cValor.push(DESCONHECIDO); this.cNum.push(SEM_NUMERO);
    const nova = this.cTipo.length - 1;
    this.cPrimeira[i] = nova;
    return nova;
  }
  raiz(): number { return this.nos.length > 0 ? this.base : DOM_VISTA_NENHUM; }
  valido(no: number): boolean { return this.indice(no) >= 0; }
  doc(): number { return this.h; }
  noDom(no: number): number { const i = this.indice(no); return i >= 0 ? this.nos[i] : DOM_VISTA_NENHUM; }
  contar(sel: string): number { return this.h === 0 ? 0 : dom.queryAllWithinCount(this.h, this.raizNo, sel); }
  /// Primeiro nó dentro da raiz que casa com `sel` (-1 se nenhum). Guarde no mount/onDomReload.
  querySelector(sel: string): number {
    if (this.h === 0) return DOM_VISTA_NENHUM;
    const n = dom.queryWithin(this.h, this.raizNo, sel);
    if (n === DOM_VISTA_NENHUM) return DOM_VISTA_NENHUM;
    let i = 0;
    while (i < this.nos.length) { if (this.nos[i] === n) return this.base + i; i = i + 1; }
    if (this.nos.length >= DOM_VISTA_MAX_NOS) return DOM_VISTA_NENHUM;
    return this.guardar(n);
  }
  getText(no: number): string { const i = this.indice(no); return i >= 0 ? dom.getText(this.h, this.nos[i]) : ""; }
  setText(no: number, s: string): void {
    const i = this.indice(no);
    if (i < 0 || this.textos[i] === s) return;
    this.textos[i] = s; this.numK[i] = SEM_NUMERO;
    dom.setText(this.h, this.nos[i], s);
    this.escritas = this.escritas + 1;
  }
  /// `v` com `casas` casas (0..DOM_CASAS_MAX); só escreve quando o valor
  /// arredondado muda. Sem alocação quando `v * 10^casas` arredondado cai em
  /// 0..DOM_NUM_CACHE-1 (placar 0..9999; 0..999.9 com 1 casa); fora disso monta a
  /// string a cada mudança. NaN/±Infinity escrevem 0.
  setNumero(no: number, v: number, casas: number): void {
    const i = this.indice(no);
    if (i < 0) return;
    const c = casas >= 0 ? (casas > DOM_CASAS_MAX ? DOM_CASAS_MAX : casas | 0) : 0;
    const k = finito(Math.round(v * POTENCIAS[c]));
    if (this.numK[i] === k && this.numCasas[i] === c) return;
    const s = numeroEmCache(k, c);
    this.numK[i] = k; this.numCasas[i] = c; this.textos[i] = s;
    dom.setText(this.h, this.nos[i], s);
    this.escritas = this.escritas + 1;
  }
  setStyle(no: number, prop: string, valor: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    const e = this.entrada(i, TIPO_ESTILO, prop);
    if (this.cNum[e] === SEM_NUMERO && this.cValor[e] === valor) return;
    this.cNum[e] = SEM_NUMERO; this.cValor[e] = valor;
    dom.setStyleProperty(this.h, this.nos[i], prop, valor);
    this.escritas = this.escritas + 1;
  }
  /// Estilo numérico inteiro + unidade (barras: "57%"); só escreve quando muda.
  /// Sem alocação para inteiros 0..DOM_NUM_CACHE-1 nas primeiras DOM_UNIDADES_MAX
  /// unidades usadas; fora disso monta a string a cada mudança. NaN/±Infinity → 0.
  setStyleNumero(no: number, prop: string, v: number, unidade: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    const k = finito(Math.round(v));
    const e = this.entrada(i, TIPO_ESTILO, prop);
    if (this.cNum[e] === k && this.cValor[e] === unidade) return;
    this.cNum[e] = k; this.cValor[e] = unidade;
    dom.setStyleProperty(this.h, this.nos[i], prop, numeroComUnidade(k, unidade));
    this.escritas = this.escritas + 1;
  }
  /// Só mexe no atributo quando o estado muda; ao mudar, remonta a lista de
  /// classes (aloca): alternar classe todo quadro custa uma string por troca.
  setClass(no: number, classe: string, ligada: boolean): void {
    const i = this.indice(no);
    if (i < 0) return;
    const e = this.entrada(i, TIPO_CLASSE, classe);
    const v = ligada ? LIGADA : DESLIGADA;
    if (this.cValor[e] === v) return;
    this.cValor[e] = v;
    const atual = dom.getAttribute(this.h, this.nos[i], ATRIBUTO_CLASSE);
    dom.setAttr(this.h, this.nos[i], ATRIBUTO_CLASSE, alternarClasse(atual, classe, ligada));
    this.escritas = this.escritas + 1;
  }
  /// Recusa "class" e "style" (cache velho de setClass/setStyle): avisa uma vez.
  setAttr(no: number, nome: string, valor: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    if (nome === ATRIBUTO_CLASSE || nome === ATRIBUTO_ESTILO) {
      if (!this.avisouAtributo) { this.avisouAtributo = true; logWarn("DomVista.setAttr: use setClass/setStyle para class/style"); }
      return;
    }
    const e = this.entrada(i, TIPO_ATRIBUTO, nome);
    if (this.cValor[e] === valor) return;
    this.cValor[e] = valor;
    dom.setAttr(this.h, this.nos[i], nome, valor);
    this.escritas = this.escritas + 1;
  }
  /// `fn(no)` roda no domHostPump depois do endFrame (1 quadro depois do clique).
  on(no: number, evento: string, fn: DomEventoFn): void {
    const i = this.indice(no);
    if (i < 0) return;
    dom.addListenerCbOptions(this.h, this.nos[i], evento, (e: any): void => { fn(no); });
  }
}

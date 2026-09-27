// Engine RTS — DomCanvas: interface em HTML/CSS desenhada sobre o jogo, como
// componente de um GameObject (o UIDocument da Unity). Desenho e eventos são
// do DomHost (um documento por janela); aqui ficam os campos salvos com a
// cena, a carga do .html/.css e a DomVista que os scripts usam:
//
//   const c = domCanvasDe(this.owner);
//   this.vida = c.documento.querySelector("#vida");   // no mount/onDomReload
//   c.documento.setNumero(this.vida, hp, 0);           // por quadro: só escreve se mudou
//
// Posição: host.px/py a partir do canto `ancoragem` (como o UIText); largura
// ou altura 0 estica até a borda da área. Ativo = active do objeto (com os
// pais) e enabled do componente; escondido = display none, sem apagar nós.
// Remover o objeto ou o componente (onDestroy) libera a raiz.
import { Behavior, KIND_UI } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { ANCHOR_TL, ANCHOR_BR } from "@engine/ui/anchor";
import { domHostRegistrar, domHostRemover, domHostConteudo, domHostLayout, domHostRaiz, domHostDoc, domHostEscopo,
         DOM_LAYOUT_FLOATS, DL_ANCORAGEM, DL_LARGURA, DL_ALTURA, DL_ORDEM, DL_ESCALA, DL_BLOQUEIA } from "@engine/ui/dom_host";
import { DomVista } from "@engine/ui/dom_vista";
import { prepararHtml, scriptsRemovidos } from "@engine/ui/dom_css";
import { logError, logWarn } from "@engine/core/logger";
import fs from "@compat/fs.ts";

/// Escala mínima aceita (fase 1: vira font-size da raiz).
export const DOM_ESCALA_MIN: number = 0.1;
const SEM_SLOT: number = 0 - 1;

class LeituraDom {
  texto: string; erro: string;
  constructor() { this.texto = ""; this.erro = ""; }
}
const leitura = new LeituraDom();
/// Lê um arquivo do canvas. Fora de qualquer caminho por quadro (tem try).
/// O runtime nem sempre lança em arquivo ausente (devolve undefined): confere
/// `exists` antes e o tipo do resultado depois.
function lerArquivoDom(caminho: string): boolean {
  leitura.texto = ""; leitura.erro = "";
  if (!fs.exists(caminho)) { leitura.erro = caminho + ": arquivo não encontrado"; return false; }
  try {
    const t: any = fs.read_text(caminho);
    if (typeof t !== "string") { leitura.erro = caminho + ": leitura falhou"; return false; }
    leitura.texto = t;
    return true;
  } catch (e) { leitura.erro = caminho + ": " + String(e); return false; }
}

/**
 * Interface em HTML/CSS sobre o jogo. Cuidados herdados do DomHost:
 * - `slot` guarda o HANDLE devolvido por `domHostRegistrar` (slot + geração);
 *   depois de `domHostRemover` o campo volta a SEM_SLOT (handle velho é no-op).
 * - Trocar o conteúdo (recarga, `definirConteudo`) recicla os nós antigos da
 *   raiz: ids da `DomVista` de antes da troca viram no-op; refaça as consultas
 *   em `onDomReload`.
 * - O CSS é escopado à raiz, mas nomes de `@keyframes` são globais ao documento
 *   único: dois canvases com o mesmo nome de animação se sobrescrevem.
 * - Com `bloqueiaCliques`, um descendente de bloco sem largura (um <div> ou <p>
 *   solto) ocupa a largura inteira da raiz e bloqueia o clique no mundo na
 *   faixa toda: dê largura (ou `display:inline-block`) aos elementos do HUD.
 * - Trocar um texto/número a cada quadro custa hoje ~1 ms de relayout NATIVO do
 *   documento inteiro por mutação (o DomHost do rts ainda não tem layout
 *   incremental — item de fase 2, `renderIn`). `setText`/`setNumero` já pulam a
 *   escrita quando o valor não mudou; prefira atualizar só quando o valor muda
 *   de fato, ou a uma taxa menor que por quadro (ex.: a cada N quadros).
 * @componentCategory UI
 * @componentDescription Interface em HTML/CSS desenhada sobre o jogo; scripts do objeto acessam `documento`.
 * @componentKeywords ui html css hud menu dom documento
 */
export class DomCanvas extends Behavior {
  html: string;
  css: string;
  escala: number;
  ancoragem: number;
  largura: number;
  altura: number;
  ordem: number;
  bloqueiaCliques: boolean;
  private slot: number;
  private destruido: boolean;
  private ultimoErro: string;
  private cfg: Float64Array;
  private vista: DomVista;
  constructor() {
    super();
    this.html = ""; this.css = ""; this.escala = 1.0; this.ancoragem = ANCHOR_TL;
    this.largura = 0; this.altura = 0; this.ordem = 0; this.bloqueiaCliques = true;
    this.slot = SEM_SLOT; this.destruido = false; this.ultimoErro = "";
    this.cfg = new Float64Array(DOM_LAYOUT_FLOATS); this.vista = new DomVista();
  }
  kind(): number { return KIND_UI; }
  mount(): void { this.garantir(); }
  onDestroy(): void {
    this.destruido = true;
    if (this.slot === SEM_SLOT) return;
    domHostRemover(this.slot);
    this.slot = SEM_SLOT;
    this.vista.soltar();
  }
  onValidate(campo: string): void {
    if (!(this.escala >= DOM_ESCALA_MIN)) this.escala = DOM_ESCALA_MIN;
    if (!(this.largura >= 0)) this.largura = 0;
    if (!(this.altura >= 0)) this.altura = 0;
    if (!(this.ancoragem >= ANCHOR_TL)) this.ancoragem = ANCHOR_TL;
    this.ancoragem = Math.min(ANCHOR_BR, Math.round(this.ancoragem));
    if (this.ordem !== this.ordem) this.ordem = 0; // NaN
    this.ordem = Math.round(this.ordem);
    if (campo === "html" || campo === "css") this.recarregar();
    else this.enviarLayout();
  }
  /// O HTML deste canvas, escopado à raiz. Carrega sob demanda (script montado
  /// antes do canvas) — inclusive quando `owner` ainda não entrou numa cena.
  /// Chamar `documento` num `DomCanvas` solto (criado com `new`, nunca
  /// adicionado a uma `Scene`) registra a raiz mesmo assim; sem `onDestroy`
  /// (que só roda ao remover da cena) essa raiz nunca é liberada. Só leia
  /// `documento` de um componente que já está (ou vai estar) numa cena.
  get documento(): DomVista { this.garantir(); return this.vista; }
  /// Relê .html/.css. Erro: mantém o conteúdo anterior, anota e loga. Sucesso: onDomReload nos irmãos.
  recarregar(): boolean {
    if (this.slot === SEM_SLOT) { this.garantir(); return this.slot !== SEM_SLOT && this.ultimoErro.length === 0; }
    const ok = this.carregar();
    if (ok) this.avisarIrmaos();
    return ok;
  }
  /// Troca o conteúdo por HTML literal (comando WS; estado de execução, não salvo).
  definirConteudo(html: string): void {
    this.garantir();
    if (this.slot === SEM_SLOT) return;
    this.aplicar(html, "", "definirConteudo");
    this.avisarIrmaos();
  }
  erro(): string { return this.ultimoErro; }
  montado(): boolean { return this.slot !== SEM_SLOT; }
  private garantir(): void {
    if (this.slot !== SEM_SLOT || this.destruido) return;
    this.slot = domHostRegistrar(this);
    this.vista.ligar(domHostDoc(), domHostRaiz(this.slot));
    this.enviarLayout();
    this.carregar();
  }
  private enviarLayout(): void {
    const c = this.cfg;
    c[DL_ANCORAGEM] = this.ancoragem; c[DL_LARGURA] = this.largura; c[DL_ALTURA] = this.altura;
    c[DL_ORDEM] = this.ordem; c[DL_ESCALA] = this.escala; c[DL_BLOQUEIA] = this.bloqueiaCliques ? 1.0 : 0.0;
    if (this.slot !== SEM_SLOT) domHostLayout(this.slot, c);
  }
  private carregar(): boolean {
    let html = "";
    let css = "";
    if (this.html.length > 0) { if (!lerArquivoDom(this.html)) return this.falhou(leitura.erro); html = leitura.texto; }
    if (this.css.length > 0) { if (!lerArquivoDom(this.css)) return this.falhou(leitura.erro); css = leitura.texto; }
    this.aplicar(html, css, this.html.length > 0 ? this.html : "(sem arquivo .html)");
    return true;
  }
  private aplicar(html: string, css: string, origem: string): void {
    domHostConteudo(this.slot, prepararHtml(html, css, domHostEscopo(this.slot)));
    this.vista.recomecar();
    this.ultimoErro = "";
    if (scriptsRemovidos() > 0) logWarn("DomCanvas: <script> ignorado em " + origem + " (a lógica fica nos scripts do objeto)");
  }
  private falhou(msg: string): boolean { this.ultimoErro = msg; logError("DomCanvas: " + msg); return false; }
  private avisarIrmaos(): void {
    const o = this.owner;
    if (o === null) return;
    let i = 0;
    while (i < o.behaviors.length) {
      const b = o.behaviors[i];
      if (b !== this && b.enabled !== 0) b.onDomReload();
      i = i + 1;
    }
  }
}

/// O (primeiro) DomCanvas de `o`, ou null.
export function domCanvasDe(o: GameObject | null): DomCanvas | null {
  if (o === null) return null;
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof DomCanvas) return b as DomCanvas;
    i = i + 1;
  }
  return null;
}

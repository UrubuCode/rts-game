/** @editorOnly */
// Pacote ambiente (editor): a janela Janela/Ambiente no Inspector (céu,
// neblina e luz ambiente da cena editada) e os comandos `ambiente` e
// `ambienteinfo`. Tudo pela API pública (@editor/api) e pelo JSON da cena.
import { Editor, registerCommand } from "@editor/api";
import { Behavior } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { Ambiente, MODOS_CEU, MODOS_LUZ_AMBIENTE, ambienteToData, ambienteFromData } from "@engine/core/ambiente";
import fs from "@compat/fs.ts";

const TITULO: string = "Ambiente";
const ROTULO_CEU: string = "Céu";
const ROTULO_TOPO: string = "Topo";
const ROTULO_HORIZONTE: string = "Horizonte";
const ROTULO_CHAO: string = "Chão";
const ROTULO_EXPOSICAO: string = "Exposição";
const ROTULO_ESTRELAS: string = "Estrelas";
const ROTULO_TEXTURA: string = "Textura: ";
const SEM_TEXTURA: string = "(nenhuma)";
const ROTULO_NEBLINA: string = "Neblina";
const ROTULO_COR_NEBLINA: string = "Cor da neblina";
const ROTULO_DENSIDADE: string = "Densidade";
const ROTULO_LUZ: string = "Luz ambiente";
const ROTULO_MODO: string = "Modo";
const ROTULO_COR_AMBIENTE: string = "Cor ambiente";
const ROTULO_INTENSIDADE: string = "Intensidade";
const EXPOSICAO_MAX: number = 4.0;
const ESTRELAS_MAX: number = 2.0;
const DENSIDADE_MAX: number = 0.2;
const INTENSIDADE_MAX: number = 2.0;
const MODO_PANORAMA: string = "panorama";
/// Canal de cor 0..1 ↔ byte 0..255 do campo #RRGGBB.
const BYTE: number = 255.0;

function byteDe(v: number): number { return Math.max(0, Math.min(255, Math.round(v * BYTE))); }
/// Campo de cor #RRGGBB para um rgb 0..1; só escreve de volta quando o usuário muda a cor.
function corCampo(ui: InspectorUI, rotulo: string, v: Float64Array): void {
  const atual = (byteDe(v[0]) << 16) | (byteDe(v[1]) << 8) | byteDe(v[2]);
  const nova = ui.color(rotulo, atual);
  if (nova !== atual) {
    v[0] = ((nova >> 16) & 255) / BYTE; v[1] = ((nova >> 8) & 255) / BYTE; v[2] = (nova & 255) / BYTE;
  }
}

/**
 * Janela do Ambiente da cena editada (não é componente de cena).
 * @componentIgnore
 */
export class AmbienteInspector extends Behavior {
  /// "Textura: <caminho>", refeito só quando o caminho muda.
  private rotuloTextura: string = "";
  private texturaMostrada: string = "";
  constructor() { super(); this.collapsed = 0; this.rotuloTextura = ROTULO_TEXTURA + SEM_TEXTURA; }
  typeName(): string { return TITULO; }
  onInspectorGUI(ui: InspectorUI): void {
    const sc = Editor.scene();
    if (sc === null) return;
    const a: Ambiente = sc.ambiente;
    ui.label(ROTULO_CEU);
    const modo = Math.max(0, MODOS_CEU.indexOf(a.ceu.modo));
    const novoModo = ui.dropdown(ROTULO_CEU, MODOS_CEU, modo);
    if (novoModo !== modo) a.ceu.modo = MODOS_CEU[novoModo];
    corCampo(ui, ROTULO_TOPO, a.ceu.topo);
    corCampo(ui, ROTULO_HORIZONTE, a.ceu.horizonte);
    corCampo(ui, ROTULO_CHAO, a.ceu.chao);
    a.ceu.exposicao = ui.slider(ROTULO_EXPOSICAO, a.ceu.exposicao, 0.0, EXPOSICAO_MAX);
    a.ceu.estrelas = ui.slider(ROTULO_ESTRELAS, a.ceu.estrelas, 0.0, ESTRELAS_MAX);
    if (a.ceu.modo === MODO_PANORAMA) {
      if (a.ceu.textura !== this.texturaMostrada) {
        this.texturaMostrada = a.ceu.textura;
        this.rotuloTextura = ROTULO_TEXTURA + (a.ceu.textura.length > 0 ? a.ceu.textura : SEM_TEXTURA);
      }
      ui.label(this.rotuloTextura);
    }
    ui.label(ROTULO_NEBLINA);
    corCampo(ui, ROTULO_COR_NEBLINA, a.neblina.cor);
    a.neblina.densidade = ui.slider(ROTULO_DENSIDADE, a.neblina.densidade, 0.0, DENSIDADE_MAX);
    ui.label(ROTULO_LUZ);
    const luz = Math.max(0, MODOS_LUZ_AMBIENTE.indexOf(a.luzAmbiente.modo));
    const novaLuz = ui.dropdown(ROTULO_MODO, MODOS_LUZ_AMBIENTE, luz);
    if (novaLuz !== luz) a.luzAmbiente.modo = MODOS_LUZ_AMBIENTE[novaLuz];
    corCampo(ui, ROTULO_COR_AMBIENTE, a.luzAmbiente.cor);
    a.luzAmbiente.intensidade = ui.slider(ROTULO_INTENSIDADE, a.luzAmbiente.intensidade, 0.0, INTENSIDADE_MAX);
  }
}

/// Criada na primeira abertura (nunca no carregamento do módulo).
let instancia: AmbienteInspector | null = null;
function janelaAmbiente(): AmbienteInspector {
  if (instancia === null) instancia = new AmbienteInspector();
  return instancia as AmbienteInspector;
}
export class JanelaAmbiente {
  /** @menuItem Janela/Ambiente */
  static abrir(): void { Editor.inspect(janelaAmbiente(), TITULO); }
}

/// rgb a partir de p[i..i+2]; null se faltar valor (a validação numérica é a do JSON da cena).
function rgbDe(p: string[], i: number): number[] | null {
  if (p.length !== i + 3) return null;
  const v: number[] = [parseFloat(p[i]), parseFloat(p[i + 1]), parseFloat(p[i + 2])];
  return v;
}
/// Valida pelas regras do JSON da cena: troca um campo no estado atual inteiro
/// e deixa `ambienteFromData` aceitar (copia tudo) ou recusar (não muda nada).
function aplicar(a: Ambiente, dados: any): string {
  let out = "";
  try { ambienteFromData(a, dados); }
  catch (e) { out = "[erro] " + (e instanceof Error ? e.message : String(e)); }
  return out;
}
function cmdAmbienteSet(a: Ambiente, p: string[]): string {
  const campo = p.length > 2 ? p[2] : "";
  const dados = ambienteToData(a);
  const v = p.length > 3 ? parseFloat(p[3]) : NaN;
  let out = "";
  if (campo === "ceu.topo" || campo === "ceu.horizonte" || campo === "ceu.chao" || campo === "neblina.cor" || campo === "luz.cor") {
    const c = rgbDe(p, 3);
    if (c === null) out = "[erro] " + campo + ": use r g b";
    else if (campo === "ceu.topo") dados.ceu.topo = c;
    else if (campo === "ceu.horizonte") dados.ceu.horizonte = c;
    else if (campo === "ceu.chao") dados.ceu.chao = c;
    else if (campo === "neblina.cor") dados.neblina.cor = c;
    else dados.luzAmbiente.cor = c;
  } else if (p.length < 4) out = "[erro] " + campo + ": falta o valor";
  else if (campo === "ceu.modo") dados.ceu.modo = p[3];
  else if (campo === "ceu.estrelas") dados.ceu.estrelas = v;
  else if (campo === "ceu.exposicao") dados.ceu.exposicao = v;
  else if (campo === "ceu.tamanhoSol") dados.ceu.tamanhoSol = v;
  else if (campo === "neblina.densidade") dados.neblina.densidade = v;
  else if (campo === "luz.modo") dados.luzAmbiente.modo = p[3];
  else if (campo === "luz.intensidade") dados.luzAmbiente.intensidade = v;
  else if (campo === "sol") dados.sol = p.slice(3).join(" ");
  else out = "[erro] campo: ceu.modo, ceu.topo, ceu.horizonte, ceu.chao, ceu.estrelas, ceu.exposicao, ceu.tamanhoSol, neblina.cor, neblina.densidade, luz.modo, luz.cor, luz.intensidade, sol";
  if (out.length === 0) out = aplicar(a, dados);
  if (out.length === 0) out = "[ok] " + campo;
  return out;
}
function cmdAmbienteCeu(a: Ambiente, p: string[]): string {
  const modo = p.length > 2 ? p[2] : "";
  const textura = p.length > 3 ? p.slice(3).join(" ") : "";
  let out = "";
  if (MODOS_CEU.indexOf(modo) < 0) out = "[erro] ceu: use " + MODOS_CEU.join(", ");
  else if (textura.length > 0 && !fs.exists(textura)) out = "[erro] textura inexistente: " + textura;
  else {
    const dados = ambienteToData(a);
    dados.ceu.modo = modo;
    if (textura.length > 0) dados.ceu.textura = textura;
    out = aplicar(a, dados);
    if (out.length === 0) out = "[ok] ceu " + modo + (textura.length > 0 ? " " + textura : "");
  }
  return out;
}
function cmdAmbiente(p: string[]): string {
  const sc = Editor.scene();
  let out = "[erro] uso: ambiente set <campo> <valores> | ambiente ceu <modo> [textura]";
  if (sc === null) out = "[erro] sem cena";
  else if (p.length > 1 && p[1] === "set") out = cmdAmbienteSet(sc.ambiente, p);
  else if (p.length > 1 && p[1] === "ceu") out = cmdAmbienteCeu(sc.ambiente, p);
  return out;
}
function cmdAmbienteInfo(p: string[]): string {
  const sc = Editor.scene();
  return sc === null ? "[erro] sem cena" : "[ambiente] " + JSON.stringify(ambienteToData(sc.ambiente));
}
registerCommand("ambiente", "ambiente set <campo> <valores> | ambiente ceu <modo> [textura] :: muda o Ambiente da cena com Desfazer (campos ceu.modo, ceu.topo/horizonte/chao r g b, ceu.estrelas, ceu.exposicao, ceu.tamanhoSol, neblina.cor r g b, neblina.densidade, luz.modo, luz.cor r g b, luz.intensidade, sol <nome>; mesma validação do JSON da cena) :: ambiente set neblina.densidade 0.03", true, cmdAmbiente);
registerCommand("ambienteinfo", "ambienteinfo :: o Ambiente da cena em JSON (consulta) :: ambienteinfo", false, cmdAmbienteInfo);

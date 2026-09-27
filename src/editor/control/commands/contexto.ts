// `contexto` — retrato compacto do editor pra uma IA se orientar, gerado SÓ de
// registros do runtime (nenhuma lista à mão): comandos vêm do mesmo manifesto
// do `doc json`, componentes do catálogo gerado + introspecção real de campos
// (fieldCount/fieldLabel/fieldType/fieldOptions da própria instância), menus
// do registro de @menuItem, pacotes da pasta assets/pacotes, sistemas de uma
// sonda ao vivo (com deteccao de recurso — nunca um import que pode nao
// existir nesta branch) e a cena do estado atual da sessão.
//
// `contexto` (texto resumido) | `contexto json` (tudo) | `contexto <secao>`
// (comandos|componentes|menus|pacotes|sistemas|cena), com
// `contexto componentes <Nome>` pros detalhes de UM componente.
import { manifestoComandos } from "@editor/control/commands/doc";
import { COMPONENT_CATALOG } from "@engine/generated/component_catalog";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { tipoCampo, TIPO_ENUM } from "@editor/control/fields";
import { MENU_ITEMS } from "@engine/generated/editor_extensions";
import { scene, S } from "@editor/control/session";
import { sceneDocument } from "@editor/scene_document";
import fs from "@compat/fs.ts";
import { audioReady, audioNulo, audioRate, audioCanais, audioStats } from "@engine/audio/audio";
import { escutaDisponivel, STATS_FLOATS } from "@compat/audio.ts";
import * as rtsEguiSonda from "rts:egui";
import * as rtsInputSonda from "rts:input";
import { coroutineActiveCount, coroutineActiveByOwner } from "@engine/core/coroutine_scheduler";

const NL: string = "\n";
/// Alvo aproximado do texto padrão (CLAUDE.md/spec: ~6-8k chars) — acima disto
/// o texto some detalhes, não corta no meio de uma linha.
const ALVO_CHARS: number = 7000;

// ── comandos ────────────────────────────────────────────────────────────────

/// Uma linha por comando: nome, sintaxe do primeiro uso, ajuda, e entre
/// colchetes o grupo + como funciona o Desfazer + se é assíncrono.
function linhaComando(c: any): string {
  const marcas: string[] = [c.group];
  if (c.undo !== "nenhum") marcas.push("undo:" + c.undo);
  if (c.async) marcas.push("async");
  return c.name + " :: " + c.syntax + " :: " + c.help + " [" + marcas.join(" ") + "]";
}
function textoComandos(m: any): string {
  let out = "[contexto:comandos] " + m.commands.length + " comandos (doc <nome> = todos os usos, doc json = manifesto completo)";
  let i = 0;
  while (i < m.commands.length) { out = out + NL + linhaComando(m.commands[i]); i = i + 1; }
  return out;
}

// ── componentes ─────────────────────────────────────────────────────────────

/// Ficha de campos de UM componente: instancia (createComponent), lê o schema
/// pelas mesmas funções do Inspector/porta de controle (fieldCount, fieldName,
/// fieldLabel, fieldType, fieldHint, fieldOptions) — nunca um valor de exemplo
/// gravado à mão.
function camposDoComponente(nome: string): any[] {
  const b = createComponent(nome);
  const out: any[] = [];
  let fi = 0;
  while (fi < b.fieldCount()) {
    const tipo = tipoCampo(b, fi);
    const campo: any = { name: b.fieldName(fi), label: b.fieldLabel(fi), type: tipo };
    if (tipo === TIPO_ENUM) campo.options = b.fieldOptions(fi);
    out.push(campo);
    fi = fi + 1;
  }
  return out;
}

/// { name, category, description, source, fields } de UM componente do catálogo.
function fichaComponente(entry: any): any {
  const fields = camposDoComponente(entry.name);
  return { name: entry.name, category: entry.category, description: entry.description, source: entry.source, fields };
}

/// Identificador do campo pra exibição: o nome na classe, ou (inspector
/// legado sem `fieldName` próprio — @componentDescription/customInspector) o
/// rótulo, que sempre existe.
function idCampo(f: any): string {
  return f.name.length > 0 ? f.name : f.label;
}
function linhaCampo(f: any): string {
  return idCampo(f) + ":" + f.type + (f.options !== undefined ? "(" + f.options.join("|") + ")" : "");
}
/// Uma linha por componente: nome (categoria) — descrição — nomes dos campos.
function linhaComponente(entry: any): string {
  const nomes: string[] = [];
  let fi = 0;
  while (fi < entry.fields.length) { nomes.push(linhaCampo(entry.fields[fi])); fi = fi + 1; }
  return entry.name + " (" + entry.category + ") :: " + entry.description +
    (nomes.length > 0 ? " :: campos: " + nomes.join(", ") : "");
}
/// Ficha detalhada de UM componente (contexto componentes <Nome>), com rótulo.
function textoDetalheComponente(entry: any): string {
  let out = "[contexto:componentes] " + entry.name + " (" + entry.category + ") — " + entry.description + " [" + entry.source + "]";
  let fi = 0;
  while (fi < entry.fields.length) {
    const f = entry.fields[fi];
    out = out + NL + "  " + f.name + " \"" + f.label + "\" " + f.type + (f.options !== undefined ? " opcoes=" + f.options.join("|") : "");
    fi = fi + 1;
  }
  return out;
}
function catalogoComponentes(): any[] {
  const out: any[] = [];
  let i = 0;
  while (i < COMPONENT_CATALOG.length) { out.push(fichaComponente(COMPONENT_CATALOG[i])); i = i + 1; }
  return out;
}
function textoComponentes(lista: any[]): string {
  let out = "[contexto:componentes] " + lista.length + " componentes (contexto componentes <Nome> = ficha detalhada; complist = só os nomes)";
  let i = 0;
  while (i < lista.length) { out = out + NL + linhaComponente(lista[i]); i = i + 1; }
  return out;
}

// ── menus ───────────────────────────────────────────────────────────────────

function textoMenus(): string {
  let out = "[contexto:menus] " + MENU_ITEMS.length + " itens (menu <caminho> executa; Criar/Cubo etc. tambem por spawn/menu)";
  let i = 0;
  while (i < MENU_ITEMS.length) { out = out + NL + MENU_ITEMS[i]; i = i + 1; }
  return out;
}

// ── pacotes ─────────────────────────────────────────────────────────────────

const PASTA_PACOTES: string = "assets/pacotes";
/// Nomes das pastas de pacote (lidas do disco AGORA, não uma lista fixa) — o
/// mesmo `assets/pacotes/*` que o gerador de componentes varre.
function pacotesDoDisco(): string[] {
  const out: string[] = [];
  if (!fs.exists(PASTA_PACOTES)) return out;
  const lista = fs.readdir(PASTA_PACOTES);
  if (lista === undefined) return out;
  let i = 0;
  while (i < lista.length) {
    const nm = lista[i];
    if (fs.is_dir(PASTA_PACOTES + "/" + nm)) out.push(nm);
    i = i + 1;
  }
  return out;
}
function textoPacotes(pacotes: string[]): string {
  return "[contexto:pacotes] " + pacotes.length + " em " + PASTA_PACOTES + ": " + (pacotes.length > 0 ? pacotes.join(", ") : "(nenhum)");
}

// ── sistemas (sonda ao vivo, com deteccao de recurso) ───────────────────────

/// 1 se o binário nativo atual do rts.exe expõe a função `nome` no namespace
/// `ns` (nunca um import estático de algo que pode não existir nesta branch).
function temFuncao(ns: any, nome: string): boolean {
  return typeof ns[nome] === "function";
}
const ctxStats = new Float64Array(STATS_FLOATS);
/// `faltas` (underruns) do dispositivo nativo desde a abertura — a IA confere
/// chiado por número aqui, sem depender de `audio nivel` nem de escutar
/// (CLAUDE.md, Áudio).
function faltasAudio(pronto: boolean): f64 {
  return pronto && audioStats(ctxStats) !== 0 ? ctxStats[1] : 0.0 - 1.0;
}
function sistemaAudio(): any {
  const pronto = audioReady() !== 0;
  return { pronto: pronto, tipo: pronto ? (audioNulo() !== 0 ? "nulo" : "real") : "mudo",
    taxa: pronto ? audioRate() : 0, canais: pronto ? audioCanais() : 0, escutaDisponivel: escutaDisponivel(),
    faltas: faltasAudio(pronto) };
}
/// Corrotinas vivas AGORA, lidas direto do escalonador (engine/core/
/// coroutine_scheduler.ts) — nunca um número hardcoded.
function sistemaCorrotinas(): any {
  return { ativas: coroutineActiveCount(), donos: coroutineActiveByOwner() };
}
function sistemas(): any {
  return {
    audio: sistemaAudio(),
    particulas: { drawParticlesDisponivel: temFuncao(rtsEguiSonda, "drawParticles") },
    input: { droppedCountDisponivel: temFuncao(rtsInputSonda, "droppedCount") },
    corrotinas: sistemaCorrotinas(),
  };
}
function textoDonosCorrotinas(donos: any[]): string {
  if (donos.length === 0) return "(nenhuma)";
  const partes: string[] = [];
  let i = 0;
  while (i < donos.length) { partes.push(donos[i].name + "x" + donos[i].count); i = i + 1; }
  return partes.join(", ");
}
function textoSistemas(sis: any): string {
  const a = sis.audio;
  return "[contexto:sistemas] audio: " + (a.pronto ? a.tipo + " " + a.taxa + "hz " + a.canais + "ch" : "mudo") +
    " escuta=" + (a.escutaDisponivel ? "sim" : "nao") + " faltas=" + (a.faltas >= 0.0 ? a.faltas : "-") + NL +
    "particulas: drawParticles=" + (sis.particulas.drawParticlesDisponivel ? "sim" : "nao (nao esta nesta branch/binario)") + NL +
    "input: droppedCount=" + (sis.input.droppedCountDisponivel ? "sim" : "nao (nao esta nesta branch/binario)") + NL +
    "corrotinas: " + sis.corrotinas.ativas + " ativas | donos: " + textoDonosCorrotinas(sis.corrotinas.donos);
}

// ── cena ────────────────────────────────────────────────────────────────────

function resumoCena(): any {
  return {
    objetos: scene.objects.length, selecionado: S.selected, multiSelecao: S.selection.length,
    playing: S.playing !== 0, simulating: S.simulating !== 0,
    cenaPath: sceneDocument.path.length > 0 ? sceneDocument.path : "(nova, sem salvar)",
    cenaAlterada: sceneDocument.dirty,
  };
}
function textoCena(c: any): string {
  return "[contexto:cena] " + c.objetos + " objetos | selecionado=#" + c.selecionado +
    (c.multiSelecao > 0 ? " (+" + c.multiSelecao + " na multi-selecao)" : "") +
    " | play=" + (c.playing ? "rodando" : (c.simulating ? "pausado" : "parado")) +
    " | cena=" + c.cenaPath + (c.cenaAlterada ? " (alteracoes nao salvas)" : "");
}

// ── montagem ─────────────────────────────────────────────────────────────────

const SECOES: string[] = ["comandos", "componentes", "menus", "pacotes", "sistemas", "cena"];

/// O manifesto inteiro em JSON (a forma de `contexto json`).
function manifestoContexto(): any {
  return {
    comandos: manifestoComandos(),
    componentes: catalogoComponentes(),
    menus: MENU_ITEMS,
    pacotes: pacotesDoDisco(),
    sistemas: sistemas(),
    cena: resumoCena(),
  };
}

/// Resumo (uma linha por comando/componente) — o padrão sem argumento, com
/// alvo de tamanho (CLAUDE.md/spec: ~6-8k chars); acima disto avisa e sugere
/// as seções focadas em vez de cortar uma linha ao meio.
function textoResumo(): string {
  const m = manifestoContexto();
  const partes: string[] = [
    textoCena(m.cena), textoSistemas(m.sistemas), textoPacotes(m.pacotes),
    textoMenus(), textoComandos(m.comandos), textoComponentes(m.componentes),
  ];
  let out = "[contexto] gerado agora do runtime (comandos/componentes/menus/pacotes/sistemas/cena) — " +
    "'contexto json' pro JSON completo, 'contexto <secao>' pra uma so" + NL + NL + partes.join(NL + NL);
  if (out.length > ALVO_CHARS) {
    out = out + NL + NL + "[contexto] " + out.length + " chars (acima do alvo de " + ALVO_CHARS +
      "): peça uma seção — contexto comandos | componentes | menus | pacotes | sistemas | cena";
  }
  return out;
}

/// `contexto [json | <secao> [detalhe]]`.
export function cmdContexto(parts: string[]): string {
  const arg = parts.length > 1 ? parts[1] : "";
  if (arg === "json") return "[contexto] " + JSON.stringify(manifestoContexto());
  if (arg === "") return textoResumo();
  if (SECOES.indexOf(arg) < 0) return "[erro] contexto: secao desconhecida '" + arg + "' (use: " + SECOES.join(", ") + " ou json)";
  if (arg === "componentes" && parts.length > 2) {
    const nome = parts[2];
    if (COMPONENT_NAMES.indexOf(nome) < 0) return "[erro] contexto: componente nao registrado: " + nome + " (veja complist)";
    let ei = 0;
    while (ei < COMPONENT_CATALOG.length && COMPONENT_CATALOG[ei].name !== nome) ei = ei + 1;
    return textoDetalheComponente(fichaComponente(COMPONENT_CATALOG[ei]));
  }
  if (arg === "comandos") return textoComandos(manifestoComandos());
  if (arg === "componentes") return textoComponentes(catalogoComponentes());
  if (arg === "menus") return textoMenus();
  if (arg === "pacotes") return textoPacotes(pacotesDoDisco());
  if (arg === "sistemas") return textoSistemas(sistemas());
  return textoCena(resumoCena());
}

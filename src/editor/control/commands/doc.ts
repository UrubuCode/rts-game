// `help`, `doc [prefixo]` e `doc json` — a documentação da porta de controle,
// GERADA do manifesto dos embutidos (builtin_commands.ts) e do registro dos
// comandos de pacote (@editor/api registerCommand). Nenhuma lista à mão: um
// comando novo aparece aqui ao entrar no manifesto ou ser registrado.
import { BUILTIN_MANIFEST, GRUPOS_COMANDO, MUTA_SIM, MUTA_PROPRIO } from "@editor/control/builtin_commands";
import { commandCount, commandUsage, commandName, commandMutates } from "@editor/api";

/// Grupo dos comandos registrados por pacote.
export const GRUPO_PACOTE: string = "pacote";
const SEPARADOR_USO: string = " :: ";
const NL: string = "\n";

// prefixo simples (só charCodeAt — robusto no motor)
function startsWith(s: string, p: string): boolean {
  if (p.length > s.length) return false;
  let i = 0;
  while (i < p.length) { if (s.charCodeAt(i) !== p.charCodeAt(i)) return false; i = i + 1; }
  return true;
}

/// Todas as linhas "assinatura :: descrição :: exemplo" (embutidos + pacotes).
function linhasDoc(): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < BUILTIN_MANIFEST.length) {
    const usos = BUILTIN_MANIFEST[i].usos;
    let k = 0;
    while (k < usos.length) { out.push(usos[k]); k = k + 1; }
    i = i + 1;
  }
  let r = 0;
  while (r < commandCount()) { out.push(commandUsage(r)); r = r + 1; }
  return out;
}

/// Um uso em JSON: { syntax, help, example }.
function usoJson(uso: string, nome: string): any {
  const p = uso.split(SEPARADOR_USO);
  return { syntax: p[0], help: p.length > 1 ? p[1] : "", example: p.length > 2 ? p[2] : nome };
}

/// Um comando em JSON; o primeiro uso dá syntax/help/example.
function comandoJson(nome: string, usos: string[]): any {
  const lista: any[] = [];
  let k = 0;
  while (k < usos.length) { lista.push(usoJson(usos[k], nome)); k = k + 1; }
  const primeiro = lista[0];
  return { name: nome, syntax: primeiro.syntax, help: primeiro.help, example: primeiro.example, usages: lista };
}

/// O manifesto de TODOS os comandos (a forma do `doc json`).
export function manifestoComandos(): any {
  const cmds: any[] = [];
  let i = 0;
  while (i < BUILTIN_MANIFEST.length) {
    const info = BUILTIN_MANIFEST[i];
    const c = comandoJson(info.nome, info.usos);
    c.group = info.grupo;
    c.builtin = true;
    c.mutating = info.muta === MUTA_SIM || info.muta === MUTA_PROPRIO;
    c.undo = info.muta === MUTA_SIM ? "dispatch" : (info.muta === MUTA_PROPRIO ? "proprio" : "nenhum");
    c.objectArgs = info.objs;
    cmds.push(c);
    i = i + 1;
  }
  let r = 0;
  while (r < commandCount()) {
    const usos: string[] = [commandUsage(r)];
    const c = comandoJson(commandName(r), usos);
    c.group = GRUPO_PACOTE;
    c.builtin = false;
    c.mutating = commandMutates(r);
    c.undo = commandMutates(r) ? "dispatch" : "nenhum";
    c.objectArgs = [];
    cmds.push(c);
    r = r + 1;
  }
  return {
    protocol: "1 comando por linha; resposta [ok] | [erro] <motivo> | [<etiqueta>] ...; <obj> = indice, #indice, nome exato (aspas se tiver espaco) ou caminho Pai/Filho",
    groups: GRUPOS_COMANDO,
    commands: cmds
  };
}

/// doc [prefixo] | doc json
export function cmdDoc(parts: string[]): string {
  const q = parts.length > 1 ? parts[1] : "";
  if (q === "json") return "[doc] " + JSON.stringify(manifestoComandos());
  const lines = linhasDoc();
  let m = "[doc]" + NL;
  let hit = 0;
  let i = 0;
  while (i < lines.length) {
    if (q.length === 0 || startsWith(lines[i], q)) { m = m + lines[i] + NL; hit = hit + 1; }
    i = i + 1;
  }
  if (hit === 0) return "[doc] nenhum comando com prefixo '" + q + "'";
  return m;
}

/// help — as assinaturas de cada comando, por grupo (uma linha por grupo).
export function cmdHelp(): string {
  let m = "[help] comandos por grupo (doc <prefixo> = detalhes e exemplos; doc json = manifesto; <obj> = indice, nome ou caminho Pai/Filho)";
  let g = 0;
  while (g < GRUPOS_COMANDO.length) {
    let linha = "";
    let i = 0;
    while (i < BUILTIN_MANIFEST.length) {
      const info = BUILTIN_MANIFEST[i];
      let u = 0;
      while (info.grupo === GRUPOS_COMANDO[g] && u < info.usos.length) {
        linha = linha + (linha.length > 0 ? " | " : "") + info.usos[u].split(SEPARADOR_USO)[0];
        u = u + 1;
      }
      i = i + 1;
    }
    if (linha.length > 0) m = m + NL + GRUPOS_COMANDO[g].toUpperCase() + ": " + linha;
    g = g + 1;
  }
  let pacote = "";
  let r = 0;
  while (r < commandCount()) { pacote = pacote + (r > 0 ? " | " : "") + commandUsage(r).split(SEPARADOR_USO)[0]; r = r + 1; }
  if (pacote.length > 0) m = m + NL + GRUPO_PACOTE.toUpperCase() + ": " + pacote;
  return m;
}

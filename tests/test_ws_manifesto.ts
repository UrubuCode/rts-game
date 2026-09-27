// Teste SEM JANELA da DOCUMENTAÇÃO da porta de controle: `help`, `doc
// [prefixo]` e `doc json` saem do manifesto (builtin_commands.ts) e do
// registro de comandos de pacote; o JSON traz nome, sintaxe, ajuda, se muta e
// o grupo de TODOS os comandos.
//
//   rts.exe run tests/test_ws_manifesto.ts
import { registerCommand, commandCount } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { BUILTIN_COMMANDS, GRUPOS_COMANDO } from "@editor/control/builtin_commands";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
instalarEditorReal();
check(registerCommand("teste_doc", "teste_doc <x> :: comando de pacote :: teste_doc 1", true, (p: string[]) => "[ok]"), "registra");
history.u = []; history.r = [];

const out = execCommand(800, 600, "doc json");
check(out.indexOf("[doc] ") === 0, "doc json: " + out.slice(0, 80));
const m = JSON.parse(out.slice("[doc] ".length));
check(m.commands.length === BUILTIN_COMMANDS.length + commandCount() && commandCount() >= 1, "embutidos + os de pacote: " + m.commands.length);
let i = 0;
while (i < BUILTIN_COMMANDS.length) {
  let achou: any = null;
  let k = 0;
  while (k < m.commands.length) { if (m.commands[k].name === BUILTIN_COMMANDS[i]) achou = m.commands[k]; k = k + 1; }
  check(achou !== null, "manifesto tem " + BUILTIN_COMMANDS[i]);
  check(achou.syntax.indexOf(achou.name) === 0 && achou.help.length > 0 && achou.usages.length > 0, achou.name + ": sintaxe e ajuda");
  check(GRUPOS_COMANDO.indexOf(achou.group) >= 0 && achou.builtin === true, achou.name + ": grupo");
  check(typeof achou.mutating === "boolean" && (achou.undo === "dispatch" || achou.undo === "proprio" || achou.undo === "nenhum"), achou.name + ": muta");
  i = i + 1;
}
function cmd(nome: string): any { let k = 0; while (k < m.commands.length) { if (m.commands[k].name === nome) return m.commands[k]; k = k + 1; } return null; }
check(cmd("move").mutating === true && cmd("move").undo === "dispatch" && cmd("move").objectArgs[0] === 1, "move muta, <obj> na posicao 1");
check(cmd("describe").mutating === false && cmd("find").mutating === false && cmd("getfield").mutating === false && cmd("scene").mutating === false, "consultas nao mutam");
check(cmd("rot").mutating === true && cmd("rot").undo === "proprio", "rot tira o proprio snapshot");
check(cmd("setfield").mutating === true, "setfield muta");
check(cmd("pose").usages.length === 4, "varios usos");
const pac = cmd("teste_doc");
check(pac !== null && pac.builtin === false && pac.mutating === true && pac.group === "pacote" && pac.syntax === "teste_doc <x>" && pac.help === "comando de pacote" && pac.example === "teste_doc 1", "comando de pacote: " + JSON.stringify(pac));
check(history.undoDepth() === 0, "doc json e consulta");

// doc em texto e help continuam, agora gerados
const d = execCommand(800, 600, "doc rot");
check(d.indexOf("rot <obj> <yaw> <pitch> [roll]") > 0, "doc <prefixo>: " + d);
check(execCommand(800, 600, "doc").indexOf("teste_doc <x> :: comando de pacote") > 0, "doc lista os de pacote");
check(execCommand(800, 600, "doc zzz").indexOf("nenhum comando") > 0, "doc sem resultado");
const h = execCommand(800, 600, "help");
let j = 0;
while (j < BUILTIN_COMMANDS.length) { check(h.indexOf(BUILTIN_COMMANDS[j]) > 0, "help lista " + BUILTIN_COMMANDS[j]); j = j + 1; }
check(h.indexOf("teste_doc <x>") > 0 && h.indexOf("TRANSFORM") > 0, "help por grupo e com os de pacote");
println("[PASSOU] ws manifesto: doc json com todos os comandos (nome, sintaxe, ajuda, muta, grupo), doc e help gerados");

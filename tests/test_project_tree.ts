// Teste headless: usa pastas do repositorio, sem modificar arquivos.
import io from "@compat/io.ts";
import { ProjectTree } from "@editor/project_tree";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const tree = new ProjectTree("src");
tree.refresh();
check(tree.paths[0] === "src", "raiz visivel");
check(tree.paths.indexOf("src/editor") >= 0, "pastas filhas visiveis");
check(tree.paths.indexOf("src/editor/control") < 0, "ramos fechados nao mostram descendentes");

tree.reveal("src/editor/control/commands");
const row = tree.paths.indexOf("src/editor/control/commands");
check(row >= 0 && tree.depths[row] === 3, "navegacao revela os ancestrais");
check(tree.isExpanded("src/editor") && tree.isExpanded("src/editor/control"), "ancestrais expandidos");
tree.toggle("src/editor");
check(tree.paths.indexOf("src/editor/control/commands") < 0, "recolher esconde descendentes");
tree.toggle("src/editor");
check(tree.paths.indexOf("src/editor/control/commands") >= 0, "reabrir preserva expansao interna");
tree.refresh();
check(tree.paths.indexOf("src/editor/control/commands") >= 0, "atualizar preserva expansao");
tree.reveal("assets/scenes");
check(!tree.isExpanded("assets"), "navegacao respeita a raiz");
check(tree.paths.indexOf("src/editor/assets.ts") < 0, "arvore mostra apenas pastas");

const missing = new ProjectTree("__project_tree_missing_directory__");
missing.refresh();
check(missing.paths.length === 1 && missing.branches[0] === 0, "pasta indisponivel nao derruba o painel");
io.print("[PASSOU] Project tree: expansao, navegacao, refresh e pastas indisponiveis");

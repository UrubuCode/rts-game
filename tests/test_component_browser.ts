import io from "@compat/io.ts";
import { ComponentBrowser, COMPONENT_CATALOG, COMPONENT_NAMES, COMPONENT_CATEGORIES, componentMatches } from "@editor/component_catalog";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const browser = new ComponentBrowser();
browser.reset();
check(browser.isRoot() && browser.rows.length === COMPONENT_CATEGORIES.length, "raiz mostra categorias derivadas");
check(browser.activate() === "" && browser.category === "Renderização", "entrar em categoria nao adiciona componente");
check(browser.rows.length === 3 && browser.activate() === "Camera", "categoria filtra componentes");
browser.query = "GRAVIDADE";
browser.refresh();
check(browser.rows.length === 1 && browser.activate() === "Rigidbody", "busca global por funcao e sem case");
browser.query = "   audio   ";
browser.refresh();
check(browser.rows.length === 1 && browser.activate() === "AudioSource", "termos sem acento e espacos externos");
browser.query = "nao-existe";
browser.refresh();
browser.move(1, 3);
check(browser.rows.length === 0 && browser.activate() === "", "busca vazia nao adiciona fallback");
browser.reset();
browser.category = "Scripts";
browser.refresh();
browser.move(99, 3);
check(browser.selected === browser.rows.length - 1 && browser.scroll === browser.rows.length - 3, "teclado revela selecao e limita final");
browser.move(0 - 99, 3);
check(browser.selected === 0 && browser.scroll === 0, "teclado limita inicio");
browser.query = "  ";
browser.category = "";
browser.refresh();
check(browser.isRoot(), "busca so com espacos preserva categorias");
let index = 0;
while (index < COMPONENT_CATALOG.length) {
  check(COMPONENT_NAMES.indexOf(COMPONENT_CATALOG[index].name) === index, "nomes unicos e derivados");
  check(componentMatches(index, "", COMPONENT_NAMES[index]), "todo componente pode ser encontrado pelo nome");
  index = index + 1;
}
io.print("[PASSOU] Component browser: categorias, busca, teclado, scroll e estado vazio");

import io from "@compat/io.ts";
import { ComponentPicker } from "@editor/component_picker";
import { UIScene } from "@engine/ui/uiscene";
import { COMPONENT_CATEGORIES, COMPONENT_CATALOG } from "@editor/component_catalog";
import { UI_COMPONENT_PICKER as P, UI_PICKER_KEYS as K, UI_INSP_DEFAULT } from "@editor/ui_config";

// Driver de input sem janela: exercita o mesmo draw usado pelo editor.
class TestApp {
  _win: number = 0;
  focus: number = 0 - 1;
  key: number = 0;
  typed: string = "";
  textChanged: boolean = false;
  hoveredRow: number = 0 - 1;
  clickedRow: number = 0 - 1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  keyPressed(code: number): number { return code === this.key ? 1 : 0; }
  // Linhas desenhadas neste draw (o clickable não tem id: a linha é a ordem de chamada).
  row: number = 0;
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string {
    if (!this.textChanged) return value;
    this.textChanged = false;
    return this.typed;
  }
  clickable(x: number, y: number, w: number, h: number): number {
    if (h !== P.rowH) return 0;
    const row = this.row; this.row = this.row + 1;
    if (row === this.clickedRow && this.clickedRow >= 0) return 3;
    return row === this.hoveredRow && this.hoveredRow >= 0 ? 1 : 0;
  }
  button(label: string): boolean { return false; }
}
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
const app = new TestApp();
const picker = new ComponentPicker();
const bottom = 500;
function draw(): string {
  app.row = 0;
  picker.place(0, bottom, UI_INSP_DEFAULT, 0); picker.mouse(P.padding, bottom - P.padding, 0, 0);
  return picker.draw(app);
}
picker.begin(app);
check(app.isFocused(P.searchId), "abrir foca a busca");
draw();
app.key = K.down;
draw();
app.key = K.enter;
check(draw() === "" && picker.browser.category === COMPONENT_CATEGORIES[1], "seta e Enter abrem categoria");
app.key = K.left;
draw();
check(picker.browser.isRoot(), "seta esquerda volta mesmo com busca focada");
app.key = 0;
app.textChanged = true;
app.typed = "gravidade";
draw();
app.key = K.enter;
check(draw() === "Rigidbody", "Enter devolve o resultado pesquisado");
app.key = 0;
app.textChanged = true;
app.typed = "inexistente";
draw();
app.key = K.enter;
check(draw() === "", "Enter sem resultados nao cria outro componente");
app.key = 0;
picker.begin(app);
app.hoveredRow = 0;
draw();
app.key = K.down;
draw();
check(picker.browser.selected === 1, "mouse parado nao desfaz navegacao por teclado");
app.key = 0;
app.hoveredRow = 0 - 1;
// `clickedRow` é a posição VISÍVEL da linha (a ordem da chamada de
// `clickable` dentro do draw), não o índice da categoria. A lista mostra no
// máximo `maxRows` de cada vez, e quando as categorias passaram desse número
// este teste parou de alcançar a última — clicava numa linha que não era
// desenhada.
//
// Em vez de fixar `maxRows` aqui, rola até a categoria e deixa o próprio
// picker limitar a rolagem; a posição visível sai da diferença.
const scriptsIndex = COMPONENT_CATEGORIES.indexOf("Scripts");
check(scriptsIndex >= 0, "a categoria Scripts existe no catalogo");
picker.browser.scroll = scriptsIndex;
app.clickedRow = 0 - 1;
draw();   // este draw só limita a rolagem ao máximo possível
check(scriptsIndex - picker.browser.scroll >= 0, "a rolagem passou da categoria");
app.clickedRow = scriptsIndex - picker.browser.scroll;
draw();
check(picker.browser.category === "Scripts", "clique abre categoria");
app.clickedRow = 0;
const expected = COMPONENT_CATALOG[picker.browser.rows[0]].name;
check(draw() === expected, "clique devolve componente");
app.clickedRow = 0 - 1;
app.key = K.escape;
draw();
check(picker.closed, "Escape fecha");
picker.begin(app);
app.key = 0;
picker.place(0, bottom, UI_INSP_DEFAULT, 0); picker.mouse(UI_INSP_DEFAULT + P.margin, bottom, 1, 0);
picker.draw(app);
check(picker.closed, "clique fora fecha");
const ui = new UIScene();
const root = ui.createGameObject("Root");
const pickerObject = ui.createGameObject("Picker", 0);
pickerObject.addBehavior(picker); picker.sceneIndex = 1;
picker.result = "Rigidbody"; root.active = 0;
picker.place(0, bottom, UI_INSP_DEFAULT, 0); picker.mouse(0, 0, 0, 0);
check(picker.render(ui, app) === "", "picker oculto nao repete ultima escolha");
check(picker.host.sx === UI_INSP_DEFAULT && picker.host.sy === bottom, "limites do picker vivem no Transform");
io.print("[PASSOU] Component picker: foco, teclado, mouse, busca e fechamento");

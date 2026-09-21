import io from "@compat/io.ts";
import { ComponentPicker } from "@editor/component_picker";
import { UI_COMPONENT_PICKER as P, UI_PICKER_KEYS as K, UI_INSP_DEFAULT } from "@editor/ui_config";

// Driver de input sem janela: exercita o mesmo draw usado pelo editor.
class TestApp {
  focus: number = 0 - 1;
  key: number = 0;
  typed: string = "";
  textChanged: boolean = false;
  hoveredRow: number = 0 - 1;
  clickedRow: number = 0 - 1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  keyPressed(code: number): number { return code === this.key ? 1 : 0; }
  textField(id: number, x: number, y: number, w: number, value: string, enabled: boolean): string {
    if (!this.textChanged) return value;
    this.textChanged = false;
    return this.typed;
  }
  clickable(id: number, x: number, y: number, w: number, h: number): number {
    if (id === P.rowId + this.clickedRow && this.clickedRow >= 0) return 3;
    return id === P.rowId + this.hoveredRow && this.hoveredRow >= 0 ? 1 : 0;
  }
  button(x: number, y: number, w: number, h: number, label: string): boolean { return false; }
  box(x: number, y: number, w: number, h: number, fill: number, sw: number, stroke: number, radius: number): void {}
  text(x: number, y: number, label: string, color: number, size: number): void {}
  line(x: number, y: number, x2: number, y2: number, w: number, color: number): void {}
}
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
const app = new TestApp();
const picker = new ComponentPicker();
const bottom = 500;
function draw(): string { return picker.draw(app, 0, bottom, UI_INSP_DEFAULT, 0, P.padding, bottom - P.padding, 0, 0); }
picker.begin(app);
check(app.isFocused(P.searchId), "abrir foca a busca");
draw();
app.key = K.down;
draw();
app.key = K.enter;
check(draw() === "" && picker.browser.category === "Física", "seta e Enter abrem categoria");
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
app.clickedRow = 4;
draw();
check(picker.browser.category === "Scripts", "clique abre categoria");
app.clickedRow = 0;
check(draw() === "Spinner", "clique devolve componente");
app.clickedRow = 0 - 1;
app.key = K.escape;
draw();
check(picker.closed, "Escape fecha");
picker.begin(app);
app.key = 0;
picker.draw(app, 0, bottom, UI_INSP_DEFAULT, 0, UI_INSP_DEFAULT + P.margin, bottom, 1, 0);
check(picker.closed, "clique fora fecha");
io.print("[PASSOU] Component picker: foco, teclado, mouse, busca e fechamento");

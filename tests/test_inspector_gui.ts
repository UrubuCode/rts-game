// Teste SEM JANELA do onInspectorGUI: a GUI do Light substitui a lista
// automática, dropdown/cor/slider/toggle mudam o componente com Desfazer, um
// componente sem GUI continua com os campos automáticos, e "Alinhar com a
// vista" copia a pose da câmera do editor (raiz e filha).
//   rts.exe run tests/test_inspector_gui.ts
import io from "@compat/io.ts";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { Light } from "@engine/core/light";
import { Camera } from "@engine/core/camera";
import { Spinner } from "@scripts/spinner";
import { Behavior, FALHA_GUI } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { logEntries, LOG_ERROR } from "@engine/core/logger";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1; textoId: number = -1; texto: string = "";
  // Digitação como a do app real: textField SEM estado devolve o valor recebido
  // mais a tecla do frame (e Backspace tira o último caractere).
  digitado: string = ""; apagar: boolean = false; checkRotulo: string = "";
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string {
    if (id === this.textoId) return this.texto;
    let out = value;
    if (enabled && id === this.focus) {
      out = out + this.digitado;
      if (this.apagar) out = out.slice(0, out.length - 1);
    }
    return out;
  }
  clickableAt(id: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return label === this.checkRotulo ? 1 - value : value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const PANEL_H = 4000;
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;
function render(): void { inspector.area(0, 0, 290, PANEL_H); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0); }
function control(name: string): EditorControl {
  const i = inspector.ui.names.indexOf(name); check(i >= 0, "controle ausente: " + name); return inspector.ui.controls[i];
}
function porRotulo(prefixo: string): EditorControl {
  let i = 0; let achado: EditorControl | null = null;
  while (i < inspector.ui.controls.length && achado === null) { if (inspector.ui.controls[i].label.indexOf(prefixo) === 0) achado = inspector.ui.controls[i]; i = i + 1; }
  check(achado !== null, "controle com rótulo " + prefixo); return achado as EditorControl;
}
function click(c: EditorControl): void { app.clickId = c.id; render(); app.clickId = -1; render(); }

scene.clear(); history.u = []; history.r = [];
const o = scene.createGameObject("Luz"); const luz = new Light(); o.addBehavior(luz);
S.selected = 0; S.selection = [0];
render();
check(inspector.ui.names.indexOf("Components/0/Field/0") < 0, "Light com GUI: sem a lista automática");
const tipo = control("Components/0/GUI/0");
check(tipo.label === "Tipo: direcional", "dropdown mostra o tipo: " + tipo.label);
click(tipo);
check(luz.tipo === "pontual" && history.undoDepth() === 1, "dropdown alterna o tipo com 1 Desfazer");
check(inspector.ui.names.indexOf("Components/0/Field/3") >= 0, "pontual mostra o campo automático 'alcance' (índice 3)");
const cor = control("Components/0/GUI/1");
app.textoId = cor.id; app.texto = "#FF8000"; render(); app.textoId = -1; render();
check(luz.cor === 0xFF8000, "campo de cor em #RRGGBB");
app.textoId = cor.id; app.texto = "#zz"; render(); app.textoId = -1; render();
check(luz.cor === 0xFF8000, "cor inválida é ignorada");
// digitação real, UMA tecla por frame: o rascunho incompleto sobrevive entre frames
const antesCor = history.undoDepth();
function tecla(t: string): void { if (t === "<") app.apagar = true; else app.digitado = t; render(); app.apagar = false; app.digitado = ""; }
app.focus = cor.id;
tecla("<");
check(luz.cor === 0xFF8000 && cor.textValue === "#FF800", "Backspace deixa o rascunho no campo: " + cor.textValue);
render();
check(cor.textValue === "#FF800", "o rascunho sobrevive ao frame seguinte: " + cor.textValue);
let nTecla = 0;
while (nTecla < 5) { tecla("<"); nTecla = nTecla + 1; }
check(cor.textValue === "#", "apagou até o #: " + cor.textValue);
const teclas = "00ff0";
nTecla = 0;
while (nTecla < teclas.length) { tecla(teclas.slice(nTecla, nTecla + 1)); nTecla = nTecla + 1; }
check(luz.cor === 0xFF8000 && cor.textValue === "#00ff0", "incompleto ainda não aplica: " + cor.textValue);
tecla("0");
check(luz.cor === 0x00FF00, "a última tecla forma a cor e aplica");
app.focus = 0 - 1; render();
check(cor.textValue === "#00FF00", "sem foco, o campo volta a mostrar a cor: " + cor.textValue);
check(history.undoDepth() === antesCor + 1, "a digitação vira 1 passo de Desfazer");
// componente sem GUI continua com os campos automáticos
const s = scene.createGameObject("Gira"); s.addBehavior(new Spinner());
S.selected = 1; S.selection = [1]; render();
check(inspector.ui.names.indexOf("Components/0/Field/0") >= 0, "sem onInspectorGUI: lista automática");
// Camera: slider do FOV em graus, toggle Principal, Alinhar com a vista (raiz)
const c = scene.createGameObject("Cam"); const cam = new Camera(); c.addBehavior(cam);
S.selected = 2; S.selection = [2]; render();
const fov = porRotulo("Campo de visão");
const r = fov.host;
// pressiona dentro da barra e arrasta para além da ponta direita (o arrasto segue até soltar)
inspector.area(0, 0, 290, PANEL_H); inspector.mouse(r.px + 1, r.py + 1, 1, 1); inspector.render(app, false, 0, 0);
inspector.area(0, 0, 290, PANEL_H); inspector.mouse(r.px + r.sx + 50, r.py + 1, 1, 0); inspector.render(app, false, 0, 0);
inspector.area(0, 0, 290, PANEL_H); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0);
check(Math.abs(cam.fov * 180.0 / Math.PI - 150.0) < 1e-6, "arrastar o slider até o fim = 150°: " + cam.fov * 180.0 / Math.PI);
// 30 frames de arrasto = UM passo de Desfazer (o snapshot serializa a cena inteira)
const antesArrasto = history.undoDepth();
inspector.area(0, 0, 290, PANEL_H); inspector.mouse(r.px + 1, r.py + 1, 1, 1); inspector.render(app, false, 0, 0);
let passo = 0;
while (passo < 30) { inspector.area(0, 0, 290, PANEL_H); inspector.mouse(r.px + 2 + passo * 3, r.py + 1, 1, 0); inspector.render(app, false, 0, 0); passo = passo + 1; }
inspector.area(0, 0, 290, PANEL_H); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0);
check(cam.fov * 180.0 / Math.PI < 100.0 && history.undoDepth() === antesArrasto + 1, "arrasto de 30 frames = 1 Desfazer: " + (history.undoDepth() - antesArrasto));
// o passo guardado é o de ANTES do arrasto (150°); lido do snapshot sem desfazer
// (Desfazer recriaria os objetos e soltaria as referências usadas abaixo)
check(history.u[history.u.length - 1].indexOf("2.617993877991") >= 0, "o snapshot é o valor de antes do arrasto (150° em rad)");
const antesMain = history.undoDepth();
app.checkRotulo = "Principal"; render(); app.checkRotulo = ""; render();
check(cam.isMain === 0 && history.undoDepth() === antesMain + 1, "toggle Principal desliga com 1 Desfazer");
S.camX = 3.0; S.camY = 4.0; S.camZ = 5.0; S.camYaw = 0.5; S.camPitch = 0 - 0.2;
const antes = history.undoDepth();
click(porRotulo("Alinhar com a vista"));
check(c.transform.px === 3.0 && c.transform.pz === 5.0 && c.transform.ry === 0.5 && c.transform.rx === 0 - 0.2, "alinhou a câmera raiz");
check(history.undoDepth() === antes + 1, "Alinhar com a vista entra no Desfazer");
history.undo();
check(scene.objects[2].transform.px === 0.0, "Desfazer volta a pose");
// Alinhar numa câmera filha de pai girado
const pai = scene.createGameObject("Veículo"); pai.transform.setPosition(10.0, 0.0, 0.0); pai.transform.ry = Math.PI / 2.0;
const cf = scene.createGameObject("CamFilha"); cf.parent = scene.objects.indexOf(pai); cf.addBehavior(new Camera());
scene.computeWorld();
S.selected = scene.objects.indexOf(cf); S.selection = [S.selected]; render();
click(porRotulo("Alinhar com a vista"));
scene.computeWorld();
check(Math.abs(cf.transform.wx - 3.0) < 1e-9 && Math.abs(cf.transform.wz - 5.0) < 1e-9 && Math.abs(cf.transform.wry - 0.5) < 1e-9, "filha: pose de mundo = vista");

// onInspectorGUI que lança: o Inspector termina o quadro (renderProtegido), o
// erro vai ao Console uma vez e o componente passa aos campos automáticos.
class GuiQuebrada extends Behavior {
  n: number = 0;
  valor: number = 3.0;
  typeName(): string { return "GuiQuebrada"; }
  fieldCount(): number { return 1; }
  fieldLabel(i: number): string { return "Valor"; }
  fieldName(i: number): string { return "valor"; }
  fieldType(i: number): string { return "number"; }
  fieldGet(i: number): f64 { return this.valor; }
  fieldSet(i: number, v: f64): void { this.valor = v; }
  onInspectorGUI(ui: InspectorUI): void { this.n = this.n + 1; ui.field("valor"); throw new Error("GUI quebrada de propósito"); }
}
function renderProtegido(): void { inspector.area(0, 0, 290, PANEL_H); inspector.mouse(-1, -1, 0, 0); inspector.renderProtegido(app, false, 0, 0); }
function errosDaGui(): number { return logEntries(LOG_ERROR, "GuiQuebrada").length; }
scene.clear(); history.u = []; history.r = [];
const oq = scene.createGameObject("Quebrada"); const gq = new GuiQuebrada(); oq.addBehavior(gq);
S.selected = 0; S.selection = [0];
const errosGuiAntes = errosDaGui();
renderProtegido();
check(gq.n === 1 && (gq.falhasEditor & FALHA_GUI) !== 0 && inspector.guiEmCurso === null, "a GUI que lançou fica desligada");
check(errosDaGui() === errosGuiAntes + 1, "erro registrado uma vez");
renderProtegido();
check(gq.n === 1 && inspector.ui.names.indexOf("Components/0/Field/0") >= 0, "no quadro seguinte: campos automáticos, sem chamar a GUI");
check(errosDaGui() === errosGuiAntes + 1, "sem repetir o erro");
io.print("[PASSOU] inspector gui: substitui a lista, dropdown, cor (digitada tecla a tecla), slider, toggle, sem GUI, alinhar raiz e filha, exceção de script contida");

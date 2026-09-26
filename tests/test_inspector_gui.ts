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

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1; textoId: number = -1; texto: string = "";
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return id === this.textoId ? this.texto : value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const PANEL_H = 4000;
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;
function render(): void { inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0); }
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
inspector.render(app, 0, 0, 290, PANEL_H, r.px + 1, r.py + 1, 1, 1, false, 0, 0);
inspector.render(app, 0, 0, 290, PANEL_H, r.px + r.sx + 50, r.py + 1, 1, 0, false, 0, 0);
inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0);
check(Math.abs(cam.fov * 180.0 / Math.PI - 150.0) < 1e-6, "arrastar o slider até o fim = 150°: " + cam.fov * 180.0 / Math.PI);
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
io.print("[PASSOU] inspector gui: substitui a lista, dropdown, cor, slider, sem GUI, alinhar raiz e filha");

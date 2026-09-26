// Teste SEM JANELA do pacote ambiente/: CicloDoDia (sol e cores), comandos
// `ambiente`/`ambienteinfo` e Janela/Ambiente no Inspector (dropdown do céu
// com Desfazer; trocar a seleção fecha a janela).
//   rts.exe run tests/test_pacote_ambiente.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { cicloSol, avancarHora, CicloDoDia, ELEVACAO_MAX, DIA_TOPO, NOITE_TOPO } from "../assets/pacotes/ambiente/ciclo_do_dia";
import { Light, criarLuzDirecionalPadrao } from "@engine/core/light";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import type { Behavior } from "@engine/core/behavior";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const sol = new Float64Array(3);
cicloSol(12.0, sol); check(Math.abs(sol[0] + ELEVACAO_MAX) < 1e-12 && sol[2] === 1.0, "meio-dia: sol no alto, dia pleno");
cicloSol(6.0, sol); check(Math.abs(sol[0]) < 1e-12, "6h: sol no horizonte");
cicloSol(0.0, sol); check(Math.abs(sol[0] - ELEVACAO_MAX) < 1e-12 && sol[2] === 0.0, "meia-noite: sol abaixo, noite");
check(Math.abs(avancarHora(23.5, 1.0, 24.0) - 0.5) < 1e-12, "a hora dá a volta em 24");
// CicloDoDia gira a luz do sol e pinta o céu
scene.clear(); scene.ambiente.ceu.modo = "procedural";
const luz = criarLuzDirecionalPadrao(scene);
const relogio = scene.createGameObject("Relógio"); const ciclo = new CicloDoDia(); ciclo.duracao = 24.0; ciclo.hora = 11.0; relogio.addBehavior(ciclo);
const ry0 = luz.transform.ry;
ciclo.update(1.0);
check(ciclo.hora === 12.0 && Math.abs(luz.transform.rx + ELEVACAO_MAX) < 1e-12, "1 s = 1 h; ao meio-dia o sol está no alto");
check(Math.abs(luz.transform.ry - 12.0 / 24.0 * 2.0 * Math.PI) < 1e-12 && luz.transform.ry !== ry0, "o sol gira no azimute");
check(Math.abs(scene.ambiente.ceu.topo[0] - DIA_TOPO[0]) < 1e-12 && Math.abs(scene.ambiente.ceu.topo[2] - DIA_TOPO[2]) < 1e-12, "topo do céu de dia");
ciclo.hora = 23.0; ciclo.update(1.0);
check(scene.ambiente.ceu.topo[0] === NOITE_TOPO[0], "topo do céu à meia-noite");

// comandos
instalarEditorReal(); history.u = []; history.r = [];
check(execCommand(800, 600, "ambiente set ceu.topo 0.1 0.2 0.3").indexOf("[ok]") === 0 && scene.ambiente.ceu.topo[1] === 0.2 && history.undoDepth() === 1, "set ceu.topo com Desfazer");
check(execCommand(800, 600, "ambiente set neblina.densidade 0.04").indexOf("[ok]") === 0 && scene.ambiente.neblina.densidade === 0.04, "neblina");
check(execCommand(800, 600, "ambiente set neblina.densidade -1").indexOf("[erro]") === 0, "densidade negativa");
check(execCommand(800, 600, "ambiente set sol Luz Direcional").indexOf("[ok]") === 0 && scene.ambiente.sol === "Luz Direcional", "sol com espaço no nome");
check(execCommand(800, 600, "ambiente ceu nublado").indexOf("[erro]") === 0, "modo inválido");
check(execCommand(800, 600, "ambiente ceu panorama assets/nao/existe.png").indexOf("[erro]") === 0, "textura inexistente");
check(execCommand(800, 600, "ambiente ceu panorama assets/editor/icons/info.png").indexOf("[ok]") === 0 && scene.ambiente.ceu.modo === "panorama" && scene.ambiente.ceu.textura === "assets/editor/icons/info.png", "panorama com textura");
const d = history.undoDepth();
check(execCommand(800, 600, "ambienteinfo").indexOf("\"panorama\"") > 0 && history.undoDepth() === d, "ambienteinfo é consulta");

// Janela/Ambiente no Inspector
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const app = new TestApp();
const inspector = new Inspector(app);
const host = instalarEditorReal();
host.janela = (b: Behavior, titulo: string) => { inspector.abrirJanela(b, titulo); };
function render(): void { inspector.render(app, 0, 0, 290, 4000, -1, -1, 0, 0, false, 0, 0); }
S.selected = 0; S.selection = [0];
check(executarItemDeMenu(indiceDoCaminho("Janela/Ambiente"), 0 - 1) === "", "Janela/Ambiente");
check(history.undoDepth() === d, "abrir a janela não entra no Desfazer");
render();
check(inspector.janela !== null, "o Inspector mostra a janela do Ambiente");
let ceu: EditorControl | null = null;
let i = 0;
while (i < inspector.ui.controls.length) { if (inspector.ui.controls[i].label.indexOf("Céu: ") === 0) ceu = inspector.ui.controls[i]; i = i + 1; }
check(ceu !== null && (ceu as EditorControl).label === "Céu: panorama", "dropdown do céu");
app.clickId = (ceu as EditorControl).id; render(); app.clickId = -1; render();
check(scene.ambiente.ceu.modo === "estrelas" && history.undoDepth() === d + 1, "o dropdown alterna o modo, com Desfazer");
S.selected = 1; S.selection = [1]; render();
check(inspector.janela === null, "trocar a seleção fecha a janela");
io.print("[PASSOU] pacote ambiente: ciclo do dia, comandos, consulta, janela no Inspector");

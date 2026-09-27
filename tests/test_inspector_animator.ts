// Teste SEM JANELA da seção "Animator" do Inspector: controlador, parâmetros
// editáveis ao vivo (bool = caixa, trigger = botão; float = campo numérico),
// estado por camada, prévia fora do Play e fim da prévia restaurando tudo.
// Mesmo padrão de test_inspector_skeleton.ts.
//
//   rts.exe run tests/test_inspector_animator.ts
import io from "@compat/io.ts";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { sceneToJSON } from "@editor/sceneio";
import { animatorPreviewIsActive, previewTick, previewFrame } from "@editor/skeleton_preview";
import { Skeleton } from "@engine/core/skeleton";
import { Animator } from "@engine/core/animator";
import { AnimationPlayer } from "@engine/core/animation_player";
import { EditorControl } from "@editor/ui_controls";
import { UI_ANIMATOR as A } from "@editor/ui_config";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

class TestApp {
  _win: number = 0;
  focus: number = -1;
  clickId: number = -1;
  toggleLabel: string = "";
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  // a caixa com o rótulo pedido "é clicada" (inverte) uma vez
  checkbox(x: number, y: number, value: number, label: string): number {
    if (label === this.toggleLabel) { this.toggleLabel = ""; return value !== 0 ? 0 : 1; }
    return value;
  }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}

const DT: f64 = 1.0 / 60.0;
const PANEL_H = 4000;
scene.clear();
history.u = []; history.r = [];
const object = scene.createGameObject("Heroi");
const sk = new Skeleton("assets/models/kenney/character-a.glb");
object.addBehavior(sk); sk.ensureAsset(0);
const ap = new AnimationPlayer(); object.addBehavior(ap); ap.mount();
const an = new Animator(); an.controller = "assets/animators/personagem.controller.json";
object.addBehavior(an); an.mount();
const other = scene.createGameObject("Outro");
S.selected = 0; S.selection = [0];
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;
inspector.skeletonOpen = false;

function render(): void { inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0); }
function control(name: string): EditorControl {
  const index = inspector.ui.names.indexOf(name);
  check(index >= 0, "controle ausente: " + name);
  return inspector.ui.controls[index];
}
// o controle foi desenhado NESTE frame (painel ativo na UIScene)
function shown(name: string): boolean {
  const index = inspector.ui.names.indexOf(name);
  return index >= 0 && inspector.ui.scene.panels[inspector.ui.controls[index].sceneIndex].active !== 0;
}
function click(name: string): void { app.clickId = control(name).id; render(); app.clickId = -1; render(); }

render();
// 1) controlador, parâmetros e camadas
check(control("Animator/Controller").label.indexOf("personagem.controller.json") > 0, "mostra o caminho do controlador");
check(control("Animator/Param/0").mode === "number" && control("Animator/Param/0").label === "velocidade", "float = campo numerico");
check(control("Animator/Param/1").mode === "toggle" && control("Animator/Param/1").label === "morto", "bool = caixa");
check(control("Animator/Param/2").mode === "button" && control("Animator/Param/2").label === "tiro", "trigger = botao");
check(control("Animator/Layer/0").label.indexOf("Base: Locomocao") === 0, "camada 0: " + control("Animator/Layer/0").label);
check(control("Animator/Layer/1").label.indexOf("Braco: Segurando") === 0, "camada 1: " + control("Animator/Layer/1").label);
check(!shown("Animator/StopPreview"), "sem previa, sem botao de parar");

// 2) trigger pelo botão: arma, inicia a prévia, sem undo; a prévia avança e mostra o estado novo
const salva = sceneToJSON();
const undoAntes = history.undoDepth();
click("Animator/Param/2");
check(an.getBool("tiro") || an.stateName(1) === "Atirando", "botao arma o trigger");
check(animatorPreviewIsActive(an), "mexer num parametro fora do Play inicia a previa");
previewTick(DT); render();
check(control("Animator/Layer/1").label.indexOf("Braco: Atirando") === 0, "estado ao vivo: " + control("Animator/Layer/1").label);
// 3) bool pela caixa: transição com fade aparece no rótulo
app.toggleLabel = "morto"; render();
check(an.getBool("morto"), "caixa liga o bool");
previewFrame(DT); render();
const base = control("Animator/Layer/0").label;
check(base.indexOf("Base: Morto") === 0 && base.indexOf(A.fadeOpen.trim()) > 0, "rotulo com fade: " + base);
check(history.undoDepth() === undoAntes, "parametros nao empilham undo");
check(sceneToJSON() === salva, "a previa nao muda a cena salva");
// 4) "Parar prévia": volta parâmetros, estados e pose
check(shown("Animator/StopPreview"), "com previa, botao de parar aparece");
click("Animator/StopPreview");
check(!animatorPreviewIsActive(an) && !an.getBool("morto") && an.stateName(0) === "Locomocao", "parar previa restaura parametros e estados");
let dif: f64 = 0.0; let i = 0;
while (i < sk.poseR.length) { dif = dif + Math.abs(sk.poseR[i] - sk.manualR[i]); i = i + 1; }
check(dif === 0.0, "parar previa devolve a pose manual");
// 5) trocar de objeto encerra a prévia
click("Animator/Param/2");
check(animatorPreviewIsActive(an), "previa de novo");
S.selected = 1; S.selection = [1]; render();
check(!animatorPreviewIsActive(an) && !an.getBool("tiro"), "trocar de objeto encerra a previa");
S.selected = 0; S.selection = [0]; render();
// 5b) seção Esqueleto: com o Animator ligado, aviso em vez dos controles do player (inerte)
inspector.skeletonOpen = true; render();
check(shown("Skeleton/DrivenByAnimator") && !shown("Skeleton/Play"), "Animator ligado: aviso no lugar de tocar/parar");
// 6) controlador com erro: rótulo de erro, sem parâmetros
an.controller = "assets/animators/nao-existe.controller.json"; an.onValidate("controller"); render();
check(shown("Animator/Error") && !shown("Animator/Param/0") && control("Animator/Error").label.indexOf("nao-existe") > 0, "erro legivel no Inspector");
check(!shown("Skeleton/DrivenByAnimator") && shown("Skeleton/Play"), "Animator com erro: o player volta a ter controles");
io.print("[PASSOU] Inspector: animator (controlador, parametros ao vivo, estado por camada, previa, parar previa, erro)");

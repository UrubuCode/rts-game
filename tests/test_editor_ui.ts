import io from "@compat/io.ts";
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { UIScene } from "@engine/ui/uiscene";
import { EditorUI } from "@editor/ui_controls";
import { scene } from "@editor/control/session";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
class Probe extends Behavior {
  calls: number = 0;
  kind(): number { return KIND_UI; }
  drawUI(win: i64, width: f64, height: f64): void { this.calls = this.calls + 1; }
}
const ui = new UIScene();
const root = ui.createGameObject("Root");
const child = ui.createGameObject("Child", 0);
const probe = new Probe(); child.addBehavior(probe);
ui.draw(0, 800, 600);
check(probe.calls === 1, "component draws");
root.active = 0; ui.draw(0, 800, 600);
check(probe.calls === 1, "hidden ancestor suppresses drawing and input");
root.active = 1; probe.enabled = 0; ui.draw(0, 800, 600);
check(probe.calls === 1, "disabled component does not draw");
probe.enabled = 1; child.parent = 1;
check(!ui.isVisible(1), "cycle hidden");
child.parent = 99;
check(!ui.isVisible(1) && !ui.isVisible(-1), "invalid indices hidden");
const gameCount = scene.count();
const controls = new EditorUI(null, "Editor/Test");
controls.begin(0, 0, 0, 0);
const button = controls.control("Button", "button", 10, 20, 100, 24, "Test");
const buttonObject = controls.scene.panels[button.sceneIndex];
check(buttonObject.parent === 0 && buttonObject.behaviors[0] === button, "control is actual child GameObject and component");
controls.begin(0, 0, 0, 0);
check(buttonObject.active === 0, "unused controls hidden next frame");
const reused = controls.control("Button", "button", 30, 40, 120, 24, "Changed");
check(reused === button && controls.scene.count() === 2, "stable identity without per-frame allocation");
check(buttonObject.active === 1 && button.host.px === 30 && button.host.sx === 120, "layout stored in Transform");
check(scene.count() === gameCount, "editor UI does not pollute game scene");
io.print("[PASSOU] Editor UI: GameObjects, reuso, visibilidade e isolamento");

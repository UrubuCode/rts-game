import io from "@compat/io.ts";
import { Behavior } from "@engine/core/behavior";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { UI_INSPECTOR as L } from "@editor/ui_config";

class TextOnly extends Behavior {
  text: string = "before";
  fieldCount(): number { return 1; }
  fieldType(index: number): string { return "string"; }
  fieldLabel(index: number): string { return "Label"; }
  fieldStringGet(index: number): string { return this.text; }
  fieldStringSet(index: number, value: string): void { this.text = value; }
}
class TestApp {
  _win: number = 0;
  focus: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string {
    if (id === L.nameId || !enabled) return value;
    this.focus = id;
    return "after";
  }
  clickableAt(id: number): number { return 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
scene.clear();
const object = scene.createGameObject("Test"); const text = new TextOnly(); object.addBehavior(text); S.selected = 0;
const app = new TestApp(); const inspector = new Inspector(app); inspector.transformOpen = false;
inspector.area(0, 0, 290, 720); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0);
if (text.text !== "after" || app.focus < 0) throw new Error("Inspector string field failed to edit or retain focus");
object.behaviors[0].collapsed = 1;
inspector.area(0, 0, 290, 720); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0);
if (app.focus >= 0) throw new Error("hidden text field retains focus");
io.print("[PASSOU] Inspector: texto editavel e foco liberado quando oculto");

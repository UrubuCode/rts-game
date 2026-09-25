import { Behavior, KIND_UI } from "@engine/core/behavior";
import { UIScene } from "@engine/ui/uiscene";
import { GameObject } from "@engine/core/gameobject";
import { numField, propertyField, assetField } from "./widgets";
import { UI_C, UI_INSPECTOR as L, UI_NUMERIC as N, UI_CONSOLE as C } from "./ui_config";
import { drawEditorIcon } from "./icon_images";

// Shared identities across all panels: native focus/click state is window-wide.
const editorControlIds = { next: L.controlId };

// Um controle e um componente real: Transform guarda seu retangulo, active
// controla visibilidade, enabled controla o componente, inputEnabled o input.
export class EditorControl extends Behavior {
  app: any;
  mode: string = "label";
  label: string = "";
  icon: string = "";
  trailing: string = "";
  textValue: string = "";
  value: number = 0;
  id: number = 0;
  sceneIndex: number = 0;
  color: number = UI_C.primaryText;
  fill: number = UI_C.controlIdle;
  inputEnabled: boolean = true;
  clicked: boolean = false;
  hot: number = 0;
  mx: number = 0; my: number = 0; down: number = 0; pressed: number = 0;
  constructor(app: any) { super(); this.app = app; }
  kind(): number { return KIND_UI; }
  typeName(): string { return "EditorControl"; }

  drawUI(win: i64, width: f64, height: f64): void {
    const x = this.host.px; const y = this.host.py;
    const w = this.host.sx; const h = this.host.sy;
    const app = this.app;
    this.clicked = false;
    if (this.mode === "surface") { app.box(x, y, w, h, this.fill, 0, 0, 0); return; }
    if (this.mode === "icon") { drawEditorIcon(win, this.icon, x, y, w); return; }
    if (this.mode === "flat" || this.mode === "row") {
      this.hot = this.inputEnabled ? app.clickable(this.id, x, y, w, h) : 0;
      app.box(x, y, w, h, this.hot === 1 || this.hot === 2 ? UI_C.consoleHover : this.fill, 0, 0, this.mode === "row" ? 0 : C.radius);
      let textX = x + C.padding;
      if (this.icon.length > 0) {
        drawEditorIcon(win, this.icon, textX, y + (h - C.iconSize) / 2, C.iconSize);
        textX = textX + C.iconSize + C.iconGap;
      }
      const trailingW = this.trailing.length > 0 ? C.repeatW : 0;
      const available = Math.max(0, Math.floor((x + w - trailingW - C.gap - textX) / C.charW));
      const caption = this.label.length > available ? this.label.slice(0, Math.max(0, available - 1)) + "…" : this.label;
      app.text(textX, y + C.textY, caption, this.color, C.font);
      if (trailingW > 0) app.text(x + w - trailingW, y + C.textY, this.trailing, UI_C.consoleMuted, C.font);
      this.clicked = this.hot === 3; return;
    }
    if (this.mode === "panel") { app.box(x, y, w, h, this.fill, L.border, UI_C.border, L.radius); return; }
    if (this.mode === "number" || this.mode === "axis") {
      this.value = this.mode === "number" ?
        propertyField(win, this.id, x, y, w, this.label, this.value, this.mx, this.my,
          this.inputEnabled ? this.down : 0, this.inputEnabled ? this.pressed : 0) :
        numField(win, this.id, x, y, w, this.label, this.color, this.value, this.mx, this.my,
          this.inputEnabled ? this.down : 0, this.inputEnabled ? this.pressed : 0);
      return;
    }
    if (this.mode === "text") {
      this.textValue = app.textField(this.id, x, y, w, this.textValue, this.inputEnabled);
      return;
    }
    if (this.mode === "propertyText") {
      const labelW = w * N.labelFraction;
      app.text(x, y + L.textY, this.label.slice(0, Math.floor((labelW - N.labelGap) / N.charWidth)), this.color, L.font);
      this.textValue = app.textField(this.id, x + labelW, y, w - labelW, this.textValue, this.inputEnabled);
      return;
    }
    if (this.mode === "asset") {
      this.hot = assetField(win, x, y, w, h, this.label, this.textValue,
        this.inputEnabled ? this.value : 0, this.mx, this.my);
      if (!this.inputEnabled) this.hot = 0;
      return;
    }
    if (this.mode === "toggle") {
      if (this.inputEnabled) this.value = app.checkbox(x, y + L.textY, this.value, this.label);
      else app.text(x, y + L.textY, (this.value !== 0 ? "[x] " : "[ ] ") + this.label, UI_C.disabledText, L.font);
      return;
    }
    if (this.mode === "button" || this.mode === "header") {
      const state = this.inputEnabled ? app.clickable(this.id, x, y, w, h) : 0;
      const fill = state === 1 || state === 2 ? UI_C.controlHover : this.fill;
      app.box(x, y, w, h, fill, L.border, UI_C.border, L.radius);
      const caption = this.label.slice(0, Math.max(0, Math.floor((w - L.gap * 2) / L.charWidth)));
      app.text(x + L.gap, y + L.textY, caption, this.inputEnabled || this.mode === "header" ? this.color : UI_C.disabledText, L.font);
      this.clicked = state === 3;
      return;
    }
    app.text(x, y + L.textY, this.label.slice(0, Math.max(0, Math.floor(w / L.charWidth))), this.color, L.font);
  }
}

// Identidades estaveis, criadas uma vez por caminho, nao um GameObject por frame.
export class EditorUI {
  scene: UIScene = new UIScene();
  root: GameObject;
  names: string[] = [];
  controls: EditorControl[] = [];
  app: any;
  mx: number = 0; my: number = 0; down: number = 0; pressed: number = 0;
  constructor(app: any, name: string) { this.app = app; this.root = this.scene.createGameObject(name); }
  begin(mx: number, my: number, down: number, pressed: number): void {
    this.mx = mx; this.my = my; this.down = down; this.pressed = pressed;
    let objectIndex = 1;
    while (objectIndex < this.scene.panels.length) { this.scene.panels[objectIndex].active = 0; objectIndex = objectIndex + 1; }
  }
  control(name: string, mode: string, x: number, y: number, w: number, h: number,
          label: string, inputEnabledArg?: boolean): EditorControl {
    const inputEnabled: boolean = inputEnabledArg !== undefined ? inputEnabledArg : true;
    let index = this.names.indexOf(name);
    if (index < 0) {
      const object = this.scene.createGameObject(this.root.name + "/" + name, 0);
      const component = new EditorControl(this.app);
      component.id = editorControlIds.next; editorControlIds.next = editorControlIds.next + 1;
      component.sceneIndex = this.scene.count() - 1;
      object.addBehavior(component);
      this.names.push(name); this.controls.push(component);
      index = this.controls.length - 1;
    }
    const control = this.controls[index];
    this.scene.panels[control.sceneIndex].active = 1;
    control.mode = mode; control.label = label; control.inputEnabled = inputEnabled;
    control.host.px = x; control.host.py = y; control.host.sx = w; control.host.sy = h;
    control.mx = this.mx; control.my = this.my; control.down = this.down; control.pressed = this.pressed;
    control.clicked = false; control.hot = 0;
    control.icon = "";
    control.trailing = "";
    control.color = UI_C.primaryText; control.fill = UI_C.controlIdle;
    return control;
  }
  draw(control: EditorControl): void { this.scene.drawObject(control.sceneIndex, this.app._win, 0, 0); }
  end(): void {
    let index = 0;
    while (index < this.controls.length) {
      const control = this.controls[index];
      if (this.app.isFocused(control.id) && (!control.inputEnabled || !this.scene.isVisible(control.sceneIndex))) this.app.setFocus(0 - 1);
      index = index + 1;
    }
  }
}

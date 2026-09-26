import { Behavior, KIND_UI } from "@engine/core/behavior";
import { UIScene } from "@engine/ui/uiscene";
import { GameObject } from "@engine/core/gameobject";
import { numField, propertyField, assetField, widgetRect, widgetMouse } from "./widgets";
import { UI_C, UI_INSPECTOR as L, UI_NUMERIC as N, UI_CONSOLE as C, UI_SKELETON as K } from "./ui_config";
import { drawEditorIcon, iconAt } from "./icon_images";

import { caixa, estiloTexto, pincel, texto } from "@compat/draw2d.ts";
// Shared identities across all panels: native focus/click state is window-wide.
const editorControlIds = { next: L.controlId };
/// Os primeiros `n` caracteres de `texto`, sem string nova quando ele já cabe
/// (o caso comum: desenhar não aloca por frame).
function cortar(texto: string, n: number): string { return texto.length <= n ? texto : texto.slice(0, Math.max(0, n)); }

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
  dragging: boolean = false;   // "timeline": arrasto iniciado dentro dela, segue até soltar
  mx: number = 0; my: number = 0; down: number = 0; pressed: number = 0;
  constructor(app: any) { super(); this.app = app; }
  kind(): number { return KIND_UI; }
  typeName(): string { return "EditorControl"; }

  drawUI(win: i64, width: f64, height: f64): void {
    const x = this.host.px; const y = this.host.py;
    const w = this.host.sx; const h = this.host.sy;
    const app = this.app;
    this.clicked = false;
    if (this.mode === "surface") { pincel(this.fill, 0, 0, 0); caixa(x, y, w, h); return; }
    if (this.mode === "icon") { iconAt(x, y, w); drawEditorIcon(this.icon); return; }
    if (this.mode === "flat" || this.mode === "row") {
      app.at(x, y, w, h);
      this.hot = this.inputEnabled ? app.clickableAt(this.id) : 0;
      pincel(this.hot === 1 || this.hot === 2 ? UI_C.consoleHover : this.fill, 0, 0, this.mode === "row" ? 0 : C.radius); caixa(x, y, w, h);
      let textX = x + C.padding;
      if (this.icon.length > 0) {
        iconAt(textX, y + (h - C.iconSize) / 2, C.iconSize); drawEditorIcon(this.icon);
        textX = textX + C.iconSize + C.iconGap;
      }
      const trailingW = this.trailing.length > 0 ? C.repeatW : 0;
      const available = Math.max(0, Math.floor((x + w - trailingW - C.gap - textX) / C.charW));
      const caption = this.label.length > available ? this.label.slice(0, Math.max(0, available - 1)) + "…" : this.label;
      texto(textX, y + C.textY, caption, estiloTexto(this.color, C.font));
      if (trailingW > 0) texto(x + w - trailingW, y + C.textY, this.trailing, estiloTexto(UI_C.consoleMuted, C.font));
      this.clicked = this.hot === 3; return;
    }
    if (this.mode === "timeline") {
      // Barra de tempo: `value` em [0,1]. Pressionar dentro captura o arrasto,
      // que continua fora da barra até soltar o botão; hot = 1 enquanto arrasta.
      if (!this.inputEnabled || this.down === 0) this.dragging = false;
      const over = this.mx >= x && this.mx < x + w && this.my >= y && this.my < y + h;
      if (this.inputEnabled && this.pressed !== 0 && over) this.dragging = true;
      if (this.dragging && w > 0) this.value = Math.max(0, Math.min(1, (this.mx - x) / w));
      this.hot = this.dragging ? 1 : 0;
      pincel(UI_C.timelineTrack, L.border, UI_C.border, L.radius); caixa(x, y, w, h);
      if (this.value > 0) { pincel(UI_C.timelineFill, 0, 0, L.radius); caixa(x, y, w * this.value, h); }
      const handleX = Math.max(x, Math.min(x + w - K.handleW, x + w * this.value - K.handleW / 2));
      pincel(UI_C.timelineHandle, 0, 0, 0); caixa(handleX, y, K.handleW, h);
      texto(x + L.gap, y + K.textY, this.label, estiloTexto(UI_C.timelineText, L.font));
      return;
    }
    if (this.mode === "panel") { pincel(this.fill, L.border, UI_C.border, L.radius); caixa(x, y, w, h); return; }
    if (this.mode === "number" || this.mode === "axis") {
      widgetRect(x, y, w, h);
      widgetMouse(this.mx, this.my, this.inputEnabled ? this.down : 0, this.inputEnabled ? this.pressed : 0);
      this.value = this.mode === "number" ? propertyField(this.id, this.label, this.value) :
        numField(this.id, this.label, this.color, this.value);
      return;
    }
    if (this.mode === "text") {
      app.at(x, y, w, h);
      this.textValue = app.textField(this.id, this.textValue, this.inputEnabled);
      return;
    }
    if (this.mode === "propertyText") {
      const labelW = w * N.labelFraction;
      texto(x, y + L.textY, cortar(this.label, Math.floor((labelW - N.labelGap) / N.charWidth)), estiloTexto(this.color, L.font));
      app.at(x + labelW, y, w - labelW, h);
      this.textValue = app.textField(this.id, this.textValue, this.inputEnabled);
      return;
    }
    if (this.mode === "asset") {
      widgetRect(x, y, w, h);
      widgetMouse(this.mx, this.my, 0, 0);
      this.hot = assetField(this.label, this.textValue, this.inputEnabled ? this.value : 0);
      if (!this.inputEnabled) this.hot = 0;
      return;
    }
    if (this.mode === "toggle") {
      if (this.inputEnabled) this.value = app.checkbox(x, y + L.textY, this.value, this.label);
      else texto(x, y + L.textY, (this.value !== 0 ? "[x] " : "[ ] ") + this.label, estiloTexto(UI_C.disabledText, L.font));
      return;
    }
    if (this.mode === "button" || this.mode === "header") {
      app.at(x, y, w, h);
      const state = this.inputEnabled ? app.clickableAt(this.id) : 0;
      const fill = state === 1 || state === 2 ? UI_C.controlHover : this.fill;
      pincel(fill, L.border, UI_C.border, L.radius); caixa(x, y, w, h);
      const caption = cortar(this.label, Math.floor((w - L.gap * 2) / L.charWidth));
      texto(x + L.gap, y + L.textY, caption, estiloTexto(this.inputEnabled || this.mode === "header" ? this.color : UI_C.disabledText, L.font));
      this.clicked = state === 3;
      return;
    }
    texto(x, y + L.textY, cortar(this.label, Math.floor(w / L.charWidth)), estiloTexto(this.color, L.font));
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
  atX: number = 0; atY: number = 0; atW: number = 0; atH: number = 0;
  constructor(app: any, name: string) { this.app = app; this.root = this.scene.createGameObject(name); }
  begin(mx: number, my: number, down: number, pressed: number): void {
    this.mx = mx; this.my = my; this.down = down; this.pressed = pressed;
    let objectIndex = 1;
    while (objectIndex < this.scene.panels.length) { this.scene.panels[objectIndex].active = 0; objectIndex = objectIndex + 1; }
  }
  /// Retângulo do próximo `control` (≤ 4 parâmetros por chamada: 5+ alocam no RTS).
  at(x: number, y: number, w: number, h: number): void { this.atX = x; this.atY = y; this.atW = w; this.atH = h; }
  /// Controle `name` no retângulo do último `at`.
  control(name: string, mode: string, label: string, inputEnabledArg?: boolean): EditorControl {
    const inputEnabled: boolean = inputEnabledArg !== undefined ? inputEnabledArg : true;
    const x = this.atX; const y = this.atY; const w = this.atW; const h = this.atH;
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

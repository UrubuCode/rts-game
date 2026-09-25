import { Behavior, KIND_UI } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { EditorUI } from "./ui_controls";
import { MeshRenderer } from "@engine/core/meshrenderer";
import { ComponentPicker } from "./component_picker";
import { attachEditorComponent } from "./script_drop";
import { history } from "./undo";
import { scene, S } from "./control/session";
import { nfCancel, AXIS_X, AXIS_Y, AXIS_Z } from "./widgets";
import input from "rts:input";
import { UI_C, UI_INSPECTOR as L, UI_COMPONENT_PICKER as P, UI_AXIS_NAMES,
  UI_MESH_NAMES, UI_INSPECTOR_SCROLL_STEP } from "./ui_config";

const DEGREES_PER_RADIAN = 180 / Math.PI;

// Painel do editor: GameObject raiz + controles filhos em uma UIScene propria.
// Nenhum desses objetos entra na cena editada ou no arquivo do jogo.
export class Inspector extends Behavior {
  ui: EditorUI;
  picker: ComponentPicker = new ComponentPicker();
  scroll: number = 0;
  contentHeight: number = 0;
  selection: number = 0 - 1;
  selectedObject: any = null;
  opened: number = 0;
  transformOpen: boolean = true;
  appearanceOpen: boolean = true;
  meshHot: number = 0;
  textureHot: number = 0;
  top: number = 0; bottom: number = 0;
  x: number = 0; width: number = 0;
  enabledInput: boolean = true;
  scrollbarDrag: boolean = false;
  changed: boolean = false;

  constructor(app: any) {
    super();
    this.ui = new EditorUI(app, "Editor/Inspector");
    this.ui.root.addBehavior(this);
    const browser = this.ui.scene.createGameObject("Editor/Inspector/ComponentPicker", 0);
    browser.addBehavior(this.picker);
    this.picker.sceneIndex = this.ui.scene.count() - 1;
  }
  kind(): number { return KIND_UI; }
  typeName(): string { return "Inspector"; }
  snapshot(): void { if (!this.changed) { history.snapshot(); this.changed = true; } }
  visible(y: number, height: number): boolean { return y >= this.top && y + height <= this.bottom; }
  label(key: string, y: number, text: string): void {
    if (!this.visible(y, L.rowH)) return;
    const label = this.ui.control(key, "label", this.x + L.padding, y, this.width - L.padding * 2, L.rowH, text, false);
    this.ui.draw(label);
  }
  header(key: string, y: number, text: string, expanded: boolean): boolean {
    if (!this.visible(y, L.headerH)) return expanded;
    const header = this.ui.control(key, "header", this.x + L.padding, y, this.width - L.padding * 2,
      L.headerH, (expanded ? "v  " : ">  ") + text, this.enabledInput);
    header.fill = UI_C.componentHeader;
    this.ui.draw(header);
    return header.clicked ? !expanded : expanded;
  }
  vector(key: string, y: number, label: string, values: number[]): number[] {
    if (!this.visible(y, L.rowH)) return values;
    this.label(key + "/Label", y, label);
    const colors = [AXIS_X, AXIS_Y, AXIS_Z];
    const valueX = this.x + L.padding + L.labelW;
    const fieldWidth = (this.width - L.padding * 2 - L.labelW - L.axisGap * 2) / 3;
    let axisIndex = 0;
    while (axisIndex < UI_AXIS_NAMES.length) {
      const axis = this.ui.control(key + "/" + UI_AXIS_NAMES[axisIndex], "axis",
        valueX + axisIndex * (fieldWidth + L.axisGap), y, fieldWidth, L.rowH,
        UI_AXIS_NAMES[axisIndex], this.enabledInput);
      axis.color = colors[axisIndex]; axis.value = values[axisIndex];
      this.ui.draw(axis);
      if (axis.value !== values[axisIndex]) { this.snapshot(); values[axisIndex] = axis.value; }
      axisIndex = axisIndex + 1;
    }
    return values;
  }
  render(app: any, x: number, y: number, width: number, height: number,
         mx: number, my: number, down: number, pressed: number, blocked: boolean,
         modelDrag: number, textureDrag: number): void {
    this.ui.begin(mx, my, down, pressed);
    this.x = x; this.width = width; this.changed = false;
    this.meshHot = 0; this.textureHot = 0;
    const selected = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
    if (selected !== this.selectedObject || S.selected !== this.selection) {
      this.scroll = 0; this.contentHeight = 0; this.opened = 0;
      this.selectedObject = selected; this.selection = S.selected;
      nfCancel(); app.setFocus(0 - 1);
    }
    if (blocked) { this.opened = 0; nfCancel(); }
    this.enabledInput = !blocked && this.opened === 0;
    const background = this.ui.control("Background", "panel", x, y, width, height, "", false);
    background.fill = UI_C.panel; this.ui.draw(background);
    const title = this.ui.control("Title", "header", x, y, width, L.headerH, L.title, false);
    title.fill = UI_C.panelHeader; this.ui.draw(title);
    this.top = y + L.headerH + L.objectH;
    this.bottom = y + height - L.footerH;
    if (selected === null) { this.label("Empty", this.top, L.empty); this.label("EmptyHint", this.top + L.rowH, L.emptyHint); return; }
    const object: GameObject = selected;
    const name = this.ui.control("Name", "text", x + L.padding, y + L.headerH + L.gap,
      width - L.padding * 2, L.rowH, "", this.enabledInput);
    name.id = L.nameId; name.textValue = object.name; this.ui.draw(name);
    if (name.textValue !== object.name) { this.snapshot(); object.name = name.textValue; }
    const flagsY = y + L.headerH + L.gap + L.rowH;
    const active = this.ui.control("Active", "toggle", x + L.padding, flagsY, width / 2, L.rowH, L.active, this.enabledInput);
    active.value = object.active; this.ui.draw(active);
    if (active.value !== object.active) { this.snapshot(); object.active = active.value; scene.markCollidersDirty(); }
    const stationary = this.ui.control("Static", "toggle", x + width / 2, flagsY, width / 2 - L.padding, L.rowH, L.stationary, this.enabledInput);
    stationary.value = object.stationary; this.ui.draw(stationary);
    if (stationary.value !== object.stationary) { this.snapshot(); object.stationary = stationary.value; scene.markStaticDirty(); }
    const available = Math.max(0, this.bottom - this.top);
    const maxBefore = Math.max(0, this.contentHeight - available);
    if (this.enabledInput && mx >= x && mx < x + width && my >= this.top && my < this.bottom) {
      const wheel = input.wheel(app._win);
      if (wheel !== 0) { this.scroll = Math.max(0, Math.min(maxBefore, this.scroll - Math.sign(wheel) * UI_INSPECTOR_SCROLL_STEP)); nfCancel(); }
    }
    let rowY = this.top - this.scroll;
    if (object.parent >= 0 && object.parent < scene.objects.length) {
      this.label("Parent/Name", rowY, L.parent + scene.objects[object.parent].name);
      rowY = rowY + L.rowH;
      if (this.visible(rowY, L.rowH)) {
        const unparent = this.ui.control("Parent/Detach", "button", x + L.padding, rowY,
          width - L.padding * 2, L.rowH, L.unparent, this.enabledInput);
        this.ui.draw(unparent);
        if (unparent.clicked) {
          this.snapshot();
          scene.moveSubtree(S.selected, scene.objects.length, 0 - 1);
          S.selected = scene.objects.indexOf(object); S.selection = [S.selected];
        }
      }
      rowY = rowY + L.rowH + L.gap;
    }
    this.transformOpen = this.header("Transform/Header", rowY, L.transform, this.transformOpen);
    rowY = rowY + L.headerH + L.gap;
    if (this.transformOpen) {
      const transform = object.transform;
      const position = this.vector("Transform/Position", rowY, L.position, [transform.px, transform.py, transform.pz]);
      // Mover um ESTATICO invalida o indice espacial estatico (o dinamico segue o transform sozinho).
      if (object.stationary !== 0 && (position[0] !== transform.px || position[1] !== transform.py || position[2] !== transform.pz)) scene.markCollidersDirty();
      transform.px = position[0]; transform.py = position[1]; transform.pz = position[2];
      rowY = rowY + L.rowH;
      const rxDegrees = transform.rx * DEGREES_PER_RADIAN;
      const ryDegrees = transform.ry * DEGREES_PER_RADIAN;
      const rzDegrees = transform.rz * DEGREES_PER_RADIAN;
      const rotation = this.vector("Transform/Rotation", rowY, L.rotation, [rxDegrees, ryDegrees, rzDegrees]);
      if (object.stationary !== 0 && (rotation[0] !== rxDegrees || rotation[1] !== ryDegrees || rotation[2] !== rzDegrees)) scene.markCollidersDirty();
      if (rotation[0] !== rxDegrees) transform.rx = rotation[0] / DEGREES_PER_RADIAN;
      if (rotation[1] !== ryDegrees) transform.ry = rotation[1] / DEGREES_PER_RADIAN;
      if (rotation[2] !== rzDegrees) transform.rz = rotation[2] / DEGREES_PER_RADIAN;
      rowY = rowY + L.rowH;
      const scale = this.vector("Transform/Scale", rowY, L.scale, [transform.sx, transform.sy, transform.sz]);
      if (scale[0] !== transform.sx || scale[1] !== transform.sy || scale[2] !== transform.sz) scene.markCollidersDirty();
      transform.sx = scale[0]; transform.sy = scale[1]; transform.sz = scale[2];
      rowY = rowY + L.rowH + L.gap;
    }
    // Referencias de assets continuam aceitando drop; agora fazem parte do fluxo rolavel.
    if (object.meshKind !== 0 || object.rendIdx >= 0 || object.matIdx >= 0) {
      this.appearanceOpen = this.header("Appearance/Header", rowY, L.appearance, this.appearanceOpen);
      rowY = rowY + L.headerH + L.gap;
      if (this.appearanceOpen) {
        if (this.visible(rowY, L.rowH)) {
          const mesh = this.ui.control("Appearance/Mesh", "asset", x + L.padding, rowY, width - L.padding * 2, L.rowH, L.mesh, this.enabledInput);
          const kind = object.rendIdx >= 0 ? object.behaviors[object.rendIdx].rMeshKind() : object.meshKind;
          mesh.textValue = object.meshPath.length > 0 ? object.meshPath : UI_MESH_NAMES[Math.max(0, Math.min(UI_MESH_NAMES.length - 1, kind))];
          mesh.value = modelDrag; this.ui.draw(mesh); this.meshHot = mesh.hot;
        }
        rowY = rowY + L.rowH;
        if (this.visible(rowY, L.rowH)) {
          const cycle = this.ui.control("Appearance/ChangeMesh", "button", x + L.padding, rowY,
            width - L.padding * 2, L.rowH, L.changeMesh, this.enabledInput);
          this.ui.draw(cycle);
          if (cycle.clicked) {
            this.snapshot();
            const kind = object.rendIdx >= 0 ? object.behaviors[object.rendIdx].rMeshKind() : object.meshKind;
            const nextKind = kind % (UI_MESH_NAMES.length - 1) + 1;
            object.setMesh(nextKind, object.cr, object.cg, object.cb);
            object.customMesh = 0; object.meshPath = ""; object.meshPart = 0;
            if (object.rendIdx >= 0) {
              const renderer: MeshRenderer = object.behaviors[object.rendIdx] as MeshRenderer;
              renderer.meshKind = nextKind; renderer.customMesh = 0;
            }
            scene.markCollidersDirty();
          }
        }
        rowY = rowY + L.rowH;
        if (this.visible(rowY, L.rowH)) {
          const texture = this.ui.control("Appearance/Texture", "asset", x + L.padding, rowY, width - L.padding * 2, L.rowH, L.texture, this.enabledInput);
          texture.textValue = object.matIdx >= 0 ? object.behaviors[object.matIdx].matTexPath() : "";
          texture.value = textureDrag; this.ui.draw(texture); this.textureHot = texture.hot;
        }
        rowY = rowY + L.rowH + L.gap;
      }
    }
    let componentIndex = 0;
    let removeIndex = 0 - 1;
    while (componentIndex < object.behaviors.length) {
      const component = object.behaviors[componentIndex];
      const key = "Components/" + componentIndex;
      const expanded = component.collapsed === 0;
      if (this.visible(rowY, L.headerH)) {
        const heading = this.ui.control(key + "/Header", "header", x + L.padding, rowY,
          width - L.padding * 2 - L.iconW - L.gap, L.headerH,
          (expanded ? "v  " : ">  ") + component.typeName(), this.enabledInput);
        heading.fill = UI_C.componentHeader; this.ui.draw(heading);
        if (heading.clicked) { component.collapsed = expanded ? 1 : 0; nfCancel(); }
        const remove = this.ui.control(key + "/Remove", "button", x + width - L.padding - L.iconW, rowY, L.iconW, L.headerH, "x", this.enabledInput);
        remove.color = UI_C.destructiveText; this.ui.draw(remove);
        if (remove.clicked) removeIndex = componentIndex;
      }
      rowY = rowY + L.headerH + L.gap;
      if (component.collapsed === 0) {
        if (this.visible(rowY, L.rowH)) {
          const enabled = this.ui.control(key + "/Enabled", "toggle", x + L.padding + L.gap, rowY,
            width - L.padding * 2, L.rowH, L.active, this.enabledInput);
          enabled.value = component.enabled; this.ui.draw(enabled);
          if (enabled.value !== component.enabled) { this.snapshot(); component.enabled = enabled.value; scene.markCollidersDirty(); }
        }
        rowY = rowY + L.rowH;
        let fieldIndex = 0;
        while (fieldIndex < component.fieldCount()) {
          if (this.visible(rowY, L.rowH)) {
            const fieldType = component.fieldType(fieldIndex);
            const field = this.ui.control(key + "/Field/" + fieldIndex, fieldType === "boolean" ? "toggle" : fieldType === "string" ? "propertyText" : "number",
              x + L.padding + L.gap, rowY, width - L.padding * 2 - L.gap, L.rowH, component.fieldLabel(fieldIndex), this.enabledInput);
            if (fieldType === "string") {
              const before = component.fieldStringGet(fieldIndex);
              field.textValue = before; this.ui.draw(field);
              if (field.textValue !== before) { this.snapshot(); component.fieldStringSet(fieldIndex, field.textValue); }
            } else {
              const before = component.fieldGet(fieldIndex);
              field.value = before; this.ui.draw(field);
              if (field.value !== before) { this.snapshot(); component.fieldSet(fieldIndex, field.value); scene.markCollidersDirty(); }
            }
          }
          rowY = rowY + L.rowH;
          fieldIndex = fieldIndex + 1;
        }
        rowY = rowY + L.gap;
      }
      componentIndex = componentIndex + 1;
    }
    if (object.behaviors.length === 0) { this.label("NoComponents", rowY, L.noComponents); rowY = rowY + L.rowH; }
    if (removeIndex >= 0) { this.snapshot(); object.removeBehavior(removeIndex); scene.markCollidersDirty(); nfCancel(); }
    this.contentHeight = rowY + this.scroll - this.top;
    const maxScroll = Math.max(0, this.contentHeight - available);
    this.scroll = Math.min(this.scroll, maxScroll);
    if (maxScroll > 0 && available > L.minThumbH) {
      const thumbH = Math.max(L.minThumbH, available * available / this.contentHeight);
      if (this.enabledInput && pressed !== 0 && mx >= x + width - L.scrollbarHitW && mx < x + width && my >= this.top && my < this.bottom) this.scrollbarDrag = true;
      if (down === 0 || !this.enabledInput) this.scrollbarDrag = false;
      if (this.scrollbarDrag) { this.scroll = Math.max(0, Math.min(maxScroll, (my - this.top - thumbH / 2) / (available - thumbH) * maxScroll)); nfCancel(); }
      const scrollbar = this.ui.control("Scrollbar", "panel", x + width - L.scrollbarW,
        this.top + (available - thumbH) * this.scroll / maxScroll, L.scrollbarW, thumbH, "", false);
      scrollbar.fill = UI_C.scrollbarThumb; this.ui.draw(scrollbar);
    }
    const footer = this.ui.control("Footer", "panel", x, this.bottom, width, L.footerH, "", false);
    footer.fill = UI_C.panelHeader; this.ui.draw(footer);
    const add = this.ui.control("AddComponent", "button", x + L.padding, this.bottom + L.gap,
      width - L.padding * 2, L.rowH, "+ " + P.title, !blocked);
    this.ui.draw(add);
    if (add.clicked) { this.opened = this.opened === 0 ? 1 : 0; nfCancel(); if (this.opened !== 0) this.picker.begin(app); else app.setFocus(0 - 1); }
    if (this.opened !== 0) {
      const chosen = this.picker.render(this.ui.scene, app, x + L.padding, this.bottom - L.gap,
        width - L.padding * 2, y + L.headerH, mx, my,
        add.clicked || (mx >= x && my >= this.bottom) ? 0 : pressed, input.wheel(app._win));
      if (chosen.length > 0) {
        this.snapshot();
        const added = attachEditorComponent(S.selected, chosen);
        this.scroll = Math.max(0, this.contentHeight + L.headerH + (added.fieldCount() + 1) * L.rowH + L.gap * 2 - available);
      }
      if (chosen.length > 0 || this.picker.closed) { this.opened = 0; app.setFocus(0 - 1); }
    }
    this.ui.end();
  }
}

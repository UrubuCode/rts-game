import { Behavior, KIND_UI } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { editorPreferences } from "./preferences";
import { UI_CODE_EDITOR as L, UI_C } from "./ui_config";
import { CodeEditorChoice, installedCodeEditors, sameEditorPath } from "./code_editors";
import { chooseEditorExecutable, ExecutableSelection } from "./executable_picker";
import fs from "@compat/fs";

export class PreferencesPanel extends Behavior {
  ui: EditorUI;
  value: string = "";
  choices: CodeEditorChoice[] = [];
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/Preferences"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  typeName(): string { return "PreferencesPanel"; }
  open(): void { this.value = editorPreferences.codeEditor; editorPreferences.error = ""; this.choices = installedCodeEditors(); }
  select(index: number): void {
    if (index < 0 || index >= this.choices.length) return;
    this.value = this.choices[index].path; editorPreferences.error = "";
  }
  acceptSelection(result: ExecutableSelection): void {
    if (result.error.length > 0) { editorPreferences.error = result.error; return; }
    if (result.path.length === 0) return;
    if (!result.path.toLowerCase().endsWith(".exe") || !fs.exists(result.path) || fs.is_dir(result.path)) {
      editorPreferences.error = "Selecione um executavel .exe existente."; return;
    }
    this.value = result.path; editorPreferences.error = "";
  }
  render(width: number, height: number, mx: number, my: number, down: number, pressed: number): boolean {
    this.ui.begin(mx, my, down, pressed);
    const w = Math.min(L.width, width - L.padding * 2);
    const listRows = 1 + Math.max(1, this.choices.length);
    const listHeight = listRows * (L.rowH + L.listGap);
    const panelHeight = L.height + listHeight;
    const x = (width - w) / 2; const y = (height - panelHeight) / 2;
    const panel = this.ui.control("Panel", "panel", x, y, w, panelHeight, "", false);
    panel.fill = UI_C.helpBackground; this.ui.draw(panel);
    const title = this.ui.control("Title", "label", x + L.padding, y + L.padding, w - L.padding * 2, L.rowH, L.title, false);
    this.ui.draw(title);
    const installed = this.ui.control("InstalledLabel", "label", x + L.padding, y + L.labelY, w - L.padding * 2, L.rowH, L.installed, false);
    this.ui.draw(installed);
    const system = this.ui.control("System", "button", x + L.padding, y + L.listY, w - L.padding * 2, L.rowH, (this.value.length === 0 ? L.selected : "") + L.system);
    if (this.value.length === 0) system.fill = UI_C.controlActive;
    this.ui.draw(system);
    if (system.clicked) { this.value = ""; editorPreferences.error = ""; }
    let index = 0;
    let known = this.value.length === 0;
    while (index < this.choices.length) {
      const choice = this.choices[index];
      const active = sameEditorPath(this.value, choice.path);
      if (active) known = true;
      const button = this.ui.control("Editor/" + choice.name, "button", x + L.padding,
        y + L.listY + (index + 1) * (L.rowH + L.listGap), w - L.padding * 2, L.rowH,
        (active ? L.selected : "") + choice.name);
      if (active) button.fill = UI_C.controlActive;
      this.ui.draw(button);
      if (button.clicked) { this.select(index); this.ui.app.setFocus(0 - 1); }
      index = index + 1;
    }
    if (this.choices.length === 0) {
      const empty = this.ui.control("Empty", "label", x + L.padding, y + L.listY + L.rowH + L.listGap, w - L.padding * 2, L.rowH, L.empty, false);
      this.ui.draw(empty);
    }
    const contentY = y + listHeight;
    const label = this.ui.control("PathLabel", "label", x + L.padding, contentY + L.listY, w - L.padding * 2, L.rowH, known ? L.pathLabel : L.custom + " - " + L.pathLabel, false);
    this.ui.draw(label);
    const fieldY = contentY + L.listY + L.rowH + L.listGap;
    const field = this.ui.control("Path", "text", x + L.padding, fieldY, w - L.padding * 2 - L.buttonW - L.gap, L.rowH, "");
    field.id = L.fieldId; field.textValue = this.value; this.ui.draw(field); this.value = field.textValue;
    const browse = this.ui.control("Browse", "button", x + w - L.padding - L.buttonW, fieldY, L.buttonW, L.rowH, L.browse);
    this.ui.draw(browse);
    if (browse.clicked) {
      this.ui.app.setFocus(0 - 1);
      this.acceptSelection(chooseEditorExecutable());
      this.ui.end();
      return false;
    }
    const hint = this.ui.control("Hint", "label", x + L.padding, fieldY + L.rowH + L.listGap, w - L.padding * 2, L.rowH, L.hint, false);
    this.ui.draw(hint);
    const status = this.ui.control("Status", "label", x + L.padding, fieldY + (L.rowH + L.listGap) * 2, w - L.padding * 2, L.rowH, editorPreferences.error, false);
    status.color = UI_C.destructiveText; this.ui.draw(status);
    const buttonsY = y + panelHeight - L.padding - L.rowH;
    const save = this.ui.control("Save", "button", x + w - L.padding - L.buttonW * 2 - L.gap, buttonsY, L.buttonW, L.rowH, L.save);
    this.ui.draw(save);
    const cancel = this.ui.control("Cancel", "button", x + w - L.padding - L.buttonW, buttonsY, L.buttonW, L.rowH, L.cancel);
    this.ui.draw(cancel);
    const closed = cancel.clicked || this.ui.app.keyPressed(2) !== 0 || (save.clicked && editorPreferences.save(this.value));
    if (closed) this.ui.app.setFocus(0 - 1);
    this.ui.end();
    return closed;
  }
}

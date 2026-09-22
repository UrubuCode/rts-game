import io from "@compat/io";
import fs from "@compat/fs";
import { detectCodeEditors, installedCodeEditors, sameEditorPath } from "@editor/code_editors";
import { PreferencesPanel } from "@editor/preferences_panel";
import { editorPreferences } from "@editor/preferences";
import { executableSelection } from "@editor/executable_picker";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
// Isolated fixtures are filenames only, never executed.
const root = "build/editor-selector-test";
fs.create_dir_all(root + "/local/Programs/Microsoft VS Code");
fs.create_dir_all(root + "/system/Microsoft VS Code");
fs.create_dir_all(root + "/system/Cursor");
fs.create_dir_all(root + "/system/Notepad++/notepad++.exe");
const code = root + "/local/Programs/Microsoft VS Code/Code.exe";
fs.write(code, "fixture");
fs.write(root + "/system/Microsoft VS Code/Code.exe", "fixture");
fs.write(root + "/system/Cursor/Cursor.exe", "fixture");
const found = detectCodeEditors(root + "/local", root + "/system", "");
check(found.length === 2, "only existing files detected; duplicate installs and directories excluded");
check(found[0].name === "Visual Studio Code" && found[0].path === code, "user install preferred");
check(found[1].name === "Cursor", "system install discovered");
check(detectCodeEditors("", "", "").length === 0, "missing environment does not probe relative directories");
check(sameEditorPath("C:\\Apps\\Code.exe", "c:/apps/code.exe"), "Windows path comparison");

class App {
  _win: number = 0; clicked: number = -1; focus: number = -1;
  clickable(id: number, x: number, y: number, w: number, h: number): number {
    if (id !== this.clicked) return 0;
    this.clicked = -1; return 3;
  }
  textField(id: number, x: number, y: number, w: number, value: string, enabled: boolean): string { return value; }
  box(x: number, y: number, w: number, h: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
  keyPressed(key: number): number { return 0; }
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
}
const app = new App(); const panel = new PreferencesPanel(app);
panel.open(); panel.choices = found;
const original = editorPreferences.codeEditor;
panel.render(1200, 720, 0, 0, 0, 0);
const count = panel.ui.scene.count();
app.clicked = panel.ui.controls[panel.ui.names.indexOf("Editor/Visual Studio Code")].id;
panel.render(1200, 720, 0, 0, 0, 0);
check(panel.value === code, "click selects editor without typing a path");
check(editorPreferences.codeEditor === original, "selection does not persist before Save");
check(panel.ui.scene.count() === count, "selector reuses GameObjects across frames");
panel.acceptSelection(executableSelection(0, ""));
check(panel.value === code, "native picker cancellation preserves choice");
panel.acceptSelection(executableSelection(1, ""));
check(panel.value === code && editorPreferences.error.length > 0, "picker failure preserves choice and shows error");
panel.acceptSelection(executableSelection(0, "assets/scripts/MotionSettings.ts"));
check(panel.value === code, "non-executable rejected");
panel.acceptSelection(executableSelection(0, "C:/Windows/System32/notepad.exe"));
check(panel.value === "C:/Windows/System32/notepad.exe", "custom existing executable accepted");
app.clicked = panel.ui.controls[panel.ui.names.indexOf("System")].id;
panel.render(1200, 720, 0, 0, 0, 0);
check(panel.value === "", "system default can be selected");
app.clicked = panel.ui.controls[panel.ui.names.indexOf("Cancel")].id;
check(panel.render(1200, 720, 0, 0, 0, 0), "Cancel closes preferences");
check(editorPreferences.codeEditor === original, "Cancel leaves stored preference intact");
panel.choices = []; panel.render(1200, 720, 0, 0, 0, 0);
check(panel.ui.names.indexOf("Empty") >= 0 && panel.ui.names.indexOf("Browse") >= 0, "empty discovery still offers Browse");
const actual = installedCodeEditors();
let index = 0;
while (index < actual.length) { io.print("[detectado] " + actual[index].name); index = index + 1; }
io.print("[PASSOU] Code editor selector: discovery, GameObjects, selection, cancellation and custom paths");

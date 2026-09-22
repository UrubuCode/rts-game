import io from "@compat/io";
import fs from "@compat/fs";
import { EditorPreferences, editorPreferences } from "@editor/preferences";
import { ScriptEditor } from "@editor/script_editor";

function check(ok: boolean, message: string): void { if (!ok) throw new Error(message); }
fs.create_dir_all("build/preferences-test");
const file = "build/preferences-test/settings.json";
fs.write(file, "{}");
const settings = new EditorPreferences(file); settings.load();
check(settings.codeEditor === "", "default uses OS association");
check(!settings.save("C:/missing/editor.exe"), "missing executable rejected");
check(!settings.save("assets/scripts/MotionSettings.ts"), "script is not an editor executable");
const executable = "C:/Windows/System32/notepad.exe";
check(settings.save('"' + executable + '"'), "valid quoted executable accepted");
const restored = new EditorPreferences(file); restored.load();
check(restored.codeEditor === executable, "preference persists on reopen");
check(!restored.save("C:/missing/editor.exe") && restored.codeEditor === executable, "invalid save preserves preference");
check(restored.save("  ") && restored.codeEditor === "", "blank restores system association");
fs.write(file, "not json"); restored.load();
check(restored.error.length > 0, "malformed preferences do not crash editor");
const original = editorPreferences.codeEditor;
editorPreferences.codeEditor = "C:/missing/editor.exe";
const opener = new ScriptEditor(); opener.open("assets/scripts/MotionSettings.ts");
check(opener.message.indexOf("Editor nao encontrado") >= 0, "removed editor reports actionable error");
editorPreferences.codeEditor = original;
io.print("[PASSOU] Editor preferences: defaults, validation, persistence, reset and failure handling");

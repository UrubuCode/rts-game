import { spawn } from "node:child_process";
import { resolve } from "node:path";
import fs from "@compat/fs";
import { editorPreferences } from "./preferences";

// A literal PowerShell string: spaces, apostrophes, $, &, etc. remain filename data.
export function scriptOpenCommand(path: string): string {
  return "Invoke-Item -LiteralPath '" + path.split("'").join("''") + "' -ErrorAction Stop";
}

export class ScriptEditor {
  message: string = "";
  open(path: string, line: number = 0): void {
    if (!fs.exists(path) || fs.is_dir(path)) { this.message = "Script nao encontrado: " + path; return; }
    this.message = "Abrir script: use Abrir com no Windows para escolher o editor .ts.";
    try {
      if (editorPreferences.codeEditor.length > 0) {
        if (!fs.exists(editorPreferences.codeEditor) || fs.is_dir(editorPreferences.codeEditor)) {
          this.message = "Editor nao encontrado. Confira Configuracoes > Editor de codigo.";
          return;
        }
        const args = scriptEditorArguments(editorPreferences.codeEditor, resolve(path), line);
        const editor = spawn(editorPreferences.codeEditor, args, { stdio: "ignore" });
        editor.unref();
        this.message = "Abertura solicitada ao editor de codigo configurado.";
        return;
      }
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", scriptOpenCommand(resolve(path))], { stdio: "ignore" });
      child.unref();
    } catch { this.message = "Nao foi possivel abrir o editor de codigo."; }
  }
}

export function scriptEditorArguments(editor: string, path: string, line: number): string[] {
  const name = editor.split("\\").join("/").split("/").pop().toLowerCase();
  if (line > 0 && (name === "code.exe" || name === "code - insiders.exe" || name === "cursor.exe" || name === "windsurf.exe" || name === "antigravity.exe")) return ["--goto", path + ":" + Math.floor(line)];
  if (line > 0 && name === "notepad++.exe") return ["-n" + Math.floor(line), path];
  if (line > 0 && name === "sublime_text.exe") return [path + ":" + Math.floor(line)];
  return [path];
}

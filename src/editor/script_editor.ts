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
  open(path: string): void {
    if (!fs.exists(path) || fs.is_dir(path)) { this.message = "Script nao encontrado: " + path; return; }
    this.message = "Abrir script: use Abrir com no Windows para escolher o editor .ts.";
    try {
      if (editorPreferences.codeEditor.length > 0) {
        if (!fs.exists(editorPreferences.codeEditor) || fs.is_dir(editorPreferences.codeEditor)) {
          this.message = "Editor nao encontrado. Confira Configuracoes > Editor de codigo.";
          return;
        }
        const editor = spawn(editorPreferences.codeEditor, [resolve(path)], { stdio: "ignore" });
        editor.unref();
        this.message = "Abertura solicitada ao editor de codigo configurado.";
        return;
      }
      const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", scriptOpenCommand(resolve(path))], { stdio: "ignore" });
      child.unref();
    } catch { this.message = "Nao foi possivel abrir o editor de codigo."; }
  }
}

import fs from "@compat/fs";

export const EDITOR_PREFERENCES_FILE = ".rts-editor.local.json";

export class EditorPreferences {
  codeEditor: string = "";
  error: string = "";
  file: string;
  constructor(file: string = EDITOR_PREFERENCES_FILE) { this.file = file; }
  load(): void {
    this.error = "";
    if (!fs.exists(this.file)) return;
    try {
      const data = JSON.parse(fs.read_text(this.file));
      if (data !== null && typeof data.codeEditor === "string") this.codeEditor = data.codeEditor;
    } catch { this.error = "Nao foi possivel ler as preferencias locais."; }
  }
  save(value: string): boolean {
    let path = value.trim();
    if (path.length > 1 && path.charAt(0) === '"' && path.charAt(path.length - 1) === '"') path = path.slice(1, path.length - 1);
    if (path.length > 0 && (!path.toLowerCase().endsWith(".exe") || !fs.exists(path) || fs.is_dir(path))) {
      this.error = "Informe o caminho de um editor .exe existente, ou deixe vazio.";
      return false;
    }
    try { fs.write(this.file, JSON.stringify({ codeEditor: path })); }
    catch { this.error = "Nao foi possivel salvar as preferencias locais."; return false; }
    this.codeEditor = path; this.error = "";
    return true;
  }
}

export const editorPreferences = new EditorPreferences();
editorPreferences.load();

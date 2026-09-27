import fs from "@compat/fs";

export const EDITOR_PREFERENCES_FILE = ".rts-editor.local.json";

export class EditorPreferences {
  codeEditor: string = "";
  /// Calibração de latência de áudio (Janela/Calibrar latência de áudio,
  /// `audio calibrar`), em ms — local por projeto/máquina, como `codeEditor`;
  /// nunca na cena (não é dado do jogo, é do MONITOR/placa de som de quem
  /// está editando). Espelha `Audio.latenciaCalibrada`.
  audioLatenciaMs: number = 0.0;
  error: string = "";
  file: string;
  constructor(file: string = EDITOR_PREFERENCES_FILE) { this.file = file; }
  load(): void {
    this.error = "";
    if (!fs.exists(this.file)) return;
    try {
      const data = JSON.parse(fs.read_text(this.file));
      if (data !== null && typeof data.codeEditor === "string") this.codeEditor = data.codeEditor;
      if (data !== null && typeof data.audioLatenciaMs === "number") this.audioLatenciaMs = data.audioLatenciaMs;
    } catch { this.error = "Nao foi possivel ler as preferencias locais."; }
  }
  private escrever(): boolean {
    try { fs.write(this.file, JSON.stringify({ codeEditor: this.codeEditor, audioLatenciaMs: this.audioLatenciaMs })); }
    catch { this.error = "Nao foi possivel salvar as preferencias locais."; return false; }
    this.error = "";
    return true;
  }
  save(value: string): boolean {
    let path = value.trim();
    if (path.length > 1 && path.charAt(0) === '"' && path.charAt(path.length - 1) === '"') path = path.slice(1, path.length - 1);
    if (path.length > 0 && (!path.toLowerCase().endsWith(".exe") || !fs.exists(path) || fs.is_dir(path))) {
      this.error = "Informe o caminho de um editor .exe existente, ou deixe vazio.";
      return false;
    }
    const antes = this.codeEditor;
    this.codeEditor = path;
    if (!this.escrever()) { this.codeEditor = antes; return false; }
    return true;
  }
  /// Salva só a calibração de áudio (o painel de calibração não mexe no
  /// editor de código, e vice-versa).
  saveAudioLatenciaMs(ms: number): boolean {
    const antes = this.audioLatenciaMs;
    this.audioLatenciaMs = ms;
    if (!this.escrever()) { this.audioLatenciaMs = antes; return false; }
    return true;
  }
}

export const editorPreferences = new EditorPreferences();
editorPreferences.load();

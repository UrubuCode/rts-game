// Configuração do USUÁRIO do jogo exportado (não do projeto/editor): fica ao
// lado do `.exe` distribuído, em `config/usuario.json` — o mesmo modelo que
// `assets/`/`scenes/` já usam ("ao lado do executável", `game.ts`), sem
// depender de uma pasta de dados do SO (`%APPDATA%`/`~/.config`, que este
// codebase ainda não tem um helper pra resolver — ver o relatório do brief
// de relógio de áudio). Por máquina/instalação, nunca no JSON da cena.
//
// Hoje só guarda `audioLatenciaMs` (a calibração de latência de áudio —
// `CalibradorLatencia`, `engine/audio/calibrador_latencia.ts`), carregada no
// boot do jogo (`game.ts`) ANTES do áudio começar e aplicada em
// `Audio.latenciaCalibrada`. Cresce aqui, não num arquivo por feature.
import fs from "@compat/fs.ts";
import { logError } from "@engine/core/logger";

export const CONFIG_USUARIO_ARQUIVO: string = "config/usuario.json";

function pastaDe(caminho: string): string {
  const norm = caminho.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.substring(0, i) : "";
}

export class ConfigUsuario {
  audioLatenciaMs: f64 = 0.0;
  error: string = "";
  file: string;
  constructor(file: string = CONFIG_USUARIO_ARQUIVO) { this.file = file; }
  carregar(): void {
    this.error = "";
    if (!fs.exists(this.file)) return;
    try {
      const data = JSON.parse(fs.read_text(this.file));
      if (data !== null && typeof data.audioLatenciaMs === "number") this.audioLatenciaMs = data.audioLatenciaMs;
    } catch (e) { this.error = "Nao foi possivel ler a configuracao do usuario: " + String(e); }
  }
  /// Escreve E CONFERE de verdade (o nativo pode falhar a I/O sem lançar —
  /// mesmo padrão de `import_assets.ts`): relê o arquivo e compara o
  /// conteúdo. Falha não muda `audioLatenciaMs` (o valor em memória continua
  /// o de antes) e vai pro Console, além de `this.error` pro chamador.
  salvarAudioLatenciaMs(ms: f64): boolean {
    const pasta = pastaDe(this.file);
    if (pasta !== "") fs.create_dir_all(pasta);
    const conteudo = JSON.stringify({ audioLatenciaMs: ms });
    try {
      fs.write(this.file, conteudo);
      if (!fs.exists(this.file) || fs.read_text(this.file) !== conteudo) {
        this.error = "Nao foi possivel salvar a configuracao do usuario (escrita nao confirmada).";
        logError("ConfigUsuario: " + this.error);
        return false;
      }
    } catch (e) {
      this.error = "Nao foi possivel salvar a configuracao do usuario: " + String(e);
      logError("ConfigUsuario: " + this.error);
      return false;
    }
    this.audioLatenciaMs = ms;
    this.error = "";
    return true;
  }
}

/// A instância do JOGO em execução — `game.ts` chama `configUsuario.carregar()`
/// e aplica em `Audio.latenciaCalibrada` no boot, antes de `initAudio()`.
export const configUsuario = new ConfigUsuario();

// Janela/Calibrar latência de áudio: UI FINA sobre `CalibradorLatencia`
// (`engine/audio/calibrador_latencia.ts` — a matemática/agendamento vivem lá,
// reaproveitáveis por um jogo exportado que queira a própria tela de
// calibrar). Este painel só desenha, lê Enter como o toque, e decide ONDE
// persistir: preferências do EDITOR (`.rts-editor.local.json`, projeto/local
// — CLAUDE.md: não é dado do jogo), ao contrário de `CalibradorLatencia.
// salvar()` (que grava na config do JOGO, `config_usuario.ts`).
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { editorPreferences } from "./preferences";
import { UI_CALIBRAR_AUDIO as L, UI_C, UI_PICKER_KEYS } from "./ui_config";
import { Audio } from "@engine/audio/audio_system";
import { toneClip, FORMA_SENO } from "@engine/audio/clip";
import { CalibradorLatencia } from "@engine/audio/calibrador_latencia";

const CALIB_CLIQUE_HZ: f64 = 1200.0;
const CALIB_CLIQUE_DUR: f64 = 0.05;

export class CalibrarLatenciaPanel extends Behavior {
  ui: EditorUI;
  calibrador: CalibradorLatencia;
  constructor(app: any) {
    super();
    this.ui = new EditorUI(app, "Editor/CalibrarLatencia");
    this.ui.root.addBehavior(this);
    this.calibrador = new CalibradorLatencia(L.intervaloMs / 1000.0, L.batidasAlvo);
  }
  kind(): number { return KIND_UI; }
  typeName(): string { return "CalibrarLatenciaPanel"; }
  open(): void { this.calibrador.parar(); }
  private salvar(): boolean {
    const r = this.calibrador.resultado();
    if (r !== r) return false; // NaN: nada medido ainda
    Audio.latenciaCalibrada = r;
    return editorPreferences.saveAudioLatenciaMs(r);
  }
  inMx: number = 0; inMy: number = 0; inDown: number = 0; inPressed: number = 0;
  mouse(mx: number, my: number, down: number, pressed: number): void {
    this.inMx = mx; this.inMy = my; this.inDown = down; this.inPressed = pressed;
  }
  private statusTexto(): string {
    if (this.calibrador.rodando) return L.medindo + this.calibrador.progresso() + L.de + L.batidasAlvo + L.fechaParen;
    return L.aguardando;
  }
  private resultadoTexto(): string {
    const r = this.calibrador.resultado();
    if (r === r) return L.resultado + r.toFixed(1) + L.ms;
    return L.atual + editorPreferences.audioLatenciaMs.toFixed(1) + L.ms;
  }
  render(width: number, height: number): boolean {
    if (this.calibrador.rodando && this.ui.app.keyPressed(UI_PICKER_KEYS.enter) !== 0) this.calibrador.toque();
    this.ui.begin(this.inMx, this.inMy, this.inDown, this.inPressed);
    const w = Math.min(L.width, width - L.padding * 2);
    const x = (width - w) / 2; const y = (height - L.height) / 2;
    this.ui.at(x, y, w, L.height);
    const panel = this.ui.control("Panel", "panel", "", false);
    panel.fill = UI_C.helpBackground; this.ui.draw(panel);
    this.ui.at(x + L.padding, y + L.padding, w - L.padding * 2, L.rowH);
    const title = this.ui.control("Title", "label", L.title, false);
    this.ui.draw(title);
    this.ui.at(x + L.padding, y + L.labelY, w - L.padding * 2, L.rowH);
    const instr = this.ui.control("Instr", "label", L.instrucoes + L.batidasAlvo + L.taps, false);
    this.ui.draw(instr);
    this.ui.at(x + L.padding, y + L.statusY, w - L.padding * 2, L.rowH);
    const status = this.ui.control("Status", "label", this.statusTexto(), false);
    this.ui.draw(status);
    this.ui.at(x + L.padding, y + L.resultY, w - L.padding * 2, L.rowH);
    const resultado = this.ui.control("Resultado", "label", this.resultadoTexto(), false);
    this.ui.draw(resultado);
    const buttonsY = y + L.height - L.padding - L.rowH;
    this.ui.at(x + L.padding, buttonsY, L.buttonW, L.rowH);
    const startStop = this.ui.control("StartStop", "button", this.calibrador.rodando ? L.stop : L.start);
    this.ui.draw(startStop);
    if (startStop.clicked) {
      if (this.calibrador.rodando) this.calibrador.parar();
      else this.calibrador.iniciar(toneClip(CALIB_CLIQUE_HZ, CALIB_CLIQUE_DUR, FORMA_SENO));
    }
    this.ui.at(x + L.padding + L.buttonW + L.gap, buttonsY, L.buttonW, L.rowH);
    const save = this.ui.control("Save", "button", L.save);
    this.ui.draw(save);
    if (save.clicked) this.salvar();
    this.ui.at(x + w - L.padding - L.buttonW, buttonsY, L.buttonW, L.rowH);
    const cancel = this.ui.control("Cancel", "button", L.cancel);
    this.ui.draw(cancel);
    const closed = cancel.clicked || this.ui.app.keyPressed(UI_PICKER_KEYS.escape) !== 0;
    if (closed) { this.calibrador.parar(); this.ui.app.setFocus(0 - 1); }
    this.ui.end();
    return closed;
  }
}

// Janela/Calibrar latência de áudio: mede o atraso entre o clique agendado
// (`Audio.agendarEm`, sample-accurate — a 1ª amostra do clique fica audível
// EXATAMENTE no `tempoDsp` pedido) e a tecla que a pessoa aperta na batida.
// A mediana dos offsets é o `Audio.latenciaCalibrada` daqui pra frente —
// soma dispositivo + percepção, sem tentar separar os dois (não dá, sem
// microfone: ver `audio escuta` pra essa outra pergunta).
//
// `offsetMaisProximo`/`medianaMs` são funções PURAS (sem UI): o teste sem
// janela (`tests/test_audio_relogio.ts`) cobre a matemática direto, sem abrir
// a janela real.
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { editorPreferences } from "./preferences";
import { UI_CALIBRAR_AUDIO as L, UI_C, UI_PICKER_KEYS } from "./ui_config";
import { Audio } from "@engine/audio/audio_system";
import { toneClip, FORMA_SENO } from "@engine/audio/clip";

const CALIB_CLIQUE_HZ: f64 = 1200.0;
const CALIB_CLIQUE_DUR: f64 = 0.05;
const CALIB_CLIQUE_GANHO: f64 = 0.3;

/// O beat agendado mais PRÓXIMO de `tapTempoDsp` (podem faltar batidas: a
/// pessoa erra o Enter, ou aperta cedo/tarde demais) — `primeiroBeat` e
/// `intervaloSeg` descrevem a grade toda (spec: clique a cada 500 ms).
/// Devolve `tapTempoDsp − beat` (positivo: a tecla veio DEPOIS do clique).
export function offsetMaisProximo(tapTempoDsp: f64, primeiroBeat: f64, intervaloSeg: f64): f64 {
  const n = Math.round((tapTempoDsp - primeiroBeat) / intervaloSeg);
  const beat = primeiroBeat + n * intervaloSeg;
  return tapTempoDsp - beat;
}
/// Mediana (não a média: robusta a UM toque perdido/duplo) dos offsets em
/// SEGUNDOS, em ms. Lista vazia devolve 0 (nenhuma medição ainda).
export function medianaMs(offsetsSeg: f64[]): f64 {
  const n = offsetsSeg.length;
  if (n === 0) return 0.0;
  const copia = offsetsSeg.slice();
  copia.sort((a: f64, b: f64) => a - b);
  const meio = Math.floor(n / 2);
  const medSeg: f64 = n % 2 === 1 ? copia[meio] : (copia[meio - 1] + copia[meio]) / 2.0;
  return medSeg * 1000.0;
}

export class CalibrarLatenciaPanel extends Behavior {
  ui: EditorUI;
  rodando: boolean = false;
  primeiroBeat: f64 = 0.0;
  proximoBeat: f64 = 0.0;
  beatsAgendados: number = 0;
  offsets: f64[] = [];
  resultadoMs: f64 = 0.0 / 0.0; // NaN: sem resultado ainda
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/CalibrarLatencia"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  typeName(): string { return "CalibrarLatenciaPanel"; }
  open(): void { this.parar(); this.resultadoMs = 0.0 / 0.0; }
  private iniciar(): void {
    this.rodando = true;
    this.offsets = [];
    this.resultadoMs = 0.0 / 0.0;
    // 1ª batida daqui a 1 s (dá tempo de a pessoa se preparar): agendada já
    // AQUI (sample-accurate), não recalculada frame a frame.
    this.primeiroBeat = Audio.tempoDsp() + 1.0;
    this.proximoBeat = this.primeiroBeat;
    this.beatsAgendados = 0;
    this.agendarProximosCliques();
  }
  private parar(): void { this.rodando = false; }
  /// Agenda TODAS as `batidasAlvo` de uma vez (a régua inteira já é
  /// conhecida — `primeiroBeat + i·intervalo` — sem precisar reagendar por
  /// quadro; `Audio.agendarEm` aceita alvo no futuro).
  private agendarProximosCliques(): void {
    const clip = toneClip(CALIB_CLIQUE_HZ, CALIB_CLIQUE_DUR, FORMA_SENO);
    let i = this.beatsAgendados;
    while (i < L.batidasAlvo) {
      Audio.agendarEm(clip, this.primeiroBeat + i * (L.intervaloMs / 1000.0));
      i = i + 1;
    }
    this.beatsAgendados = L.batidasAlvo;
  }
  /// Uma tecla (Enter) chegou NA batida: registra o offset contra a grade e,
  /// ao completar `batidasAlvo`, crava a mediana.
  private registrarToque(): void {
    if (!this.rodando) return;
    const tempo = Audio.tempoDsp();
    this.offsets.push(offsetMaisProximo(tempo, this.primeiroBeat, L.intervaloMs / 1000.0));
    if (this.offsets.length >= L.batidasAlvo) {
      this.resultadoMs = medianaMs(this.offsets);
      this.rodando = false;
    }
  }
  private salvar(): boolean {
    if (this.resultadoMs !== this.resultadoMs) return false; // NaN: nada medido ainda
    Audio.latenciaCalibrada = this.resultadoMs;
    return editorPreferences.saveAudioLatenciaMs(this.resultadoMs);
  }
  inMx: number = 0; inMy: number = 0; inDown: number = 0; inPressed: number = 0;
  mouse(mx: number, my: number, down: number, pressed: number): void {
    this.inMx = mx; this.inMy = my; this.inDown = down; this.inPressed = pressed;
  }
  private statusTexto(): string {
    if (this.rodando) return L.medindo + this.offsets.length + L.de + L.batidasAlvo + L.fechaParen;
    return L.aguardando;
  }
  private resultadoTexto(): string {
    if (this.resultadoMs === this.resultadoMs) return L.resultado + this.resultadoMs.toFixed(1) + L.ms;
    return L.atual + editorPreferences.audioLatenciaMs.toFixed(1) + L.ms;
  }
  render(width: number, height: number): boolean {
    if (this.rodando && this.ui.app.keyPressed(UI_PICKER_KEYS.enter) !== 0) this.registrarToque();
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
    const startStop = this.ui.control("StartStop", "button", this.rodando ? L.stop : L.start);
    this.ui.draw(startStop);
    if (startStop.clicked) { if (this.rodando) this.parar(); else this.iniciar(); }
    this.ui.at(x + L.padding + L.buttonW + L.gap, buttonsY, L.buttonW, L.rowH);
    const save = this.ui.control("Save", "button", L.save);
    this.ui.draw(save);
    if (save.clicked) this.salvar();
    this.ui.at(x + w - L.padding - L.buttonW, buttonsY, L.buttonW, L.rowH);
    const cancel = this.ui.control("Cancel", "button", L.cancel);
    this.ui.draw(cancel);
    const closed = cancel.clicked || this.ui.app.keyPressed(UI_PICKER_KEYS.escape) !== 0;
    if (closed) { this.parar(); this.ui.app.setFocus(0 - 1); }
    this.ui.end();
    return closed;
  }
}

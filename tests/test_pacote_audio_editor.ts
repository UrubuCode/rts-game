// Teste SEM JANELA do lado de editor do pacote audio/: Criar/Áudio/*, aviso
// de segundo ouvinte, gizmos (ícone; esferas min/max só selecionado e 3D),
// prévia do AudioSource pelo Inspector e Janela/Mixer (mudo pelo toggle).
//   $RTS run tests/test_pacote_audio_editor.ts
import io from "@compat/io.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin, GIZMO_SEGMENTOS_CIRCULO } from "@engine/core/gizmos";
import { Inspector } from "@editor/inspector";
import { EditorControl } from "@editor/ui_controls";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import type { Behavior } from "@engine/core/behavior";
import { logEntries, LOG_INFO } from "@engine/core/logger";
import { AudioSource } from "@scripts/audiosource";
import { AudioListener } from "@engine/core/audio_listener";
import { initAudio, AUDIO_NULO, previaTocando, pararPrevia } from "@engine/audio/audio";
import { mixerPadrao, grupoMudo, GRUPO_MASTER } from "@engine/audio/mixer_grupos";
import { AVISO_OUVINTE_EXISTE } from "../assets/pacotes/audio/audio_editor";
import { UI_ICONS } from "@editor/ui_config";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
initAudio(AUDIO_NULO);
mixerPadrao();
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
check(UI_ICONS.names.indexOf("audio-fonte") >= 0 && UI_ICONS.names.indexOf("audio-ouvinte") >= 0, "ícones registrados");

// ── Criar/Áudio/* ───────────────────────────────────────────────────────────
S.camX = 0.0; S.camY = 0.0; S.camZ = 0.0; S.camYaw = 0.0; S.camPitch = 0.0;
check(executarItemDeMenu(indiceDoCaminho("Criar/Áudio/Fonte"), 0 - 1) === "", "Criar/Áudio/Fonte");
const fonteGo = scene.objects[S.selected];
const fonte = fonteGo.behaviors[0] as AudioSource;
check(fonteGo.name === "Fonte de áudio" && fonteGo.transform.pz === 8.0 && fonte instanceof AudioSource, "fonte nasce à frente da vista");
const dicas0 = logEntries(LOG_INFO, "AudioListener").length;
check(executarItemDeMenu(indiceDoCaminho("Criar/Áudio/Ouvinte"), 0 - 1) === "", "Criar/Áudio/Ouvinte");
check(scene.objects[S.selected].behaviors[0] instanceof AudioListener && logEntries(LOG_INFO, "AudioListener").length === dicas0, "primeiro ouvinte: sem aviso");
check(executarItemDeMenu(indiceDoCaminho("Criar/Áudio/Ouvinte"), 0 - 1) === "", "segundo ouvinte");
check(logEntries(LOG_INFO, "AudioListener").length === dicas0 + 1 && AVISO_OUVINTE_EXISTE.indexOf("AudioListener") >= 0, "segundo ouvinte: avisa no Console");

// ── gizmos ──────────────────────────────────────────────────────────────────
scene.computeWorld();
const gp = new Float64Array(8); gp[2] = 0.0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc === 3 && gizmosDoEditor.nSeg === 0, "três ícones (fonte e dois ouvintes), sem esferas sem seleção");
check(gizmosDoEditor.icNomes.indexOf("audio-fonte") >= 0 && gizmosDoEditor.icNomes.indexOf("audio-ouvinte") >= 0, "ícones de fonte e ouvinte");
const iFonte = scene.objects.indexOf(fonteGo);
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, iFonte);
check(gizmosDoEditor.nSeg === 0, "fonte 2D selecionada: só o ícone");
fonte.spatialBlend = 1.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, iFonte);
// A esfera de minDistance (raio 1) cabe toda à frente da câmera do gizmo (3
// círculos completos = 3 * GIZMO_SEGMENTOS_CIRCULO). A de maxDistance (raio
// padrão 500, câmera a só 28 unidades) envolve a própria câmera: parte dela
// fica atrás do plano near e o projetor (gizmos.ts) descarta esses segmentos
// (ambas as pontas precisam projetar) — comportamento correto do desenho, não
// bug do pacote. 120 é a contagem estável (verificada rodando o pipeline real).
check(gizmosDoEditor.nSeg === 3 * GIZMO_SEGMENTOS_CIRCULO + 48, "fonte 3D selecionada: esferas de min e max (a de max parcialmente atrás da câmera do gizmo)");

// ── Inspector: prévia e Janela/Mixer ────────────────────────────────────────
class TestApp {
  _win: number = 0; focus: number = -1; clickId: number = -1;
  /// Rótulo do toggle a inverter neste quadro (o mock de checkbox não recebe
  /// o id do controle, só x/y/valor/rótulo — mesmo padrão de test_inspector_gui.ts).
  checkRotulo: string = "";
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  at(x: number, y: number, w: number, h: number): void {}
  textField(id: number, value: string, enabled: boolean): string { return value; }
  clickableAt(id: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return label === this.checkRotulo ? 1 - value : value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
}
const app = new TestApp();
const inspector = new Inspector(app);
const host = instalarEditorReal();
host.janela = (b: Behavior, titulo: string) => { inspector.abrirJanela(b, titulo); };
function render(): void { inspector.area(0, 0, 290, 4000); inspector.mouse(-1, -1, 0, 0); inspector.render(app, false, 0, 0); }
function controle(prefixo: string): EditorControl | null {
  // Prefere um rótulo IGUAL (ex.: botão "Tocar") a um prefixo mais longo que
  // por acaso comece igual (ex.: o campo "Tocar ao iniciar"); só cai para o
  // primeiro que bate por prefixo quando não há igualdade exata.
  let porPrefixo: EditorControl | null = null;
  let i = 0;
  while (i < inspector.ui.controls.length) {
    const l = inspector.ui.controls[i].label;
    if (l === prefixo) return inspector.ui.controls[i];
    if (porPrefixo === null && l.indexOf(prefixo) === 0) porPrefixo = inspector.ui.controls[i];
    i = i + 1;
  }
  return porPrefixo;
}
function clicar(c: EditorControl | null): void {
  check(c !== null, "controle existe");
  const ctrl = c as EditorControl;
  if (ctrl.mode === "toggle") { app.checkRotulo = ctrl.label; render(); app.checkRotulo = ""; render(); }
  else { app.clickId = ctrl.id; render(); app.clickId = -1; render(); }
}

S.selected = iFonte; S.selection = [iFonte];
render();
const d = history.undoDepth();
clicar(controle("Tocar"));
check(previaTocando() === 1 && history.undoDepth() === d, "Tocar: prévia fora do Play, sem Desfazer (botão não é alteração do componente)");
check(controle("Sem clipe: toca o tom gerado.") !== null, "linha de informação do clipe");
clicar(controle("Parar"));
check(previaTocando() === 0, "Parar");
pararPrevia();

check(executarItemDeMenu(indiceDoCaminho("Janela/Mixer"), 0 - 1) === "", "Janela/Mixer");
render();
check(inspector.janela !== null && controle("Master — volume") !== null && controle("Música — pico") !== null, "janela do Mixer com os grupos");
clicar(controle("Master — mudo"));
check(grupoMudo(GRUPO_MASTER) === 1, "o toggle muta o Master");
check(controle("Salvar mixer") !== null && controle("Reverter") !== null, "Salvar e Reverter");
S.selected = iFonte + 1; S.selection = [iFonte + 1]; render();
check(inspector.janela === null, "trocar a seleção (para o ouvinte) fecha a janela");
io.print("[PASSOU] pacote audio (editor): Criar/Áudio, aviso de ouvinte, gizmos, prévia no Inspector, Janela/Mixer");

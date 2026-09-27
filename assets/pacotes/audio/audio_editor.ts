/** @editorOnly */
// Pacote áudio (editor): gizmos do AudioSource (ícone; esferas de min/max
// quando selecionado e 3D) e do AudioListener, os itens Criar/Áudio/* e a
// janela Janela/Mixer no Inspector. Tudo pela API pública (@editor/api).
// O mixer é arquivo de PROJETO: a janela edita em memória e tem Salvar e
// Reverter (não entra no Desfazer da cena).
import { Editor, registerGizmo, Gizmos } from "@editor/api";
import { Behavior, AUDIO_PAPEL_OUVINTE } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { GameObject, activeInScene } from "@engine/core/gameobject";
import { AudioSource } from "@scripts/audiosource";
import { AudioListener } from "@engine/core/audio_listener";
import { mixerNGrupos, grupoNome, grupoVolume, grupoMudo, grupoPausa, mixerSetVolume, mixerSetMudo, mixerSetPausa,
         mixerVersao, mixerAlterado, salvarMixer, carregarMixer, MIXER_ARQUIVO, MAX_GRUPOS } from "@engine/audio/mixer_grupos";
import { audioPicoGrupo } from "@engine/audio/audio";

const ICONE_FONTE: string = "audio-fonte";
const ICONE_OUVINTE: string = "audio-ouvinte";
/// Cores dos gizmos (0xRRGGBB, como o `cor` da Light): mínimo mais forte que o máximo.
const COR_GIZMO_MIN: number = 0x8FD19E;
const COR_GIZMO_MAX: number = 0x4E7F59;
const NOME_FONTE: string = "Fonte de áudio";
const NOME_OUVINTE: string = "Ouvinte de áudio";
export const AVISO_OUVINTE_EXISTE: string = "Áudio: a cena já tem um AudioListener ativo; só o primeiro vale (desligue um deles).";
const TITULO_MIXER: string = "Mixer";
export const ROTULO_VOLUME_SUFIXO: string = " — volume";
export const ROTULO_MUDO_SUFIXO: string = " — mudo";
export const ROTULO_PAUSA_SUFIXO: string = " — pausa";
export const ROTULO_PICO_SUFIXO: string = " — pico";
const ROTULO_SALVAR: string = "Salvar mixer";
const ROTULO_REVERTER: string = "Reverter";
const ROTULO_SALVO: string = "Mixer salvo em " + MIXER_ARQUIVO;
const ROTULO_NAO_SALVO: string = "Mixer com alterações não salvas";

const gzPos = new Float64Array(3);
/// `spawnPoint` escreve pose completa (posição + yaw/pitch): precisa de 5, não 3.
const menuPonto = new Float64Array(5);

function desenharFonte(g: Gizmos, dono: GameObject, comp: Behavior): void {
  const s = comp as AudioSource;
  gzPos[0] = dono.transform.wx; gzPos[1] = dono.transform.wy; gzPos[2] = dono.transform.wz;
  g.color(COR_GIZMO_MIN);
  g.icon(ICONE_FONTE, gzPos);
  if (g.selecionado && s.spatialBlend > 0.0) {
    g.wireSphere(gzPos, s.minDistance);
    g.color(COR_GIZMO_MAX);
    g.wireSphere(gzPos, s.maxDistance);
  }
}
function desenharOuvinte(g: Gizmos, dono: GameObject, comp: Behavior): void {
  gzPos[0] = dono.transform.wx; gzPos[1] = dono.transform.wy; gzPos[2] = dono.transform.wz;
  g.color(COR_GIZMO_MIN);
  g.icon(ICONE_OUVINTE, gzPos);
}
registerGizmo("AudioSource", desenharFonte);
registerGizmo("AudioListener", desenharOuvinte);

function haOuvinteAtivo(): boolean {
  const sc = Editor.scene();
  if (sc === null) return false;
  let i = 0;
  while (i < sc.audioObjs.length) {
    const o = sc.audioObjs[i];
    if (activeInScene(sc.objects, o)) {
      let k = 0;
      while (k < o.behaviors.length) { const b = o.behaviors[k]; if (b.enabled !== 0 && b.audioPapel() === AUDIO_PAPEL_OUVINTE) return true; k = k + 1; }
    }
    i = i + 1;
  }
  return false;
}
function criarAudio(ouvinte: boolean): void {
  const sc = Editor.scene();
  if (sc === null) return;
  const avisar = ouvinte && haOuvinteAtivo();
  const o = sc.createGameObject(ouvinte ? NOME_OUVINTE : NOME_FONTE);
  Editor.spawnPoint(menuPonto);
  o.transform.setPosition(menuPonto[0], menuPonto[1], menuPonto[2]);
  if (ouvinte) o.addBehavior(new AudioListener()); else o.addBehavior(new AudioSource());
  if (avisar) Editor.log(AVISO_OUVINTE_EXISTE);
}
export class AudioMenu {
  /** @menuItem Criar/Áudio/Fonte */
  static fonte(): void { criarAudio(false); }
  /** @menuItem Criar/Áudio/Ouvinte */
  static ouvinte(): void { criarAudio(true); }
}

/**
 * Janela do Mixer (não é componente de cena).
 * @componentIgnore
 */
export class MixerInspector extends Behavior {
  /// Rótulos por grupo, refeitos só quando o mixer muda (nada de string por quadro).
  private rotVolume: string[] = [];
  private rotMudo: string[] = [];
  private rotPausa: string[] = [];
  private rotPico: string[] = [];
  private rotulosDe: number = 0 - 1;
  constructor() { super(); this.collapsed = 0; }
  typeName(): string { return TITULO_MIXER; }
  private rotulos(): void {
    const v = mixerVersao();
    if (v === this.rotulosDe) return;
    this.rotulosDe = v;
    this.rotVolume.length = 0; this.rotMudo.length = 0; this.rotPausa.length = 0; this.rotPico.length = 0;
    let g = 0;
    while (g < mixerNGrupos()) {
      const n = grupoNome(g);
      this.rotVolume.push(n + ROTULO_VOLUME_SUFIXO); this.rotMudo.push(n + ROTULO_MUDO_SUFIXO);
      this.rotPausa.push(n + ROTULO_PAUSA_SUFIXO); this.rotPico.push(n + ROTULO_PICO_SUFIXO);
      g = g + 1;
    }
  }
  onInspectorGUI(ui: InspectorUI): void {
    this.rotulos();
    ui.label(mixerAlterado() !== 0 ? ROTULO_NAO_SALVO : ROTULO_SALVO);
    let g = 0;
    while (g < mixerNGrupos() && g < MAX_GRUPOS) {
      const vol = grupoVolume(g);
      const nv = ui.slider(this.rotVolume[g], vol, 0.0, 1.0);
      if (nv !== vol) mixerSetVolume(g, nv);
      const mudo = grupoMudo(g) !== 0;
      if (ui.toggle(this.rotMudo[g], mudo) !== mudo) mixerSetMudo(g, mudo ? 0 : 1);
      const pausa = grupoPausa(g) !== 0;
      if (ui.toggle(this.rotPausa[g], pausa) !== pausa) mixerSetPausa(g, pausa ? 0 : 1);
      // medidor: a barra mostra o pico estimado do último bloco; arrastar não muda nada
      ui.slider(this.rotPico[g], audioPicoGrupo(g), 0.0, 1.0);
      g = g + 1;
    }
    if (ui.button(ROTULO_SALVAR)) { const e = salvarMixer(MIXER_ARQUIVO); Editor.log(e === "" ? ROTULO_SALVO : e); }
    if (ui.button(ROTULO_REVERTER)) { const e = carregarMixer(MIXER_ARQUIVO); if (e !== "") Editor.log(e); }
  }
}

let janelaMixerInst: MixerInspector | null = null;
/// Criada na primeira abertura, nunca no carregamento do módulo (regra do RTS
/// sobre instâncias de topo com métodos que leem nomes de módulo).
function janelaMixer(): MixerInspector {
  if (janelaMixerInst === null) janelaMixerInst = new MixerInspector();
  return janelaMixerInst as MixerInspector;
}
export class JanelaMixer {
  /** @menuItem Janela/Mixer */
  static abrir(): void { Editor.inspect(janelaMixer(), TITULO_MIXER); }
}

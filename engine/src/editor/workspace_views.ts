import { Behavior, KIND_UI } from "@engine/core/behavior";
import { Camera } from "@engine/core/camera";
import type { GameObject } from "@engine/core/gameobject";
import { EditorUI } from "./ui_controls";
import { scene, S } from "./control/session";
import { UI_WORKSPACE as L, UI_GAME_VIEW as G, UI_C } from "./ui_config";

export class WorkspaceViews extends Behavior {
  ui: EditorUI; game: boolean = false; console: boolean = false;
  x: number = 0; y: number = 0; z: number = 0; yaw: number = 0; pitch: number = 0; fov: number = 0;
  /// Escrito pelo main.ts: a aba Jogo desenhou ao menos uma câmera neste frame.
  hasCamera: boolean = false;
  /// Rótulos dos seletores, montados uma vez (proporção) ou só quando a câmera muda.
  rotulosProporcao: string[] = [];
  rotuloCamera: string = "";
  rotuloCameraDe: string = "";
  /// Chaves das abas, montadas uma vez.
  chavesAba: string[] = []; chavesBaixo: string[] = [];
  constructor(app: any) {
    super(); this.ui = new EditorUI(app, "Editor/WorkspaceTabs"); this.ui.root.addBehavior(this);
    let i = 0;
    while (i < L.tabs.length) { this.chavesAba.push(L.tabKey + i); this.chavesBaixo.push(L.bottomTabKey + i); i = i + 1; }
    i = 0;
    while (i < G.aspectLabels.length) { this.rotulosProporcao.push(G.aspectPrefix + G.aspectLabels[i]); i = i + 1; }
    this.rotuloCamera = G.cameraPrefix + G.cameraAll; this.rotuloCameraDe = G.cameraAll;
  }
  kind(): number { return KIND_UI; }
  /// Câmera da vista de Cena (a do editor). A aba Jogo usa as câmeras da cena (main.ts).
  camera(defaultFov: number): void {
    this.x = S.camX; this.y = S.camY; this.z = S.camZ; this.yaw = S.camYaw; this.pitch = S.camPitch; this.fov = defaultFov;
  }
  /// Câmera única escolhida na aba Jogo (S.gameCamera), ou null = todas. Um
  /// objeto que saiu da cena ou deixou de ter Camera volta a "todas".
  cameraEscolhida(): Camera | null {
    let c: Camera | null = null;
    const go = S.gameCamera;
    if (go !== null && go.uiOwner === scene && go.camIdx >= 0) c = go.behaviors[go.camIdx] as Camera;
    else S.gameCamera = null;
    return c;
  }
  /// Todas → 1ª câmera (por profundidade) → … → última → Todas.
  proximaCamera(): void {
    const lista = Camera.all();
    const atual = this.cameraEscolhida();
    let k = atual === null ? 0 - 1 : lista.indexOf(atual);
    k = k + 1;
    S.gameCamera = k < lista.length ? lista[k].owner : null;
  }
  /// "Câmera: <nome>" refeito só quando o nome muda.
  textoCamera(): string {
    const c = this.cameraEscolhida();
    const nome = c === null ? G.cameraAll : (c.owner as GameObject).name;
    if (nome !== this.rotuloCameraDe) { this.rotuloCameraDe = nome; this.rotuloCamera = G.cameraPrefix + nome; }
    return this.rotuloCamera;
  }
  tabs(x: number, top: number, bottom: number, blocked: boolean): void {
    this.ui.begin(0, 0, 0, 0);
    let i = 0;
    while (i < L.tabs.length) {
      this.ui.at(x + L.padding + i * (L.tabW + L.gap), top, L.tabW, L.tabH);
      const tab = this.ui.control(this.chavesAba[i], "button", L.tabs[i], !blocked);
      if (this.game === (i === 1)) tab.fill = UI_C.controlActive;
      this.ui.draw(tab);
      if (tab.clicked) { this.game = i === 1; S.gameView = this.game ? 1 : 0; this.ui.app.setFocus(-1); }
      this.ui.at(x + L.padding + i * (L.tabW + L.gap), bottom, L.tabW, L.tabH);
      const bottomTab = this.ui.control(this.chavesBaixo[i], "button", L.bottomTabs[i], !blocked);
      if (this.console === (i === 1)) bottomTab.fill = UI_C.controlActive;
      this.ui.draw(bottomTab); if (bottomTab.clicked) { this.console = i === 1; this.ui.app.setFocus(-1); }
      i = i + 1;
    }
    if (this.game) {
      const ax = x + L.padding + L.tabs.length * (L.tabW + L.gap) + L.gap;
      this.ui.at(ax, top, G.aspectW, L.tabH);
      const aspecto = this.ui.control(G.aspectKey, "button", this.rotulosProporcao[S.gameAspect], !blocked);
      this.ui.draw(aspecto);
      if (aspecto.clicked) { S.gameAspect = (S.gameAspect + 1) % G.aspectLabels.length; this.ui.app.setFocus(-1); }
      this.ui.at(ax + G.aspectW + L.gap, top, G.cameraW, L.tabH);
      const cam = this.ui.control(G.cameraKey, "button", this.textoCamera(), !blocked);
      this.ui.draw(cam);
      if (cam.clicked) { this.proximaCamera(); this.ui.app.setFocus(-1); }
    }
    this.ui.end();
  }
}

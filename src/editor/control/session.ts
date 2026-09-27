// Estado mutável COMPARTILHADO do editor — um singleton que main + comandos usam.
import type { AnimationPlayer } from "@engine/core/animation_player";
import type { Animator } from "@engine/core/animator";
import type { GameObject } from "@engine/core/gameobject";
export class Session {
  camX: f64; camY: f64; camZ: f64; camYaw: f64; camPitch: f64;
  selected: number; playing: number;
  simulating: number; // sessao Play ativa, inclusive quando pausada
  /// Primeira linha visível da hierarquia + quantas cabem. Vivem aqui, e não só
  /// no main.ts, para que o controle por WebSocket possa INSPECIONAR e mover o
  /// scroll — é como se verifica que ele funciona sem tirar screenshot.
  hierScroll: number; hierVis: number;
  selection: number[];   // multi-seleção (índices); vazio = usa só `selected`. O gizmo aplica em todos.
  wsServer: number; wsClient: number;
  drawnLast: number;
  fpsLast: number;      // FPS do último frame — exposto no ws `dbg` pra medir performance sem screenshot
  win: number;        // handle da janela egui (pra comandos que sobem mesh/textura)
  tool: number;       // ferramenta de manipulação: 0=seleção, 1=Move, 2=Rotate, 3=Scale
  snap: number;       // 1 = snap to grid no gizmo (move 0.5, rotate 15°)
  lightX: f64; lightY: f64; lightZ: f64; lightAmb: f64;   // luz PONTUAL (posição) + ambiente
  selectedBone: number;   // osso selecionado no Inspector do Skeleton (-1 = nenhum)
  /// Objeto dono de `selectedBone` (GameObject): se o selecionado deixa de ser
  /// ele, o osso não vale mais (ver bone_gizmo.selectedBoneTarget).
  selectedBoneOwner: any;
  /// PRÉVIA de animação do Inspector fora do Play (estado do editor: não vai
  /// para a cena salva nem para o undo). Ver skeleton_preview.ts.
  previewPlayers: AnimationPlayer[];   // tocando agora
  previewTouched: AnimationPlayer[];   // pose de trabalho mexida pela prévia (inclui os tocando)
  /// Animators em prévia fora do Play (parâmetro mexido pelo Inspector/WS):
  /// avançam a cada frame até a prévia ser encerrada. Ver skeleton_preview.ts.
  previewAnimators: Animator[];
  /// Aba Jogo (estado do editor, sem Desfazer; ws `gameview`): 1 = aba Jogo
  /// ativa; índice da proporção em UI_GAME_VIEW; 1 = prévia da câmera
  /// selecionada na vista de Cena.
  gameView: number; gameAspect: number; cameraPreview: number;
  /// Objeto da câmera única da aba Jogo (null = todas). Referência, não
  /// índice: apagar ou reordenar objetos não troca a câmera escolhida.
  gameCamera: GameObject | null;
  /// Retângulo (x, y, w, h, pixels lógicos) da vista de Cena/Jogo no último
  /// quadro: o recorte de `shot jogo`. Escrito pelo main.ts 1x por quadro.
  areaVista: Float64Array;
  constructor() {
    this.camX = 0.0; this.camY = 11.0; this.camZ = -15.0;
    this.camYaw = 0.0; this.camPitch = 0 - 0.5;
    this.selected = 0; this.playing = 0; this.simulating = 0;
    this.hierScroll = 0; this.hierVis = 0;
    this.selection = [];
    this.wsServer = 0; this.wsClient = 0;
    this.drawnLast = 0;
    this.fpsLast = 0;
    this.win = 0;
    this.tool = 1;   // Move por padrão
    this.snap = 0;
    this.lightX = 7.0; this.lightY = 13.0; this.lightZ = 5.0; this.lightAmb = 0.28;
    this.selectedBone = 0 - 1;
    this.selectedBoneOwner = null;
    this.previewPlayers = [];
    this.previewTouched = [];
    this.previewAnimators = [];
    this.gameView = 0; this.gameAspect = 0; this.gameCamera = null; this.cameraPreview = 0;
    this.areaVista = new Float64Array(4);
  }
}
export const S = new Session();

// cena compartilhada (singleton) — main + comandos operam nela
import { Scene } from "@engine/core/scene";
import { setActiveScene } from "@engine/core/active_scene";
export const scene = new Scene("Main");
setActiveScene(scene);

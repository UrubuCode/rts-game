import { Behavior, KIND_UI, FALHA_GUI } from "@engine/core/behavior";
import { registrarExcecao } from "@engine/core/falhas";
import { logError } from "@engine/core/logger";
import { GameObject } from "@engine/core/gameobject";
import { EditorUI } from "./ui_controls";
import { MeshRenderer } from "@engine/core/meshrenderer";
import { pararPrevia } from "@engine/audio/audio";
import { Skeleton } from "@engine/core/skeleton";
import { previewIsPlaying, previewStart, previewPause, previewStop, previewStopAll, previewSeek, previewChooseClip,
  timelineTarget, animationPlayerOf, skeletonOfObject, animatorOfObject, animatorPreviewTouch, animatorPreviewIsActive,
  animatorPreviewStop } from "./skeleton_preview";
import type { Animator } from "@engine/core/animator";
import { PARAM_FLOAT, PARAM_BOOL } from "@engine/core/animator_controller";
import { ComponentPicker } from "./component_picker";
import { ObjectFieldPicker, OBJECT_FIELD_NONE } from "./object_field_picker";
import { InspectorGUIEditor } from "./inspector_gui";
import { beginBoneEdit, boneDegreesInto, boneRotationFromDegreesInto, selectBone } from "./bone_gizmo";
import { attachEditorComponent } from "./script_drop";
import { history } from "./undo";
import { scene, S } from "./control/session";
import { nfCancel, AXIS_X, AXIS_Y, AXIS_Z } from "./widgets";
import { assetsPing } from "./assets";
import input from "@compat/input";
import { UI_C, UI_INSPECTOR as L, UI_COMPONENT_PICKER as P, UI_PICKER_KEYS as PK, UI_AXIS_NAMES,
  UI_MESH_NAMES, UI_INSPECTOR_SCROLL_STEP, UI_SKELETON as K, UI_ANIMATOR as A } from "./ui_config";

const DEGREES_PER_RADIAN = 180 / Math.PI;
/// Progresso do fade (0..1) mostrado em porcentagem na seção Animator.
const FADE_PERCENT = 100;
/// Escala do tempo mostrado (10^casas): o rótulo da camada só é refeito
/// quando o valor ARREDONDADO muda.
const ANIMATOR_TIME_SCALE = Math.pow(10, A.timeDigits);

// Painel do editor: GameObject raiz + controles filhos em uma UIScene propria.
// Nenhum desses objetos entra na cena editada ou no arquivo do jogo.
export class Inspector extends Behavior {
  ui: EditorUI;
  /// `onInspectorGUI(ui)` de cada componente desenha por aqui (controles da mesma UIScene).
  gui: InspectorGUIEditor;
  picker: ComponentPicker = new ComponentPicker();
  scroll: number = 0;
  contentHeight: number = 0;
  selection: number = 0 - 1;
  selectedObject: any = null;
  opened: number = 0;
  transformOpen: boolean = true;
  appearanceOpen: boolean = true;
  skeletonOpen: boolean = true;
  // Rótulos da seção "Esqueleto", refeitos só quando o modelo (asset) muda ou,
  // na barra de tempo, quando tempo/duração mudam — não a cada frame.
  skeletonLabelsAsset: any = null;
  bonesTitle: string = "";
  clipLabels: string[] = [];
  /// Componente cujo onInspectorGUI está rodando agora (null fora dele): se o
  /// script lançar, `renderProtegido` sabe quem passa aos campos automáticos.
  guiEmCurso: Behavior | null = null;
  timelineLabel: string = "";
  timelineTime: f64 = 0 - 1;
  timelineDuration: f64 = 0 - 1;
  // Rótulo "Osso: <nome>" refeito só quando o osso/modelo muda; graus e
  // quaternion do osso em buffers fixos (sem alocar por frame).
  boneLabel: string = "";
  boneLabelBone: number = 0 - 1;
  boneLabelAsset: any = null;
  boneQuat: Float64Array = new Float64Array(4);
  // Graus mostrados nos campos de rotação do osso. Enquanto o quaternion do
  // osso é o que estes graus produziram (`boneShownQ`, mesmo osso/Skeleton),
  // os campos mostram os graus DIGITADOS em vez de decompor de novo — perto de
  // pitch ±90° a decomposição salta de ramo e o valor pularia sob o cursor.
  boneDegrees: Float64Array = new Float64Array(3);
  boneShownQ: Float64Array = new Float64Array(4);
  boneShownSkeleton: any = null;
  boneShownBone: number = 0 - 1;
  // Valores passados aos campos (reaproveitados: sem array novo por frame).
  boneRotationValues: number[] = [0, 0, 0];
  bonePositionValues: number[] = [0, 0, 0];
  // Seção "Animator": rótulos refeitos só quando o que mostram muda (caminho
  // do controlador; estado/tempo/fade de cada camada).
  animatorOpen: boolean = true;
  animatorControllerShown: string = "";
  animatorControllerLabel: string = "";
  animatorLayerLabels: string[] = [];
  animatorLayerStates: string[] = [];
  animatorLayerTimes: number[] = [];
  animatorLayerFades: number[] = [];
  meshHot: number = 0;
  textureHot: number = 0;
  // ── ObjectField (item 2 do brief de áudio-arquivos) ─────────────────────────
  /// Seletor "Selecionar <Tipo>" (⊙): mesmo padrão do ComponentPicker.
  objPicker: ObjectFieldPicker = new ObjectFieldPicker();
  objOpened: number = 0;
  /// Componente/índice do campo do ObjectField cujo seletor está aberto agora.
  objPickerComp: Behavior | null = null;
  objPickerIndex: number = 0 - 1;
  /// Estilo do próximo objectFieldRow (setter — Task 10.5: ≤4 parâmetros).
  objTipo: string = ""; objExts: string[] = []; objIcon: string = "";
  /// Componente/índice do campo SOB O CURSOR neste quadro (0 = nenhum), para o
  /// drop de um tile do Project (o main lê `objectHot()`/chama `dropObjectField`).
  objHotComp: Behavior | null = null;
  objHotIndex: number = 0 - 1;
  /// Campo com FOCO (último clique): Delete/Backspace o limpa (Nenhum).
  objFocusComp: Behavior | null = null;
  objFocusIndex: number = 0 - 1;
  objFocusId: number = 0 - 1;
  /// Estado de arraste do quadro (setter `drag`): 0 nada, senão `objDragOk`
  /// distingue um tile COMPATÍVEL (realce verde) de outro tipo (realce de recusa).
  objDragOn: number = 0; objDragOk: number = 0;
  /// "<nome sem extensão> (<Tipo>)"/"Nenhum (<Tipo>)" por chave de controle,
  /// refeito só quando o valor do campo muda (Task 10.5: sem concatenar por quadro).
  objLabelValor: Map<string, string> = new Map<string, string>();
  objLabelTexto: Map<string, string> = new Map<string, string>();
  /// Chave do botão ⊙ ("<campo>/Pick"), criada uma vez por chave de campo —
  /// Task 10.5: nada de concatenar string por quadro.
  objPickKeyCache: Map<string, string> = new Map<string, string>();
  /// 1 no quadro em que um clique no campo pediu um ping no Project (o main
  /// troca a aba do painel de Console pra Project quando isto acontece).
  pinged: boolean = false;
  top: number = 0; bottom: number = 0;
  areaX: number = 0; areaY: number = 0; areaW: number = 0; areaH: number = 0;
  inMx: number = 0; inMy: number = 0; inDown: number = 0; inPressed: number = 0;
  x: number = 0; width: number = 0;
  enabledInput: boolean = true;
  scrollbarDrag: boolean = false;
  changed: boolean = false;
  /// Janela de pacote aberta por Editor.inspect (null = o objeto selecionado).
  janela: GameObject | null = null;
  janelaSel: number = 0 - 1;
  janelaTitulo: string = "";
  /// "Janela: <título>", refeito só quando o título muda.
  janelaNome: string = "";
  janelaNomeDe: string = "";
  /// Chaves por componente (ver chavesDe): índices em compChave… para o objeto
  /// selecionado e para a janela.
  compSel: number[] = []; compJanela: number[] = [];
  compChave: string[] = []; compHeader: string[] = []; compRemove: string[] = []; compEnabled: string[] = [];
  compTitulo: string[] = []; compTituloDe: string[] = []; compTituloAberto: boolean[] = [];
  // Chaves e rótulos derivados, criados uma vez (Task 10.5: sem concatenar por quadro).
  /// "v  Texto"/">  Texto" de cada cabeçalho fixo (texto → rótulo).
  cabecalhoAberto: Map<string, string> = new Map<string, string>();
  cabecalhoFechado: Map<string, string> = new Map<string, string>();
  /// Chaves de `vector`: índice de `key` → [key/Label, key/<eixo0>, key/<eixo1>, key/<eixo2>].
  vetorIndice: Map<string, number> = new Map<string, number>();
  vetorChaves: string[][] = []; vetorNomes: string[][] = [];
  /// Chaves `key/Field/<i>` por `key` de componente.
  campoIndice: Map<string, number> = new Map<string, number>();
  campoChaves: string[][] = [];
  /// Valores passados a `vector` pelo Transform (reaproveitados).
  posValores: number[] = [0, 0, 0]; rotValores: number[] = [0, 0, 0]; escValores: number[] = [0, 0, 0];
  /// Rótulo "Pai: <nome>", refeito só quando o nome do pai muda.
  paiRotulo: string = ""; paiDe: string = "";
  addRotulo: string = "+ " + P.title;
  /// Chaves "<prefixo><i>" de osso, clipe, parâmetro e camada, criadas uma vez.
  chavesOsso: string[] = []; chavesClipe: string[] = []; chavesParam: string[] = []; chavesCamada: string[] = [];

  constructor(app: any) {
    super();
    this.ui = new EditorUI(app, "Editor/Inspector");
    this.gui = new InspectorGUIEditor(this);
    this.ui.root.addBehavior(this);
    const browser = this.ui.scene.createGameObject("Editor/Inspector/ComponentPicker", 0);
    browser.addBehavior(this.picker);
    this.picker.sceneIndex = this.ui.scene.count() - 1;
    const objBrowser = this.ui.scene.createGameObject("Editor/Inspector/ObjectFieldPicker", 0);
    objBrowser.addBehavior(this.objPicker);
    this.objPicker.sceneIndex = this.ui.scene.count() - 1;
  }
  kind(): number { return KIND_UI; }
  typeName(): string { return "Inspector"; }
  snapshot(): void { if (!this.changed) { history.snapshot(); this.changed = true; } }
  visible(y: number, height: number): boolean { return y >= this.top && y + height <= this.bottom; }
  label(key: string, y: number, text: string): void {
    if (!this.visible(y, L.rowH)) return;
    this.ui.at(this.x + L.padding, y, this.width - L.padding * 2, L.rowH);
    const label = this.ui.control(key, "label", text, false);
    this.ui.draw(label);
  }
  /// "v  texto" ou ">  texto", criado uma vez por texto.
  rotuloCabecalho(text: string, expanded: boolean): string {
    const mapa = expanded ? this.cabecalhoAberto : this.cabecalhoFechado;
    const achado = mapa.get(text);
    if (achado !== undefined) return achado;
    const novo = (expanded ? L.expandedMark : L.collapsedMark) + text;
    mapa.set(text, novo);
    return novo;
  }
  /// `lista[i]`, criando `prefixo + i` na primeira vez (sem string nova por quadro).
  chaveLista(lista: string[], prefixo: string, i: number): string {
    while (lista.length <= i) lista.push(prefixo + lista.length);
    return lista[i];
  }
  /// Chave `key/Field/<i>`, criada uma vez.
  chaveCampo(key: string, i: number): string {
    let k = this.campoIndice.get(key);
    if (k === undefined) { k = this.campoChaves.length; this.campoChaves.push([]); this.campoIndice.set(key, k); }
    const lista = this.campoChaves[k];
    while (lista.length <= i) lista.push(key + L.fieldKey + lista.length);
    return lista[i];
  }
  /// Chaves de `vector(key)` para os eixos `names`: [Label, eixo0, eixo1, eixo2], criadas uma vez.
  chavesVetor(key: string, names: string[]): string[] {
    const achado = this.vetorIndice.get(key);
    if (achado !== undefined && this.vetorNomes[achado] === names) return this.vetorChaves[achado];
    const chaves: string[] = [key + L.labelKey];
    let i = 0;
    while (i < names.length) { chaves.push(key + "/" + names[i]); i = i + 1; }
    if (achado !== undefined) { this.vetorChaves[achado] = chaves; this.vetorNomes[achado] = names; }
    else { this.vetorIndice.set(key, this.vetorChaves.length); this.vetorChaves.push(chaves); this.vetorNomes.push(names); }
    return chaves;
  }
  header(key: string, y: number, text: string, expanded: boolean): boolean {
    if (!this.visible(y, L.headerH)) return expanded;
    this.ui.at(this.x + L.padding, y, this.width - L.padding * 2, L.headerH);
    const header = this.ui.control(key, "header", this.rotuloCabecalho(text, expanded), this.enabledInput);
    header.fill = UI_C.componentHeader;
    this.ui.draw(header);
    return header.clicked ? !expanded : expanded;
  }
  /// Linha automática do campo `fieldIndex` (número, caixa ou texto), chave
  /// `key + "/Field/" + fieldIndex`. Usada pela lista automática e por `ui.field(nome)`.
  fieldRow(component: Behavior, key: string, fieldIndex: number, rowY: number): void {
    const fieldType = component.fieldType(fieldIndex);
    this.ui.at(this.x + L.padding + L.gap, rowY, this.width - L.padding * 2 - L.gap, L.rowH);
    const field = this.ui.control(this.chaveCampo(key, fieldIndex), fieldType === "boolean" ? "toggle" : fieldType === "string" ? "propertyText" : "number", component.fieldLabel(fieldIndex), this.enabledInput);
    if (fieldType === "string") {
      const before = component.fieldStringGet(fieldIndex);
      field.textValue = before; this.ui.draw(field);
      if (field.textValue !== before) { this.snapshot(); component.fieldStringSet(fieldIndex, field.textValue); }
    } else {
      const before = component.fieldGet(fieldIndex);
      field.value = before; this.ui.draw(field);
      if (field.value !== before) { this.snapshot(); component.fieldSet(fieldIndex, field.value); scene.markCollidersDirty(); }
    }
  }
  /// Estado de arraste do quadro pro ObjectField — chamar antes de `render`
  /// (setter, como `area`/`mouse`: Task 10.5, ≤4 parâmetros por chamada).
  /// `on` = algum tile do Project está sendo arrastado; `ok` = é do tipo aceito
  /// pelo campo que estiver sob o cursor (hoje só "audio:" — o AudioSource é o
  /// único ObjectField).
  drag(on: number, ok: number): void { this.objDragOn = on; this.objDragOk = ok; }
  /// Estilo do próximo `objectFieldRow` (setter chamado por InspectorGUIEditor.objectField).
  objectFieldStyle(tipo: string, exts: string[], icon: string): void {
    this.objTipo = tipo; this.objExts = exts; this.objIcon = icon;
  }
  /// Nome do arquivo, sem pasta nem extensão ("explosao" de "assets/audio/explosao.wav").
  private nomeSemExtensao(path: string): string {
    let start = 0; let end = path.length; let i = 0;
    while (i < path.length) {
      const c = path.charCodeAt(i);
      if (c === 47) start = i + 1;
      i = i + 1;
    }
    i = path.length - 1;
    while (i > start) { if (path.charCodeAt(i) === 46) { end = i; break; } i = i - 1; }
    return path.substring(start, end);
  }
  /// "<nome> (<Tipo>)"/"Nenhum (<Tipo>)" da chave `key`, refeito só quando `value` muda.
  rotuloObjectField(key: string, value: string, tipo: string): string {
    const cached = this.objLabelValor.get(key);
    if (cached === value) return this.objLabelTexto.get(key) as string;
    this.objLabelValor.set(key, value);
    const nome = value.length === 0 ? L.objectFieldNone : this.nomeSemExtensao(value);
    const texto = nome + L.objectFieldOpen + tipo + L.objectFieldClose;
    this.objLabelTexto.set(key, texto);
    return texto;
  }
  /// Chave "<key>/Pick" do botão seletor, criada uma vez por `key`.
  private chavePick(key: string): string {
    const achada = this.objPickKeyCache.get(key);
    if (achada !== undefined) return achada;
    const k = key + L.objectPickKey;
    this.objPickKeyCache.set(key, k);
    return k;
  }
  /// 1 se o ObjectField sob o cursor neste quadro aceita o drop de um tile do
  /// Project (o main testa isto antes de chamar `dropObjectField`).
  objectHot(): number { return this.objHotComp !== null ? 1 : 0; }
  /// Aplica `path` no campo sob o cursor (drop de um tile do Project), com
  /// Desfazer. Chamado pelo main no frame em que o botão é solto.
  dropObjectField(path: string): void {
    if (this.objHotComp === null) return;
    this.snapshot();
    this.objHotComp.fieldStringSet(this.objHotIndex, path);
  }
  /// Caixa + botão ⊙ do ObjectField (chave/componente/índice/y — ≤4 parâmetros,
  /// como `fieldRow`). Estilo (tipo/exts/ícone) vem de `objectFieldStyle`.
  objectFieldRow(component: Behavior, key: string, fieldIndex: number, rowY: number): void {
    const value = component.fieldStringGet(fieldIndex);
    const label = this.rotuloObjectField(key, value, this.objTipo);
    const boxX = this.x + L.padding + L.gap;
    const boxW = this.width - L.padding * 2 - L.gap - L.iconW - L.gap;
    this.ui.at(boxX, rowY, boxW, L.rowH);
    const field = this.ui.control(key, "object", label, this.enabledInput);
    field.icon = this.objIcon;
    field.value = this.objDragOn === 0 ? 0 : (this.objDragOk !== 0 ? 1 : 2);
    this.ui.draw(field);
    if (field.hot !== 0) { this.objHotComp = component; this.objHotIndex = fieldIndex; }
    if (field.clicked) {
      this.objFocusComp = component; this.objFocusIndex = fieldIndex; this.objFocusId = field.id;
      this.ui.app.setFocus(field.id);
      if (value.length > 0) { assetsPing(value); this.pinged = true; }
    }
    this.ui.at(this.x + this.width - L.padding - L.iconW, rowY, L.iconW, L.rowH);
    const pick = this.ui.control(this.chavePick(key), "button", L.objectPickGlyph, this.enabledInput);
    this.ui.draw(pick);
    if (pick.clicked) {
      this.objPickerComp = component; this.objPickerIndex = fieldIndex;
      this.objOpened = 1;
      this.objPicker.begin(this.ui.app, this.objExts, this.objTipo);
    }
  }
  /// Nomes dos eixos do próximo `vector` (volta a UI_AXIS_NAMES depois dele).
  vectorNames: string[] = UI_AXIS_NAMES;
  vector(key: string, y: number, label: string, values: number[]): number[] {
    const names = this.vectorNames; this.vectorNames = UI_AXIS_NAMES;
    if (!this.visible(y, L.rowH)) return values;
    const chaves = this.chavesVetor(key, names);
    this.label(chaves[0], y, label);
    const valueX = this.x + L.padding + L.labelW;
    const fieldWidth = (this.width - L.padding * 2 - L.labelW - L.axisGap * 2) / 3;
    let axisIndex = 0;
    while (axisIndex < names.length) {
      this.ui.at(valueX + axisIndex * (fieldWidth + L.axisGap), y, fieldWidth, L.rowH);
      const axis = this.ui.control(chaves[axisIndex + 1], "axis", names[axisIndex], this.enabledInput);
      axis.color = axisIndex === 0 ? AXIS_X : axisIndex === 1 ? AXIS_Y : AXIS_Z; axis.value = values[axisIndex];
      this.ui.draw(axis);
      if (axis.value !== values[axisIndex]) { this.snapshot(); values[axisIndex] = axis.value; }
      axisIndex = axisIndex + 1;
    }
    return values;
  }
  /// Seção "Esqueleto": árvore de ossos (clique = S.selectedBone), clipes,
  /// tocar/pausar/parar, barra de tempo (arrastar = seek) e "Resetar pose".
  /// Fora do Play, tocar/pausar/tempo são PRÉVIA (skeleton_preview.ts): sem
  /// undo e sem mudar a cena salva. Escolher o clipe (campo salvo `clip`) e
  /// resetar a pose (pose manual) passam pelo undo como as outras edições.
  skeletonSection(app: any, skeleton: Skeleton, startY: number): number {
    let rowY = startY;
    this.skeletonOpen = this.header("Skeleton/Header", rowY, K.title, this.skeletonOpen);
    rowY = rowY + L.headerH + L.gap;
    if (!this.skeletonOpen) return rowY;
    skeleton.ensureAsset(app._win);
    const asset = skeleton.asset;
    if (asset === null) { this.label("Skeleton/NoModel", rowY, K.noModel); return rowY + L.rowH + L.gap; }
    const innerX = this.x + L.padding + L.gap;
    const innerW = this.width - L.padding * 2 - L.gap;
    const boneCount = asset.boneNames.length;
    if (this.skeletonLabelsAsset !== asset) {
      this.skeletonLabelsAsset = asset;
      this.bonesTitle = K.bones + K.countOpen + boneCount + K.countClose;
      const labels: string[] = [];
      let labelIndex = 0;
      while (labelIndex < asset.clips.length) {
        const labelClip = asset.clips[labelIndex];
        labels.push(labelClip.name + K.clipDurationOpen + labelClip.duration.toFixed(K.timeDigits) + K.timeUnit + K.clipDurationClose);
        labelIndex = labelIndex + 1;
      }
      this.clipLabels = labels;
    }
    this.label("Skeleton/BonesTitle", rowY, this.bonesTitle);
    rowY = rowY + L.rowH;
    let bone = 0;
    while (bone < boneCount) {
      if (this.visible(rowY, K.boneRowH)) {
        let depth = 0;
        let parent = asset.boneParent[bone];
        while (parent >= 0 && depth < K.maxIndentDepth) { depth = depth + 1; parent = asset.boneParent[parent]; }
        const indent = depth * K.boneIndent;
        this.ui.at(innerX + indent, rowY, innerW - indent, K.boneRowH);
        const row = this.ui.control(this.chaveLista(this.chavesOsso, K.boneKey, bone), "row", asset.boneNames[bone], this.enabledInput);
        row.fill = bone === S.selectedBone ? UI_C.boneSelected : UI_C.boneRow;
        this.ui.draw(row);
        // clicar no osso já selecionado devolve o gizmo ao objeto
        if (row.clicked) selectBone(skeleton.owner, S.selectedBone === bone ? 0 - 1 : bone);
      }
      rowY = rowY + K.boneRowH;
      bone = bone + 1;
    }
    rowY = rowY + L.gap;
    if (S.selectedBone >= 0 && S.selectedBone < boneCount) rowY = this.boneFields(skeleton, S.selectedBone, rowY);
    const player = animationPlayerOf(skeleton);
    if (player === null) {
      this.label("Skeleton/NoPlayer", rowY, K.noPlayer);
      this.label("Skeleton/NoPlayerHint", rowY + L.rowH, K.noPlayerHint);
      return rowY + L.rowH * 2 + L.gap;
    }
    // Animator ligado no mesmo objeto: o player fica inerte, então os
    // controles de tocar/parar não fariam nada — mostra só o aviso
    if (player.drivenByAnimator(skeleton)) {
      this.label("Skeleton/DrivenByAnimator", rowY, K.drivenByAnimator);
      this.label("Skeleton/DrivenByAnimatorHint", rowY + L.rowH, K.drivenByAnimatorHint);
      return rowY + L.rowH * 2 + L.gap;
    }
    const simulating = S.simulating !== 0;
    this.label("Skeleton/ClipsTitle", rowY, K.clips);
    rowY = rowY + L.rowH;
    if (asset.clips.length === 0) { this.label("Skeleton/NoClips", rowY, K.noClips); rowY = rowY + L.rowH; }
    let clipIndex = 0;
    while (clipIndex < asset.clips.length) {
      const clip = asset.clips[clipIndex];
      if (this.visible(rowY, K.clipRowH)) {
        this.ui.at(innerX, rowY, innerW, K.clipRowH);
        const button = this.ui.control(this.chaveLista(this.chavesClipe, K.clipKey, clipIndex), "button", this.clipLabels[clipIndex], this.enabledInput);
        if (clip.name === player.clip) button.fill = UI_C.clipActive;
        this.ui.draw(button);
        if (button.clicked && clip.name !== player.clip) {
          this.snapshot();
          if (simulating) player.play(clip.name);
          else previewChooseClip(player, clip.name);
        }
      }
      rowY = rowY + K.clipRowH;
      clipIndex = clipIndex + 1;
    }
    rowY = rowY + L.gap;
    const duration = player.duration();
    const canPlay = this.enabledInput && duration > 0.0;
    if (this.visible(rowY, L.rowH)) {
      const playing = simulating ? player.playing : previewIsPlaying(player);
      const halfW = (innerW - K.buttonGap) / 2;
      this.ui.at(innerX, rowY, halfW, L.rowH);
      const toggle = this.ui.control("Skeleton/Play", "button", playing ? K.pause : K.play, canPlay);
      this.ui.draw(toggle);
      if (toggle.clicked) {
        if (simulating) { if (playing) player.pause(); else player.resume(); }
        else if (playing) previewPause(player);
        else previewStart(player);
      }
      this.ui.at(innerX + halfW + K.buttonGap, rowY, halfW, L.rowH);
      const stop = this.ui.control("Skeleton/Stop", "button", K.stop, canPlay);
      this.ui.draw(stop);
      if (stop.clicked) {
        if (simulating) { player.pause(); player.seek(0.0); }
        else previewStop(player);
      }
    }
    rowY = rowY + L.rowH + L.gap;
    if (this.visible(rowY, K.timelineH)) {
      if (player.time !== this.timelineTime || duration !== this.timelineDuration) {
        this.timelineTime = player.time; this.timelineDuration = duration;
        this.timelineLabel = player.time.toFixed(K.timeDigits) + K.timeSeparator + duration.toFixed(K.timeDigits) + K.timeUnit;
      }
      this.ui.at(innerX, rowY, innerW, K.timelineH);
      const timeline = this.ui.control("Skeleton/Time", "timeline", this.timelineLabel, canPlay);
      timeline.value = duration > 0.0 ? player.time / duration : 0;
      this.ui.draw(timeline);
      if (timeline.hot !== 0) {
        const target = timelineTarget(player, timeline.value, duration);
        if (simulating) player.seek(target); else previewSeek(player, target);
      }
    }
    rowY = rowY + K.timelineH + L.gap;
    if (this.visible(rowY, L.rowH)) {
      this.ui.at(innerX, rowY, innerW, L.rowH);
      const reset = this.ui.control("Skeleton/Reset", "button", K.resetPose, this.enabledInput);
      this.ui.draw(reset);
      // repouso + fim da prévia deste player (senão o clipe continuaria por cima)
      if (reset.clicked) { this.snapshot(); skeleton.resetPose(); previewStop(player); }
    }
    return rowY + L.rowH + L.gap;
  }
  /// Seção "Animator": caminho do controlador (ou o erro que o deixa inerte),
  /// parâmetros editáveis ao vivo (float = campo arrastável, bool = caixa,
  /// trigger = botão) e o estado atual + tempo normalizado de cada camada.
  /// Parâmetros são estado de EXECUÇÃO: sem undo e fora da cena salva. Fora
  /// do Play, mexer num parâmetro inicia a prévia do Animator
  /// (skeleton_preview.ts), que acaba ao trocar de objeto, entrar no Play ou
  /// no botão "Parar prévia" — parâmetros, estados e pose voltam ao início.
  animatorSection(animator: Animator, startY: number): number {
    let rowY = startY;
    this.animatorOpen = this.header("Animator/Header", rowY, A.title, this.animatorOpen);
    rowY = rowY + L.headerH + L.gap;
    if (!this.animatorOpen) return rowY;
    const innerX = this.x + L.padding + L.gap;
    const innerW = this.width - L.padding * 2 - L.gap;
    if (this.animatorControllerShown !== animator.controller || this.animatorControllerLabel === "") {
      this.animatorControllerShown = animator.controller;
      this.animatorControllerLabel = A.controller + (animator.controller === "" ? A.none : animator.controller);
    }
    this.label("Animator/Controller", rowY, this.animatorControllerLabel);
    rowY = rowY + L.rowH;
    const error = animator.errorText();
    if (error !== "") {
      if (this.visible(rowY, L.rowH)) {
        this.ui.at(innerX, rowY, innerW, L.rowH);
        const label = this.ui.control("Animator/Error", "label", A.error + error, false);
        label.color = UI_C.animatorError; this.ui.draw(label);
      }
      return rowY + L.rowH + L.gap;
    }
    this.label("Animator/ParamsTitle", rowY, A.params);
    rowY = rowY + L.rowH;
    const paramCount = animator.paramCount();
    if (paramCount === 0) { this.label("Animator/NoParams", rowY, A.noParams); rowY = rowY + L.rowH; }
    let param = 0;
    while (param < paramCount) {
      const type = animator.paramType(param);
      const value = animator.paramValue(param);
      const rowH = type === PARAM_FLOAT || type === PARAM_BOOL ? L.rowH : A.triggerRowH;
      if (this.visible(rowY, rowH)) {
        const key = this.chaveLista(this.chavesParam, A.paramKey, param);
        const name = animator.paramName(param);
        if (type === PARAM_FLOAT) {
          this.ui.at(innerX, rowY, innerW, rowH);
          const field = this.ui.control(key, "number", name, this.enabledInput);
          field.value = value; this.ui.draw(field);
          if (field.value !== value) { animator.setFloatAt(param, field.value); animatorPreviewTouch(animator); }
        } else if (type === PARAM_BOOL) {
          this.ui.at(innerX, rowY, innerW, rowH);
          const box = this.ui.control(key, "toggle", name, this.enabledInput);
          box.value = value !== 0.0 ? 1 : 0; this.ui.draw(box);
          if ((box.value !== 0) !== (value !== 0.0)) { animator.setBoolAt(param, box.value !== 0); animatorPreviewTouch(animator); }
        } else {
          this.ui.at(innerX, rowY, innerW, rowH);
          const button = this.ui.control(key, "button", name, this.enabledInput);
          button.fill = value !== 0.0 ? UI_C.triggerArmed : UI_C.controlIdle;
          this.ui.draw(button);
          if (button.clicked) { animator.setTriggerAt(param); animatorPreviewTouch(animator); }
        }
      }
      rowY = rowY + rowH;
      param = param + 1;
    }
    rowY = rowY + L.gap;
    this.label("Animator/LayersTitle", rowY, A.layers);
    rowY = rowY + L.rowH;
    const layerCount = animator.layerCount();
    let layer = 0;
    while (layer < layerCount) {
      this.refreshAnimatorLayerLabel(animator, layer);
      this.label(this.chaveLista(this.chavesCamada, A.layerKey, layer), rowY, this.animatorLayerLabels[layer]);
      rowY = rowY + L.rowH;
      layer = layer + 1;
    }
    if (S.simulating === 0 && animatorPreviewIsActive(animator)) {
      if (this.visible(rowY, L.rowH)) {
        this.ui.at(innerX, rowY, innerW, L.rowH);
        const stop = this.ui.control("Animator/StopPreview", "button", A.stopPreview, this.enabledInput);
        this.ui.draw(stop);
        if (stop.clicked) animatorPreviewStop(animator);
      }
      rowY = rowY + L.rowH;
    }
    return rowY + L.gap;
  }
  // "Camada: Estado  t=0.42  (fade de X 30%)" — refeito só quando estado,
  // tempo ou progresso do fade mudam.
  refreshAnimatorLayerLabel(animator: Animator, layer: number): void {
    while (this.animatorLayerLabels.length <= layer) {
      this.animatorLayerLabels.push(""); this.animatorLayerStates.push("");
      this.animatorLayerTimes.push(0 - 1); this.animatorLayerFades.push(0 - 1);
    }
    const state = animator.stateName(layer);
    // compara o que o rótulo MOSTRA (arredondado), não o valor cru
    const time = Math.round(animator.stateTime(layer) * ANIMATOR_TIME_SCALE);
    const fade = animator.fadingFrom(layer) !== "" ? Math.round(animator.fadeProgress(layer) * FADE_PERCENT) : 0 - 1;
    if (this.animatorLayerLabels[layer] !== "" && this.animatorLayerStates[layer] === state &&
      this.animatorLayerTimes[layer] === time && this.animatorLayerFades[layer] === fade) return;
    this.animatorLayerStates[layer] = state; this.animatorLayerTimes[layer] = time; this.animatorLayerFades[layer] = fade;
    let text = animator.layerName(layer) + A.layerSeparator + state + A.timeOpen + (time / ANIMATOR_TIME_SCALE).toFixed(A.timeDigits);
    if (fade >= 0) text = text + A.fadeOpen + animator.fadingFrom(layer) + A.fadeStateGap + fade + A.fadeClose;
    this.animatorLayerLabels[layer] = text;
  }
  /// Campos do osso selecionado: rotação local em graus (yaw/pitch/roll, a
  /// convenção do `pose rot` do WebSocket) e posição local. Editar encerra a
  /// prévia do objeto e grava a pose MANUAL (salva na cena, com undo).
  boneFields(skeleton: Skeleton, bone: number, startY: number): number {
    const asset = skeleton.asset;
    if (asset === null) return startY;
    let rowY = startY;
    if (this.boneLabelBone !== bone || this.boneLabelAsset !== asset) {
      this.boneLabelBone = bone; this.boneLabelAsset = asset;
      this.boneLabel = K.boneSelected + asset.boneNames[bone];
    }
    this.label("Skeleton/BoneName", rowY, this.boneLabel);
    rowY = rowY + L.rowH;
    const degrees = this.boneDegrees;
    const shown = this.boneShownQ;
    const o = bone * 4;
    const same = this.boneShownSkeleton === skeleton && this.boneShownBone === bone &&
      skeleton.manualR[o] === shown[0] && skeleton.manualR[o + 1] === shown[1] &&
      skeleton.manualR[o + 2] === shown[2] && skeleton.manualR[o + 3] === shown[3];
    if (!same) {
      // o osso mudou por outro caminho (gizmo, WS, undo, outro osso): decompõe
      boneDegreesInto(degrees, skeleton.manualR, o);
      this.rememberBoneRotation(skeleton, bone);
    }
    const yaw = degrees[0]; const pitch = degrees[1]; const roll = degrees[2];
    const rotationValues = this.boneRotationValues;
    rotationValues[0] = yaw; rotationValues[1] = pitch; rotationValues[2] = roll;
    this.vectorNames = K.rotationAxes;
    const rotation = this.vector("Skeleton/BoneRotation", rowY, K.boneRotation, rotationValues);
    if (rotation[0] !== yaw || rotation[1] !== pitch || rotation[2] !== roll) {
      beginBoneEdit(skeleton);
      boneRotationFromDegreesInto(this.boneQuat, rotation[0], rotation[1], rotation[2]);
      skeleton.setBoneRotation(bone, this.boneQuat);
      degrees[0] = rotation[0]; degrees[1] = rotation[1]; degrees[2] = rotation[2];
      this.rememberBoneRotation(skeleton, bone);
    }
    rowY = rowY + L.rowH;
    const tx = skeleton.manualT[bone * 3]; const ty = skeleton.manualT[bone * 3 + 1]; const tz = skeleton.manualT[bone * 3 + 2];
    const positionValues = this.bonePositionValues;
    positionValues[0] = tx; positionValues[1] = ty; positionValues[2] = tz;
    const position = this.vector("Skeleton/BonePosition", rowY, K.bonePosition, positionValues);
    if (position[0] !== tx || position[1] !== ty || position[2] !== tz) {
      beginBoneEdit(skeleton);
      skeleton.setBonePosition(bone, position[0], position[1], position[2]);
    }
    return rowY + L.rowH + L.gap;
  }
  // Guarda o quaternion atual do osso como "o que os graus mostrados produzem".
  rememberBoneRotation(skeleton: Skeleton, bone: number): void {
    const o = bone * 4;
    this.boneShownSkeleton = skeleton; this.boneShownBone = bone;
    this.boneShownQ[0] = skeleton.manualR[o]; this.boneShownQ[1] = skeleton.manualR[o + 1];
    this.boneShownQ[2] = skeleton.manualR[o + 2]; this.boneShownQ[3] = skeleton.manualR[o + 3];
  }
  /// Índice das chaves de controle do componente `i` (objeto selecionado ou
  /// janela), criadas uma vez: sem concatenar strings por frame.
  chavesDe(editavel: boolean, i: number): number {
    const lista = editavel ? this.compSel : this.compJanela;
    while (lista.length <= i) {
      const k = (editavel ? L.componentsKey : L.windowComponentsKey) + lista.length;
      lista.push(this.compChave.length);
      this.compChave.push(k); this.compHeader.push(k + L.headerKey); this.compRemove.push(k + L.removeKey);
      this.compEnabled.push(k + L.enabledKey); this.compTitulo.push(""); this.compTituloDe.push(""); this.compTituloAberto.push(false);
    }
    return lista[i];
  }
  /// "v  Nome" / ">  Nome", refeito só quando o nome ou o estado mudam.
  tituloComponente(c: number, component: Behavior, aberto: boolean): string {
    const nome = component.typeName();
    if (this.compTitulo[c].length === 0 || this.compTituloDe[c] !== nome || this.compTituloAberto[c] !== aberto) {
      this.compTituloDe[c] = nome; this.compTituloAberto[c] = aberto;
      this.compTitulo[c] = (aberto ? L.expandedMark : L.collapsedMark) + nome;
    }
    return this.compTitulo[c];
  }
  /// Cabeçalho, remover, "Ativo" e GUI/campos de cada componente de `object`,
  /// a partir de `rowY`; devolve o y seguinte. Com `editavel = false` (janela de
  /// pacote), sem o botão "x" nem o toggle "Ativo".
  componentsSection(object: GameObject, rowY0: number, editavel: boolean): number {
    let rowY = rowY0;
    let componentIndex = 0;
    let removeIndex = 0 - 1;
    while (componentIndex < object.behaviors.length) {
      const component = object.behaviors[componentIndex];
      // a janela tem chaves próprias: não herda estado de controle do objeto selecionado
      const c = this.chavesDe(editavel, componentIndex);
      const key = this.compChave[c];
      const expanded = component.collapsed === 0;
      if (this.visible(rowY, L.headerH)) {
        this.ui.at(this.x + L.padding, rowY, this.width - L.padding * 2 - L.iconW - L.gap, L.headerH);
        const heading = this.ui.control(this.compHeader[c], "header", this.tituloComponente(c, component, expanded), this.enabledInput);
        heading.fill = UI_C.componentHeader; this.ui.draw(heading);
        if (heading.clicked) { component.collapsed = expanded ? 1 : 0; nfCancel(); }
        if (editavel) {
          this.ui.at(this.x + this.width - L.padding - L.iconW, rowY, L.iconW, L.headerH);
          const remove = this.ui.control(this.compRemove[c], "button", "x", this.enabledInput);
          remove.color = UI_C.destructiveText; this.ui.draw(remove);
          if (remove.clicked) removeIndex = componentIndex;
        }
      }
      rowY = rowY + L.headerH + L.gap;
      if (component.collapsed === 0) {
        if (editavel && this.visible(rowY, L.rowH)) {
          this.ui.at(this.x + L.padding + L.gap, rowY, this.width - L.padding * 2, L.rowH);
          const enabled = this.ui.control(this.compEnabled[c], "toggle", L.active, this.enabledInput);
          enabled.value = component.enabled; this.ui.draw(enabled);
          if (enabled.value !== component.enabled) { this.snapshot(); component.enabled = enabled.value; scene.markCollidersDirty(); }
        }
        if (editavel) rowY = rowY + L.rowH;
        // GUI própria do componente; sem nenhum controle pedido, a lista automática.
        this.gui.begin(component, key, rowY);
        if ((component.falhasEditor & FALHA_GUI) === 0) {
          this.guiEmCurso = component;
          component.onInspectorGUI(this.gui);
          this.guiEmCurso = null;
        }
        if (this.gui.usos > 0) rowY = this.gui.y;
        else {
          let fieldIndex = 0;
          while (fieldIndex < component.fieldCount()) {
            if (this.visible(rowY, L.rowH)) this.fieldRow(component, key, fieldIndex, rowY);
            rowY = rowY + L.rowH;
            fieldIndex = fieldIndex + 1;
          }
        }
        rowY = rowY + L.gap;
      }
      componentIndex = componentIndex + 1;
    }
    if (object.behaviors.length === 0) { this.label("NoComponents", rowY, L.noComponents); rowY = rowY + L.rowH; }
    if (removeIndex >= 0) { this.snapshot(); object.removeBehavior(removeIndex); scene.markCollidersDirty(); nfCancel(); }
    return rowY;
  }
  /// Mostra `b` no Inspector como uma janela (Editor.inspect): o componente vive
  /// num objeto oculto da UIScene do Inspector, nunca na cena editada. Trocar a
  /// seleção fecha a janela.
  abrirJanela(b: Behavior, titulo: string): void {
    const nome = this.ui.root.name + L.windowKey + titulo;
    let go: GameObject | null = null;
    let i = 0;
    const lista = this.ui.scene.panels;
    while (i < lista.length && go === null) { if (lista[i].name === nome) go = lista[i]; i = i + 1; }
    if (go === null) go = this.ui.scene.createGameObject(nome, 0);
    if (b.owner !== go) go.addBehavior(b);
    this.janela = go; this.janelaTitulo = titulo; this.janelaSel = S.selected; this.scroll = 0;
    if (this.janelaNome.length === 0 || this.janelaNomeDe !== titulo) { this.janelaNomeDe = titulo; this.janelaNome = L.windowPrefix + titulo; }
  }
  /// Modo janela do `render`: o título no lugar do nome, os componentes da
  /// janela (sem remover/Ativo) com a mesma rolagem, sem "Adicionar componente".
  /// Usa this.janela/x/width/top (≤ 4 parâmetros no caminho por frame).
  renderJanela(mx: number, my: number): void {
    const janela = this.janela as GameObject;
    const x = this.x; const width = this.width;
    // a linha do nome do objeto: logo abaixo do título do painel (this.top - objectH = y + headerH)
    this.ui.at(x + L.padding, this.top - L.objectH + L.gap, width - L.padding * 2, L.rowH);
    const titulo = this.ui.control(L.windowTitleKey, "label", this.janelaNome, false);
    this.ui.draw(titulo);
    const available = Math.max(0, this.bottom - this.top);
    const maxBefore = Math.max(0, this.contentHeight - available);
    if (this.enabledInput && mx >= x && mx < x + width && my >= this.top && my < this.bottom) {
      const wheel = input.wheel(this.ui.app._win);
      if (wheel !== 0) { this.scroll = Math.max(0, Math.min(maxBefore, this.scroll - Math.sign(wheel) * UI_INSPECTOR_SCROLL_STEP)); nfCancel(); }
    }
    const rowY = this.componentsSection(janela, this.top - this.scroll, false);
    this.contentHeight = rowY + this.scroll - this.top;
    this.scroll = Math.min(this.scroll, Math.max(0, this.contentHeight - available));
    this.ui.end();
  }
  /// Área do painel (chamar antes de `render`; ≤ 4 parâmetros por chamada).
  area(x: number, y: number, width: number, height: number): void {
    this.areaX = x; this.areaY = y; this.areaW = width; this.areaH = height;
  }
  /// Mouse do quadro (chamar antes de `render`).
  mouse(mx: number, my: number, down: number, pressed: number): void {
    this.inMx = mx; this.inMy = my; this.inDown = down; this.inPressed = pressed;
  }
  /// Entrada do Inspector por quadro: `render` com a exceção de um
  /// onInspectorGUI de script contida. O componente que lançou é registrado no
  /// Console uma vez e passa a mostrar os campos automáticos. O `try` fica
  /// nesta função pequena, chamada uma vez por quadro (no RTS a função que
  /// contém `try` aloca por chamada).
  renderProtegido(app: any, blocked: boolean, modelDrag: number, textureDrag: number): void {
    try { this.render(app, blocked, modelDrag, textureDrag); }
    catch (e) { this.desligarGuiQueFalhou(e); }
  }
  private desligarGuiQueFalhou(e: any): void {
    const b = this.guiEmCurso;
    this.guiEmCurso = null;
    if (b === null) throw e;
    b.falhasEditor = b.falhasEditor | FALHA_GUI;
    const dono = b.owner !== null ? b.owner.name : "?";
    registrarExcecao("onInspectorGUI " + b.typeName() + " em " + dono, e);
    logError("Inspector: onInspectorGUI de " + b.typeName() + " em '" + dono + "' lançou: " + String(e) + " — usando os campos automáticos deste componente.");
    this.ui.end();
  }
  render(app: any, blocked: boolean, modelDrag: number, textureDrag: number): void {
    const x = this.areaX; const y = this.areaY; const width = this.areaW; const height = this.areaH;
    const mx = this.inMx; const my = this.inMy; const down = this.inDown; const pressed = this.inPressed;
    this.ui.begin(mx, my, down, pressed);
    this.x = x; this.width = width; this.changed = false;
    this.meshHot = 0; this.textureHot = 0;
    this.objHotComp = null; this.objHotIndex = 0 - 1; this.pinged = false;
    const selected = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
    if (selected !== this.selectedObject || S.selected !== this.selection) {
      this.scroll = 0; this.contentHeight = 0; this.opened = 0;
      this.objOpened = 0; this.objPickerComp = null;
      this.objFocusComp = null; this.objFocusIndex = 0 - 1; this.objFocusId = 0 - 1;
      this.selectedObject = selected; this.selection = S.selected;
      nfCancel(); app.setFocus(0 - 1);
      // outro objeto: o osso escolhido não vale mais (salvo Desfazer/Refazer,
      // que re-liga o osso ao objeto restaurado — ver undo.ts) e a prévia de
      // animação (estado do editor) termina, com a pose de trabalho de volta à manual.
      // A prévia de áudio do AudioSource também para (rampa, sem clique).
      if (S.selectedBoneOwner !== selected) selectBone(null, 0 - 1);
      previewStopAll();
      pararPrevia();
    }
    if (this.janela !== null && S.selected !== this.janelaSel) this.janela = null;
    if (blocked) { this.opened = 0; this.objOpened = 0; nfCancel(); }
    this.enabledInput = !blocked && this.opened === 0 && this.objOpened === 0;
    // Delete/Backspace com o ObjectField focado (clicado por último) → Nenhum,
    // com Desfazer (item 2 do brief de áudio-arquivos). `isFocused` sobrevive à
    // troca de seleção só se o mesmo id for reusado — a checagem acima já
    // limpa objFocusComp quando o objeto muda.
    if (this.objFocusComp !== null && this.enabledInput && app.isFocused(this.objFocusId) &&
        (app.keyPressed(PK.backspace) !== 0 || app.keyPressed(PK.del) !== 0)) {
      this.snapshot();
      this.objFocusComp.fieldStringSet(this.objFocusIndex, "");
    }
    this.ui.at(x, y, width, height);
    const background = this.ui.control("Background", "panel", "", false);
    background.fill = UI_C.panel; this.ui.draw(background);
    this.ui.at(x, y, width, L.headerH);
    const title = this.ui.control("Title", "header", L.title, false);
    title.fill = UI_C.panelHeader; this.ui.draw(title);
    this.top = y + L.headerH + L.objectH;
    this.bottom = y + height - L.footerH;
    if (this.janela !== null) { this.renderJanela(mx, my); return; }
    if (selected === null) { this.label("Empty", this.top, L.empty); this.label("EmptyHint", this.top + L.rowH, L.emptyHint); return; }
    const object: GameObject = selected;
    this.ui.at(x + L.padding, y + L.headerH + L.gap, width - L.padding * 2, L.rowH);
    const name = this.ui.control("Name", "text", "", this.enabledInput);
    name.id = L.nameId; name.textValue = object.name; this.ui.draw(name);
    if (name.textValue !== object.name) { this.snapshot(); object.name = name.textValue; }
    const flagsY = y + L.headerH + L.gap + L.rowH;
    this.ui.at(x + L.padding, flagsY, width / 2, L.rowH);
    const active = this.ui.control("Active", "toggle", L.active, this.enabledInput);
    active.value = object.active; this.ui.draw(active);
    if (active.value !== object.active) { this.snapshot(); object.active = active.value; scene.markCollidersDirty(); }
    this.ui.at(x + width / 2, flagsY, width / 2 - L.padding, L.rowH);
    const stationary = this.ui.control("Static", "toggle", L.stationary, this.enabledInput);
    stationary.value = object.stationary; this.ui.draw(stationary);
    if (stationary.value !== object.stationary) { this.snapshot(); object.stationary = stationary.value; scene.markStaticDirty(); }
    const available = Math.max(0, this.bottom - this.top);
    const maxBefore = Math.max(0, this.contentHeight - available);
    if (this.enabledInput && mx >= x && mx < x + width && my >= this.top && my < this.bottom) {
      const wheel = input.wheel(app._win);
      if (wheel !== 0) { this.scroll = Math.max(0, Math.min(maxBefore, this.scroll - Math.sign(wheel) * UI_INSPECTOR_SCROLL_STEP)); nfCancel(); }
    }
    let rowY = this.top - this.scroll;
    if (object.parent >= 0 && object.parent < scene.objects.length) {
      const nomePai = scene.objects[object.parent].name;
      if (this.paiRotulo.length === 0 || this.paiDe !== nomePai) { this.paiDe = nomePai; this.paiRotulo = L.parent + nomePai; }
      this.label("Parent/Name", rowY, this.paiRotulo);
      rowY = rowY + L.rowH;
      if (this.visible(rowY, L.rowH)) {
        this.ui.at(x + L.padding, rowY, width - L.padding * 2, L.rowH);
        const unparent = this.ui.control("Parent/Detach", "button", L.unparent, this.enabledInput);
        this.ui.draw(unparent);
        if (unparent.clicked) {
          this.snapshot();
          scene.moveSubtree(S.selected, scene.objects.length, 0 - 1);
          S.selected = scene.objects.indexOf(object); S.selection = [S.selected];
        }
      }
      rowY = rowY + L.rowH + L.gap;
    }
    this.transformOpen = this.header("Transform/Header", rowY, L.transform, this.transformOpen);
    rowY = rowY + L.headerH + L.gap;
    if (this.transformOpen) {
      const transform = object.transform;
      const pv = this.posValores; pv[0] = transform.px; pv[1] = transform.py; pv[2] = transform.pz;
      const position = this.vector("Transform/Position", rowY, L.position, pv);
      // Mover um ESTATICO invalida o indice espacial estatico (o dinamico segue o transform sozinho).
      if (object.stationary !== 0 && (position[0] !== transform.px || position[1] !== transform.py || position[2] !== transform.pz)) scene.markCollidersDirty();
      transform.px = position[0]; transform.py = position[1]; transform.pz = position[2];
      rowY = rowY + L.rowH;
      const rxDegrees = transform.rx * DEGREES_PER_RADIAN;
      const ryDegrees = transform.ry * DEGREES_PER_RADIAN;
      const rzDegrees = transform.rz * DEGREES_PER_RADIAN;
      const rv = this.rotValores; rv[0] = rxDegrees; rv[1] = ryDegrees; rv[2] = rzDegrees;
      const rotation = this.vector("Transform/Rotation", rowY, L.rotation, rv);
      if (object.stationary !== 0 && (rotation[0] !== rxDegrees || rotation[1] !== ryDegrees || rotation[2] !== rzDegrees)) scene.markCollidersDirty();
      if (rotation[0] !== rxDegrees) transform.rx = rotation[0] / DEGREES_PER_RADIAN;
      if (rotation[1] !== ryDegrees) transform.ry = rotation[1] / DEGREES_PER_RADIAN;
      if (rotation[2] !== rzDegrees) transform.rz = rotation[2] / DEGREES_PER_RADIAN;
      rowY = rowY + L.rowH;
      const ev = this.escValores; ev[0] = transform.sx; ev[1] = transform.sy; ev[2] = transform.sz;
      const scale = this.vector("Transform/Scale", rowY, L.scale, ev);
      if (scale[0] !== transform.sx || scale[1] !== transform.sy || scale[2] !== transform.sz) scene.markCollidersDirty();
      transform.sx = scale[0]; transform.sy = scale[1]; transform.sz = scale[2];
      rowY = rowY + L.rowH + L.gap;
    }
    // Referencias de assets continuam aceitando drop; agora fazem parte do fluxo rolavel.
    if (object.meshKind !== 0 || object.rendIdx >= 0 || object.matIdx >= 0) {
      this.appearanceOpen = this.header("Appearance/Header", rowY, L.appearance, this.appearanceOpen);
      rowY = rowY + L.headerH + L.gap;
      if (this.appearanceOpen) {
        if (this.visible(rowY, L.rowH)) {
          this.ui.at(x + L.padding, rowY, width - L.padding * 2, L.rowH);
          const mesh = this.ui.control("Appearance/Mesh", "asset", L.mesh, this.enabledInput);
          const kind = object.rendIdx >= 0 ? object.behaviors[object.rendIdx].rMeshKind() : object.meshKind;
          mesh.textValue = object.meshPath.length > 0 ? object.meshPath : UI_MESH_NAMES[Math.max(0, Math.min(UI_MESH_NAMES.length - 1, kind))];
          mesh.value = modelDrag; this.ui.draw(mesh); this.meshHot = mesh.hot;
        }
        rowY = rowY + L.rowH;
        if (this.visible(rowY, L.rowH)) {
          this.ui.at(x + L.padding, rowY, width - L.padding * 2, L.rowH);
          const cycle = this.ui.control("Appearance/ChangeMesh", "button", L.changeMesh, this.enabledInput);
          this.ui.draw(cycle);
          if (cycle.clicked) {
            this.snapshot();
            const kind = object.rendIdx >= 0 ? object.behaviors[object.rendIdx].rMeshKind() : object.meshKind;
            const nextKind = kind % (UI_MESH_NAMES.length - 1) + 1;
            object.setMesh(nextKind, object.cr, object.cg, object.cb);
            object.customMesh = 0; object.meshPath = ""; object.meshPart = 0;
            if (object.rendIdx >= 0) {
              const renderer: MeshRenderer = object.behaviors[object.rendIdx] as MeshRenderer;
              renderer.meshKind = nextKind; renderer.customMesh = 0;
            }
            scene.markCollidersDirty();
          }
        }
        rowY = rowY + L.rowH;
        if (this.visible(rowY, L.rowH)) {
          this.ui.at(x + L.padding, rowY, width - L.padding * 2, L.rowH);
          const texture = this.ui.control("Appearance/Texture", "asset", L.texture, this.enabledInput);
          texture.textValue = object.matIdx >= 0 ? object.behaviors[object.matIdx].matTexPath() : "";
          texture.value = textureDrag; this.ui.draw(texture); this.textureHot = texture.hot;
        }
        rowY = rowY + L.rowH + L.gap;
      }
    }
    const skeleton = skeletonOfObject(object);
    if (skeleton !== null) rowY = this.skeletonSection(app, skeleton, rowY);
    const animator = animatorOfObject(object);
    if (animator !== null) rowY = this.animatorSection(animator, rowY);
    rowY = this.componentsSection(object, rowY, true);
    this.contentHeight = rowY + this.scroll - this.top;
    const maxScroll = Math.max(0, this.contentHeight - available);
    this.scroll = Math.min(this.scroll, maxScroll);
    if (maxScroll > 0 && available > L.minThumbH) {
      const thumbH = Math.max(L.minThumbH, available * available / this.contentHeight);
      if (this.enabledInput && pressed !== 0 && mx >= x + width - L.scrollbarHitW && mx < x + width && my >= this.top && my < this.bottom) this.scrollbarDrag = true;
      if (down === 0 || !this.enabledInput) this.scrollbarDrag = false;
      if (this.scrollbarDrag) { this.scroll = Math.max(0, Math.min(maxScroll, (my - this.top - thumbH / 2) / (available - thumbH) * maxScroll)); nfCancel(); }
      this.ui.at(x + width - L.scrollbarW, this.top + (available - thumbH) * this.scroll / maxScroll, L.scrollbarW, thumbH);
      const scrollbar = this.ui.control("Scrollbar", "panel", "", false);
      scrollbar.fill = UI_C.scrollbarThumb; this.ui.draw(scrollbar);
    }
    this.ui.at(x, this.bottom, width, L.footerH);
    const footer = this.ui.control("Footer", "panel", "", false);
    footer.fill = UI_C.panelHeader; this.ui.draw(footer);
    this.ui.at(x + L.padding, this.bottom + L.gap, width - L.padding * 2, L.rowH);
    const add = this.ui.control("AddComponent", "button", this.addRotulo, !blocked && this.objOpened === 0);
    this.ui.draw(add);
    if (add.clicked) { this.opened = this.opened === 0 ? 1 : 0; nfCancel(); if (this.opened !== 0) this.picker.begin(app); else app.setFocus(0 - 1); }
    if (this.opened !== 0) {
      this.picker.place(x + L.padding, this.bottom - L.gap, width - L.padding * 2, y + L.headerH);
      this.picker.mouse(mx, my, add.clicked || (mx >= x && my >= this.bottom) ? 0 : pressed, input.wheel(app._win));
      const chosen = this.picker.render(this.ui.scene, app);
      if (chosen.length > 0) {
        this.snapshot();
        const added = attachEditorComponent(S.selected, chosen);
        this.scroll = Math.max(0, this.contentHeight + L.headerH + (added.fieldCount() + 1) * L.rowH + L.gap * 2 - available);
      }
      if (chosen.length > 0 || this.picker.closed) { this.opened = 0; app.setFocus(0 - 1); }
    }
    // Seletor "Selecionar <Tipo>" do ObjectField (⊙): mesmo padrão do AddComponent
    // acima, num flag separado (objOpened) pra não abrir os dois ao mesmo tempo.
    if (this.objOpened !== 0) {
      this.objPicker.place(x + L.padding, this.bottom - L.gap, width - L.padding * 2, y + L.headerH);
      this.objPicker.mouse(mx, my, mx >= x && my >= this.bottom ? 0 : pressed, input.wheel(app._win));
      const chosenObj = this.objPicker.render(this.ui.scene, app);
      if (chosenObj.length > 0 && this.objPickerComp !== null) {
        this.snapshot();
        this.objPickerComp.fieldStringSet(this.objPickerIndex, chosenObj === OBJECT_FIELD_NONE ? "" : chosenObj);
      }
      if (chosenObj.length > 0 || this.objPicker.closed) { this.objOpened = 0; this.objPickerComp = null; app.setFocus(0 - 1); }
    }
    this.ui.end();
  }
}


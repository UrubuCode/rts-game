import { Behavior, KIND_UI } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { EditorUI } from "./ui_controls";
import { MeshRenderer } from "@engine/core/meshrenderer";
import { Skeleton } from "@engine/core/skeleton";
import { previewIsPlaying, previewStart, previewPause, previewStop, previewStopAll, previewSeek, previewChooseClip,
  timelineTarget, animationPlayerOf, skeletonOfObject, animatorOfObject, animatorPreviewTouch, animatorPreviewIsActive,
  animatorPreviewStop } from "./skeleton_preview";
import type { Animator } from "@engine/core/animator";
import { PARAM_FLOAT, PARAM_BOOL } from "@engine/core/animator_controller";
import { ComponentPicker } from "./component_picker";
import { InspectorGUIEditor } from "./inspector_gui";
import { beginBoneEdit, boneDegreesInto, boneRotationFromDegreesInto, selectBone } from "./bone_gizmo";
import { attachEditorComponent } from "./script_drop";
import { history } from "./undo";
import { scene, S } from "./control/session";
import { nfCancel, AXIS_X, AXIS_Y, AXIS_Z } from "./widgets";
import input from "rts:input";
import { UI_C, UI_INSPECTOR as L, UI_COMPONENT_PICKER as P, UI_AXIS_NAMES,
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
  top: number = 0; bottom: number = 0;
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

  constructor(app: any) {
    super();
    this.ui = new EditorUI(app, "Editor/Inspector");
    this.gui = new InspectorGUIEditor(this);
    this.ui.root.addBehavior(this);
    const browser = this.ui.scene.createGameObject("Editor/Inspector/ComponentPicker", 0);
    browser.addBehavior(this.picker);
    this.picker.sceneIndex = this.ui.scene.count() - 1;
  }
  kind(): number { return KIND_UI; }
  typeName(): string { return "Inspector"; }
  snapshot(): void { if (!this.changed) { history.snapshot(); this.changed = true; } }
  visible(y: number, height: number): boolean { return y >= this.top && y + height <= this.bottom; }
  label(key: string, y: number, text: string): void {
    if (!this.visible(y, L.rowH)) return;
    const label = this.ui.control(key, "label", this.x + L.padding, y, this.width - L.padding * 2, L.rowH, text, false);
    this.ui.draw(label);
  }
  header(key: string, y: number, text: string, expanded: boolean): boolean {
    if (!this.visible(y, L.headerH)) return expanded;
    const header = this.ui.control(key, "header", this.x + L.padding, y, this.width - L.padding * 2,
      L.headerH, (expanded ? "v  " : ">  ") + text, this.enabledInput);
    header.fill = UI_C.componentHeader;
    this.ui.draw(header);
    return header.clicked ? !expanded : expanded;
  }
  /// Linha automática do campo `fieldIndex` (número, caixa ou texto), chave
  /// `key + "/Field/" + fieldIndex`. Usada pela lista automática e por `ui.field(nome)`.
  fieldRow(component: Behavior, key: string, fieldIndex: number, rowY: number): void {
    const fieldType = component.fieldType(fieldIndex);
    const field = this.ui.control(key + "/Field/" + fieldIndex, fieldType === "boolean" ? "toggle" : fieldType === "string" ? "propertyText" : "number",
      this.x + L.padding + L.gap, rowY, this.width - L.padding * 2 - L.gap, L.rowH, component.fieldLabel(fieldIndex), this.enabledInput);
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
  vector(key: string, y: number, label: string, values: number[], namesArg?: string[]): number[] {
    const names = namesArg !== undefined ? namesArg : UI_AXIS_NAMES;
    if (!this.visible(y, L.rowH)) return values;
    this.label(key + "/Label", y, label);
    const colors = [AXIS_X, AXIS_Y, AXIS_Z];
    const valueX = this.x + L.padding + L.labelW;
    const fieldWidth = (this.width - L.padding * 2 - L.labelW - L.axisGap * 2) / 3;
    let axisIndex = 0;
    while (axisIndex < names.length) {
      const axis = this.ui.control(key + "/" + names[axisIndex], "axis",
        valueX + axisIndex * (fieldWidth + L.axisGap), y, fieldWidth, L.rowH,
        names[axisIndex], this.enabledInput);
      axis.color = colors[axisIndex]; axis.value = values[axisIndex];
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
        const row = this.ui.control("Skeleton/Bone/" + bone, "row", innerX + indent, rowY, innerW - indent,
          K.boneRowH, asset.boneNames[bone], this.enabledInput);
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
        const button = this.ui.control("Skeleton/Clip/" + clipIndex, "button", innerX, rowY, innerW, K.clipRowH,
          this.clipLabels[clipIndex], this.enabledInput);
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
      const toggle = this.ui.control("Skeleton/Play", "button", innerX, rowY, halfW, L.rowH,
        playing ? K.pause : K.play, canPlay);
      this.ui.draw(toggle);
      if (toggle.clicked) {
        if (simulating) { if (playing) player.pause(); else player.resume(); }
        else if (playing) previewPause(player);
        else previewStart(player);
      }
      const stop = this.ui.control("Skeleton/Stop", "button", innerX + halfW + K.buttonGap, rowY, halfW, L.rowH, K.stop, canPlay);
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
      const timeline = this.ui.control("Skeleton/Time", "timeline", innerX, rowY, innerW, K.timelineH, this.timelineLabel, canPlay);
      timeline.value = duration > 0.0 ? player.time / duration : 0;
      this.ui.draw(timeline);
      if (timeline.hot !== 0) {
        const target = timelineTarget(player, timeline.value, duration);
        if (simulating) player.seek(target); else previewSeek(player, target);
      }
    }
    rowY = rowY + K.timelineH + L.gap;
    if (this.visible(rowY, L.rowH)) {
      const reset = this.ui.control("Skeleton/Reset", "button", innerX, rowY, innerW, L.rowH, K.resetPose, this.enabledInput);
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
        const label = this.ui.control("Animator/Error", "label", innerX, rowY, innerW, L.rowH, A.error + error, false);
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
        const key = "Animator/Param/" + param;
        const name = animator.paramName(param);
        if (type === PARAM_FLOAT) {
          const field = this.ui.control(key, "number", innerX, rowY, innerW, rowH, name, this.enabledInput);
          field.value = value; this.ui.draw(field);
          if (field.value !== value) { animator.setFloatAt(param, field.value); animatorPreviewTouch(animator); }
        } else if (type === PARAM_BOOL) {
          const box = this.ui.control(key, "toggle", innerX, rowY, innerW, rowH, name, this.enabledInput);
          box.value = value !== 0.0 ? 1 : 0; this.ui.draw(box);
          if ((box.value !== 0) !== (value !== 0.0)) { animator.setBoolAt(param, box.value !== 0); animatorPreviewTouch(animator); }
        } else {
          const button = this.ui.control(key, "button", innerX, rowY, innerW, rowH, name, this.enabledInput);
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
      this.label("Animator/Layer/" + layer, rowY, this.animatorLayerLabels[layer]);
      rowY = rowY + L.rowH;
      layer = layer + 1;
    }
    if (S.simulating === 0 && animatorPreviewIsActive(animator)) {
      if (this.visible(rowY, L.rowH)) {
        const stop = this.ui.control("Animator/StopPreview", "button", innerX, rowY, innerW, L.rowH, A.stopPreview, this.enabledInput);
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
    const rotation = this.vector("Skeleton/BoneRotation", rowY, K.boneRotation, rotationValues, K.rotationAxes);
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
        const heading = this.ui.control(this.compHeader[c], "header", this.x + L.padding, rowY,
          this.width - L.padding * 2 - L.iconW - L.gap, L.headerH,
          this.tituloComponente(c, component, expanded), this.enabledInput);
        heading.fill = UI_C.componentHeader; this.ui.draw(heading);
        if (heading.clicked) { component.collapsed = expanded ? 1 : 0; nfCancel(); }
        if (editavel) {
          const remove = this.ui.control(this.compRemove[c], "button", this.x + this.width - L.padding - L.iconW, rowY, L.iconW, L.headerH, "x", this.enabledInput);
          remove.color = UI_C.destructiveText; this.ui.draw(remove);
          if (remove.clicked) removeIndex = componentIndex;
        }
      }
      rowY = rowY + L.headerH + L.gap;
      if (component.collapsed === 0) {
        if (editavel && this.visible(rowY, L.rowH)) {
          const enabled = this.ui.control(this.compEnabled[c], "toggle", this.x + L.padding + L.gap, rowY,
            this.width - L.padding * 2, L.rowH, L.active, this.enabledInput);
          enabled.value = component.enabled; this.ui.draw(enabled);
          if (enabled.value !== component.enabled) { this.snapshot(); component.enabled = enabled.value; scene.markCollidersDirty(); }
        }
        if (editavel) rowY = rowY + L.rowH;
        // GUI própria do componente; sem nenhum controle pedido, a lista automática.
        this.gui.begin(component, key, rowY);
        component.onInspectorGUI(this.gui);
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
  renderJanela(janela: GameObject, x: number, y: number, width: number, mx: number, my: number): void {
    const titulo = this.ui.control("Window/Title", "label", x + L.padding, y + L.headerH + L.gap, width - L.padding * 2, L.rowH, this.janelaNome, false);
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
  render(app: any, x: number, y: number, width: number, height: number,
         mx: number, my: number, down: number, pressed: number, blocked: boolean,
         modelDrag: number, textureDrag: number): void {
    this.ui.begin(mx, my, down, pressed);
    this.x = x; this.width = width; this.changed = false;
    this.meshHot = 0; this.textureHot = 0;
    const selected = S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null;
    if (selected !== this.selectedObject || S.selected !== this.selection) {
      this.scroll = 0; this.contentHeight = 0; this.opened = 0;
      this.selectedObject = selected; this.selection = S.selected;
      nfCancel(); app.setFocus(0 - 1);
      // outro objeto: o osso escolhido não vale mais (salvo Desfazer/Refazer,
      // que re-liga o osso ao objeto restaurado — ver undo.ts) e a prévia de
      // animação (estado do editor) termina, com a pose de trabalho de volta à manual.
      if (S.selectedBoneOwner !== selected) selectBone(null, 0 - 1);
      previewStopAll();
    }
    if (this.janela !== null && S.selected !== this.janelaSel) this.janela = null;
    if (blocked) { this.opened = 0; nfCancel(); }
    this.enabledInput = !blocked && this.opened === 0;
    const background = this.ui.control("Background", "panel", x, y, width, height, "", false);
    background.fill = UI_C.panel; this.ui.draw(background);
    const title = this.ui.control("Title", "header", x, y, width, L.headerH, L.title, false);
    title.fill = UI_C.panelHeader; this.ui.draw(title);
    this.top = y + L.headerH + L.objectH;
    this.bottom = y + height - L.footerH;
    if (this.janela !== null) { this.renderJanela(this.janela, x, y, width, mx, my); return; }
    if (selected === null) { this.label("Empty", this.top, L.empty); this.label("EmptyHint", this.top + L.rowH, L.emptyHint); return; }
    const object: GameObject = selected;
    const name = this.ui.control("Name", "text", x + L.padding, y + L.headerH + L.gap,
      width - L.padding * 2, L.rowH, "", this.enabledInput);
    name.id = L.nameId; name.textValue = object.name; this.ui.draw(name);
    if (name.textValue !== object.name) { this.snapshot(); object.name = name.textValue; }
    const flagsY = y + L.headerH + L.gap + L.rowH;
    const active = this.ui.control("Active", "toggle", x + L.padding, flagsY, width / 2, L.rowH, L.active, this.enabledInput);
    active.value = object.active; this.ui.draw(active);
    if (active.value !== object.active) { this.snapshot(); object.active = active.value; scene.markCollidersDirty(); }
    const stationary = this.ui.control("Static", "toggle", x + width / 2, flagsY, width / 2 - L.padding, L.rowH, L.stationary, this.enabledInput);
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
      this.label("Parent/Name", rowY, L.parent + scene.objects[object.parent].name);
      rowY = rowY + L.rowH;
      if (this.visible(rowY, L.rowH)) {
        const unparent = this.ui.control("Parent/Detach", "button", x + L.padding, rowY,
          width - L.padding * 2, L.rowH, L.unparent, this.enabledInput);
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
      const position = this.vector("Transform/Position", rowY, L.position, [transform.px, transform.py, transform.pz]);
      // Mover um ESTATICO invalida o indice espacial estatico (o dinamico segue o transform sozinho).
      if (object.stationary !== 0 && (position[0] !== transform.px || position[1] !== transform.py || position[2] !== transform.pz)) scene.markCollidersDirty();
      transform.px = position[0]; transform.py = position[1]; transform.pz = position[2];
      rowY = rowY + L.rowH;
      const rxDegrees = transform.rx * DEGREES_PER_RADIAN;
      const ryDegrees = transform.ry * DEGREES_PER_RADIAN;
      const rzDegrees = transform.rz * DEGREES_PER_RADIAN;
      const rotation = this.vector("Transform/Rotation", rowY, L.rotation, [rxDegrees, ryDegrees, rzDegrees]);
      if (object.stationary !== 0 && (rotation[0] !== rxDegrees || rotation[1] !== ryDegrees || rotation[2] !== rzDegrees)) scene.markCollidersDirty();
      if (rotation[0] !== rxDegrees) transform.rx = rotation[0] / DEGREES_PER_RADIAN;
      if (rotation[1] !== ryDegrees) transform.ry = rotation[1] / DEGREES_PER_RADIAN;
      if (rotation[2] !== rzDegrees) transform.rz = rotation[2] / DEGREES_PER_RADIAN;
      rowY = rowY + L.rowH;
      const scale = this.vector("Transform/Scale", rowY, L.scale, [transform.sx, transform.sy, transform.sz]);
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
          const mesh = this.ui.control("Appearance/Mesh", "asset", x + L.padding, rowY, width - L.padding * 2, L.rowH, L.mesh, this.enabledInput);
          const kind = object.rendIdx >= 0 ? object.behaviors[object.rendIdx].rMeshKind() : object.meshKind;
          mesh.textValue = object.meshPath.length > 0 ? object.meshPath : UI_MESH_NAMES[Math.max(0, Math.min(UI_MESH_NAMES.length - 1, kind))];
          mesh.value = modelDrag; this.ui.draw(mesh); this.meshHot = mesh.hot;
        }
        rowY = rowY + L.rowH;
        if (this.visible(rowY, L.rowH)) {
          const cycle = this.ui.control("Appearance/ChangeMesh", "button", x + L.padding, rowY,
            width - L.padding * 2, L.rowH, L.changeMesh, this.enabledInput);
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
          const texture = this.ui.control("Appearance/Texture", "asset", x + L.padding, rowY, width - L.padding * 2, L.rowH, L.texture, this.enabledInput);
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
      const scrollbar = this.ui.control("Scrollbar", "panel", x + width - L.scrollbarW,
        this.top + (available - thumbH) * this.scroll / maxScroll, L.scrollbarW, thumbH, "", false);
      scrollbar.fill = UI_C.scrollbarThumb; this.ui.draw(scrollbar);
    }
    const footer = this.ui.control("Footer", "panel", x, this.bottom, width, L.footerH, "", false);
    footer.fill = UI_C.panelHeader; this.ui.draw(footer);
    const add = this.ui.control("AddComponent", "button", x + L.padding, this.bottom + L.gap,
      width - L.padding * 2, L.rowH, "+ " + P.title, !blocked);
    this.ui.draw(add);
    if (add.clicked) { this.opened = this.opened === 0 ? 1 : 0; nfCancel(); if (this.opened !== 0) this.picker.begin(app); else app.setFocus(0 - 1); }
    if (this.opened !== 0) {
      const chosen = this.picker.render(this.ui.scene, app, x + L.padding, this.bottom - L.gap,
        width - L.padding * 2, y + L.headerH, mx, my,
        add.clicked || (mx >= x && my >= this.bottom) ? 0 : pressed, input.wheel(app._win));
      if (chosen.length > 0) {
        this.snapshot();
        const added = attachEditorComponent(S.selected, chosen);
        this.scroll = Math.max(0, this.contentHeight + L.headerH + (added.fieldCount() + 1) * L.rowH + L.gap * 2 - available);
      }
      if (chosen.length > 0 || this.picker.closed) { this.opened = 0; app.setFocus(0 - 1); }
    }
    this.ui.end();
  }
}


import { GameObject } from "@engine/core/gameobject";
import { componentToData } from "@engine/components";
import { MissingScript } from "@engine/core/missing_script";
import { KIND_MATERIAL } from "@engine/core/behavior";
import { scene, S } from "./control/session";
import { recreateBehavior } from "./sceneio";
import { history } from "./undo";
import { stepReset, stepSimReset } from "@engine/core/fixedstep";
import { interpolateReset } from "@engine/core/interpolate";
import { Ambiente, copiarAmbiente } from "@engine/core/ambiente";
import { emitEditorEvent } from "./api";

// A cena original nao e serializada/reconstruida ao parar. Conservamos seus
// GameObjects e componentes; somente copias descartaveis recebem update.
export class PlayMode {
  originals: GameObject[] = [];
  undo: string[] = [];
  redo: string[] = [];
  selected: number = 0 - 1;
  selection: number[] = [];
  sceneName: string = "";
  light: number[] = [];
  ambiente: Ambiente = new Ambiente();
  error: string = "";

  play(): boolean {
    this.error = "";
    if (S.simulating !== 0) { S.playing = 1; stepReset(); return true; }
    const copies: GameObject[] = [];
    let objectIndex = 0;
    while (objectIndex < scene.objects.length) {
      const source = scene.objects[objectIndex];
      const copy = source.cloneShallow();
      copy.name = source.name; copy.parent = source.parent; copy.active = source.active;
      copy.colShape = source.colShape; copy.selFlag = source.selFlag;
      copy.transform.vx = source.transform.vx; copy.transform.vy = source.transform.vy; copy.transform.vz = source.transform.vz;
      copy.transform.mass = source.transform.mass;
      copy.transform.restitution = source.transform.restitution; copy.transform.friction = source.transform.friction;
      let behaviorIndex = 0;
      while (behaviorIndex < source.behaviors.length) {
        const original = source.behaviors[behaviorIndex];
        if (original instanceof MissingScript) { this.error = original.typeName(); return false; }
        const data = componentToData(original);
        if (data === null) { this.error = "Play indisponível: " + original.typeName() + " não suporta cópia."; return false; }
        const cloned = recreateBehavior(data);
        if (cloned.typeName() !== original.typeName()) {
          this.error = "Play indisponível: registre a cópia de " + original.typeName() + ".";
          return false;
        }
        cloned.enabled = original.enabled; cloned.collapsed = original.collapsed;
        if (original.kind() === KIND_MATERIAL) cloned.setMatTexture(original.matTexId(), original.matTexPath());
        copy.addBehavior(cloned);
        behaviorIndex = behaviorIndex + 1;
      }
      copies.push(copy);
      objectIndex = objectIndex + 1;
    }
    // So troca a cena depois de validar todos os componentes.
    this.originals = scene.objects.slice();
    this.sceneName = scene.name;
    this.selected = S.selected; this.selection = S.selection.slice();
    // a câmera da aba Jogo é um objeto: passa para a cópia correspondente
    const camJogo = S.gameCamera !== null ? this.originals.indexOf(S.gameCamera) : 0 - 1;
    this.light = [S.lightX, S.lightY, S.lightZ, S.lightAmb];
    copiarAmbiente(this.ambiente, scene.ambiente);
    this.undo = history.u; this.redo = history.r;
    history.u = []; history.r = [];
    scene.clear();
    let copyIndex = 0;
    while (copyIndex < copies.length) { scene.add(copies[copyIndex]); copyIndex = copyIndex + 1; }
    S.gameCamera = camJogo >= 0 ? copies[camJogo] : null;
    scene.computeWorld();
    stepReset(); stepSimReset(); interpolateReset();
    S.simulating = 1; S.playing = 1;
    emitEditorEvent("entrarPlay", "");
    return true;
  }

  pause(): void { if (S.simulating !== 0) { S.playing = 0; stepReset(); } }

  stop(): void {
    if (S.simulating === 0) return;
    S.playing = 0;
    // a câmera da aba Jogo volta da cópia para o original de mesma posição
    const camJogo = S.gameCamera !== null ? scene.objects.indexOf(S.gameCamera) : 0 - 1;
    scene.clear();
    let restoreIndex = 0;
    while (restoreIndex < this.originals.length) {
      // Nao executar mount novamente: os objetos de autoria nunca simularam.
      scene.add(this.originals[restoreIndex], false);
      restoreIndex = restoreIndex + 1;
    }
    scene.name = this.sceneName;
    S.selected = this.selected; S.selection = this.selection;
    S.gameCamera = camJogo >= 0 && camJogo < this.originals.length ? this.originals[camJogo] : null;
    S.lightX = this.light[0]; S.lightY = this.light[1]; S.lightZ = this.light[2]; S.lightAmb = this.light[3];
    copiarAmbiente(scene.ambiente, this.ambiente);
    history.u = this.undo; history.r = this.redo;
    this.originals = []; this.undo = []; this.redo = [];
    scene.computeWorld();
    stepReset(); interpolateReset();
    S.simulating = 0;
    emitEditorEvent("sairPlay", "");
  }
}

export const playMode = new PlayMode();

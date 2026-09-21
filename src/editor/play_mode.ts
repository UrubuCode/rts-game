import { GameObject } from "@engine/core/gameobject";
import { KIND_MATERIAL } from "@engine/core/behavior";
import { scene, S } from "./control/session";
import { recreateBehavior } from "./sceneio";
import { history } from "./undo";
import { stepReset } from "@engine/core/fixedstep";
import { interpolateReset } from "@engine/core/interpolate";

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
      let behaviorIndex = 0;
      while (behaviorIndex < source.behaviors.length) {
        const original = source.behaviors[behaviorIndex];
        const data = original.toData();
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
    this.light = [S.lightX, S.lightY, S.lightZ, S.lightAmb];
    this.undo = history.u; this.redo = history.r;
    history.u = []; history.r = [];
    scene.clear();
    let copyIndex = 0;
    while (copyIndex < copies.length) { scene.add(copies[copyIndex]); copyIndex = copyIndex + 1; }
    scene.computeWorld();
    stepReset(); interpolateReset();
    S.simulating = 1; S.playing = 1;
    return true;
  }

  pause(): void { if (S.simulating !== 0) { S.playing = 0; stepReset(); } }

  stop(): void {
    if (S.simulating === 0) return;
    S.playing = 0;
    scene.clear();
    let restoreIndex = 0;
    while (restoreIndex < this.originals.length) {
      // Nao executar mount novamente: os objetos de autoria nunca simularam.
      scene.add(this.originals[restoreIndex], false);
      restoreIndex = restoreIndex + 1;
    }
    scene.name = this.sceneName;
    S.selected = this.selected; S.selection = this.selection;
    S.lightX = this.light[0]; S.lightY = this.light[1]; S.lightZ = this.light[2]; S.lightAmb = this.light[3];
    history.u = this.undo; history.r = this.redo;
    this.originals = []; this.undo = []; this.redo = [];
    scene.computeWorld();
    stepReset(); interpolateReset();
    S.simulating = 0;
  }
}

export const playMode = new PlayMode();

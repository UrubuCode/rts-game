import fs from "@compat/fs";
import { scene, S } from "./control/session";
import { sceneToJSON, sceneFromJSON, saveScene } from "./sceneio";
import { history } from "./undo";
import { logInfo, logError } from "@engine/core/logger";
import { UI_DOCUMENT } from "./ui_config";

export function authoredSignature(json: string): string {
  const data = JSON.parse(json);
  // Moving the editor camera is not a change to authored game objects.
  return JSON.stringify({ name: data.name, objects: data.objects, light: data.light });
}

export class SceneDocument {
  path: string = ""; saved: string = ""; dirty: boolean = false;
  pending: string = ""; pendingPath: string = ""; error: string = "";
  initialize(path: string): void { this.path = path; this.saved = authoredSignature(sceneToJSON()); this.dirty = false; }
  refresh(): void { if (S.simulating === 0) this.dirty = authoredSignature(sceneToJSON()) !== this.saved; }
  save(path: string): boolean {
    this.error = "";
    if (S.simulating !== 0) { this.error = "Pare a simulacao antes de salvar."; return false; }
    if (path.length === 0) return false;
    try {
      saveScene(path); this.initialize(path); logInfo("Cena salva: " + path); return true;
    } catch (error) { this.error = "Falha ao salvar: " + String(error); logError(this.error); return false; }
  }
  request(action: string, path: string = ""): boolean {
    if (action !== "open" && action !== "new") return false;
    if (S.simulating !== 0) { this.error = "Pare a simulacao antes de trocar a cena."; logError(this.error); return false; }
    this.refresh(); this.error = "";
    this.pending = action; this.pendingPath = path;
    if (this.dirty) return false;
    return this.complete();
  }
  cancel(): void { this.pending = ""; this.pendingPath = ""; this.error = ""; }
  complete(): boolean {
    if (this.pending.length === 0 || S.simulating !== 0) return false;
    try {
      if (this.pending === "open") {
        const json = fs.read_text(this.pendingPath);
        sceneFromJSON(json);
        this.initialize(this.pendingPath);
      } else if (this.pending === "new") {
        scene.clear(); scene.name = UI_DOCUMENT.untitled; this.initialize("");
      } else return false;
      history.u = []; history.r = []; S.selected = scene.objects.length > 0 ? 0 : -1; S.selection = [];
      this.cancel(); return true;
    } catch (error) { this.error = "Falha ao abrir cena: " + String(error); logError(this.error); this.pending = ""; this.pendingPath = ""; return false; }
  }
}
export const sceneDocument = new SceneDocument();

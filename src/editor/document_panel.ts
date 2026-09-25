import { Behavior, KIND_UI } from "@engine/core/behavior";
import { EditorUI } from "./ui_controls";
import { sceneDocument } from "./scene_document";
import { chooseSceneFile } from "./scene_dialog";
import { UI_DOCUMENT as L, UI_C, UI_PICKER_KEYS } from "./ui_config";
import { S } from "./control/session";
import { logError } from "@engine/core/logger";

export function saveDocument(saveAs: boolean = false): boolean {
  if (S.simulating !== 0) return sceneDocument.save(sceneDocument.path);
  try {
    const path = saveAs || sceneDocument.path.length === 0 ? chooseSceneFile(true) : sceneDocument.path;
    return path.length > 0 && sceneDocument.save(path);
  } catch (error) { sceneDocument.error = String(error); logError(sceneDocument.error); return false; }
}

export class DocumentPanel extends Behavior {
  ui: EditorUI;
  constructor(app: any) { super(); this.ui = new EditorUI(app, "Editor/UnsavedChanges"); this.ui.root.addBehavior(this); }
  kind(): number { return KIND_UI; }
  render(w: number, h: number): void {
    this.ui.begin(0, 0, 0, 0);
    if (sceneDocument.pending.length === 0) { this.ui.end(); return; }
    const width = Math.min(L.width, w - L.padding * 2);
    const x = (w - width) / 2; const y = (h - L.height) / 2;
    const bg = this.ui.control("Background", "panel", x, y, width, L.height, "", false); bg.fill = UI_C.popupDark; this.ui.draw(bg);
    this.ui.draw(this.ui.control("Title", "label", x + L.padding, y + L.padding, width - L.padding * 2, L.rowH, L.title, false));
    this.ui.draw(this.ui.control("Hint", "label", x + L.padding, y + L.padding + L.rowH, width - L.padding * 2, L.rowH, L.hint, false));
    const error = this.ui.control("Error", "label", x + L.padding, y + L.padding + L.rowH * 2, width - L.padding * 2, L.rowH, sceneDocument.error, false); error.color = UI_C.destructiveText; this.ui.draw(error);
    const labels = [L.save, L.discard, L.cancel];
    const bw = (width - L.padding * 2 - L.gap * 2) / labels.length;
    let i = 0;
    while (i < labels.length) {
      const button = this.ui.control("Action/" + i, "button", x + L.padding + i * (bw + L.gap), y + L.height - L.padding - L.rowH, bw, L.rowH, labels[i]);
      this.ui.draw(button);
      if (button.clicked) {
        if (i === 2) sceneDocument.cancel();
        else if (i === 1 || saveDocument()) sceneDocument.complete();
        this.ui.app.setFocus(-1);
      }
      i = i + 1;
    }
    if (this.ui.app.keyPressed(UI_PICKER_KEYS.escape) !== 0) sceneDocument.cancel();
    this.ui.end();
  }
}

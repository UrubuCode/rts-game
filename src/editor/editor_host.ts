// O host real de @editor/api: lê a cena e a sessão do editor. Instalado pelo
// main.ts; o jogo exportado não instala nada e a API fica em no-op.
import type { Scene } from "@engine/core/scene";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import { EditorHost, instalarHost } from "./api";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { logInfo } from "@engine/core/logger";
import { UI_EDITOR_API } from "./ui_config";

export class EditorHostReal extends EditorHost {
  /// Abre um Behavior no Inspector (o main.ts liga ao Inspector; Task 10).
  janela: ((b: Behavior, titulo: string) => void) | null;
  constructor() { super(); this.ativo = true; this.janela = null; }
  scene(): Scene | null { return scene; }
  selection(): GameObject | null { return S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null; }
  select(o: GameObject | null): void {
    const i = o === null ? 0 - 1 : scene.objects.indexOf(o);
    S.selected = i; S.selection = i >= 0 ? [i] : [];
  }
  snapshot(rotulo: string): void { history.snapshot(); logInfo(UI_EDITOR_API.undoPrefix + rotulo); }
  log(msg: string): void { logInfo(msg); }
  viewPose(out: Float64Array): void { out[0] = S.camX; out[1] = S.camY; out[2] = S.camZ; out[3] = S.camYaw; out[4] = S.camPitch; }
  inspect(b: Behavior, titulo: string): void { if (this.janela !== null) this.janela(b, titulo); }
}
export function instalarEditorReal(): EditorHostReal { const h = new EditorHostReal(); instalarHost(h); return h; }

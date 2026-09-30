import fs from "@compat/fs";
import { scene, S } from "./control/session";
import { sceneToJSON, sceneFromJSON, saveScene } from "./sceneio";
import { history } from "./undo";
import { logInfo, logError } from "@engine/core/logger";
import { UI_DOCUMENT } from "./ui_config";
import { criarLuzDirecionalPadrao } from "@engine/core/light";
import { emitEditorEvent } from "./api";

export function authoredSignature(json: string): string {
  const data = JSON.parse(json);
  // Moving the editor camera is not a change to authored game objects.
  return JSON.stringify({ name: data.name, objects: data.objects, light: data.light, ambiente: data.ambiente });
}

/// Assinatura numérica barata da cena (transforms, nomes, malhas, hierarquia,
/// componentes, luz legada e versões de histórico/composição), sem alocar.
/// Serve só para decidir SE vale serializar a cena e comparar com o salvo.
export function assinaturaRapida(): number {
  let h: f64 = history.versao * 7919.0 + scene.compVersion * 104729.0 + scene.objects.length * 31.0;
  h = h + S.lightX * 3.0 + S.lightY * 5.0 + S.lightZ * 7.0 + S.lightAmb * 11.0;
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i]; const t = o.transform; const k: f64 = i + 1.0;
    h = h + k * (t.px * 1.3 + t.py * 1.7 + t.pz * 1.9 + t.rx * 2.3 + t.ry * 2.9 + t.rz * 3.1 + t.sx * 3.7 + t.sy * 4.1 + t.sz * 4.3);
    const nome = o.name; let c = 0;
    while (c < nome.length) { h = h + k * (c + 1.0) * nome.charCodeAt(c) * 0.013; c = c + 1; }
    h = h + k * (nome.length * 5.3 + o.meshKind * 5.9 + o.active * 6.1 + o.parent * 6.7 + o.behaviors.length * 7.1 + o.stationary * 7.3);
    i = i + 1;
  }
  return h;
}

export class SceneDocument {
  path: string = ""; saved: string = ""; dirty: boolean = false;
  /// Assinatura rápida da última comparação completa, e quantos `refresh` seguidos a pularam.
  rapida: number = 0; pulados: number = 0;
  pending: string = ""; pendingPath: string = ""; error: string = "";
  initialize(path: string): void {
    this.path = path; this.saved = authoredSignature(sceneToJSON()); this.dirty = false;
    this.rapida = assinaturaRapida(); this.pulados = 0;
  }
  /// Recalcula `dirty`. Serializar a cena para comparar era ~17k objetos de lixo
  /// a cada `UI_DOCUMENT.pollMs` (vitrine) — o que sobrava de coleta no editor
  /// parado. Agora a comparação completa só roda quando a assinatura rápida
  /// muda, ou a cada `UI_DOCUMENT.fullCheckEvery` chamadas (edições que não
  /// passam pelo histórico nem mexem em transform/nome/malha continuam vistas).
  refresh(): void {
    if (S.simulating !== 0) return;
    const r = assinaturaRapida();
    if (r === this.rapida && this.pulados + 1 < UI_DOCUMENT.fullCheckEvery) { this.pulados = this.pulados + 1; return; }
    this.rapida = r; this.pulados = 0;
    this.dirty = authoredSignature(sceneToJSON()) !== this.saved;
  }
  save(path: string): boolean {
    this.error = "";
    if (S.simulating !== 0) { this.error = "Pare a simulacao antes de salvar."; return false; }
    if (path.length === 0) return false;
    try {
      saveScene(path); this.initialize(path); logInfo("Cena salva: " + path); emitEditorEvent("salvar", path); return true;
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
  /// Ponto ÚNICO de "cena aberta" (UI, WS `loadscene`, cena nova): marca o
  /// documento como limpo e dispara o gancho `abrirCena` de @editor/api.
  /// Todo caminho que troca a cena editada passa por aqui.
  opened(path: string): void { this.initialize(path); emitEditorEvent("abrirCena", path); }
  cancel(): void { this.pending = ""; this.pendingPath = ""; this.error = ""; }
  complete(): boolean {
    if (this.pending.length === 0 || S.simulating !== 0) return false;
    const caminho = this.pendingPath;   // "" na cena nova
    try {
      if (this.pending === "open") {
        const json = fs.read_text(this.pendingPath);
        sceneFromJSON(json);
      } else if (this.pending === "new") {
        scene.clear(); scene.name = UI_DOCUMENT.untitled; criarLuzDirecionalPadrao(scene); scene.computeWorld();
      } else return false;
      history.u = []; history.r = []; S.selected = scene.objects.length > 0 ? 0 : -1; S.selection = [];
      this.cancel(); this.opened(caminho); return true;
    } catch (error) { this.error = "Falha ao abrir cena: " + String(error); logError(this.error); this.pending = ""; this.pendingPath = ""; return false; }
  }
}
export const sceneDocument = new SceneDocument();

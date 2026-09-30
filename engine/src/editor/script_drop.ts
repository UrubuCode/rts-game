import { COMPONENT_CATALOG } from "./component_catalog";
import { createComponent } from "./components";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { Behavior } from "@engine/core/behavior";

// Match the generated source path, never guess a class from the filename.
export function normalizeScriptPath(path: string): string {
  const parts = path.split("\\").join("/").split("/");
  const clean: string[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    if (part === "..") {
      if (clean.length === 0) return "";
      clean.pop();
    } else if (part !== "." && part.length > 0) clean.push(part);
    i = i + 1;
  }
  return clean.join("/");
}

export function scriptComponents(path: string): string[] {
  const source = normalizeScriptPath(path);
  const names: string[] = [];
  let i = 0;
  while (i < COMPONENT_CATALOG.length) {
    if (COMPONENT_CATALOG[i].source === source) names.push(COMPONENT_CATALOG[i].name);
    i = i + 1;
  }
  return names;
}

// Shared attachment lifecycle for the picker and script drop.
export function attachEditorComponent(index: number, name: string): Behavior {
  const object = scene.objects[index];
  const component = createComponent(name);
  object.addBehavior(component);
  component.mount();
  if (component.bodyIntegrates() !== 0) { object.stationary = 0; object.refreshCollide(); }
  scene.markCollidersDirty();
  return component;
}

export function scriptDropError(path: string, index: number): string {
  if (S.simulating !== 0) return "Pare a simulacao para adicionar scripts.";
  if (index < 0 || index >= scene.objects.length) return "Solte sobre um GameObject ou seu Inspector.";
  const names = scriptComponents(path);
  if (names.length === 0) return "Script nao registrado. Exporte um Behavior e recompile o editor.";
  if (names.length > 1) return "Varias classes neste arquivo. Escolha em Adicionar componente.";
  return "";
}

export function dropScriptOnObject(path: string, index: number): string {
  const error = scriptDropError(path, index);
  if (error.length > 0) return error;
  const names = scriptComponents(path);
  history.snapshot();
  attachEditorComponent(index, names[0]);
  S.selected = index;
  S.selection = [];
  return "";
}

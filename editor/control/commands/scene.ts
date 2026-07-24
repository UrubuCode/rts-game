// Comandos de CENA/sessão: select, delete, cam, focus, play, pause, clear, loadscene.
import math from "rts:math";
import { scene, S } from "../session";
import { loadSceneFrom, instantiateSceneUnder, cloneObject, saveScene } from "../../sceneio";

export function cmdSelect(parts: string[]): string {
  S.selected = parseFloat(parts[1]) | 0;
  S.selection = [];   // seleção ÚNICA (limpa a multi)
  return "[ok] select #" + S.selected;
}

/// selectadd <i> — adiciona à MULTI-seleção (o gizmo manipula todos juntos).
export function cmdSelectAdd(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: selectadd <i>";
  const i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  // garante o selected atual na lista + adiciona i (sem duplicar)
  if (S.selection.length === 0 && S.selected >= 0) S.selection.push(S.selected);
  let j = 0; let has = 0;
  while (j < S.selection.length) { if (S.selection[j] === i) has = 1; j = j + 1; }
  if (has === 0) S.selection.push(i);
  S.selected = i;
  return "[ok] selectadd #" + i + " (multi: " + S.selection.length + ")";
}

/// view <top|front|side|persp> — posiciona a câmera num preset (olhando a origem).
export function cmdView(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: view <top|front|side|persp>";
  const v = parts[1];
  if (v === "top") {
    S.camX = 0.0; S.camY = 22.0; S.camZ = 0.1; S.camYaw = 0.0; S.camPitch = 0 - 1.55;
  } else if (v === "front") {
    S.camX = 0.0; S.camY = 4.0; S.camZ = 0 - 20.0; S.camYaw = 0.0; S.camPitch = 0 - 0.15;
  } else if (v === "side") {
    S.camX = 0 - 20.0; S.camY = 4.0; S.camZ = 0.0; S.camYaw = 1.5708; S.camPitch = 0 - 0.15;
  } else if (v === "persp") {
    S.camX = 0.0; S.camY = 11.0; S.camZ = 0 - 15.0; S.camYaw = 0.0; S.camPitch = 0 - 0.5;
  } else {
    return "[erro] view invalido: " + v + " (top|front|side|persp)";
  }
  return "[ok] view " + v;
}

/// rename <i> <nome...> — renomeia o objeto (nome = resto da linha).
export function cmdRename(parts: string[]): string {
  if (parts.length < 3) return "[erro] uso: rename <i> <nome>";
  const i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  let nm = parts[2];
  let k = 3;
  while (k < parts.length) { nm = nm + " " + parts[k]; k = k + 1; }
  scene.objects[i].name = nm;
  return "[ok] rename #" + i + " -> " + nm;
}

/// selectclear — volta pra seleção única (esvazia a multi).
export function cmdSelectClear(parts: string[]): string {
  S.selection = [];
  return "[ok] selectclear (seleção única)";
}

/// focus <i> — enquadra a câmera do editor no objeto (Unity "frame selected").
export function cmdFocus(parts: string[]): string {
  const idx = parseFloat(parts[1]) | 0;
  if (idx < 0 || idx >= scene.objects.length) return "[erro] objeto invalido";
  const o = scene.objects[idx];
  const wx: f64 = o.transform.wx; const wy: f64 = o.transform.wy; const wz: f64 = o.transform.wz;
  let sz: f64 = o.transform.sx;
  if (o.transform.sy > sz) sz = o.transform.sy;
  if (o.transform.sz > sz) sz = o.transform.sz;
  const dist: f64 = sz * 2.2 + 3.0;
  S.camX = wx; S.camY = wy + dist * 0.4; S.camZ = wz - dist; S.camYaw = 0.0;
  S.camPitch = math.atan2(wy - S.camY, dist);
  return "[ok] focus #" + idx + " " + o.name;
}

export function cmdDelete(parts: string[]): string {
  scene.removeAt(parseFloat(parts[1]) | 0);
  if (S.selected >= scene.objects.length) S.selected = scene.objects.length - 1;
  if (S.selected < 0) S.selected = 0;
  return "[ok] delete";
}

export function cmdCam(parts: string[]): string {
  S.camX = parseFloat(parts[1]); S.camY = parseFloat(parts[2]); S.camZ = parseFloat(parts[3]);
  S.camYaw = parseFloat(parts[4]); S.camPitch = parseFloat(parts[5]);
  return "[ok] cam";
}

export function cmdPlay(): string { S.playing = 1; return "[ok] play"; }
export function cmdPause(): string { S.playing = 0; return "[ok] pause"; }

export function cmdClear(): string {
  scene.clear();
  S.selected = 0;
  return "[ok] clear";
}

export function cmdLoad(parts: string[]): string {
  loadSceneFrom(parts[1]);
  return "[ok] loadscene " + parts[1] + " -> " + scene.objects.length;
}

/// savescene <path> — SALVA a cena atual num arquivo JSON (fecha o loop com loadscene).
export function cmdSaveScene(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: savescene <path>";
  const n = saveScene(parts[1]) | 0;
  return "[ok] savescene " + parts[1] + " <- " + n + " objs";
}

/// dup [i] — duplica o objeto (default = selecionado), deslocado em +1 no X, e
/// seleciona a cópia. (Clone raso: copia transform+aparência; behaviors ainda não.)
export function cmdDup(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const g = cloneObject(scene.objects[i]);   // transform+aparência + scripts de gameplay
  g.transform.px = g.transform.px + 1.0;
  scene.add(g);
  S.selected = scene.objects.length - 1;
  return "[ok] dup #" + i + " -> #" + S.selected + " (" + g.name + ")";
}

/// instscene <path> [hostIdx] — CENA DENTRO DE CENA: instancia uma cena inteira
/// sob o objeto hostIdx (default = selecionado). Mover o host move a sub-cena toda.
export function cmdInstScene(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: instscene <path> [hostIdx]";
  let host = S.selected;
  if (parts.length > 2) host = parseFloat(parts[2]) | 0;
  const before = scene.objects.length;
  const n = instantiateSceneUnder(parts[1], host) | 0;
  if (n === 0) return "[erro] falha ao instanciar (arquivo/objetos): " + parts[1];
  return "[ok] instscene " + parts[1] + " -> " + n + " objs sob #" + host + " (cena agora com " + scene.objects.length + ")";
}

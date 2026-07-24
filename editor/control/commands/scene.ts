// Comandos de CENA/sessão: select, delete, cam, focus, play, pause, clear, loadscene.
import math from "rts:math";
import { scene, S } from "../session";
import { loadSceneFrom, instantiateSceneUnder } from "../../sceneio";

export function cmdSelect(parts: string[]): string {
  S.selected = parseFloat(parts[1]) | 0;
  return "[ok] select #" + S.selected;
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

/// dup [i] — duplica o objeto (default = selecionado), deslocado em +1 no X, e
/// seleciona a cópia. (Clone raso: copia transform+aparência; behaviors ainda não.)
export function cmdDup(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const g = scene.objects[i].cloneShallow();
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

// Comandos de CENA/sessão: select, delete, cam, play, pause, clear, loadscene.
import { scene, S } from "../session";
import { loadSceneFrom } from "../../sceneio";

export function cmdSelect(parts: string[]): string {
  S.selected = parseFloat(parts[1]) | 0;
  return "[ok] select #" + S.selected;
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

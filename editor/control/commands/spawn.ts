// Comando SPAWN: cria um GameObject na cena. Nasce `stationary` (a posição
// pedida gruda — a colisão não empurra).
import { scene, S } from "../session";
import { GameObject } from "../../../engine/core/gameobject";

export function cmdSpawn(parts: string[], np: number): string {
  const idx = scene.objects.length;
  const go = new GameObject(parts[1]);
  let k = 1;
  if (np > 5) k = parseFloat(parts[5]) | 0;
  go.setMesh(k, 120, 180, 255);
  go.transform.setPosition(parseFloat(parts[2]), parseFloat(parts[3]), parseFloat(parts[4]));
  if (np > 6) go.transform.setScale(parseFloat(parts[6]));
  go.stationary = 1;
  scene.add(go);
  S.selected = idx;
  return "[ok] spawn #" + idx + " " + parts[1];
}

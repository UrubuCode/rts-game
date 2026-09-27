// Comando SPAWN: cria um GameObject na cena. Nasce `stationary` (a posição
// pedida gruda — a colisão não empurra).
import { scene, S } from "../session";
import { GameObject } from "@engine/core/gameobject";
import { argNum, argInt, argsNumericos } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";

/// Faixa do `kind` do spawn (1 cubo .. 4 esfera; 0 = vazio).
const SPAWN_KIND_MAX: number = 4;

export function cmdSpawn(parts: string[], np: number): string {
  if (np < 5 || parts[1].length === 0) return erroUso("spawn");
  if (!argsNumericos(parts, 2, 3)) return erroUso("spawn") + " (x, y e z numericos)";
  let k = 1;
  if (np > 5) {
    k = argInt(parts, 5);
    if (!(k >= 0 && k <= SPAWN_KIND_MAX)) return "[erro] kind invalido: '" + parts[5] + "' (0.." + SPAWN_KIND_MAX + ")";
  }
  let escala: f64 = 1.0;
  if (np > 6) { escala = argNum(parts, 6); if (!(escala > 0.0)) return "[erro] escala precisa ser um numero > 0: " + parts[6]; }
  const idx = scene.objects.length;
  const go = new GameObject(parts[1]);
  go.setMesh(k, 120, 180, 255);
  go.transform.setPosition(argNum(parts, 2), argNum(parts, 3), argNum(parts, 4));
  if (np > 6) go.transform.setScale(escala);
  go.stationary = 1;
  scene.add(go);
  S.selected = idx;
  return "[ok] spawn #" + idx + " " + parts[1];
}

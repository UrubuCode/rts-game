// Comandos de TRANSFORM/aparência de 1 objeto: move, scl, mesh, color, spin.
import { scene } from "../session";
import { Spinner } from "../../../scripts/spinner";

export function cmdMove(parts: string[]): string {
  const o = scene.objects[parseFloat(parts[1]) | 0];
  o.transform.px = parseFloat(parts[2]);
  o.transform.py = parseFloat(parts[3]);
  o.transform.pz = parseFloat(parts[4]);
  return "[ok] move";
}

export function cmdScl(parts: string[]): string {
  const o = scene.objects[parseFloat(parts[1]) | 0];
  o.transform.sx = parseFloat(parts[2]);
  o.transform.sy = parseFloat(parts[3]);
  o.transform.sz = parseFloat(parts[4]);
  return "[ok] scl";
}

export function cmdMesh(parts: string[]): string {
  scene.objects[parseFloat(parts[1]) | 0].meshKind = parseFloat(parts[2]) | 0;
  return "[ok] mesh";
}

export function cmdColor(parts: string[]): string {
  const o = scene.objects[parseFloat(parts[1]) | 0];
  o.cr = parseFloat(parts[2]) | 0;
  o.cg = parseFloat(parts[3]) | 0;
  o.cb = parseFloat(parts[4]) | 0;
  return "[ok] color";
}

export function cmdSpin(parts: string[], np: number): string {
  let sx: f64 = 0.0;
  if (np > 3) sx = parseFloat(parts[3]);
  scene.objects[parseFloat(parts[1]) | 0].addBehavior(new Spinner(parseFloat(parts[2]), sx));
  return "[ok] spin";
}

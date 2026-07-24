// Comandos de TRANSFORM/aparência de 1 objeto: move, scl, mesh, color, spin, tool.
import { scene, S } from "../session";
import { Spinner } from "../../../scripts/spinner";

/// reset [i] — zera a rotação e põe escala 1 do objeto (default=selecionado);
/// mantém a posição. Equivale ao "Reset" do Transform da Unity (sem mover pra origem).
export function cmdReset(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) i = parseFloat(parts[1]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const t = scene.objects[i].transform;
  t.rx = 0.0; t.ry = 0.0; t.rz = 0.0;
  t.sx = 1.0; t.sy = 1.0; t.sz = 1.0;
  return "[ok] reset #" + i + " (rot 0, escala 1)";
}

/// snap [0|1] — liga/desliga (ou consulta) o snap-to-grid do gizmo (move 0.5, rot 15°).
export function cmdSnap(parts: string[]): string {
  if (parts.length < 2) return "[snap] " + (S.snap !== 0 ? "on" : "off") + " (use: snap 0|1)";
  S.snap = (parseFloat(parts[1]) | 0) !== 0 ? 1 : 0;
  return "[ok] snap = " + (S.snap !== 0 ? "on" : "off");
}

/// tool [move|rotate|scale|select] — troca (ou consulta) a ferramenta do gizmo.
/// A IA dirige o mesmo gizmo que o humano vê na viewport.
export function cmdTool(parts: string[]): string {
  if (parts.length < 2) {
    let cur = "select";
    if (S.tool === 1) cur = "move"; else if (S.tool === 2) cur = "rotate"; else if (S.tool === 3) cur = "scale";
    return "[tool] atual = " + cur + " (use: tool move|rotate|scale|select)";
  }
  const t = parts[1];
  if (t === "move") S.tool = 1;
  else if (t === "rotate") S.tool = 2;
  else if (t === "scale") S.tool = 3;
  else if (t === "select") S.tool = 0;
  else return "[erro] ferramenta invalida: " + t + " (move|rotate|scale|select)";
  return "[ok] tool = " + t;
}

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

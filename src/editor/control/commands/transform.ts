// Comandos de TRANSFORM/aparência de 1 objeto: move, scl, mesh, color, spin, tool.
import { scene, S } from "../session";
import { Spinner } from "@scripts/spinner";
import { argNum, argInt, argObj, erroObj, argsNumericos } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";

/// Maior `meshKind` primitivo (0 = vazio, 1 cubo, 2 pirâmide, 3 octaedro, 4 esfera).
const MESH_KIND_MAX: number = 4;
/// Faixa de um canal de cor do objeto.
const COR_MAX: number = 255;

/// align [i] [step] — arredonda a POSIÇÃO do objeto pro grid na hora (default step 0.5).
export function cmdAlign(parts: string[]): string {
  let i = S.selected;
  let step = 0.5;
  if (parts.length > 1) { i = argObj(parts, 1); if (i < 0) return erroObj(parts, 1); }
  if (parts.length > 2) { step = argNum(parts, 2); if (!(step > 0.0)) return "[erro] passo do grid precisa ser um numero > 0: " + parts[2]; }
  if (i < 0 || i >= scene.objects.length) return "[erro] nenhum objeto selecionado";
  const t = scene.objects[i].transform;
  t.px = snapAt(t.px, step); t.py = snapAt(t.py, step); t.pz = snapAt(t.pz, step);
  if (scene.objects[i].stationary !== 0) scene.markCollidersDirty();
  return "[ok] align #" + i + " (grid " + step + ")";
}

// round pro múltiplo mais próximo (local, evita import cruzado).
function snapAt(v: f64, step: f64): f64 {
  const n = v / step;
  const r = n >= 0.0 ? ((n + 0.5) | 0) : (0 - ((0.5 - n) | 0));
  return (r * 1.0) * step;
}

/// reset [i] — zera a rotação e põe escala 1 do objeto (default=selecionado);
/// mantém a posição. Equivale ao "Reset" do Transform da Unity (sem mover pra origem).
export function cmdReset(parts: string[]): string {
  let i = S.selected;
  if (parts.length > 1) { i = argObj(parts, 1); if (i < 0) return erroObj(parts, 1); }
  if (i < 0 || i >= scene.objects.length) return "[erro] nenhum objeto selecionado";
  const t = scene.objects[i].transform;
  t.rx = 0.0; t.ry = 0.0; t.rz = 0.0;
  t.sx = 1.0; t.sy = 1.0; t.sz = 1.0;
  if (scene.objects[i].stationary !== 0) scene.markCollidersDirty();
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
  const i = argObj(parts, 1);
  if (i < 0) return parts.length < 2 ? erroUso("move") : erroObj(parts, 1);
  if (!argsNumericos(parts, 2, 3)) return erroUso("move") + " (x, y e z numericos)";
  const o = scene.objects[i];
  o.transform.px = argNum(parts, 2);
  o.transform.py = argNum(parts, 3);
  o.transform.pz = argNum(parts, 4);
  if (o.stationary !== 0) scene.markCollidersDirty();
  return "[ok] move";
}

export function cmdScl(parts: string[]): string {
  const i = argObj(parts, 1);
  if (i < 0) return parts.length < 2 ? erroUso("scl") : erroObj(parts, 1);
  if (!argsNumericos(parts, 2, 3)) return erroUso("scl") + " (sx, sy e sz numericos)";
  const o = scene.objects[i];
  scene.markStaticDirty();   // a escala define o raio de colisão (cacheado em Scene)
  o.transform.sx = argNum(parts, 2);
  o.transform.sy = argNum(parts, 3);
  o.transform.sz = argNum(parts, 4);
  return "[ok] scl";
}

export function cmdMesh(parts: string[]): string {
  const i = argObj(parts, 1);
  if (i < 0) return parts.length < 2 ? erroUso("mesh") : erroObj(parts, 1);
  const k = argInt(parts, 2);
  if (!(k >= 0 && k <= MESH_KIND_MAX)) return "[erro] kind invalido: '" + (parts.length > 2 ? parts[2] : "") + "' (0.." + MESH_KIND_MAX + ")";
  scene.objects[i].meshKind = k;
  return "[ok] mesh";
}

export function cmdColor(parts: string[]): string {
  const i = argObj(parts, 1);
  if (i < 0) return parts.length < 2 ? erroUso("color") : erroObj(parts, 1);
  let c = 2;
  while (c < 5) {
    const v = argNum(parts, c);
    if (!(v >= 0 && v <= COR_MAX)) return erroUso("color") + " (r, g e b de 0 a " + COR_MAX + ")";
    c = c + 1;
  }
  const o = scene.objects[i];
  o.cr = argNum(parts, 2) | 0;
  o.cg = argNum(parts, 3) | 0;
  o.cb = argNum(parts, 4) | 0;
  return "[ok] color";
}

export function cmdSpin(parts: string[], np: number): string {
  const i = argObj(parts, 1);
  if (i < 0) return parts.length < 2 ? erroUso("spin") : erroObj(parts, 1);
  const sy = argNum(parts, 2);
  if (sy !== sy) return erroUso("spin") + " (spdY numerico)";
  let sx: f64 = 0.0;
  if (np > 3) { sx = argNum(parts, 3); if (sx !== sx) return erroUso("spin") + " (spdX numerico)"; }
  scene.objects[i].addBehavior(new Spinner(sy, sx));
  return "[ok] spin";
}

// gizmoat <sx> <sy> — o clique num ícone de gizmo, pela porta de controle:
// seleciona o dono do ícone sob o pixel (os ícones do último frame desenhado).
import { S } from "../session";
import { gizmosDoEditor, gizmoIconAt } from "../../gizmo_pass";
export function cmdGizmoAt(parts: string[]): string {
  const x = parseFloat(parts[1]); const y = parseFloat(parts[2]);
  if (parts.length < 3 || x !== x || y !== y) return "[erro] uso: gizmoat <sx> <sy>";
  const dono = gizmoIconAt(gizmosDoEditor, x, y);
  if (dono < 0) return "[gizmoat] nenhum ícone em (" + x + "," + y + ")";
  S.selected = dono; S.selection = [dono];
  return "[ok] #" + dono + " selecionado";
}

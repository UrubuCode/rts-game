// gizmoat <sx> <sy> — o clique num ícone de gizmo, pela porta de controle:
// seleciona o dono do ícone sob o pixel (os ícones do último frame desenhado).
import { S } from "../session";
import { argNum, argsNumericos } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";
import { gizmosDoEditor, gizmoIconAt } from "../../gizmo_pass";
export function cmdGizmoAt(parts: string[]): string {
  if (!argsNumericos(parts, 1, 2)) return erroUso("gizmoat");
  const x = argNum(parts, 1); const y = argNum(parts, 2);
  const dono = gizmoIconAt(gizmosDoEditor, x, y);
  if (dono < 0) return "[gizmoat] nenhum ícone em (" + x + "," + y + ")";
  S.selected = dono; S.selection = [dono];
  return "[ok] #" + dono + " selecionado";
}

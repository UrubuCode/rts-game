// Passe de gizmos da vista de Cena: chama onDrawGizmos(Selected) e os
// desenhadores por tipo dos objetos visíveis, pinta linhas e ícones por cima do
// 3D e responde o clique num ícone com a MESMA área do desenho.
import type { Scene } from "@engine/core/scene";
import { Gizmos, gizmoDrawerIndex, runGizmoDrawer } from "@engine/core/gizmos";
import { drawEditorIcon } from "./icon_images";
import { UI_GIZMO } from "./ui_config";

/// A instância da vista de Cena: o main.ts desenha nela e o `gizmoat` lê os
/// ícones do último frame (o construtor de Gizmos atribui campos, então a
/// instância no topo do módulo não cai no defeito de "not defined").
export const gizmosDoEditor = new Gizmos();

export function coletarGizmos(g: Gizmos, sc: Scene, selecionado: number): number {
  const objs = sc.objects;
  let desenharam = 0;
  let i = 0;
  while (i < objs.length) {
    const o = objs[i];
    if (o.gizmoFlag !== 0 && o.active !== 0) {
      g.dono = i; g.selecionado = i === selecionado || o.selFlag !== 0;
      let k = 0;
      while (k < o.behaviors.length) {
        const b = o.behaviors[k];
        if (b.enabled !== 0) {
          b.onDrawGizmos(g);
          if (g.selecionado) b.onDrawGizmosSelected(g);
          const d = gizmoDrawerIndex(b.typeName());
          if (d >= 0) runGizmoDrawer(d, g, o, b);
        }
        k = k + 1;
      }
      desenharam = desenharam + 1;
    }
    i = i + 1;
  }
  return desenharam;
}
export function pintarGizmos(app: any, win: number, g: Gizmos): void {
  let k = 0;
  while (k < g.nSeg) {
    const s = k * 5;
    app.line(g.seg[s], g.seg[s + 1], g.seg[s + 2], g.seg[s + 3], UI_GIZMO.lineWidth, g.seg[s + 4]);
    k = k + 1;
  }
  k = 0;
  while (k < g.nIc) { const s = k * 4; drawEditorIcon(win, g.icNomes[k], g.ic[s], g.ic[s + 1], g.ic[s + 2]); k = k + 1; }
}
/// Dono do ícone sob (mx, my), do de cima para o de baixo; -1 = nenhum.
export function gizmoIconAt(g: Gizmos, mx: number, my: number): number {
  let achado = 0 - 1;
  let k = g.nIc - 1;
  while (k >= 0 && achado < 0) {
    const s = k * 4;
    if (mx >= g.ic[s] && mx < g.ic[s] + g.ic[s + 2] && my >= g.ic[s + 1] && my < g.ic[s + 1] + g.ic[s + 2]) achado = g.ic[s + 3];
    k = k - 1;
  }
  return achado;
}

// Passe de gizmos da vista de Cena: chama onDrawGizmos(Selected) e os
// desenhadores por tipo dos objetos visíveis, pinta linhas e ícones por cima do
// 3D e responde o clique num ícone com a MESMA área do desenho.
import type { Scene } from "@engine/core/scene";
import { Behavior, FALHA_GIZMO } from "@engine/core/behavior";
import { logError } from "@engine/core/logger";
import { Gizmos, gizmoDrawerIndex, runGizmoDrawer } from "@engine/core/gizmos";
import { drawEditorIcon, iconAt } from "./icon_images";
import { UI_GIZMO } from "./ui_config";

import { linha, traco } from "@compat/draw2d.ts";
/// A instância da vista de Cena: o main.ts desenha nela e o `gizmoat` lê os
/// ícones do último frame (o construtor de Gizmos atribui campos, então a
/// instância no topo do módulo não cai no defeito de "not defined").
export const gizmosDoEditor = new Gizmos();
/// Componente cujo gancho de gizmo está rodando agora (null fora dele): se um
/// script lançar, o passe protegido sabe quem desligar.
let gizmoEmCurso: Behavior | null = null;
/// Quantas vezes um quadro recoleta depois de desligar um gizmo que lançou; o
/// que sobrar fica para o próximo quadro.
const GIZMO_RECOLETAS_POR_QUADRO: number = 4;

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
        if (b.enabled !== 0 && (b.falhasEditor & FALHA_GIZMO) === 0) {
          gizmoEmCurso = b;
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
  gizmoEmCurso = null;
  return desenharam;
}

/// Entrada do passe de gizmos do editor (uma vez por quadro): `coletarGizmos`
/// com a exceção de um script contida. O componente que lançou é registrado no
/// Console uma vez e tem o gizmo desligado; o quadro recoleta sem ele.
export function passeDeGizmosProtegido(g: Gizmos, sc: Scene, selecionado: number): number {
  let n = coletarGizmosTentando(g, sc, selecionado);
  let tentativas = 0;
  while (n < 0 && tentativas < GIZMO_RECOLETAS_POR_QUADRO) {
    g.nSeg = 0; g.nIc = 0;
    n = coletarGizmosTentando(g, sc, selecionado);
    tentativas = tentativas + 1;
  }
  return n;
}
/// O `try` fica sozinho nesta função pequena (no RTS a função que contém `try`
/// aloca por chamada): -1 = um gizmo lançou e foi desligado.
function coletarGizmosTentando(g: Gizmos, sc: Scene, selecionado: number): number {
  try { return coletarGizmos(g, sc, selecionado); }
  catch (e) { desligarGizmoQueFalhou(e); }
  return 0 - 1;
}
function desligarGizmoQueFalhou(e: any): void {
  const b = gizmoEmCurso;
  gizmoEmCurso = null;
  if (b === null) throw e;
  b.falhasEditor = b.falhasEditor | FALHA_GIZMO;
  const dono = b.owner !== null ? b.owner.name : "?";
  logError("Gizmo de " + b.typeName() + " em '" + dono + "' lançou: " + String(e) + " — gizmo desligado para este componente.");
}
export function pintarGizmos(app: any, win: number, g: Gizmos): void {
  let k = 0;
  while (k < g.nSeg) {
    const s = k * 5;
    traco(UI_GIZMO.lineWidth, g.seg[s + 4]); linha(g.seg[s], g.seg[s + 1], g.seg[s + 2], g.seg[s + 3]);
    k = k + 1;
  }
  k = 0;
  while (k < g.nIc) { const s = k * 4; iconAt(g.ic[s], g.ic[s + 1], g.ic[s + 2]); drawEditorIcon(g.icNomes[k]); k = k + 1; }
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

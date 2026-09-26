// Menus que juntam os presets fixos do editor e os itens @menuItem dos scripts
// (catálogo gerado). Montados uma vez; o menu global, o de contexto e o
// comando `menu` leem os mesmos registros.
import { MENU_ITEMS, runMenuItem } from "@engine/generated/editor_extensions";
import { scene, S } from "./control/session";
import { history } from "./undo";
import { logError } from "@engine/core/logger";

export const MENU_CRIAR: string = "Criar/";
export const MENU_JANELA: string = "Janela/";
export class MenuDinamico {
  /// O que o menu desenha: os fixos e depois os itens de script (sem o prefixo).
  rotulos: string[];
  fixos: number;
  /// Índice em MENU_ITEMS de cada rótulo de script.
  itens: number[];
  constructor() { this.rotulos = []; this.fixos = 0; this.itens = []; }
}
export function montarMenu(prefixo: string, fixos: string[], caminhos: string[]): MenuDinamico {
  const m = new MenuDinamico();
  let i = 0;
  while (i < fixos.length) { m.rotulos.push(fixos[i]); i = i + 1; }
  m.fixos = fixos.length;
  i = 0;
  while (i < caminhos.length) {
    if (caminhos[i].indexOf(prefixo) === 0) { m.rotulos.push(caminhos[i].slice(prefixo.length)); m.itens.push(i); }
    i = i + 1;
  }
  return m;
}
export function menuDoCatalogo(prefixo: string, fixos: string[]): MenuDinamico { return montarMenu(prefixo, fixos, MENU_ITEMS); }
export function indiceDoCaminho(caminho: string): number { return MENU_ITEMS.indexOf(caminho); }
/// Roda o item; itens de "Criar/" que criam algo entram no Desfazer, aninham o primeiro objeto
/// criado em `pai` (>= 0) e selecionam o último criado. Devolve "" ou o erro.
export function executarItemDeMenu(indice: number, pai: number): string {
  let erro = "";
  if (indice < 0 || indice >= MENU_ITEMS.length) erro = "item de menu inexistente";
  else {
    const cria = MENU_ITEMS[indice].indexOf(MENU_CRIAR) === 0;
    const redoAntes = history.r;
    if (cria) history.snapshot();
    const antes = scene.objects.length;
    try { runMenuItem(indice); } catch (e) { erro = String(e); logError("Menu " + MENU_ITEMS[indice] + ": " + erro); }
    // nada criado (no-op ou erro): o snapshot não vira um passo vazio de Desfazer
    if (cria && scene.objects.length <= antes) history.discard(redoAntes);
    if (cria && scene.objects.length > antes) {
      if (pai >= 0 && pai < antes) scene.moveSubtree(antes, scene.objects.length, pai);
      S.selected = scene.objects.length - 1; S.selection = [S.selected];
    }
  }
  return erro;
}

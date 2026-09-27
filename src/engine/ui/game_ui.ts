// Engine RTS — pass de UI do JOGO: desenha os componentes KIND_UI dos
// GameObjects da cena do jogo (UIText, UIButton…) por cima do 3D, e entrega os
// cliques aos scripts do mesmo objeto via `onUIClick(nome)`.
//
// É o Canvas da Unity reduzido ao que o jogo precisa: a UI vive NA cena (é
// salva com ela e aparece no Play do editor), sem uma cena de UI separada — a
// `UIScene` continua sendo a do EDITOR (CLAUDE.md: a UI do editor não vai para
// o arquivo do jogo).
//
// Custo: a Scene mantém `uiObjs` (add/removeAt/clear e `uiChanged` quando um
// componente entra/sai), então não há varredura por frame nem por mutação —
// uma cena de 2.000 objetos sem UI paga zero. (Varrer `o.uiIdx` por objeto
// custava ~300 ns cada: o campo vive fora dos 15 slots inline do GameObject.)

import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior, KIND_UI } from "@engine/core/behavior";
import { dispatchUIClick } from "@engine/ui/ui_click";
import { domHostRender } from "./dom_host";

/// Quantos objetos com UI a cena tem (a lista é mantida pela própria Scene).
export function collectGameUI(sc: Scene): number {
  return sc.uiObjs.length;
}

/// Área padrão: a janela inteira (reescrita por quadro, sem alocar).
const areaJanela = new Float64Array(4);
class AreaUI { externa: Float64Array | null; constructor() { this.externa = null; } }
const areaUI = new AreaUI();
/// O editor desenha a UI do jogo na aba Jogo: passa a área (x, y, w, h) antes
/// de drawGameUI; null = janela inteira (o jogo exportado).
export function definirAreaUI(a: Float64Array | null): void { areaUI.externa = a; }

/// Desenha a UI do jogo e entrega os cliques. Chamar DENTRO do frame, depois do
/// 3D, no máximo UMA vez por quadro (o HTML de todos os DomCanvas é um render só).
export function drawGameUI(sc: Scene, win: i64, w: f64, h: f64): void {
  // 3D -> HTML -> 2D: o render do DOM entra na fila antes dos UIText/UIButton.
  const ext = areaUI.externa;
  if (ext !== null) domHostRender(win, ext);
  else { areaJanela[0] = 0.0; areaJanela[1] = 0.0; areaJanela[2] = w; areaJanela[3] = h; domHostRender(win, areaJanela); }
  const objs: GameObject[] = sc.uiObjs;
  const n = objs.length;
  let k = 0;
  while (k < n) {
    const o: GameObject = objs[k];
    if (o.active !== 0) drawObjectUI(o, win, w, h);
    k = k + 1;
  }
}

function drawObjectUI(o: GameObject, win: i64, w: f64, h: f64): void {
  const bs: Behavior[] = o.behaviors;
  const nb = bs.length;
  let j = 0;
  while (j < nb) {
    const b: Behavior = bs[j];
    if (b.enabled !== 0 && b.kind() === KIND_UI) {
      b.drawUI(win, w, h);
      if (b.uiClicked() !== 0) dispatchUIClick(o, b.uiName());
    }
    j = j + 1;
  }
}

export { dispatchUIClick } from "@engine/ui/ui_click";

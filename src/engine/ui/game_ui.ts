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

/// Quantos objetos com UI a cena tem (a lista é mantida pela própria Scene).
export function collectGameUI(sc: Scene): number {
  return sc.uiObjs.length;
}

/// Desenha a UI do jogo e entrega os cliques. Chamar DENTRO do frame, depois do
/// 3D. `w`/`h` = tamanho atual da janela (âncoras seguem o resize).
export function drawGameUI(sc: Scene, win: i64, w: f64, h: f64): void {
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

/// Entrega `onUIClick(nome)` a todos os behaviors habilitados do objeto (o
/// próprio botão inclusive, que o ignora por padrão).
export function dispatchUIClick(o: GameObject, name: string): void {
  const bs: Behavior[] = o.behaviors;
  const nb = bs.length;
  let j = 0;
  while (j < nb) {
    const b: Behavior = bs[j];
    if (b.enabled !== 0) b.onUIClick(name);
    j = j + 1;
  }
}

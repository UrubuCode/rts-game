// Engine RTS — entrega de clique de UI ao GameObject: `onUIClick(nome)` para
// todos os behaviors habilitados do objeto. Módulo próprio para que o pass de
// UI do jogo (game_ui.ts) e o DomHost (dom_host.ts) a usem sem se importarem.

import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";

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

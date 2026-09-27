// UI do jogo dentro do editor. No Play: a UI inteira, com o HTML na área da
// vista (aba Jogo ou Cena). Fora do Play, com a aba Jogo aberta: só a PRÉVIA do
// HTML, sem receber cliques (pointer-events:none na região, os painéis seguem
// clicáveis) e com o contorno no canvas selecionado. Uma função, chamada por
// main.ts no lugar do antigo drawGameUI.
import { scene, S } from "./control/session";
import { drawGameUI, definirAreaUI } from "@engine/ui/game_ui";
import { domHostRender, domHostPrevia, domHostDestacar } from "@engine/ui/dom_host";
import { UI_DOM } from "./ui_config";

export function uiDoJogoNoEditor(win: number, area: Float64Array, w: number, h: number): void {
  if (S.simulating !== 0) {
    domHostPrevia(false);
    domHostDestacar(null, UI_DOM.semContorno);
    definirAreaUI(area);
    drawGameUI(scene, win, w, h);
    definirAreaUI(null);
    return;
  }
  if (S.gameView === 0) return;
  domHostPrevia(true);
  domHostDestacar(S.selected >= 0 && S.selected < scene.objects.length ? scene.objects[S.selected] : null, UI_DOM.contornoSelecao);
  domHostRender(win, area);
}

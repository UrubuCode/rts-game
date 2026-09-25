# UI do jogo: UIText e UIButton

A UI do **jogo** é feita de componentes (`KIND_UI`) em GameObjects da própria
cena — é salva com ela, aparece no Play do editor e na build — no modelo do
Canvas da Unity reduzido ao que o jogo precisa. A `UIScene` de
`src/engine/ui/uiscene.ts` continua sendo a UI do **editor** (CLAUDE.md: ela
não vai para o arquivo do jogo).

## Componentes (`src/engine/core/`)

| Componente | Campos | Notas |
|---|---|---|
| `UIText` | `text`, `size`, `color` (0xRRGGBBAA), `anchor` | `setUITitle(s)` atualiza o texto (HUD ao vivo) |
| `UIButton` | `label`, `w`, `h`, `anchor`, `color`, `hoverColor`, `textColor` | clique = mouse esquerdo pressionado neste frame dentro do retângulo |

Posição = `transform.px/py` como offset em pixels a partir do canto `anchor`
(`src/engine/ui/anchor.ts`: 0 TL, 1 TR, 2 BL, 3 BR), então segue o resize da
janela. Um GameObject de UI não tem malha e o laço 3D o pula.

## Clique → script

O pass (`src/engine/ui/game_ui.ts`, `drawGameUI(scene, win, w, h)`) desenha cada
componente de UI e, se `uiClicked()` responder 1, chama `onUIClick(label)` em
**todos os behaviors habilitados do mesmo GameObject**. O script do botão é um
irmão, como o OnClick da Unity aponta para um componente:

```ts
class MenuInicial extends Behavior {
  onUIClick(name: string): void {
    if (name === "Jogar") { /* … */ }
  }
}
```

Hooks em `Behavior`: `uiClicked()`, `uiName()`, `onUIClick(name)` (vazios por
padrão).

## Onde é desenhado

- `game.ts`: depois do laço 3D, antes de `app.endFrame()`.
- `main.ts`: no Play (`S.simulating !== 0`), logo após o 3D da viewport.

## Custo (medido 2026-09-25)

A `Scene` mantém `uiObjs` (em `add`, `removeAt`, `clear` e via
`GameObject.refreshComponentCache → uiChanged` quando um componente de UI entra
ou sai depois de o objeto estar na cena). Não há varredura por frame nem por
mutação: `collectGameUI` custa 0,1–0,2 µs em 4 000 objetos; `add`/`removeAt`
não mudam de custo. A alternativa de varrer `o.uiIdx` por objeto custava
~300 ns/objeto (o campo vive fora dos 15 slots inline do GameObject) — 1,2 ms
por recoleta em 4 000 objetos — e foi descartada por isso.

Testes sem janela: `tests/test_game_ui.ts` (âncoras, catálogo, serialização,
lista da cena, `onUIClick`). Com janela: `scratch/janela_ui.ts` (30 frames).

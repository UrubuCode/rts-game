# `DomCanvas`: UI em HTML/CSS como componente de GameObject — desenho

Data: 2026-09-27. Base: o spike `.superpowers/sdd/2026-09-26-luzes-ceu-camera-extensao/spike-domcanvas.md` (GO com condições). Os números e os limites do rts citados aqui vêm dele; onde este documento e o spike divergirem, vale o spike até uma nova medição.

Princípio, o mesmo de `2026-09-26-luzes-ceu-camera-extensao-design.md`: o motor ganha só o que um script não consegue fazer sozinho. Aqui isso é o `DomHost` (dono único da fachada do DOM e da chamada de `render`), o componente `DomCanvas` e dois ganchos no `Behavior`. Menu, gizmo, Inspector próprio e comandos WS vêm como pacote `@editorOnly` em `assets/pacotes/dom/`, pela API de extensão que já existe (`registerCommand`, `registerGizmo`, `@menuItem`, `onInspectorGUI`).

## 1. Motivação e o que a Unity faz

- O HUD do rts-fps (`rts-fps/src/client.ts`, `fpsHud`, ~194–232) é uma sequência de `fpsApp.text(x, y, "..." + n, cor, tam)`: posição calculada à mão com constantes `FPS_HUD_*`, strings montadas a cada quadro, sem layout, sem hover e sem estilo reaproveitável. Qualquer tela de menu vira mais código desse tipo.
- **Unity, UI Toolkit:** o componente `UIDocument` fica num GameObject e aponta para um `VisualTreeAsset` (UXML) e folhas de estilo (USS). Um `PanelSettings` compartilhado define escala, ordem (`sortingOrder`) e o alvo de renderização; vários `UIDocument` no mesmo painel dividem a mesma árvore. Scripts pegam `rootVisualElement` e usam `Q<Label>("nome")`, `RegisterCallback<ClickEvent>`. O UI Builder edita o UXML; o Live Reload recarrega o arquivo salvo.
- **Unity, UGUI:** o `Canvas` (Screen Space Overlay/Camera/World) com `CanvasScaler` e `GraphicRaycaster`, que consome o clique antes da física via `EventSystem.IsPointerOverGameObject()`.
- O `DomCanvas` é o análogo do `UIDocument`, com HTML/CSS no lugar de UXML/USS, e o `DomHost` faz o papel do `PanelSettings` + `EventSystem`.

## 2. O que o rts já tem e os limites de hoje

**Já existe no binário que usamos** (spike §1, `rts-uv-mundo @ 0e6ee85c6`):
- `rts:dom` (sempre instalado, `run.rs:403-409`) e a fachada `document`/`Element` com `parseDocument`, `pumpEventCallbacks`, `pumpTimerCallbacks`; o namespace cru é o global `dom`.
- `render(win, doc._dom)` de `rts:egui` enfileira o documento como um `WidgetCmd::HtmlHandle`. A ordem é: 3D primeiro, depois a fila do egui na ordem das chamadas; `draw2d` e HTML se intercalam.
- Funciona: `click` via `addEventListener` (latência de 1 quadro, despachado no `pump` depois do `endFrame`), `:hover`, `transition`, fundo transparente com `html,body{background:transparent;margin:0}` (sem isso o canvas fica branco e cobre o 3D).
- A fachada é injetada como prelude em **cada** arquivo que a menciona; dois módulos que a usam ganham classes duplicadas. Só um módulo nosso pode citá-la.

**Limites do rts de hoje:**
1. **Um documento por janela.** O primeiro `render` consome a altura com `allocate_space`; o segundo recebe `viewport_h ≈ 1` e o que é ancorado por `bottom` some. O medidor também é "o último a pintar ganha".
2. **Sem região nativa.** O documento ocupa o `CentralPanel` inteiro. Região por CSS (`position:absolute; left; top; width; height; overflow:hidden`) funciona e o hit-test continua certo, porque documento e janela usam as mesmas coordenadas.
3. **Sem escala.** `zoom` é ignorado no layout; `transform: scale()` escala a caixa e não o texto. Só `font-size`/`rem` na raiz serve de paliativo.
4. **Sem consumo de clique.** O clique HTML e o `mouseClicked` do pick 3D disparam no mesmo quadro. O hit-test também não sabe do 2D pintado por cima.
5. **Mutação refaz o documento inteiro.** Não há relayout incremental: `layout_cached` tem chave `(render_revision, viewport_w, viewport_h, medidor)`. Parado, não refaz layout.
6. **Sem entrada de mouse sintética.** `PostMessage` não chega ao winit; só o teclado tem `simularTecla`.

**Custo medido** (900×560, vsync desligado, 5000 quadros; o HUD tem 10 linhas, 2 barras e a mira):

| modo | ms/quadro (rodada B/C) |
|---|---|
| sem HUD | 0,82–0,95 |
| HUD `draw2d` parado | 0,89–0,93 |
| HUD HTML parado | 0,97–1,07 (+0,10 a 0,15 sobre o `draw2d`) |
| HTML com 1 `setText` por quadro | 1,29–1,31 (+0,30 a 0,45) |
| 1000 `<span>` parado / com 1 `setText` por quadro | 3,7 / 13–15,7 |

Lado TS entre 0,013 e 0,048 ms; 0 coletas em 200 mil iterações (`render` + `pump`, `dom.setText`, `textContent`, `querySelector`, `getElementById`). No lado Rust há alocação por quadro fora do GC do RTS: o clone da `DisplayList` e um `Rc<EguiMeasurer>` novo.

## 3. Desenho

### 3.1 Componente `DomCanvas` (`src/engine/core/dom_canvas.ts`, `KIND_UI`)

```ts
/**
 * @componentCategory UI
 * @componentDescription Interface em HTML/CSS desenhada sobre o jogo; scripts do objeto acessam `documento`.
 * @componentKeywords ui html css hud menu dom documento
 */
export class DomCanvas extends Behavior {
  html: string = "";        // caminho do .html em assets/ (@assetPath .html)
  css: string = "";         // .css opcional, anexado depois do <style> do próprio HTML
  escala: number = 1;       // fase 1: vira font-size da raiz; fase 2: escala real
  ancoragem: number = ANCHOR_TL;   // ANCHOR_* de @engine/ui/anchor
  largura: number = 0;      // px; 0 = tela (ou Game view) inteira
  altura: number = 0;
  ordem: number = 0;        // maior fica por cima entre DomCanvas
  bloqueiaCliques: boolean = true;  // consome o clique do pick 3D quando o ponteiro está sobre a UI
  constructor() { super(); }
}
```

- **Posição:** `host.px/py` como deslocamento a partir da âncora, igual ao `UIText`. **Ativo** é o `active` do GameObject (com ancestrais) e o `enabled` do componente, sem campo próprio.
- **Serialização:** campos públicos automáticos via `componentToData`; nada de `fieldCount/fieldGet` legados. Estado de execução (`raiz`, `vista`, nós guardados, geração, último `w/h`) é `private`/`@nonSerialized`. Cena sem `DomCanvas` carrega igual à de hoje.
- **`onValidate(campo)`:** `html`/`css` marcam recarga; `ancoragem`, `largura`, `altura`, `escala`, `ordem` marcam o estilo da raiz como sujo. O `DomHost` aplica no próximo quadro, uma vez.

### 3.2 `DomHost` (`src/engine/ui/dom_host.ts`), um por janela

- **Único módulo** que menciona a fachada (`parseDocument`, `document.`, `pump*`). O `DomCanvas` e os scripts falam com ele pela `DomVista` (§3.3), que usa só o namespace cru `dom` e NodeIds numéricos.
- Criado sob demanda no primeiro `DomCanvas` montado: um documento com `<style>html,body{background:transparent;margin:0}</style><div id="dom-regiao" style="position:absolute;overflow:hidden">`. Cena sem `DomCanvas` não paga nada (nenhum `render`).
- **Um div raiz por `DomCanvas`**, filho de `#dom-regiao`: `<div data-go="<id>" class="dom-canvas" style="position:absolute;z-index:<ordem>">`, com o conteúdo do `.html` via `setInnerHtml`.
- **Escopo do CSS:** o `<style>` do arquivo e o `.css` passam por um prefixador simples que escreve `[data-go="<id>"] ` antes de cada seletor de topo; `:root`, `html` e `body` viram o próprio div raiz. `@keyframes` e `@font-face` passam sem prefixo; `@media` é prefixado por dentro. O prefixador roda na carga, nunca por quadro, e tem testes próprios.
- **Z-order:** `z-index` = `ordem`; empate resolve pela ordem de montagem (ordem no documento). Trocar `ordem` é um `setStyle`, um layout.
- **Desativar** (objeto inativo ou componente desabilitado): `display:none` na raiz, sem apagar os nós, para que os NodeIds guardados pelos scripts continuem válidos. O `DomHost` guarda a visibilidade anterior por canvas e só chama `setStyle` quando ela muda (comparação de inteiros por quadro, N = número de canvases).
- **Remover** (objeto destruído, cena trocada, Play parado): `removeNode` + `releaseSubtree`. Exige um gancho novo `Behavior.onDestroy()` chamado pela `Scene` em `removeAt`/`clear`; hoje não existe nenhum gancho de saída. Quando o último canvas sai, o documento é liberado.
- **Região e âncora** viram `setStyle` na raiz só quando os campos ou o `w/h` da área mudam. Nunca por quadro.

### 3.3 API de script

`getBehavior(DomCanvas).documento` devolve uma `DomVista` escopada ao div raiz, não o `Document` global:

- `raiz(): number` — NodeId do div raiz.
- `querySelector(sel: string): number` — limitado à raiz; -1 se não achar. Guardar o resultado no `mount`/`onDomReload`, não por quadro (não aloca, mas custa).
- `setText(no: number, s: string): void` — compara com o último texto escrito naquele nó (cache por NodeId dentro da vista) e, se igual, não toca o DOM, então não refaz layout.
- `setNumero(no: number, v: number, casas: number): void` — monta a string só quando `v` arredondado muda. É o substituto de `"vida " + n` por quadro, seguindo a regra de rótulos do CLAUDE.md.
- `setStyle(no, prop, valor)`, `setClass(no, classe, ligada: boolean)`, `setAttr(no, nome, valor)` — com a mesma comparação com o último valor.
- `on(no: number, evento: string, fn: (alvo: number) => void): void` — registra via fachada; os callbacks rodam no `pump` depois do `endFrame`.
- **Ponte com o padrão do `UIButton`:** um clique em elemento com `data-acao="x"` (ou `id` na falta dele) também entrega `onUIClick("x")` a todos os behaviors habilitados do mesmo GameObject, pelo `dispatchUIClick` existente.
- **`onDomReload()`**, gancho novo no `Behavior`: chamado nos irmãos depois de uma recarga (§3.6) para refazer `querySelector` e `on(...)`. O `mount` do script roda depois do `mount` do `DomCanvas` quando o canvas vem antes na lista; se vier depois, `documento` carrega o HTML sob demanda na primeira leitura.
- Todos os métodos têm no máximo 4 parâmetros (`check:params`).

### 3.4 Integração com o quadro

Ordem: **3D → DOM → 2D**.
- `drawGameUI(sc, win, w, h)` (`src/engine/ui/game_ui.ts`) passa a chamar `domHostRender(win, area)` **antes** do laço de `UIText`/`UIButton`. É a única chamada de `render` do quadro. `DomCanvas.drawUI` é no-op (o desenho é do host), para não enfileirar um `render` por canvas.
- Depois de `app.endFrame()`, quem já chama `drawGameUI` chama `domHostPump()` (`pumpEventCallbacks` + `pumpTimerCallbacks`): `game.ts:209` e o Play do editor em `main.ts:1038`.
- **Área:** no jogo, `area = [0, 0, W, H]`. No editor, `drawGameUI` hoje desenha na janela inteira; o `DomHost` recebe o retângulo da Game view e o aplica em `#dom-regiao` (left/top/width/height), para não cobrir os painéis. O `area` é um `Float64Array(4)` do chamador.

### 3.5 Input

- **Fase 1 (contorno do spike):** `domHostSobreUI(): boolean` consulta `dom.matches(doc, raiz, ":hover")` para cada canvas visível com `bloqueiaCliques`. Atenção ao seletor: `#x:hover` cobre o próprio painel, `#x :hover` só os descendentes; o host usa `matches` na raiz. O `:hover` é do quadro anterior, o que basta porque clique e hover coincidem.
- Quem chama: o pick 3D do jogo e o `onUIClick` do `UIButton` perguntam `domHostSobreUI()` antes de agir. Um canvas de HUD que não deve bloquear usa `pointer-events:none` no CSS ou `bloqueiaCliques = false`.
- Limite conhecido: um `UIButton`/menu 2D pintado **sobre** o HTML também dispara o HTML, porque o hit-test do DOM ignora o 2D. Evitar sobrepor os dois até a fase 2.
- **Fase 2:** `domHostSobreUI` passa a ler a flag de consumo do rts (§7); a assinatura não muda.

### 3.6 Hot reload

- No editor (módulo `@editorOnly`), um vigia confere o `mtime` do `.html` e do `.css` de cada `DomCanvas` a cada `DOM_RECARGA_INTERVALO_S` (0,5 s), fora do caminho por quadro do jogo. Se o runtime não expuser `mtimeMs` em `statSync`, o plano define o fallback (tamanho + hash de conteúdo no mesmo intervalo).
- Na mudança: `setInnerHtml` da raiz com o conteúdo novo e o CSS prefixado; o cache de textos da vista é zerado; os NodeIds antigos ficam inválidos pela geração; `onDomReload()` nos irmãos. Erro de leitura vai para o Console e mantém o conteúdo anterior.
- No jogo exportado não há vigia: o arquivo é lido uma vez no `mount`.

### 3.7 Play

- Rodar simula cópias da cena. Cada cópia de `DomCanvas` monta a própria raiz no `mount`; as raízes dos originais saem no `onDestroy` da troca (ou ficam `display:none` se a troca não destruir). As cópias **não** compartilham estado de DOM com os originais: textos, classes e valores de `<input>` mudados no Play se perdem ao parar, como na Unity.
- Parar: as cópias fazem `releaseSubtree`; os originais voltam a montar a prévia (§4). Seleção e histórico seguem a regra atual.

## 4. Editor (pacote `assets/pacotes/dom/`, `@editorOnly`)

- **Inspector** (`onInspectorGUI` no `DomCanvas`, com `ui.field(...)` para os campos): caminho do `.html` e do `.css` com seletor de asset; botões **Recarregar** (força §3.6) e **Abrir no editor** (usa o editor externo das preferências locais, ou a associação do sistema, como o duplo clique em scripts); uma linha de estado com o número de nós e o último erro de carga. Rótulos e medidas em `src/editor/ui_config.ts`.
- **Gizmo** via `registerGizmo`: ícone `ui-html` (fonte em `assets/editor/icons/source.json`, `npm run icons`) na posição do objeto; selecionado, desenha o retângulo da região projetado na Game view.
- **Menu** `Criar/UI/DomCanvas` via `@menuItem`: cria o objeto com `scene.createGameObject`, adiciona o `DomCanvas` com um `assets/ui/exemplo.html` de modelo e seleciona.
- **Prévia fora do Play:** com a aba "Jogo" aberta, o editor chama `domHostRender` na Game view com `pointer-events:none` em `#dom-regiao`, para ver o layout sem que o HTML roube cliques dos painéis. Na aba "Cena", nada é desenhado.

## 5. Comandos WS (`registerCommand`, no mesmo pacote)

| comando | efeito | muta |
|---|---|---|
| `dom <obj> set <seletor> <texto>` | `setText` no primeiro nó que casar | não (estado de execução) |
| `dom <obj> html <arquivo\|string>` | troca o conteúdo; arquivo existente vira o novo `html`, senão a string entra como conteúdo | sim, se mudar o campo |
| `dom <obj> query <seletor>` | lista NodeId, tag, `id`, classes e texto dos nós que casam | não |
| `dom <obj> click <seletor>` | `dispatchEvent("click")` no nó; é a entrada sintética para a IA testar a UI enquanto o rts não tem mouse sintético | não |
| `dom <obj> css <seletor> <prop> <valor>` | `setStyle` | não |
| `dom <obj> reload` | força a recarga de §3.6 | não |

Respostas no padrão `[ok]`/`[erro]`; seletor sem casamento é `[erro]`. `<obj>` segue a resolução de nomes dos outros comandos.

## 6. Custo e testes

**Metas** (HUD do rts-fps portado como bench, `bench/claude-frame-bench.mjs`, mesma sessão):
- parado: ≤ 0,15 ms acima do HUD `draw2d`;
- atualizando 1 texto por quadro: **≤ 0,5 ms** acima de sem HUD;
- cena sem `DomCanvas`: custo igual ao de hoje (nenhum `render`, nenhum `pump`).
- **0 alocação TS:** sonda de 200 mil iterações com `RTS_GC_DEBUG=1` (`tests/claude-test-frame-gc.ts`) sobre `domHostRender` + `domHostPump` + `setText`/`setNumero` com valor igual e com valor novo + `domHostSobreUI`.
- Nenhuma função por quadro com `try/catch`; carga e prefixador ficam em funções próprias.

**Testes sem janela** (`rts.exe run`, DOM sem janela, `render` com `win = 0` onde preciso):
- prefixador de CSS (seletores simples, listas, `:root`/`body`, `@media`, `@keyframes`);
- montar dois canvases: duas raízes, `z-index` = `ordem`, escopo do CSS não vaza;
- desativar/ativar alterna `display` sem invalidar NodeIds; remover libera a subárvore; último canvas libera o documento;
- `setText` com valor igual não muda `render_revision`;
- `dom <obj> click` dispara `on(...)` e `onUIClick(data-acao)` no irmão;
- recarga: NodeId antigo inválido, `onDomReload` chamado, erro mantém o conteúdo;
- ida e volta na cena (`componentToData`) e Play/Parar sem vazar raízes;
- `check:params`, `npm run components`, `test:components`, `components:check`.

**Testes com janela** (PrintWindow, como no spike): HUD transparente sobre o 3D; ordem 2D antes/depois; região na Game view do editor; `:hover` pintado; `domHostSobreUI` bloqueando o pick 3D com o cursor sobre um botão (com mouse real, anotado no relatório).

## 7. Fase 2 no rts (PR à parte, ~150–250 linhas de Rust)

1. `egui.renderIn(win, doc, buf: Float64Array[x, y, w, h, escala])`, novo `WidgetCmd::HtmlHandleIn`: `ui` filho com `max_rect = rect`, viewport = rect / escala, sem `allocate_space` no pai; escala por `ui.with_visual_transform(TSTransform)` (egui 0.34.3) e ponteiro por `(p − origem) / escala`. Resolve região, escala e vários documentos por janela.
2. `dom.hoveredNode(doc)`, ou `renderIn` devolvendo 1 com o ponteiro sobre um nó que não é raiz e não tem `pointer-events:none` (o estado já existe em `Dom::set_hovered`/`hit_test_clickable`).
3. Opcional: parar de clonar a `DisplayList` e de criar o `Rc<EguiMeasurer>` por quadro.
4. Entrada de mouse sintética (`simularMouse`) para testes de UI sem `dispatchEvent`.

**O que muda no `DomCanvas`:** nada nos campos nem na `DomVista`. Por dentro, o `DomHost` passa a ter **um documento por `DomCanvas`** e chama `renderIn` por canvas, em ordem de `ordem`; o prefixador de CSS e `#dom-regiao` deixam de ser necessários (ficam para compatibilidade só enquanto o binário antigo for suportado); `escala` vira escala real em vez de `font-size`; `domHostSobreUI` lê o retorno de `renderIn`/`hoveredNode`. O relayout incremental continua fora: telas grandes que mudam por quadro seguem caras.

## 8. Migração

- **rts-fps:** o `fpsHud` vira `assets/ui/hud.html` + `hud.css` num GameObject "HUD" com `DomCanvas`, e um script `HudFps` guarda os nós no `mount` e usa `setNumero`/`setText`/`setClass("alerta", vida < FPS_HUD_VIDA_BAIXA)` só quando o valor muda. As constantes de posição `FPS_HUD_*` saem para o CSS. O painel de depuração (F3) vira um bloco com `display` alternado. Serve de bench (§6) e de primeiro consumidor real.
- **`UIText`/`UIButton` ficam**, retrocompatíveis, desenhados por `draw2d` depois do DOM. São mais baratos para um rótulo isolado e não dependem do documento. Não viram wrappers de DOM: isso mudaria a ordem de pintura e o custo de cenas existentes. Documentação passa a recomendar `DomCanvas` para HUD e menus com layout.

## 9. Fora deste desenho

- UI no mundo 3D (HTML renderizado para textura num quad, o World Space Canvas).
- Texto 3D.
- Acessibilidade (leitor de tela, navegação por teclado entre elementos, foco).
- Editor visual de HTML (o UI Builder); a edição é no editor externo com recarga.
- Relayout incremental no `rts-dom`.
- Formulários ricos (`<input>`/`<select>` com IME) além do que a fachada já oferece.

## 10. Ordem de entrega

1. rts-game, núcleo: ganchos `onDestroy` e `onDomReload` no `Behavior` e a chamada de `onDestroy` em `Scene.removeAt`/`clear`; `DomHost` com prefixador de CSS; `DomCanvas`, `DomVista`; `drawGameUI` + `domHostPump` em `game.ts` e `main.ts`; testes sem janela e sonda de GC.
2. Input fase 1: `domHostSobreUI` no pick 3D e no `UIButton`.
3. Pacote `assets/pacotes/dom/`: Inspector, gizmo e ícone, `Criar/UI/DomCanvas`, comandos `dom`, vigia de recarga, prévia na aba "Jogo".
4. rts-fps: HUD em `DomCanvas`; bench antes/depois contra o `draw2d` e captura com janela.
5. rts, fase 2 (§7), seguida da troca interna do `DomHost` para `renderIn`, sem mudar a API.

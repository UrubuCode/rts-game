# DomCanvas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI de jogo em HTML/CSS como componente de GameObject (`DomCanvas`, o análogo do `UIDocument` da Unity): arquivo `.html` + `.css` escopados por canvas, API de script sem alocação (`DomVista`: `querySelector`, `setText`, `setNumero`, `setClass`, `on`), clique entregue a `onUIClick` dos irmãos, clique do 3D bloqueado sobre a UI, recarga ao salvar o arquivo no editor, pacote de editor (`Criar/UI/DomCanvas`, Inspector, gizmo, prévia na aba Jogo, comando WS `dom`) e o HUD do rts-fps migrado, tudo sobre o runtime `rts` atual, sem mudar o Rust.

**Architecture:** O motor ganha só o que um script não faz (spec §1): o `DomHost` (`src/engine/ui/dom_host.ts`, único módulo que fala com a fachada `rts:dom`), o componente `DomCanvas` + `DomVista`, o prefixador de CSS e dois ganchos no `Behavior` (`onDestroy`, `onDomReload`), mais dois pontos de extensão do editor (`registerInspector`, `Editor.every`). O rts de hoje pinta um documento por janela: todos os canvases vivem num documento só, um `<div data-go="<serial>">` por canvas dentro de `#dom-regiao`, que recorta a área do jogo. A ordem do quadro fica 3D → HTML (um `render` em `drawGameUI`) → 2D, e `domHostPump` roda depois do `endFrame`. Todo o resto (Inspector, gizmo, menu, prévia, recarga, WS) é o pacote `@editorOnly` em `assets/pacotes/dom/`.

**Tech Stack:** TypeScript compilado pelo RTS (`rts.exe` e `ui_fixture.exe` de `rts-uv-mundo @ 0e6ee85c6`, sem mudança de Rust nesta fase), fachada `rts:dom` + `render` de `rts:egui`, Node 20 (`tools/generate-components.mjs`, `node --test`, `bench/claude-frame-bench.mjs`), Python (`tools/ws_client.py`).

**Spec:** docs/superpowers/specs/2026-09-27-domcanvas-design.md

## Global Constraints

- **Motor só onde script não alcança (spec §1).** Núcleo: `DomCanvas`, `DomVista`, `DomHost`, `dom_css.ts`, `ui_click.ts`, ganchos `onDestroy`/`onDomReload`, `Scene.detachAll`/`activeInHierarchy`, `registerInspector` e `Editor.every`. Inspector, gizmo e ícone, `Criar/UI/DomCanvas`, recarga, comandos WS `dom` ficam em `assets/pacotes/dom/` com `/** @editorOnly */`. A única ligação do editor fora do pacote é `src/editor/game_ui_editor.ts` (prévia na aba Jogo), porque o pacote não tem gancho por quadro de desenho.
- **Fachada do DOM num módulo só.** O rts injeta a fachada (prelude) em todo arquivo cujo TEXTO contenha `parseDocument`, `document.`, `new Document`, `new Element`, `runScripts` ou `loadDocument` (`rts-uv-mundo/crates/rts-host/src/run.rs:636`), inclusive em comentário. Só `src/engine/ui/dom_host.ts` pode ter esses textos. Os demais arquivos usam o global cru `dom` (NodeIds numéricos), que não dispara a injeção. Escreva "documento", nunca "document." nos comentários. `tests/editor-static.test.mjs` recusa (Task 2).
- **Custo por quadro (CLAUDE.md "Custo por quadro").** Funções chamadas por quadro com no máximo 4 parâmetros; `try/catch` só em funções de carga (`lerArquivoDom`, `assinaturaArquivo`, `rodarTemporizador`); nenhuma string montada por quadro: `setText`/`setNumero`/`setStyle`/`setClass`/`setAttr` só tocam o DOM quando o valor muda, e `setNumero` usa uma tabela de textos por (casas, inteiro) preenchida uma vez. Sonda de 200 mil iterações com `RTS_GC_DEBUG=1` (0 coletas por fase) e `npm run check:params`.
- **Runtime disponível AGORA, sem mudar o rts.** Um documento por janela; região só por CSS (`position:absolute` + `overflow:hidden` em `#dom-regiao`), sem escala real (`escala` vira `font-size` da raiz); `html,body{background:transparent;margin:0}` obrigatório (sem ele o canvas fica branco e cobre o 3D); o clique chega a `addEventListener` com 1 quadro de latência, despachado no pump depois do `endFrame`; sem flag de consumo: `domHostSobreUI()` consulta `:hover` nos DESCENDENTES da raiz (`dom.queryWithin(h, raiz, ":hover")`), porque a raiz cobre a área inteira; cada mutação refaz o layout do documento inteiro.
- **Custos medidos no spike (900×560, vsync desligado):** HUD `draw2d` parado 0,89–0,93 ms; HUD HTML parado +0,10 a 0,15 ms sobre o `draw2d`; um `setText` por quadro +0,30 a 0,45 ms; 1000 `<span>` parado 3,7 ms e com um `setText` por quadro 13–15,7 ms; lado TS 0,013–0,048 ms; 0 coletas em `render` + `pumpEventCallbacks`, `dom.setText`, `querySelector`. Metas deste plano: parado ≤ 0,15 ms acima do HUD `draw2d`; um texto por quadro ≤ 0,5 ms acima de sem HUD; cena sem `DomCanvas` com o custo de hoje (nenhum `render`, nenhum pump).
- **Chamadas da fachada que funcionaram (spike + verificação de 2026-09-27 com o mesmo binário):** `parseDocument(html)` → `doc._dom`; `render(win, doc._dom)` de `rts:egui` (também com `win = 0`, sem janela); `pumpEventCallbacks(doc)`; `dom.createElement`, `dom.setAttr`, `dom.appendChild`, `dom.setInnerHtml` (um `<style>` dentro do conteúdo vale na cascata), `dom.queryWithin`, `dom.queryAllWithinCount/At`, `dom.closest`, `dom.contains` (0/1), `dom.getAttribute` ("" se faltar), `dom.setStyleProperty(h, no, "z-index", "3")` (o `dom.setStyle` cru recebe slots opacos, não nomes CSS), `dom.inlineProperty`, `dom.computedProperty(h, no, "color", "")` → `"rgb(255, 0, 0)"`, `dom.boundingRect(h, no, 0..3)` em coordenadas da janela, `dom.addListenerCbOptions(h, no, "click", fn)` + `dom.pushRawEvent(h, no, "click")` + `pumpEventCallbacks(doc)` (o `fn` recebe `e.target.nodeId`), `dom.removeNode` + `dom.releaseSubtree` (a arena não cresce em 50 ciclos), `dom.free(h)`; `statSync(p).mtimeMs` existe.
- **Não usar `pumpTimerCallbacks`.** Ela roda `engine.run_event_loop()` (a volta inteira do loop do motor), que entregaria eventos do WebSocket e de processos fora do `ctrlPoll`. `<script>` do `.html` é removido na carga (a lógica fica nos Behaviors), então não há timers de página.
- **Ordem do quadro 3D → HTML → 2D.** `drawGameUI` chama `domHostRender(win, area)` uma vez, ANTES do laço de `UIText`/`UIButton`; `drawGameUI` roda no máximo uma vez por quadro por janela (dois `render` no mesmo quadro quebram o segundo documento). `domHostPump()` vem logo depois de `app.endFrame()` em `game.ts` (hoje `game.ts:209`) e em `main.ts` (hoje `main.ts:1707`; o spec citava 1038, linha antiga).
- **Branch e worktree.** O worktree `build/main-integration` segue com o áudio (`feat/audio`) em paralelo. Criar um worktree próprio a partir do HEAD de `feat/controle-ia` (`da367a4`, dois commits depois de `d673dff`): `cd /c/Users/nexga/Documents/GitHub/rts-game/build/main-integration && git worktree add ../domcanvas -b feat/domcanvas feat/controle-ia && cd ../domcanvas && npm ci`. Todo o trabalho do rts-game roda em `C:\Users\nexga\Documents\GitHub\rts-game\build\domcanvas`. `feat/audio` e este branch mexem nas chamadas de `game.ts`/`main.ts` perto do `endFrame`; as inserções do DomCanvas são uma linha cada (`domHostPump();`, `pollEditorTimers(Date.now());`, `uiDoJogoNoEditor(...)`), e a lógica fica em funções próprias, para o merge ser trivial.
- **Binários.** `RTS=/c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/rts.exe` (testes sem janela: `$RTS run tests/<arquivo>.ts`, a partir da raiz do worktree) e `/c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/examples/ui_fixture.exe main.ts` (editor com janela; WS em `ws://127.0.0.1:7777`, `python tools/ws_client.py "cmd" ...`). DOM sem janela funciona: `parseDocument`, consultas, mutação, eventos e `render(0, h)`.
- **Todo recurso tem comando WS.** A IA verifica a UI com `dom <obj> query <seletor>` (texto, atributos, caixa de `boundingRect`, `display` computado) e `shot [caminho] jogo`. `dom <obj> click` usa `pushRawEvent`, o mesmo caminho do mouse real (não há mouse sintético no rts; o `input mouse` do editor não chega ao hit-test do DOM).
- **Play e ciclo de vida.** Cópias do Play montam raízes próprias e não dividem estado de DOM com os originais; Parar libera as cópias e mostra os originais de novo; objeto inativo ou componente desabilitado vira `display:none` sem apagar nós; remover o objeto (ou o componente) libera a subárvore (`onDestroy`); o último canvas libera o documento.
- **CLAUDE.md.** Aliases (`@engine/...`, `@editor/...`, `@compat/...`); sem ciclos de import (`import type` quando só o tipo importa); construtores de componente sem argumentos; campos públicos `number/boolean/string` salvos por `componentToData`, estado de execução `private`; catálogo gerado (`npm run components`, `npm run test:components`, `npm run components:check`, saída versionada); rótulos, medidas e cores do editor em `src/editor/ui_config.ts` (`UI_DOM`); ícone em `assets/editor/icons/source.json` + `npm run icons` + `npm run icons:check`; `scene.createGameObject` para objetos novos; nenhuma instância de classe com métodos que leem nomes do próprio módulo nasce no topo desse módulo (estado de módulo em classes sem métodos, lógica em funções livres).
- Mensagens de commit terminam com as linhas de atribuição da sessão (Co-Authored-By e Claude-Session).

## Review Focus

1. **Play/Parar e troca de cena não vazam nem perdem raízes:** `play()` usa `detachAll` (originais escondidos, vivos), `stop()` usa `clear` (cópias liberadas), carga de cena só destrói a anterior depois de validar. Testes: Task 1 (`test_behavior_ganchos.ts`) e Task 3 (`test_dom_canvas.ts`, bloco Play/Parar).
2. **Custo zero sem DomCanvas e nenhuma alocação por quadro com DomCanvas:** `domHostRenders()` não sobe numa cena sem canvas; dois canvases = um `render`; 0 coletas em render+pump, `setText`/`setNumero` com valor igual e novo, `domHostSobreUI`. Testes: Task 4 (`test_dom_quadro.ts`, `claude-test-dom-gc.ts`) e Task 3 (contador `escritas`).
3. **Escopo do CSS não vaza entre canvases:** `html`/`body`/`:root` viram a raiz, `@media` é prefixado por dentro, `@keyframes`/`@font-face` passam intactos, vírgulas dentro de `:is(...)` não quebram a lista. Testes: Task 2 (`test_dom_css.ts`) e Task 3 (cor computada de `#vida` em dois canvases).
4. **Clique:** a ponte `data-acao`/`id` só vale dentro da própria raiz (o `id` de `#dom-regiao` não vaza); `domHostSobreUI` ignora a própria raiz, respeita `bloqueiaCliques` e canvases escondidos; `UIButton` e `mouseApertadoNoMundo` consultam o host. Testes: Task 2 (`test_dom_host.ts`) e Task 4 (`test_dom_quadro.ts`).
5. **Recarga:** ids da vista anteriores à recarga viram no-op (geração), `onDomReload` chega aos irmãos, arquivo apagado mantém o conteúdo e anota o erro no Console. Testes: Task 5 (`test_dom_recarga.ts`) e Task 6 (`dom <obj> reload`).

## Decisões deste plano (o que o spec deixou aberto ou foi ajustado)

- **Ids da vista, não NodeIds crus.** `DomVista.querySelector` devolve `geracao * DOM_VISTA_MAX_NOS + índice`. O cache "último valor escrito" vira acesso por índice (sem `Map`), e a recarga (nova geração) invalida ids antigos sem risco de um id reaproveitado apontar para outro nó. `noDom(id)` devolve o NodeId cru para quem precisa (comandos WS, testes). O callback de `on(no, evento, fn)` recebe o id da vista em que foi registrado.
- **`domCanvasDe(o)` no lugar de `getBehavior(DomCanvas)`**, que não existe no GameObject. O script faz `domCanvasDe(this.owner).documento`.
- **Visibilidade:** `enabled` do componente, objeto numa cena (`uiOwner !== null`) e `Scene.activeInHierarchy(o)` (novo em `UIOwner`, percorre `parent`). Objeto fora de cena fica escondido, o que cobre os originais guardados pelo Play.
- **`Scene.clear()` destrói e `Scene.detachAll()` só solta.** `clear` chama `onDestroy` em todos os componentes (carregar cena, nova cena, Parar). `detachAll` é o `clear` antigo, usado por `PlayMode.play` (os originais voltam no `stop`) e pela carga de cena, que destrói os objetos anteriores só depois de montar os novos (e os devolve intactos se a montagem falhar). `GameObject.removeBehavior` também chama `onDestroy`.
- **Estilo por `dom.setStyleProperty`.** O `dom.setStyle` cru recebe slots opacos. Âncoras viram CSS: TL `left/top`, TR `right/top`, BL `left/bottom`, BR `right/bottom`, com `host.px/py` como deslocamento; `largura = 0` põe o lado oposto em `0px` (estica até a borda da região) e `width:auto`. `z-index = ordem`; `font-size = DOM_FONTE_BASE_PX * escala`. Tudo aplicado só quando campos, `px/py` ou a área mudam.
- **`domHostSobreUI`** testa `:hover` nos descendentes da raiz, porque a raiz cobre a área e estaria sempre sob o ponteiro. Invólucros de tela inteira precisam de `pointer-events:none` (os modelos já vêm assim). Para teste sem janela há o seletor substituível `domHostSeletorSobre(".forcado")`: o `:hover` real só existe com mouse de verdade.
- **`dom <obj> click`** usa `dom.pushRawEvent` e o evento é entregue no próximo `domHostPump`, igual ao clique real (1 quadro). A resposta do comando diz isso.
- **HTML de arquivo:** documento completo vira o miolo do `<body>`, `<style>` do arquivo (cabeça ou corpo) + o `.css` viram um `<style>` prefixado no começo da raiz, `<script>` é removido com aviso no Console, `<link>` não é suportado nesta fase.
- **`setNumero`:** inteiros `0 ≤ k < DOM_NUM_CACHE (1024)` com até `DOM_CASAS_MAX (3)` casas viram texto uma vez só (tabela por casas); fora disso, uma string por MUDANÇA de valor. A sonda de GC usa a tabela quente.
- **"Não escreveu" é medido pelo contador `DomVista.escritas`**, porque a fachada não expõe `render_revision`.
- **Inspector por `registerInspector(tipo, fn)`** (registro no núcleo, em `inspector_ui.ts`, reexportado por `@editor/api`, consultado em `inspector.ts` antes de `onInspectorGUI`). O botão "Abrir no editor" usa `ScriptEditor` (editor), então a GUI do `DomCanvas` não pode ficar no componente do núcleo como a do `Light`.
- **Recarga por `Editor.every(segundos, fn)`** + `pollEditorTimers(agoraMs)` em `main.ts`. O quadro só compara números; a chamada (com `try`) roda só quando vence. Vigia compara `mtimeMs:size` de `.html` e `.css` a cada `UI_DOM.recargaMs` (500 ms).
- **Retângulo da região no editor:** gizmos só pintam na aba Cena, então o retângulo do canvas selecionado aparece na PRÓPRIA prévia da aba Jogo, como `outline` na raiz (`domHostDestacar`). O gizmo do pacote é o ícone `ui-html` na posição do objeto.
- **`releaseSubtree` direto** depois de `removeNode`: os NodeIds são versionados, então um wrapper antigo da fachada nunca aponta para um nó reciclado.
- **Gatilhos acidentais de fachada que já existem** (`main.ts` tem `new DocumentPanel`, `src/editor/undo.ts` tem "scene_document.ts" num comentário): ficam na lista de exceções do teste estático, sem mudança nesta fase.
- **rts-fps usa uma `Scene("hud")` própria** com o GameObject do HUD e chama `drawGameUI(cenaHud, ...)`; a cena do mundo não muda (os índices de corpos do `FpsWorld` continuam os mesmos).
- **Bench no rts-game:** `game.ts` passa a aceitar `RTS_SCENE`; `tools/gerar-bench-hud.ts` gera quatro cenas (sem HUD, HUD de `UIText`, HUD HTML parado, HUD HTML com um texto por quadro), medidas por `bench/claude-frame-bench.mjs`.

---

### Task 1: Ganchos `onDestroy`/`onDomReload` e a saída de objetos da cena

**Files:**
- Modify: `src/engine/core/behavior.ts` (depois de `update`, linha 75)
- Modify: `src/engine/core/gameobject.ts` (`UIOwner` linhas 32-36; `removeBehavior` linhas 247-257; novo `destroyBehaviors` depois de `mount`, linhas 300-307)
- Modify: `src/engine/core/scene.ts` (`clear` linhas 279-287; `removeAt` linhas 400-445; novos `detachAll` e `activeInHierarchy` depois de `uiForget`, linha 195)
- Modify: `src/editor/play_mode.ts` (linha 69)
- Modify: `src/editor/sceneio.ts` (`sceneFromJSON`, linhas 276-282)
- Test: `tests/test_behavior_ganchos.ts`

**Interfaces:**
- Produces: `Behavior.onDestroy(): void`, `Behavior.onDomReload(): void` (no-ops); `GameObject.destroyBehaviors(): void`; `UIOwner.activeInHierarchy(go: GameObject): number`; `Scene.detachAll(): void`, `Scene.activeInHierarchy(go: GameObject): number`; `Scene.clear()` passa a destruir.

- [ ] **Step 0: Worktree**

```
cd /c/Users/nexga/Documents/GitHub/rts-game/build/main-integration
git worktree add ../domcanvas -b feat/domcanvas feat/controle-ia
cd ../domcanvas && npm ci
```

- [ ] **Step 1: Write the failing test**

`tests/test_behavior_ganchos.ts`:

```ts
// Teste SEM JANELA dos ganchos de saída: onDestroy chega uma vez a quem sai da
// cena de vez (removeAt, clear, removeBehavior), nunca a quem só é solto
// (detachAll, usado pelo Play para guardar os originais); a carga de cena só
// destrói os objetos anteriores depois de validar a nova; activeInHierarchy.
//   rts.exe run tests/test_behavior_ganchos.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { scene } from "@editor/control/session";
import { sceneFromJSON } from "@editor/sceneio";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Espiao extends Behavior {
  destruido: number;
  recargas: number;
  constructor() { super(); this.destruido = 0; this.recargas = 0; }
  onDestroy(): void { this.destruido = this.destruido + 1; }
  onDomReload(): void { this.recargas = this.recargas + 1; }
}
function objeto(sc: Scene, nome: string, e: Espiao): GameObject {
  const o = new GameObject(nome); o.addBehavior(e); sc.add(o); return o;
}

const base = new Behavior(); base.onDestroy(); base.onDomReload();   // padrão: no-op

const sc = new Scene("ganchos");
const e1 = new Espiao(); objeto(sc, "a", e1);
const e2 = new Espiao(); objeto(sc, "b", e2);
sc.removeAt(0);
check(e1.destruido === 1 && e2.destruido === 0 && sc.objects.length === 1, "removeAt destrói só o removido");
sc.clear();
check(e2.destruido === 1 && sc.objects.length === 0, "clear destrói todos, uma vez");
const e3 = new Espiao(); const o3 = objeto(sc, "c", e3);
sc.detachAll();
check(e3.destruido === 0 && sc.objects.length === 0 && o3.uiOwner === null, "detachAll só solta");
const e4 = new Espiao(); const o4 = objeto(sc, "d", e4);
o4.removeBehavior(0);
check(e4.destruido === 1 && e4.owner === null && o4.behaviors.length === 0, "removeBehavior destrói o componente removido");
e4.onDomReload();
check(e4.recargas === 1, "onDomReload é um gancho comum");

sc.clear();
const pai = new GameObject("pai"); sc.add(pai);
const filho = new GameObject("filho"); filho.parent = 0; sc.add(filho);
check(sc.activeInHierarchy(filho) === 1, "ativo com pai ativo");
pai.active = 0;
check(sc.activeInHierarchy(filho) === 0 && sc.activeInHierarchy(pai) === 0, "pai inativo desliga o filho");
pai.active = 1; filho.active = 0;
check(sc.activeInHierarchy(filho) === 0 && sc.activeInHierarchy(pai) === 1, "o próprio active conta");

scene.clear();
const e5 = new Espiao(); objeto(scene, "antes", e5);
let recusou = false;
try { sceneFromJSON("{\"objects\":[{\"name\":1}]}"); } catch (e) { recusou = true; }
check(recusou && e5.destruido === 0 && scene.objects.length === 1, "cena inválida: a atual fica e não é destruída");
sceneFromJSON("{\"objects\":[]}");
check(e5.destruido === 1 && scene.objects.length === 0, "cena nova destrói a anterior");
io.print("[PASSOU] ganchos: onDestroy/onDomReload, clear x detachAll, removeAt/removeBehavior, activeInHierarchy, carga de cena");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$RTS run tests/test_behavior_ganchos.ts`
Expected: FAIL (erro de compilação: `onDestroy`/`detachAll`/`activeInHierarchy` não existem).

- [ ] **Step 3: Write minimal implementation**

`behavior.ts`, depois de `update(dt: f64): void {}` (linha 75):

```ts
  /// Chamado UMA vez quando o objeto sai da cena de vez (Scene.removeAt,
  /// Scene.clear) ou o componente é removido (GameObject.removeBehavior).
  /// Libere aqui o que não é do GC do RTS (nós do DOM, handles nativos).
  /// NÃO é chamado quando o Play só guarda os originais (Scene.detachAll).
  onDestroy(): void {}
  /// Um DomCanvas do mesmo objeto recarregou o HTML (arquivo salvo, comando
  /// `dom <obj> reload`): ids antigos da DomVista viraram no-op; refaça aqui
  /// os `querySelector` e os `on(...)`.
  onDomReload(): void {}
```

`gameobject.ts`:
- `UIOwner` (linhas 32-36) ganha `activeInHierarchy(go: GameObject): number;`.
- `removeBehavior` (linha 252): `else { this.behaviors[i].onDestroy(); this.behaviors[i].owner = null; }`.
- depois de `mount()` (linha 307):

```ts
  /// onDestroy de todos os componentes (a cena chama quando o objeto sai de vez).
  destroyBehaviors(): void {
    let i = 0;
    while (i < this.behaviors.length) { this.behaviors[i].onDestroy(); i = i + 1; }
  }
```

`scene.ts`:
- `clear()` (linhas 279-287) vira `detachAll()` com o mesmo corpo e o comentário "Esvazia a cena SEM destruir: os objetos continuam vivos fora dela (o Play guarda os originais; a carga de cena devolve os anteriores se a nova falhar)". O novo `clear()`:

```ts
  /// Esvazia a cena e DESTRÓI os objetos (onDestroy em cada componente):
  /// carregar outra cena, cena nova, Parar o Play.
  clear(): void {
    const antigos = this.objects;
    this.detachAll();
    let i = 0;
    while (i < antigos.length) { antigos[i].destroyBehaviors(); i = i + 1; }
  }
```

- depois de `uiForget` (linha 195):

```ts
  /// 1 se o objeto e todos os seus pais estão ativos (o activeInHierarchy da Unity).
  activeInHierarchy(go: GameObject): number {
    if (go.active === 0) return 0;
    const objs = this.objects;
    const n = objs.length;
    let p = go.parent;
    let passos = 0;
    while (p >= 0 && p < n && passos < n) {
      const pai = objs[p];
      if (pai.active === 0) return 0;
      p = pai.parent;
      passos = passos + 1;
    }
    return 1;
  }
```

- `removeAt`: última linha do método (depois do bloco `if (isStatic) {...} else {...}`, linha 444): `removedObj.destroyBehaviors();`.

`play_mode.ts` linha 69: `scene.detachAll();   // os originais continuam vivos: voltam no stop()`. O `scene.clear()` do `stop()` (linha 88) fica: destrói as cópias.

`sceneio.ts` linhas 276-282:

```ts
  const previous = targetScene.objects.slice();
  targetScene.detachAll();
  try {
    i = 0; while (i < next.length) { targetScene.add(next[i]); i = i + 1; }
  } catch (error) {
    targetScene.clear(); i = 0; while (i < previous.length) { targetScene.add(previous[i], false); i = i + 1; }
    throw error;
  }
  // só agora a cena anterior sai de vez (onDestroy): a nova já está montada
  i = 0; while (i < previous.length) { previous[i].destroyBehaviors(); i = i + 1; }
```

- [ ] **Step 4: Run tests**

Run:
```
$RTS run tests/test_behavior_ganchos.ts
$RTS run tests/test_scene.ts
$RTS run tests/test_play_mode.ts
$RTS run tests/test_scene_document.ts
$RTS run tests/claude-test-sceneio-roundtrip.ts
npm run check:params
```
Expected: `[PASSOU] ganchos: ...` e os demais verdes como antes.

- [ ] **Step 5: Portão de revisão**

Despachar um revisor (superpowers:requesting-code-review) com o diff da task e a saída dos testes. Pontos: nenhum caminho que só MOVE objetos (Play, rollback de carga) chama `onDestroy`; `clear` destrói depois de soltar (`uiOwner` já `null` durante `onDestroy`); `removeAt` destrói depois de corrigir índices; nenhum custo novo por quadro.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(core): onDestroy/onDomReload no Behavior; Scene.clear destroi, detachAll so solta; activeInHierarchy"`

---

### Task 2: `DomHost`, prefixador de CSS e ponte de clique

**Files:**
- Create: `src/engine/ui/dom_css.ts`, `src/engine/ui/ui_click.ts`, `src/engine/ui/dom_host.ts`
- Modify: `src/engine/ui/game_ui.ts` (linhas 51-62: `dispatchUIClick` sai para `ui_click.ts` e é reexportado)
- Modify: `tests/editor-static.test.mjs` (teste novo da fachada)
- Test: `tests/test_dom_css.ts`, `tests/test_dom_host.ts`

**Interfaces:**
- Produces (`@engine/ui/dom_css`): `DOM_ATRIBUTO_ESCOPO = "data-go"`, `seletorEscopo(serial: number): string`, `prefixarSeletor(sel, escopo): string`, `prefixarCss(css, escopo): string`, `class PartesHtml { estilos; corpo; scripts }`, `separarHtml(html, p: PartesHtml): void`, `prepararHtml(html, css, escopo): string`, `scriptsRemovidos(): number`.
- Produces (`@engine/ui/ui_click`): `dispatchUIClick(o: GameObject, name: string): void` (movido; `game_ui.ts` reexporta).
- Produces (`@engine/ui/dom_host`): `DOM_NENHUM`, `DOM_LAYOUT_FLOATS = 6`, `DL_ANCORAGEM/DL_LARGURA/DL_ALTURA/DL_ORDEM/DL_ESCALA/DL_BLOQUEIA`, `DOM_FONTE_BASE_PX = 16`; `domHostRegistrar(b: Behavior): number`, `domHostConteudo(slot, html)`, `domHostLayout(slot, cfg: Float64Array)`, `domHostRemover(slot)`, `domHostRaiz(slot): number`, `domHostEscopo(slot): string`, `domHostDoc(): number`, `domHostAtivos(): number`, `domHostRenders(): number`, `domHostRender(win: i64, area: Float64Array)`, `domHostPump()`, `domHostSobreUI(): boolean`, `domHostSeletorSobre(sel)`, `domHostPrevia(on: boolean)`, `domHostDestacar(o: GameObject | null, contorno: string)`.

- [ ] **Step 1: Write the failing tests**

`tests/test_dom_css.ts`:

```ts
// Teste SEM JANELA do prefixador de CSS e da separação do HTML de um DomCanvas.
//   rts.exe run tests/test_dom_css.ts
import io from "@compat/io.ts";
import { seletorEscopo, prefixarSeletor, prefixarCss, prepararHtml, scriptsRemovidos } from "@engine/ui/dom_css";

function check(c: boolean, m: string): void { if (!c) throw new Error(m + "\n"); }
function igual(obtido: string, esperado: string, m: string): void {
  if (obtido !== esperado) throw new Error(m + "\n  obtido:   " + obtido + "\n  esperado: " + esperado);
}
const E = seletorEscopo(7);
igual(E, "[data-go=\"7\"]", "escopo por atributo");
igual(prefixarSeletor("p", E), E + " p", "seletor simples");
igual(prefixarSeletor(" .a > b ", E), E + " .a > b", "combinador preservado");
igual(prefixarSeletor(":root", E), E, ":root vira a raiz");
igual(prefixarSeletor("body.escuro p", E), E + ".escuro p", "composto colado à raiz fica colado");
igual(prefixarSeletor("html > body .x", E), E + " .x", "html > body some");
igual(prefixarSeletor("bodyguard", E), E + " bodyguard", "nome que só começa com body não é raiz");
igual(prefixarCss("p{color:red}", E), E + " p{color:red}", "regra");
igual(prefixarCss("h1, .a > b{x:1}", E), E + " h1, " + E + " .a > b{x:1}", "lista");
igual(prefixarCss("html,body{margin:0}", E), E + ", " + E + "{margin:0}", "html,body");
igual(prefixarCss(":is(h1, h2) span{a:1}", E), E + " :is(h1, h2) span{a:1}", "vírgula entre parênteses não separa");
igual(prefixarCss("/* c */ a:hover{b:1}", E), E + " a:hover{b:1}", "comentário some");
igual(prefixarCss("@media (max-width: 600px){p{a:1} .b{c:2}}", E),
      "@media (max-width: 600px){" + E + " p{a:1}\n" + E + " .b{c:2}}", "@media prefixado por dentro");
igual(prefixarCss("@keyframes pulso{from{opacity:0}to{opacity:1}}", E), "@keyframes pulso{from{opacity:0}to{opacity:1}}", "@keyframes intacto");
igual(prefixarCss("@font-face{font-family:x}", E), "@font-face{font-family:x}", "@font-face intacto");
igual(prefixarCss("@import url(x.css);", E), "@import url(x.css);", "@import intacto");
igual(prefixarCss("a{b:1}\n\n c{d:2}", E), E + " a{b:1}\n" + E + " c{d:2}", "regras em linhas");
igual(prefixarCss("", E), "", "vazio");

const doc = "<!doctype html><html><head><title>x</title><style>p{color:red}</style></head>" +
  "<body><p>oi</p><script>alert(1)</script></body></html>";
igual(prepararHtml(doc, ".b{c:1}", E), "<style>" + E + " p{color:red}\n" + E + " .b{c:1}</style><p>oi</p>", "documento completo");
check(scriptsRemovidos() === 1, "<script> contado");
igual(prepararHtml("<div id=\"a\">x</div>", "", E), "<div id=\"a\">x</div>", "fragmento sem CSS");
igual(prepararHtml("<style>i{a:1}</style><i>x</i>", "", E), "<style>" + E + " i{a:1}</style><i>x</i>", "<style> no corpo");
check(scriptsRemovidos() === 0, "sem script");
io.print("[PASSOU] dom_css: prefixador (raiz, listas, @media, @keyframes) e HTML (corpo, estilos, scripts)");
```

`tests/test_dom_host.ts`:

```ts
// Teste SEM JANELA do DomHost com a fachada real do rts: documento sob demanda,
// uma raiz por canvas, layout e visibilidade só quando mudam, região, prévia,
// destaque, clique -> onUIClick(data-acao|id), domHostSobreUI e liberação.
//   rts.exe run tests/test_dom_host.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { ANCHOR_BR } from "@engine/ui/anchor";
import { domHostRegistrar, domHostRemover, domHostConteudo, domHostLayout, domHostRender, domHostPump,
         domHostSobreUI, domHostSeletorSobre, domHostPrevia, domHostDestacar, domHostRaiz, domHostDoc,
         domHostEscopo, domHostAtivos, domHostRenders, DOM_NENHUM, DOM_LAYOUT_FLOATS,
         DL_ANCORAGEM, DL_LARGURA, DL_ALTURA, DL_ORDEM, DL_ESCALA, DL_BLOQUEIA } from "@engine/ui/dom_host";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Dono extends Behavior {
  cliques: string[];
  constructor() { super(); this.cliques = []; }
  onUIClick(nome: string): void { this.cliques.push(nome); }
}
const sc = new Scene("dom-host");
function dono(nome: string): Dono {
  const o = new GameObject(nome); const b = new Dono(); o.addBehavior(b); sc.add(o); return b;
}
function inline(h: number, no: number, prop: string): string { return dom.inlineProperty(h, no, prop); }
const area = new Float64Array(4); area[0] = 10; area[1] = 20; area[2] = 640; area[3] = 360;

// sem canvas: nada
const r0 = domHostRenders();
domHostRender(0, area); domHostPump();
check(domHostDoc() === 0 && domHostRenders() === r0 && !domHostSobreUI(), "sem canvas: sem documento, sem render");

// dois canvases, duas raízes em #dom-regiao
const a = dono("A"); const b = dono("B");
const oa = a.owner as GameObject; const ob = b.owner as GameObject;
const sa = domHostRegistrar(a); const sb = domHostRegistrar(b);
const h = domHostDoc();
check(h !== 0 && sa !== sb && domHostAtivos() === 2, "documento criado no primeiro registro");
const ra = domHostRaiz(sa); const rb = domHostRaiz(sb);
const regiao = dom.querySelector(h, "#dom-regiao");
check(dom.parentElement(h, ra) === regiao && dom.parentElement(h, rb) === regiao, "raízes filhas de #dom-regiao");
check(domHostEscopo(sa) === "[data-go=\"" + dom.getAttribute(h, ra, "data-go") + "\"]" && domHostEscopo(sa) !== domHostEscopo(sb), "escopo por serial");

// layout
const cfg = new Float64Array(DOM_LAYOUT_FLOATS);
cfg[DL_ANCORAGEM] = ANCHOR_BR; cfg[DL_LARGURA] = 200; cfg[DL_ALTURA] = 0; cfg[DL_ORDEM] = 5; cfg[DL_ESCALA] = 1.5; cfg[DL_BLOQUEIA] = 1;
a.host.px = 12; a.host.py = 8;
domHostLayout(sa, cfg);
domHostRender(0, area);
check(domHostRenders() === r0 + 1, "um render por quadro com dois canvases");
check(inline(h, ra, "right") === "12px" && inline(h, ra, "bottom") === "8px", "BR: right/bottom = deslocamento");
check(inline(h, ra, "width") === "200px" && inline(h, ra, "left") === "auto", "largura fixa");
check(inline(h, ra, "top") === "0px" && inline(h, ra, "height") === "auto", "altura 0 estica até a borda");
check(inline(h, ra, "z-index") === "5" && inline(h, ra, "font-size") === "24px", "ordem e escala");
check(inline(h, regiao, "left") === "10px" && inline(h, regiao, "top") === "20px" && inline(h, regiao, "height") === "360px", "região = área");
a.host.px = 30; domHostRender(0, area);
check(inline(h, ra, "right") === "30px", "mover o objeto reaplica o layout");

// visibilidade
check(inline(h, ra, "display") === "block", "visível");
oa.active = 0; domHostRender(0, area);
check(inline(h, ra, "display") === "none", "objeto inativo esconde");
oa.active = 1; a.enabled = 0; domHostRender(0, area);
check(inline(h, ra, "display") === "none", "componente desabilitado esconde");
a.enabled = 1; domHostRender(0, area);
check(inline(h, ra, "display") === "block", "volta a aparecer");
ob.parent = 0; oa.active = 0; domHostRender(0, area);
check(inline(h, rb, "display") === "none", "pai inativo esconde o filho");
oa.active = 1; ob.parent = 0 - 1; domHostRender(0, area);

// clique -> onUIClick
domHostConteudo(sa, "<div class=\"painel\"><button data-acao=\"jogar\"><span id=\"rot\">Jogar</span></button><p id=\"solto\">x</p><i>sem id</i></div>");
const span = dom.queryWithin(h, ra, "#rot");
dom.pushRawEvent(h, span, "click"); domHostPump();
check(a.cliques.length === 1 && a.cliques[0] === "jogar", "data-acao do ancestral vence o id do alvo");
dom.pushRawEvent(h, dom.queryWithin(h, ra, "#solto"), "click"); domHostPump();
check(a.cliques[1] === "solto", "sem data-acao: o id");
dom.pushRawEvent(h, dom.queryWithin(h, ra, "i"), "click"); domHostPump();
check(a.cliques.length === 2 && b.cliques.length === 0, "sem ação nem id na raiz: nada (o id de #dom-regiao não vaza)");

// sobre a UI (seletor substituível: :hover exige mouse real)
domHostSeletorSobre(".forcado");
check(!domHostSobreUI(), "nada marcado");
dom.setAttr(h, span, "class", "forcado");
check(domHostSobreUI(), "descendente sob o ponteiro bloqueia");
cfg[DL_BLOQUEIA] = 0; domHostLayout(sa, cfg);
check(!domHostSobreUI(), "bloqueiaCliques = false não bloqueia");
cfg[DL_BLOQUEIA] = 1; domHostLayout(sa, cfg);
dom.setAttr(h, span, "class", ""); dom.setAttr(h, ra, "class", "dom-canvas forcado");
check(!domHostSobreUI(), "a própria raiz (área inteira) não conta");
dom.setAttr(h, ra, "class", "dom-canvas"); dom.setAttr(h, span, "class", "forcado");
a.enabled = 0; domHostRender(0, area);
check(!domHostSobreUI(), "canvas escondido não bloqueia");
a.enabled = 1; domHostRender(0, area);
domHostSeletorSobre("");

// prévia e destaque
domHostPrevia(true);
check(inline(h, regiao, "pointer-events") === "none", "prévia não rouba clique dos painéis");
domHostPrevia(false);
check(inline(h, regiao, "pointer-events") === "auto", "Play: o clique volta");
domHostDestacar(oa, "2px dashed #6A9DD2");
check(dom.cssText(h, ra).indexOf("dashed") >= 0 && dom.cssText(h, rb).indexOf("dashed") < 0, "contorno só no selecionado");
domHostDestacar(null, "none");
check(dom.cssText(h, ra).indexOf("dashed") < 0, "sem seleção, sem contorno");

// liberação
const antes = dom.nodeCount(h);
let k = 0;
while (k < 50) { const c = dono("C" + k); const s = domHostRegistrar(c); domHostConteudo(s, "<p>x</p><p>y</p>"); domHostRemover(s); k = k + 1; }
check(dom.nodeCount(h) <= antes + 8, "registrar/remover 50 vezes não cresce a arena (releaseSubtree)");
domHostRemover(sa);
check(domHostAtivos() === 1 && domHostDoc() === h, "ainda há B");
domHostRemover(sb);
check(domHostAtivos() === 0 && domHostDoc() === 0, "o último canvas libera o documento");
domHostRemover(sb);   // repetido: no-op
const s2 = domHostRegistrar(b);
check(domHostDoc() !== 0 && domHostRaiz(s2) !== DOM_NENHUM, "novo documento sob demanda");
domHostRender(0, area);
sc.detachAll(); domHostRender(0, area);
check(inline(domHostDoc(), domHostRaiz(s2), "display") === "none", "objeto fora da cena (original guardado pelo Play) fica escondido");
domHostRemover(s2);
io.print("[PASSOU] DomHost: documento sob demanda, raízes, layout, visibilidade, região, prévia, destaque, clique, sobre-UI e liberação");
```

Em `tests/editor-static.test.mjs`, no fim:

```js
const walk = d => fs.readdirSync(new URL('../' + d, import.meta.url), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
test('only dom_host.ts names the DOM facade entry points (every file that names them gets its own copy)', () => {
  const gatilho = /parseDocument|document\.|new Document|new Element|runScripts|loadDocument/;
  // main.ts (new DocumentPanel) e undo.ts (comentário com scene_document.ts) já disparavam antes do DomCanvas.
  const permitidos = new Set(['src/engine/ui/dom_host.ts', 'main.ts', 'src/editor/undo.ts']);
  const arquivos = ['game.ts', 'main.ts', ...walk('src'), ...walk('assets/pacotes'), ...walk('assets/scripts')].filter(f => f.endsWith('.ts'));
  assert.deepEqual(arquivos.filter(f => !permitidos.has(f) && gatilho.test(read(f))), []);
  assert.match(read('src/engine/ui/dom_host.ts'), /parseDocument\(/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `$RTS run tests/test_dom_css.ts; $RTS run tests/test_dom_host.ts; node --test tests/editor-static.test.mjs`
Expected: FAIL (`dom_css`/`dom_host` não existem; o teste estático falha no `assert.match` de `dom_host.ts`).

- [ ] **Step 3: Write minimal implementation**

`src/engine/ui/ui_click.ts` recebe `dispatchUIClick` exatamente como está em `game_ui.ts:51-62` (com `import type { GameObject }` e `import type { Behavior }`). Em `game_ui.ts`, as linhas 51-62 viram `export { dispatchUIClick } from "./ui_click";` e o laço `drawObjectUI` passa a chamar o importado (`import { dispatchUIClick } from "./ui_click";`).

`src/engine/ui/dom_css.ts`:

```ts
// Engine RTS — CSS e HTML de um DomCanvas preparados para o documento único da
// janela: o CSS de cada canvas ganha o prefixo [data-go="<serial>"] (um canvas
// não pinta o outro) e o HTML perde <script>, cabeçalho e o que não é corpo.
// Funções puras, sem janela e sem a fachada do DOM: rodam na carga, nunca por quadro.

export const DOM_ATRIBUTO_ESCOPO: string = "data-go";
/// Seletores que designam o documento inteiro: viram a raiz do canvas.
const RAIZES_CSS: string[] = [":root", "html", "body"];
/// At-rules com regras dentro que precisam do prefixo; as demais passam intactas.
const AT_PREFIXADAS: string[] = ["media", "supports"];
const C_ESPACO: number = 32; const C_TAB: number = 9; const C_NL: number = 10; const C_CR: number = 13;
const C_MAIOR: number = 62; const C_ARROBA: number = 64; const C_VIRGULA: number = 44;
const C_ABRE_CHAVE: number = 123; const C_FECHA_CHAVE: number = 125;
const C_ABRE_PAR: number = 40; const C_FECHA_PAR: number = 41; const C_ABRE_COL: number = 91; const C_FECHA_COL: number = 93;
const C_HIFEN: number = 45; const C_SUB: number = 95;

export function seletorEscopo(serial: number): string { return "[" + DOM_ATRIBUTO_ESCOPO + "=\"" + serial + "\"]"; }

function ehEspaco(c: number): boolean { return c === C_ESPACO || c === C_TAB || c === C_NL || c === C_CR; }
function ehNome(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === C_HIFEN || c === C_SUB;
}
function semComentarios(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const a = css.indexOf("/*", i);
    if (a < 0) { out = out + css.substring(i); break; }
    out = out + css.substring(i, a);
    const b = css.indexOf("*/", a + 2);
    if (b < 0) break;
    i = b + 2;
  }
  return out;
}
/// Índice do `}` que fecha o `{` em `abre` (blocos aninhados contam), ou o fim.
function fechaBloco(css: string, abre: number): number {
  let prof = 0;
  let i = abre;
  while (i < css.length) {
    const c = css.charCodeAt(i);
    if (c === C_ABRE_CHAVE) prof = prof + 1;
    else if (c === C_FECHA_CHAVE) { prof = prof - 1; if (prof === 0) return i; }
    i = i + 1;
  }
  return css.length;
}
function tamanhoRaiz(s: string): number {
  let k = 0;
  while (k < RAIZES_CSS.length) {
    const r = RAIZES_CSS[k];
    if (s.indexOf(r) === 0 && (s.length === r.length || !ehNome(s.charCodeAt(r.length)))) return r.length;
    k = k + 1;
  }
  return 0;
}
export function prefixarSeletor(sel: string, escopo: string): string {
  let s = sel.trim();
  let n = tamanhoRaiz(s);
  if (n === 0) return escopo + " " + s;
  while (n > 0) {
    s = s.substring(n);
    // composto colado à raiz (body.escuro, html:hover) continua colado ao escopo
    if (s.length > 0 && !ehEspaco(s.charCodeAt(0)) && s.charCodeAt(0) !== C_MAIOR) return escopo + s;
    s = s.trim();
    if (s.length > 0 && s.charCodeAt(0) === C_MAIOR) s = s.substring(1).trim();
    n = tamanhoRaiz(s);
  }
  return s.length === 0 ? escopo : escopo + " " + s;
}
function prefixarLista(lista: string, escopo: string): string {
  let out = "";
  let prof = 0;
  let ini = 0;
  let i = 0;
  while (i <= lista.length) {
    const c = i < lista.length ? lista.charCodeAt(i) : C_VIRGULA;
    if (c === C_ABRE_PAR || c === C_ABRE_COL) prof = prof + 1;
    else if (c === C_FECHA_PAR || c === C_FECHA_COL) prof = prof - 1;
    else if (c === C_VIRGULA && prof === 0) {
      const sel = lista.substring(ini, i).trim();
      if (sel.length > 0) out = out.length === 0 ? prefixarSeletor(sel, escopo) : out + ", " + prefixarSeletor(sel, escopo);
      ini = i + 1;
    }
    i = i + 1;
  }
  return out;
}
function junta(out: string, regra: string): string { return out.length === 0 ? regra : out + "\n" + regra; }
function nomeAt(cabeca: string): string {
  let j = 1;
  while (j < cabeca.length && ehNome(cabeca.charCodeAt(j))) j = j + 1;
  return cabeca.substring(1, j).toLowerCase();
}
function prefixarRegras(src: string, escopo: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    while (i < n && ehEspaco(src.charCodeAt(i))) i = i + 1;
    if (i >= n) break;
    const abre = src.indexOf("{", i);
    if (src.charCodeAt(i) === C_ARROBA) {
      const pv = src.indexOf(";", i);
      if (pv >= 0 && (abre < 0 || pv < abre)) { out = junta(out, src.substring(i, pv + 1).trim()); i = pv + 1; continue; }
      if (abre < 0) break;
      const fim = fechaBloco(src, abre);
      const cabeca = src.substring(i, abre).trim();
      const dentro = src.substring(abre + 1, fim);
      if (AT_PREFIXADAS.indexOf(nomeAt(cabeca)) >= 0) out = junta(out, cabeca + "{" + prefixarRegras(dentro, escopo) + "}");
      else out = junta(out, cabeca + "{" + dentro + "}");
      i = fim + 1;
      continue;
    }
    if (abre < 0) break;
    const fecha = fechaBloco(src, abre);
    out = junta(out, prefixarLista(src.substring(i, abre), escopo) + "{" + src.substring(abre + 1, fecha) + "}");
    i = fecha + 1;
  }
  return out;
}
/// CSS com cada seletor de topo limitado à raiz `escopo`; `:root`/`html`/`body`
/// viram a raiz; `@media`/`@supports` prefixados por dentro; demais at-rules intactas.
export function prefixarCss(css: string, escopo: string): string { return prefixarRegras(semComentarios(css), escopo); }

/// Estado de uma separação (classe sem métodos, instância de módulo).
export class PartesHtml {
  estilos: string; corpo: string; scripts: number;
  constructor() { this.estilos = ""; this.corpo = ""; this.scripts = 0; }
}
/// Tira os blocos <tag ...>...</tag>; guarda o miolo em `p.estilos` (style) ou conta (script).
function tirarBlocos(src: string, tag: string, p: PartesHtml, guardar: boolean): string {
  const low = src.toLowerCase();
  const abre = "<" + tag;
  const fecha = "</" + tag + ">";
  let out = "";
  let i = 0;
  while (i < src.length) {
    const a = low.indexOf(abre, i);
    if (a < 0) { out = out + src.substring(i); break; }
    const fimAbre = low.indexOf(">", a);
    const b = fimAbre < 0 ? 0 - 1 : low.indexOf(fecha, fimAbre);
    out = out + src.substring(i, a);
    if (b < 0) break;
    const miolo = src.substring(fimAbre + 1, b);
    if (guardar) p.estilos = p.estilos.length === 0 ? miolo : p.estilos + "\n" + miolo;
    else p.scripts = p.scripts + 1;
    i = b + fecha.length;
  }
  return out;
}
function tirarMarca(src: string, marca: string): string {
  const a = src.toLowerCase().indexOf(marca);
  if (a < 0) return src;
  const b = src.indexOf(">", a);
  return b < 0 ? src.substring(0, a) : src.substring(0, a) + src.substring(b + 1);
}
function tirarCabeca(src: string): string {
  const low = src.toLowerCase();
  const a = low.indexOf("<head");
  if (a < 0) return src;
  const b = low.indexOf("</head>", a);
  return b < 0 ? src.substring(0, a) : src.substring(0, a) + src.substring(b + 7);
}
export function separarHtml(html: string, p: PartesHtml): void {
  p.estilos = ""; p.corpo = ""; p.scripts = 0;
  let s = tirarBlocos(html, "style", p, true);
  s = tirarBlocos(s, "script", p, false);
  const low = s.toLowerCase();
  const ib = low.indexOf("<body");
  if (ib >= 0) {
    const ab = low.indexOf(">", ib);
    const fb = low.indexOf("</body>", ab);
    s = s.substring(ab + 1, fb >= 0 ? fb : s.length);
  } else {
    s = tirarCabeca(tirarMarca(tirarMarca(tirarMarca(s, "<!doctype"), "<html"), "</html"));
  }
  p.corpo = s.trim();
}
const partes = new PartesHtml();
/// Conteúdo final da raiz: um <style> com os estilos do arquivo + `css`, prefixados, e o corpo.
export function prepararHtml(html: string, css: string, escopo: string): string {
  separarHtml(html, partes);
  let todos = partes.estilos;
  if (css.length > 0) todos = todos.length > 0 ? todos + "\n" + css : css;
  const prefixado = todos.length > 0 ? prefixarCss(todos, escopo) : "";
  return prefixado.length > 0 ? "<style>" + prefixado + "</style>" + partes.corpo : partes.corpo;
}
/// Quantos <script> a última `prepararHtml` removeu (o DomCanvas avisa no Console).
export function scriptsRemovidos(): number { return partes.scripts; }
```

`src/engine/ui/dom_host.ts`:

```ts
// Engine RTS — DomHost: o ÚNICO módulo que fala com a fachada do DOM do rts
// (parseDocument, pumpEventCallbacks). O rts de hoje pinta um documento por
// janela (spike-domcanvas §2), então todos os DomCanvas vivem num documento
// só: um <div data-go="<serial>"> por canvas, filho de #dom-regiao, que
// recorta a área do jogo (a aba Jogo no editor). Criado no primeiro registro e
// liberado quando o último canvas sai: cena sem DomCanvas não paga nada.
//
// Por quadro: domHostRender (visibilidade e layout só quando mudam, e UM
// render) e domHostPump depois do endFrame. Sem try/catch e sem string por
// quadro: as strings de estilo nascem só quando um valor muda. Não chama
// pumpTimerCallbacks: ela gira o loop inteiro do motor (WebSocket, processos)
// fora do ctrlPoll, e <script> de página é removido na carga.
//
// Outro arquivo que escrever os nomes de entrada da fachada (até em
// comentário) ganha uma cópia dela: tests/editor-static.test.mjs recusa.
import { render } from "rts:egui";
import { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { ANCHOR_TR, ANCHOR_BL, ANCHOR_BR } from "./anchor";
import { DOM_ATRIBUTO_ESCOPO, seletorEscopo } from "./dom_css";
import { dispatchUIClick } from "./ui_click";

export const DOM_NENHUM: number = 0 - 1;
/// Layout de um canvas: [ancoragem, largura, altura, ordem, escala, bloqueiaCliques].
export const DOM_LAYOUT_FLOATS: number = 6;
export const DL_ANCORAGEM: number = 0;
export const DL_LARGURA: number = 1;
export const DL_ALTURA: number = 2;
export const DL_ORDEM: number = 3;
export const DL_ESCALA: number = 4;
export const DL_BLOQUEIA: number = 5;
/// font-size da raiz com escala 1 (fase 1: `escala` vira tamanho de fonte).
export const DOM_FONTE_BASE_PX: number = 16;
/// Fundo transparente é obrigatório: sem ele o canvas do documento é branco e cobre o 3D.
const HTML_BASE: string = "<style>html,body{background:transparent;margin:0}</style>" +
  "<div id=\"dom-regiao\" style=\"position:absolute;left:0px;top:0px;width:100%;height:100%;overflow:hidden\"></div>";
const SELETOR_REGIAO: string = "#dom-regiao";
const ESTILO_RAIZ: string = "position:absolute";
const CLASSE_RAIZ: string = "dom-canvas";
const SELETOR_ACAO: string = "[data-acao]";
const ATRIBUTO_ACAO: string = "data-acao";
const SELETOR_ID: string = "[id]";
const ATRIBUTO_ID: string = "id";
const SELETOR_SOBRE_PADRAO: string = ":hover";
const EVENTO_CLIQUE: string = "click";
const NAO_APLICADO: number = 0 - 1;
const PX: string = "px";
const ZERO_PX: string = "0px";
const AUTO: string = "auto";
const P_LEFT: string = "left"; const P_RIGHT: string = "right"; const P_TOP: string = "top"; const P_BOTTOM: string = "bottom";
const P_WIDTH: string = "width"; const P_HEIGHT: string = "height"; const P_Z: string = "z-index"; const P_FONTE: string = "font-size";
const P_DISPLAY: string = "display"; const P_PONTEIRO: string = "pointer-events"; const P_CONTORNO: string = "outline";
const V_BLOCK: string = "block"; const V_NONE: string = "none";
/// Dono de um slot livre (nunca visível).
const SEM_DONO: Behavior = new Behavior();

class EstadoDomHost {
  doc: Document | null; h: number; regiao: number; serial: number; ativos: number; renders: number;
  raizes: number[]; donos: Behavior[]; escopos: string[]; visivel: number[]; sujo: number[];
  ultPx: number[]; ultPy: number[]; layout: Float64Array[]; livres: number[];
  area: Float64Array; previa: number; destaque: GameObject | null; contorno: string; seletorSobre: string;
  constructor() {
    this.doc = null; this.h = 0; this.regiao = DOM_NENHUM; this.serial = 0; this.ativos = 0; this.renders = 0;
    this.raizes = []; this.donos = []; this.escopos = []; this.visivel = []; this.sujo = [];
    this.ultPx = []; this.ultPy = []; this.layout = []; this.livres = [];
    this.area = new Float64Array(4); this.previa = NAO_APLICADO; this.destaque = null; this.contorno = "";
    this.seletorSobre = SELETOR_SOBRE_PADRAO;
  }
}
const est = new EstadoDomHost();

function garantirDocumento(): void {
  if (est.h !== 0) return;
  const d = parseDocument(HTML_BASE);
  est.doc = d;
  est.h = d._dom;
  est.regiao = dom.querySelector(est.h, SELETOR_REGIAO);
  est.area[2] = NAO_APLICADO; est.previa = NAO_APLICADO; est.destaque = null; est.contorno = "";
}
function liberarDocumento(): void {
  dom.free(est.h);
  est.doc = null; est.h = 0; est.regiao = DOM_NENHUM;
  est.raizes.length = 0; est.donos.length = 0; est.escopos.length = 0; est.visivel.length = 0; est.sujo.length = 0;
  est.ultPx.length = 0; est.ultPy.length = 0; est.layout.length = 0; est.livres.length = 0;
}
function novoSlot(): number {
  if (est.livres.length > 0) {
    const s = est.livres[est.livres.length - 1];
    est.livres.length = est.livres.length - 1;
    return s;
  }
  est.raizes.push(DOM_NENHUM); est.donos.push(SEM_DONO); est.escopos.push(""); est.visivel.push(NAO_APLICADO);
  est.sujo.push(1); est.ultPx.push(0.0); est.ultPy.push(0.0); est.layout.push(new Float64Array(DOM_LAYOUT_FLOATS));
  return est.raizes.length - 1;
}
/// Cria a raiz de um canvas (e o documento, no primeiro). Devolve o slot.
export function domHostRegistrar(b: Behavior): number {
  garantirDocumento();
  const slot = novoSlot();
  est.serial = est.serial + 1;
  const h = est.h;
  const raiz = dom.createElement(h, "div");
  dom.setAttr(h, raiz, DOM_ATRIBUTO_ESCOPO, "" + est.serial);
  dom.setAttr(h, raiz, "class", CLASSE_RAIZ);
  dom.setAttr(h, raiz, "style", ESTILO_RAIZ);
  dom.appendChild(h, est.regiao, raiz);
  dom.addListenerCbOptions(h, raiz, EVENTO_CLIQUE, (e: any): void => { cliqueNaRaiz(slot, e.target.nodeId); });
  est.raizes[slot] = raiz; est.donos[slot] = b; est.escopos[slot] = seletorEscopo(est.serial);
  est.visivel[slot] = NAO_APLICADO; est.sujo[slot] = 1;
  const cfg = est.layout[slot];
  cfg[DL_ANCORAGEM] = 0.0; cfg[DL_LARGURA] = 0.0; cfg[DL_ALTURA] = 0.0; cfg[DL_ORDEM] = 0.0; cfg[DL_ESCALA] = 1.0; cfg[DL_BLOQUEIA] = 1.0;
  est.destaque = null;   // o próximo domHostDestacar reaplica o contorno, inclusive nesta raiz
  est.ativos = est.ativos + 1;
  return slot;
}
export function domHostConteudo(slot: number, html: string): void {
  if (slot < 0 || slot >= est.raizes.length || est.raizes[slot] === DOM_NENHUM) return;
  dom.setInnerHtml(est.h, est.raizes[slot], html);
}
export function domHostLayout(slot: number, cfg: Float64Array): void {
  if (slot < 0 || slot >= est.raizes.length) return;
  const d = est.layout[slot];
  let i = 0;
  while (i < DOM_LAYOUT_FLOATS) { d[i] = cfg[i]; i = i + 1; }
  est.sujo[slot] = 1;
}
/// Tira a raiz do documento e recicla a subárvore; o último canvas libera o documento.
export function domHostRemover(slot: number): void {
  if (slot < 0 || slot >= est.raizes.length || est.raizes[slot] === DOM_NENHUM) return;
  const raiz = est.raizes[slot];
  dom.removeNode(est.h, raiz);
  dom.releaseSubtree(est.h, raiz);
  est.raizes[slot] = DOM_NENHUM; est.donos[slot] = SEM_DONO;
  est.livres.push(slot);
  est.ativos = est.ativos - 1;
  if (est.ativos === 0) liberarDocumento();
}
export function domHostRaiz(slot: number): number { return slot >= 0 && slot < est.raizes.length ? est.raizes[slot] : DOM_NENHUM; }
export function domHostEscopo(slot: number): string { return slot >= 0 && slot < est.escopos.length ? est.escopos[slot] : ""; }
export function domHostDoc(): number { return est.h; }
export function domHostAtivos(): number { return est.ativos; }
export function domHostRenders(): number { return est.renders; }

function visivelNoQuadro(b: Behavior): number {
  if (b.enabled === 0) return 0;
  const o = b.owner;
  if (o === null) return 0;
  const cena = o.uiOwner;
  if (cena === null) return 0;
  return cena.activeInHierarchy(o);
}
function aplicarLayout(i: number, b: Behavior): void {
  const cfg = est.layout[i]; const raiz = est.raizes[i]; const h = est.h;
  const px = b.host.px; const py = b.host.py;
  est.ultPx[i] = px; est.ultPy[i] = py; est.sujo[i] = 0;
  const anc = cfg[DL_ANCORAGEM] | 0;
  const direita = anc === ANCHOR_TR || anc === ANCHOR_BR;
  const baixo = anc === ANCHOR_BL || anc === ANCHOR_BR;
  const w = cfg[DL_LARGURA]; const al = cfg[DL_ALTURA];
  dom.setStyleProperty(h, raiz, direita ? P_RIGHT : P_LEFT, px + PX);
  dom.setStyleProperty(h, raiz, direita ? P_LEFT : P_RIGHT, w > 0.0 ? AUTO : ZERO_PX);
  dom.setStyleProperty(h, raiz, P_WIDTH, w > 0.0 ? w + PX : AUTO);
  dom.setStyleProperty(h, raiz, baixo ? P_BOTTOM : P_TOP, py + PX);
  dom.setStyleProperty(h, raiz, baixo ? P_TOP : P_BOTTOM, al > 0.0 ? AUTO : ZERO_PX);
  dom.setStyleProperty(h, raiz, P_HEIGHT, al > 0.0 ? al + PX : AUTO);
  dom.setStyleProperty(h, raiz, P_Z, "" + (cfg[DL_ORDEM] | 0));
  dom.setStyleProperty(h, raiz, P_FONTE, (DOM_FONTE_BASE_PX * cfg[DL_ESCALA]) + PX);
}
function atualizarRaiz(i: number): void {
  const b = est.donos[i];
  const vis = visivelNoQuadro(b);
  if (vis !== est.visivel[i]) {
    est.visivel[i] = vis;
    dom.setStyleProperty(est.h, est.raizes[i], P_DISPLAY, vis !== 0 ? V_BLOCK : V_NONE);
  }
  if (vis !== 0 && (est.sujo[i] !== 0 || b.host.px !== est.ultPx[i] || b.host.py !== est.ultPy[i])) aplicarLayout(i, b);
}
function aplicarRegiao(a: Float64Array): void {
  const r = est.area;
  if (a[0] === r[0] && a[1] === r[1] && a[2] === r[2] && a[3] === r[3]) return;
  r[0] = a[0]; r[1] = a[1]; r[2] = a[2]; r[3] = a[3];
  dom.setStyleProperty(est.h, est.regiao, P_LEFT, a[0] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_TOP, a[1] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_WIDTH, a[2] + PX);
  dom.setStyleProperty(est.h, est.regiao, P_HEIGHT, a[3] + PX);
}
/// UM render por quadro para todos os canvases. `area` = [x, y, w, h] do jogo
/// na janela (do chamador). Sem canvas registrado: retorna sem render.
export function domHostRender(win: i64, area: Float64Array): void {
  if (est.ativos === 0) return;
  aplicarRegiao(area);
  const n = est.raizes.length;
  let i = 0;
  while (i < n) {
    if (est.raizes[i] !== DOM_NENHUM) atualizarRaiz(i);
    i = i + 1;
  }
  est.renders = est.renders + 1;
  render(win, est.h);
}
/// Depois do endFrame: os cliques vistos pelo hit-test viram callbacks (1 quadro de latência).
export function domHostPump(): void {
  const d = est.doc;
  if (d === null) return;
  pumpEventCallbacks(d);
}
function cliqueNaRaiz(slot: number, alvo: number): void {
  const b = est.donos[slot];
  const o = b.owner;
  if (o === null || b.enabled === 0) return;
  const h = est.h; const raiz = est.raizes[slot];
  let acao = "";
  const comAcao = dom.closest(h, alvo, SELETOR_ACAO);
  if (comAcao !== DOM_NENHUM && comAcao !== raiz && dom.contains(h, raiz, comAcao) !== 0) acao = dom.getAttribute(h, comAcao, ATRIBUTO_ACAO);
  else {
    const comId = dom.closest(h, alvo, SELETOR_ID);
    if (comId !== DOM_NENHUM && comId !== raiz && dom.contains(h, raiz, comId) !== 0) acao = dom.getAttribute(h, comId, ATRIBUTO_ID);
  }
  if (acao.length > 0) dispatchUIClick(o, acao);
}
/// O ponteiro está sobre um elemento de algum canvas visível com bloqueiaCliques?
/// Olha os DESCENDENTES da raiz (a raiz cobre a área inteira). :hover é do quadro anterior.
export function domHostSobreUI(): boolean {
  if (est.ativos === 0) return false;
  const n = est.raizes.length;
  let i = 0;
  while (i < n) {
    if (est.raizes[i] !== DOM_NENHUM && est.visivel[i] === 1 && est.layout[i][DL_BLOQUEIA] !== 0.0 &&
        dom.queryWithin(est.h, est.raizes[i], est.seletorSobre) !== DOM_NENHUM) return true;
    i = i + 1;
  }
  return false;
}
/// Só para testes sem janela (o :hover real exige mouse). "" volta ao padrão.
export function domHostSeletorSobre(sel: string): void { est.seletorSobre = sel.length > 0 ? sel : SELETOR_SOBRE_PADRAO; }
/// Prévia do editor fora do Play: a região não recebe clique (os painéis continuam clicáveis).
export function domHostPrevia(on: boolean): void {
  const v = on ? 1 : 0;
  if (est.h === 0 || v === est.previa) return;
  est.previa = v;
  dom.setStyleProperty(est.h, est.regiao, P_PONTEIRO, on ? V_NONE : AUTO);
}
function contornar(o: GameObject | null, valor: string): void {
  if (o === null) return;
  let i = 0;
  while (i < est.raizes.length) {
    if (est.raizes[i] !== DOM_NENHUM && est.donos[i].owner === o) dom.setStyleProperty(est.h, est.raizes[i], P_CONTORNO, valor);
    i = i + 1;
  }
}
/// Contorno nas raízes do objeto selecionado (o retângulo da região na prévia).
export function domHostDestacar(o: GameObject | null, contorno: string): void {
  if (est.h === 0 || (o === est.destaque && contorno === est.contorno)) return;
  contornar(est.destaque, V_NONE);
  est.destaque = o; est.contorno = contorno;
  contornar(o, contorno);
}
```

- [ ] **Step 4: Run tests**

Run:
```
$RTS run tests/test_dom_css.ts
$RTS run tests/test_dom_host.ts
$RTS run tests/test_game_ui.ts
node --test tests/editor-static.test.mjs
npm run check:params
```
Expected: `[PASSOU] dom_css: ...`, `[PASSOU] DomHost: ...`, `[PASSOU] Game UI: ...`, `node --test` verde.

- [ ] **Step 5: Portão de revisão**

Revisor com diff e saídas. Pontos: `dom_host.ts` é o único arquivo com gatilhos da fachada; nenhuma string montada em `domHostRender`/`domHostSobreUI` quando nada muda; `cliqueNaRaiz` nunca sobe além da raiz; `liberarDocumento` só com `ativos === 0`; `domHostDestacar`/`domHostPrevia` idempotentes por quadro.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(ui): DomHost (documento unico, raiz por canvas, regiao, clique -> onUIClick) e prefixador de CSS"`

---

### Task 3: Componente `DomCanvas` e `DomVista`

**Files:**
- Create: `src/engine/ui/dom_vista.ts`, `src/engine/core/dom_canvas.ts`
- Regenerate: `src/engine/generated/{components.ts,components_game.ts,component_catalog.ts,editor_extensions.ts}` (`npm run components`)
- Test: `tests/test_dom_canvas.ts`

**Interfaces:**
- Consumes: `domHost*` e `DL_*` (Task 2), `prepararHtml`/`scriptsRemovidos` (Task 2), `onDestroy`/`onDomReload`/`detachAll` (Task 1).
- Produces (`@engine/ui/dom_vista`): `type DomEventoFn = (no: number) => void`, `DOM_VISTA_NENHUM`, `DOM_VISTA_MAX_NOS = 4096`, `DOM_NUM_CACHE = 1024`, `DOM_CASAS_MAX = 3`, `textoNumero(k, casas): string`, `alternarClasse(lista, classe, ligada): string`, `class DomVista { escritas; ligar(h, raizNo); soltar(); recomecar(); raiz(); valido(no); doc(); noDom(no); contar(sel); querySelector(sel); getText(no); setText(no, s); setNumero(no, v, casas); setStyle(no, prop, valor); setStyleNumero(no, prop, v, unidade); setClass(no, classe, ligada); setAttr(no, nome, valor); on(no, evento, fn) }`.
- Produces (`@engine/core/dom_canvas`): `class DomCanvas extends Behavior` (campos `html, css, escala, ancoragem, largura, altura, ordem, bloqueiaCliques`; `get documento(): DomVista`; `recarregar(): boolean`; `definirConteudo(html)`; `erro(): string`; `montado(): boolean`), `DOM_ESCALA_MIN = 0.1`, `domCanvasDe(o: GameObject | null): DomCanvas | null`.

- [ ] **Step 1: Write the failing test**

`tests/test_dom_canvas.ts`:

```ts
// Teste SEM JANELA do DomCanvas: catálogo, carga de .html/.css escopada,
// DomVista (cache por nó, ids por geração, setNumero), carga sob demanda,
// serialização, Play/Parar sem vazar raízes e remoção.
//   rts.exe run tests/test_dom_canvas.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";
import { DOM_VISTA_NENHUM, textoNumero, alternarClasse } from "@engine/ui/dom_vista";
import { domHostAtivos, domHostRender, domHostDoc, domHostPump } from "@engine/ui/dom_host";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { componentToData } from "@engine/components";
import { buildObject } from "@editor/sceneio";
import { scene } from "@editor/control/session";
import { playMode } from "@editor/play_mode";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Ouvinte extends Behavior {
  ultimo: string; recargas: number;
  constructor() { super(); this.ultimo = ""; this.recargas = 0; }
  onUIClick(n: string): void { this.ultimo = n; }
  onDomReload(): void { this.recargas = this.recargas + 1; }
}
class Leitor extends Behavior {
  achou: number;
  constructor() { super(); this.achou = 0 - 1; }
  mount(): void { const c = domCanvasDe(this.owner); if (c !== null) this.achou = c.documento.querySelector("#vida"); }
}
const DIR = "build/claude-dom";
fs.create_dir_all(DIR);
fs.write(DIR + "/a.html", "<!doctype html><html><head><style>#vida{color:rgb(0, 128, 0)}</style></head><body>" +
  "<p id=\"vida\">100</p><p id=\"mun\">30</p><button data-acao=\"ok\">ok</button><script>x()</script></body></html>");
fs.write(DIR + "/a.css", "p{margin:0} #vida.alerta{color:rgb(255, 0, 0)}");
fs.write(DIR + "/b.html", "<style>#vida{color:rgb(0, 0, 255)}</style><p id=\"vida\">B</p>");
const area = new Float64Array(4); area[2] = 800; area[3] = 600;

check(textoNumero(1234, 0) === "1234" && textoNumero(7, 1) === "0.7" && textoNumero(-5, 2) === "-0.05" && textoNumero(573, 1) === "57.3", "textoNumero");
check(alternarClasse("a b", "c", true) === "a b c" && alternarClasse("a c b", "c", false) === "a b" && alternarClasse("a", "a", true) === "a", "alternarClasse");

check(COMPONENT_NAMES.indexOf("DomCanvas") >= 0, "DomCanvas no catálogo gerado");
const padrao = createComponent("DomCanvas") as DomCanvas;
check(padrao.escala === 1.0 && padrao.bloqueiaCliques && padrao.html === "" && padrao.largura === 0 && !padrao.montado(), "construtor sem argumentos com os padrões");

const sc = new Scene("dom-canvas");
function objetoCom(nome: string, html: string, css: string): DomCanvas {
  const o = new GameObject(nome); const c = new DomCanvas(); c.html = html; c.css = css; o.addBehavior(c); sc.add(o); return c;
}
const ativos0 = domHostAtivos();
const ca = objetoCom("A", DIR + "/a.html", DIR + "/a.css");
const ouv = new Ouvinte(); (ca.owner as GameObject).addBehavior(ouv);
const cb = objetoCom("B", DIR + "/b.html", "");
check(ca.montado() && cb.montado() && domHostAtivos() === ativos0 + 2 && ca.erro() === "", "montar registra e carrega");
const va = ca.documento; const vb = cb.documento;
const h = va.doc();
const vida = va.querySelector("#vida"); const vidaB = vb.querySelector("#vida");
check(vida >= 0 && vidaB >= 0 && va.querySelector("#nada") === DOM_VISTA_NENHUM, "querySelector limitado à raiz");
check(va.querySelector("#vida") === vida && va.valido(vida) && !va.valido(vidaB), "mesma consulta, mesmo id; id de outra vista não vale");
check(dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(0, 128, 0)", "estilo do próprio arquivo");
check(dom.computedProperty(h, vb.noDom(vidaB), "color", "") === "rgb(0, 0, 255)", "CSS escopado: um canvas não pinta o outro");
check(dom.queryAllWithinCount(h, va.noDom(va.raiz()), "script") === 0, "<script> removido");
check(va.getText(vida) === "100", "conteúdo do body");

// cache: mesmo valor não escreve
va.setText(vida, "90");
const e1 = va.escritas;
va.setText(vida, "90");
check(va.escritas === e1 && va.getText(vida) === "90", "mesmo texto: nenhuma escrita");
va.setNumero(vida, 57.4, 0);
check(va.getText(vida) === "57" && va.escritas === e1 + 1, "setNumero arredonda");
va.setNumero(vida, 57.2, 0);
check(va.escritas === e1 + 1, "mesmo inteiro: nenhuma escrita");
va.setNumero(vida, 57.24, 1);
check(va.getText(vida) === "57.2", "uma casa");
va.setClass(vida, "alerta", true);
const e2 = va.escritas;
va.setClass(vida, "alerta", true);
check(va.escritas === e2 && dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(255, 0, 0)", "setClass liga uma vez");
va.setClass(vida, "alerta", false);
check(dom.computedProperty(h, va.noDom(vida), "color", "") === "rgb(0, 128, 0)", "setClass desliga");
va.setStyle(vida, "font-size", "20px"); const e3 = va.escritas; va.setStyle(vida, "font-size", "20px");
check(va.escritas === e3 && dom.inlineProperty(h, va.noDom(vida), "font-size") === "20px", "setStyle com cache");
va.setStyleNumero(vida, "width", 42.4, "%"); const e4 = va.escritas; va.setStyleNumero(vida, "width", 42.2, "%");
check(va.escritas === e4 && dom.inlineProperty(h, va.noDom(vida), "width") === "42%", "setStyleNumero com cache");
va.setAttr(vida, "title", "t"); const e5 = va.escritas; va.setAttr(vida, "title", "t");
check(va.escritas === e5 && dom.getAttribute(h, va.noDom(vida), "title") === "t", "setAttr com cache");

// eventos
let alvo = 0 - 1;
const btn = va.querySelector("button");
va.on(btn, "click", (no: number): void => { alvo = no; });
dom.pushRawEvent(h, va.noDom(btn), "click"); domHostPump();
check(alvo === btn && ouv.ultimo === "ok", "on entrega o id da vista; data-acao chega ao onUIClick do irmão");

// script montado antes do canvas: carga sob demanda
const oc = new GameObject("C"); const leitor = new Leitor(); const cc = new DomCanvas(); cc.html = DIR + "/a.html";
oc.addBehavior(leitor); oc.addBehavior(cc); sc.add(oc);
check(leitor.achou >= 0 && cc.montado() && domHostAtivos() === ativos0 + 3, "documento sob demanda na primeira leitura");

// arquivo ausente
const cx = objetoCom("X", DIR + "/nao-existe.html", "");
check(cx.montado() && cx.erro().indexOf("nao-existe.html") >= 0, "arquivo ausente: raiz vazia e erro anotado");

// desabilitado: display none, ids válidos
ca.enabled = 0; domHostRender(0, area);
check(dom.inlineProperty(h, va.noDom(va.raiz()), "display") === "none", "desabilitado: display none");
va.setText(vida, "escondido");
check(va.getText(vida) === "escondido", "ids continuam válidos escondido");
ca.enabled = 1;

// serialização
ca.escala = 1.25; ca.ordem = 3; ca.bloqueiaCliques = false;
const dados = componentToData(ca);
const txt = JSON.stringify(dados);
check(txt.indexOf("a.html") >= 0 && txt.indexOf("1.25") >= 0 && txt.indexOf("slot") < 0 && txt.indexOf("ultimoErro") < 0, "campos públicos salvos, estado de execução não");
const rt = buildObject({ name: "Rt", pos: [0, 0, 0], rot: [0, 0], color: [0, 0, 0], scripts: [dados] });
const crt = domCanvasDe(rt) as DomCanvas;
check(crt !== null && crt.html === ca.html && crt.escala === 1.25 && crt.ordem === 3 && !crt.bloqueiaCliques && !crt.montado(), "ida e volta sem montar");

// Play/Parar na cena do editor
scene.clear();
const op = new GameObject("HUD"); const cp = new DomCanvas(); cp.html = DIR + "/a.html"; op.addBehavior(cp); scene.add(op);
const ativosEd = domHostAtivos();
check(playMode.play(), "Play aceita DomCanvas (cópia por componentToData)");
const copia = domCanvasDe(scene.objects[0]) as DomCanvas;
check(copia !== cp && copia.montado() && cp.montado() && domHostAtivos() === ativosEd + 1, "a cópia monta a própria raiz; o original fica guardado");
domHostRender(0, area);
const vo = cp.documento;
check(dom.inlineProperty(domHostDoc(), vo.noDom(vo.raiz()), "display") === "none", "original escondido durante o Play");
const vc = copia.documento; vc.setText(vc.querySelector("#vida"), "5");
playMode.stop();
check(domHostAtivos() === ativosEd && !copia.montado(), "Parar libera a raiz da cópia");
domHostRender(0, area);
check(vo.getText(vo.querySelector("#vida")) === "100" && dom.inlineProperty(domHostDoc(), vo.noDom(vo.raiz()), "display") === "block", "original intacto e visível de novo");
scene.removeAt(0);
check(!cp.montado() && domHostAtivos() === ativosEd - 1, "remover o objeto libera a raiz (onDestroy)");
(ca.owner as GameObject).removeBehavior(0);
check(!ca.montado() && ca.documento.raiz() === DOM_VISTA_NENHUM, "remover o componente libera; destruído não remonta");
sc.clear();
check(domHostAtivos() === ativos0, "clear libera todas as raízes");
io.print("[PASSOU] DomCanvas: catálogo, carga escopada, cache da vista, eventos, sob demanda, serialização, Play/Parar e remoção");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$RTS run tests/test_dom_canvas.ts`
Expected: FAIL (módulos `dom_canvas`/`dom_vista` não existem).

- [ ] **Step 3: Write minimal implementation**

`src/engine/ui/dom_vista.ts`:

```ts
// Engine RTS — DomVista: o que um script vê do HTML do seu DomCanvas. Tudo
// limitado à raiz do canvas, com cache do último valor escrito por nó: no rts
// cada mutação refaz o layout do documento inteiro (spike: +0,3 a 0,45 ms por
// quadro com UMA troca de texto), então escrever o mesmo valor não toca o DOM.
//
// Nós são ids da vista, não o NodeId do rts: `querySelector` devolve um id
// válido até a próxima recarga do HTML; depois dela ids antigos viram no-op (a
// geração muda) e o script refaz as consultas em `onDomReload`. Usa só o
// namespace cru `dom` do rts, no máximo 4 parâmetros por método e nenhuma
// string montada quando o valor não muda.

export type DomEventoFn = (no: number) => void;
export const DOM_VISTA_NENHUM: number = 0 - 1;
/// Nós guardáveis por geração (id = geracao * isto + índice).
export const DOM_VISTA_MAX_NOS: number = 4096;
/// Inteiros 0..DOM_NUM_CACHE-1 (até DOM_CASAS_MAX casas) viram texto uma vez só.
export const DOM_NUM_CACHE: number = 1024;
export const DOM_CASAS_MAX: number = 3;
const SEM_NUMERO: number = 0 - 9007199254740991;
const DESCONHECIDO: string = "\u0001";
const POTENCIAS: number[] = [1, 10, 100, 1000];
const TIPO_ESTILO: number = 0;
const TIPO_CLASSE: number = 1;
const TIPO_ATRIBUTO: number = 2;
const LIGADA: string = "1";
const DESLIGADA: string = "0";
const ATRIBUTO_CLASSE: string = "class";

function criarTabelaNumeros(): string[][] {
  const t: string[][] = [];
  let c = 0;
  while (c <= DOM_CASAS_MAX) {
    const linha: string[] = [];
    let k = 0;
    while (k < DOM_NUM_CACHE) { linha.push(""); k = k + 1; }
    t.push(linha);
    c = c + 1;
  }
  return t;
}
const NUMEROS: string[][] = criarTabelaNumeros();

/// Texto de k / 10^casas com exatamente `casas` casas (k inteiro).
export function textoNumero(k: number, casas: number): string {
  if (casas <= 0) return "" + k;
  const neg = k < 0;
  const a = neg ? 0 - k : k;
  const p = POTENCIAS[casas];
  const inteiro = Math.floor(a / p);
  let frac = "" + (a - inteiro * p);
  while (frac.length < casas) frac = "0" + frac;
  return (neg ? "-" : "") + inteiro + "." + frac;
}
function numeroEmCache(k: number, casas: number): string {
  if (k < 0 || k >= DOM_NUM_CACHE) return textoNumero(k, casas);
  const linha = NUMEROS[casas];
  let s = linha[k];
  if (s.length === 0) { s = textoNumero(k, casas); linha[k] = s; }
  return s;
}
/// Lista de classes com `classe` ligada ou desligada (sem repetir).
export function alternarClasse(lista: string, classe: string, ligada: boolean): string {
  const partes = lista.split(" ");
  let out = "";
  let i = 0;
  while (i < partes.length) {
    const p = partes[i];
    if (p.length > 0 && p !== classe) out = out.length === 0 ? p : out + " " + p;
    i = i + 1;
  }
  if (ligada) out = out.length === 0 ? classe : out + " " + classe;
  return out;
}

export class DomVista {
  h: number; raizNo: number; geracao: number; base: number;
  nos: number[]; textos: string[]; numK: number[]; numCasas: number[];
  cNo: number[]; cTipo: number[]; cNome: string[]; cValor: string[]; cNum: number[];
  /// Mutações feitas no DOM (testes e diagnóstico: "mesmo valor não escreve").
  escritas: number;
  constructor() {
    this.h = 0; this.raizNo = DOM_VISTA_NENHUM; this.geracao = 0; this.base = 0;
    this.nos = []; this.textos = []; this.numK = []; this.numCasas = [];
    this.cNo = []; this.cTipo = []; this.cNome = []; this.cValor = []; this.cNum = [];
    this.escritas = 0;
  }
  ligar(h: number, raizNo: number): void { this.h = h; this.raizNo = raizNo; this.recomecar(); }
  soltar(): void { this.h = 0; this.raizNo = DOM_VISTA_NENHUM; this.recomecar(); }
  /// Nova geração: ids antigos viram no-op; a raiz é o primeiro id.
  recomecar(): void {
    this.geracao = this.geracao + 1;
    this.base = this.geracao * DOM_VISTA_MAX_NOS;
    this.nos.length = 0; this.textos.length = 0; this.numK.length = 0; this.numCasas.length = 0;
    this.cNo.length = 0; this.cTipo.length = 0; this.cNome.length = 0; this.cValor.length = 0; this.cNum.length = 0;
    if (this.h !== 0) this.guardar(this.raizNo);
  }
  private guardar(n: number): number {
    this.nos.push(n); this.textos.push(DESCONHECIDO); this.numK.push(SEM_NUMERO); this.numCasas.push(0);
    return this.base + this.nos.length - 1;
  }
  private indice(no: number): number {
    const i = no - this.base;
    return i >= 0 && i < this.nos.length ? i : DOM_VISTA_NENHUM;
  }
  private entrada(i: number, tipo: number, nome: string): number {
    let k = 0;
    while (k < this.cNo.length) {
      if (this.cNo[k] === i && this.cTipo[k] === tipo && this.cNome[k] === nome) return k;
      k = k + 1;
    }
    this.cNo.push(i); this.cTipo.push(tipo); this.cNome.push(nome); this.cValor.push(DESCONHECIDO); this.cNum.push(SEM_NUMERO);
    return this.cNo.length - 1;
  }
  raiz(): number { return this.nos.length > 0 ? this.base : DOM_VISTA_NENHUM; }
  valido(no: number): boolean { return this.indice(no) >= 0; }
  doc(): number { return this.h; }
  noDom(no: number): number { const i = this.indice(no); return i >= 0 ? this.nos[i] : DOM_VISTA_NENHUM; }
  contar(sel: string): number { return this.h === 0 ? 0 : dom.queryAllWithinCount(this.h, this.raizNo, sel); }
  /// Primeiro nó dentro da raiz que casa com `sel` (-1 se nenhum). Guarde no mount/onDomReload.
  querySelector(sel: string): number {
    if (this.h === 0) return DOM_VISTA_NENHUM;
    const n = dom.queryWithin(this.h, this.raizNo, sel);
    if (n === DOM_VISTA_NENHUM) return DOM_VISTA_NENHUM;
    let i = 0;
    while (i < this.nos.length) { if (this.nos[i] === n) return this.base + i; i = i + 1; }
    if (this.nos.length >= DOM_VISTA_MAX_NOS) return DOM_VISTA_NENHUM;
    return this.guardar(n);
  }
  getText(no: number): string { const i = this.indice(no); return i >= 0 ? dom.getText(this.h, this.nos[i]) : ""; }
  setText(no: number, s: string): void {
    const i = this.indice(no);
    if (i < 0 || this.textos[i] === s) return;
    this.textos[i] = s; this.numK[i] = SEM_NUMERO;
    dom.setText(this.h, this.nos[i], s);
    this.escritas = this.escritas + 1;
  }
  /// `v` com `casas` casas; só escreve quando o valor arredondado muda.
  setNumero(no: number, v: number, casas: number): void {
    const i = this.indice(no);
    if (i < 0) return;
    const c = casas < 0 ? 0 : (casas > DOM_CASAS_MAX ? DOM_CASAS_MAX : casas | 0);
    const k = Math.round(v * POTENCIAS[c]);
    if (this.numK[i] === k && this.numCasas[i] === c) return;
    const s = numeroEmCache(k, c);
    this.numK[i] = k; this.numCasas[i] = c; this.textos[i] = s;
    dom.setText(this.h, this.nos[i], s);
    this.escritas = this.escritas + 1;
  }
  setStyle(no: number, prop: string, valor: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    const e = this.entrada(i, TIPO_ESTILO, prop);
    if (this.cNum[e] === SEM_NUMERO && this.cValor[e] === valor) return;
    this.cNum[e] = SEM_NUMERO; this.cValor[e] = valor;
    dom.setStyleProperty(this.h, this.nos[i], prop, valor);
    this.escritas = this.escritas + 1;
  }
  /// Estilo numérico inteiro + unidade (barras: "57%"); só monta a string quando muda.
  setStyleNumero(no: number, prop: string, v: number, unidade: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    const k = Math.round(v);
    const e = this.entrada(i, TIPO_ESTILO, prop);
    if (this.cNum[e] === k && this.cValor[e] === unidade) return;
    this.cNum[e] = k; this.cValor[e] = unidade;
    dom.setStyleProperty(this.h, this.nos[i], prop, numeroEmCache(k, 0) + unidade);
    this.escritas = this.escritas + 1;
  }
  setClass(no: number, classe: string, ligada: boolean): void {
    const i = this.indice(no);
    if (i < 0) return;
    const e = this.entrada(i, TIPO_CLASSE, classe);
    const v = ligada ? LIGADA : DESLIGADA;
    if (this.cValor[e] === v) return;
    this.cValor[e] = v;
    const atual = dom.getAttribute(this.h, this.nos[i], ATRIBUTO_CLASSE);
    dom.setAttr(this.h, this.nos[i], ATRIBUTO_CLASSE, alternarClasse(atual, classe, ligada));
    this.escritas = this.escritas + 1;
  }
  setAttr(no: number, nome: string, valor: string): void {
    const i = this.indice(no);
    if (i < 0) return;
    const e = this.entrada(i, TIPO_ATRIBUTO, nome);
    if (this.cValor[e] === valor) return;
    this.cValor[e] = valor;
    dom.setAttr(this.h, this.nos[i], nome, valor);
    this.escritas = this.escritas + 1;
  }
  /// `fn(no)` roda no domHostPump depois do endFrame (1 quadro depois do clique).
  on(no: number, evento: string, fn: DomEventoFn): void {
    const i = this.indice(no);
    if (i < 0) return;
    dom.addListenerCbOptions(this.h, this.nos[i], evento, (e: any): void => { fn(no); });
  }
}
```

`src/engine/core/dom_canvas.ts`:

```ts
// Engine RTS — DomCanvas: interface em HTML/CSS desenhada sobre o jogo, como
// componente de um GameObject (o UIDocument da Unity). Desenho e eventos são
// do DomHost (um documento por janela); aqui ficam os campos salvos com a
// cena, a carga do .html/.css e a DomVista que os scripts usam:
//
//   const c = domCanvasDe(this.owner);
//   this.vida = c.documento.querySelector("#vida");   // no mount/onDomReload
//   c.documento.setNumero(this.vida, hp, 0);           // por quadro: só escreve se mudou
//
// Posição: host.px/py a partir do canto `ancoragem` (como o UIText); largura
// ou altura 0 estica até a borda da área. Ativo = active do objeto (com os
// pais) e enabled do componente; escondido = display none, sem apagar nós.
// Remover o objeto ou o componente (onDestroy) libera a raiz.
import { Behavior, KIND_UI } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { ANCHOR_TL, ANCHOR_BR } from "@engine/ui/anchor";
import { domHostRegistrar, domHostRemover, domHostConteudo, domHostLayout, domHostRaiz, domHostDoc, domHostEscopo,
         DOM_LAYOUT_FLOATS, DL_ANCORAGEM, DL_LARGURA, DL_ALTURA, DL_ORDEM, DL_ESCALA, DL_BLOQUEIA } from "@engine/ui/dom_host";
import { DomVista } from "@engine/ui/dom_vista";
import { prepararHtml, scriptsRemovidos } from "@engine/ui/dom_css";
import { logError, logWarn } from "@engine/core/logger";
import fs from "@compat/fs.ts";

/// Escala mínima aceita (fase 1: vira font-size da raiz).
export const DOM_ESCALA_MIN: number = 0.1;
const SEM_SLOT: number = 0 - 1;

class LeituraDom {
  texto: string; erro: string;
  constructor() { this.texto = ""; this.erro = ""; }
}
const leitura = new LeituraDom();
/// Lê um arquivo do canvas. Fora de qualquer caminho por quadro (tem try).
function lerArquivoDom(caminho: string): boolean {
  leitura.texto = ""; leitura.erro = "";
  try { leitura.texto = fs.read_text(caminho); return true; }
  catch (e) { leitura.erro = caminho + ": " + String(e); return false; }
}

/**
 * @componentCategory UI
 * @componentDescription Interface em HTML/CSS desenhada sobre o jogo; scripts do objeto acessam `documento`.
 * @componentKeywords ui html css hud menu dom documento
 */
export class DomCanvas extends Behavior {
  html: string;
  css: string;
  escala: number;
  ancoragem: number;
  largura: number;
  altura: number;
  ordem: number;
  bloqueiaCliques: boolean;
  private slot: number;
  private destruido: boolean;
  private ultimoErro: string;
  private cfg: Float64Array;
  private vista: DomVista;
  constructor() {
    super();
    this.html = ""; this.css = ""; this.escala = 1.0; this.ancoragem = ANCHOR_TL;
    this.largura = 0; this.altura = 0; this.ordem = 0; this.bloqueiaCliques = true;
    this.slot = SEM_SLOT; this.destruido = false; this.ultimoErro = "";
    this.cfg = new Float64Array(DOM_LAYOUT_FLOATS); this.vista = new DomVista();
  }
  kind(): number { return KIND_UI; }
  mount(): void { this.garantir(); }
  onDestroy(): void {
    this.destruido = true;
    if (this.slot === SEM_SLOT) return;
    domHostRemover(this.slot);
    this.slot = SEM_SLOT;
    this.vista.soltar();
  }
  onValidate(campo: string): void {
    if (!(this.escala >= DOM_ESCALA_MIN)) this.escala = DOM_ESCALA_MIN;
    if (!(this.largura >= 0)) this.largura = 0;
    if (!(this.altura >= 0)) this.altura = 0;
    this.ancoragem = Math.max(ANCHOR_TL, Math.min(ANCHOR_BR, Math.round(this.ancoragem)));
    this.ordem = Math.round(this.ordem);
    if (campo === "html" || campo === "css") this.recarregar();
    else this.enviarLayout();
  }
  /// O HTML deste canvas, escopado à raiz. Carrega sob demanda (script montado antes do canvas).
  get documento(): DomVista { this.garantir(); return this.vista; }
  /// Relê .html/.css. Erro: mantém o conteúdo anterior, anota e loga. Sucesso: onDomReload nos irmãos.
  recarregar(): boolean {
    if (this.slot === SEM_SLOT) { this.garantir(); return this.ultimoErro.length === 0; }
    const ok = this.carregar();
    if (ok) this.avisarIrmaos();
    return ok;
  }
  /// Troca o conteúdo por HTML literal (comando WS; estado de execução, não salvo).
  definirConteudo(html: string): void {
    this.garantir();
    if (this.slot === SEM_SLOT) return;
    this.aplicar(html, "");
    this.avisarIrmaos();
  }
  erro(): string { return this.ultimoErro; }
  montado(): boolean { return this.slot !== SEM_SLOT; }
  private garantir(): void {
    if (this.slot !== SEM_SLOT || this.destruido) return;
    this.slot = domHostRegistrar(this);
    this.vista.ligar(domHostDoc(), domHostRaiz(this.slot));
    this.enviarLayout();
    this.carregar();
  }
  private enviarLayout(): void {
    const c = this.cfg;
    c[DL_ANCORAGEM] = this.ancoragem; c[DL_LARGURA] = this.largura; c[DL_ALTURA] = this.altura;
    c[DL_ORDEM] = this.ordem; c[DL_ESCALA] = this.escala; c[DL_BLOQUEIA] = this.bloqueiaCliques ? 1.0 : 0.0;
    if (this.slot !== SEM_SLOT) domHostLayout(this.slot, c);
  }
  private carregar(): boolean {
    let html = "";
    let css = "";
    if (this.html.length > 0) { if (!lerArquivoDom(this.html)) return this.falhou(leitura.erro); html = leitura.texto; }
    if (this.css.length > 0) { if (!lerArquivoDom(this.css)) return this.falhou(leitura.erro); css = leitura.texto; }
    this.aplicar(html, css);
    return true;
  }
  private aplicar(html: string, css: string): void {
    domHostConteudo(this.slot, prepararHtml(html, css, domHostEscopo(this.slot)));
    this.vista.recomecar();
    this.ultimoErro = "";
    if (scriptsRemovidos() > 0) logWarn("DomCanvas: <script> ignorado em " + this.html + " (a lógica fica nos scripts do objeto)");
  }
  private falhou(msg: string): boolean { this.ultimoErro = msg; logError("DomCanvas: " + msg); return false; }
  private avisarIrmaos(): void {
    const o = this.owner;
    if (o === null) return;
    let i = 0;
    while (i < o.behaviors.length) {
      const b = o.behaviors[i];
      if (b !== this && b.enabled !== 0) b.onDomReload();
      i = i + 1;
    }
  }
}

/// O (primeiro) DomCanvas de `o`, ou null.
export function domCanvasDe(o: GameObject | null): DomCanvas | null {
  if (o === null) return null;
  let i = 0;
  while (i < o.behaviors.length) {
    const b = o.behaviors[i];
    if (b instanceof DomCanvas) return b as DomCanvas;
    i = i + 1;
  }
  return null;
}
```

Depois: `npm run components`.

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_dom_canvas.ts
$RTS run tests/test_dom_host.ts
$RTS run tests/test_component_factory.ts
$RTS run tests/test_component_reflection.ts
$RTS run tests/test_play_mode.ts
node --test tests/editor-static.test.mjs
```
Expected: `[PASSOU] DomCanvas: ...` e o restante verde.

- [ ] **Step 5: Portão de revisão**

Revisor com diff e saídas. Pontos: nenhum campo de execução vaza para `componentToData`; `garantir` não registra depois de `onDestroy`; `onValidate` prende `NaN`; nenhum método da `DomVista` tem 5+ parâmetros nem monta string com valor igual; comentários sem gatilhos da fachada.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(ui): componente DomCanvas e DomVista (cache por no, ids por geracao, setNumero sem alocacao)"`

---

### Task 4: Integração com o quadro, bloqueio de clique, sonda de GC e bench

**Files:**
- Create: `src/editor/game_ui_editor.ts`, `tests/test_dom_quadro.ts`, `tests/claude-test-dom-gc.ts`, `tools/gerar-bench-hud.ts`, `assets/scripts/BenchHudDom.ts`, `assets/ui/claude-bench-hud.html`
- Create (gerados por `tools/gerar-bench-hud.ts`): `scenes/claude-bench-hud-{sem,2d,dom,dom-texto}.json`
- Modify: `src/engine/ui/game_ui.ts` (`drawGameUI`, linhas 24-35; `definirAreaUI`)
- Modify: `game.ts` (import perto da linha 30; `RTS_SCENE` depois da linha 60; `domHostPump()` depois de `app.endFrame()`, linha 209)
- Modify: `main.ts` (imports perto da linha 35; linha 1027 `drawGameUI` → `uiDoJogoNoEditor`; `domHostPump()` depois de `app.endFrame()`, linha 1707)
- Modify: `src/engine/core/ui_button.ts` (linha 58), `src/engine/core/entrada.ts` (depois da linha 32)
- Modify: `src/editor/ui_config.ts` (`UI_DOM` depois de `UI_EDITOR_API`, linha 219)
- Modify: `bench/claude-frame-bench.mjs` (`CENARIOS`, linhas 38-44), `tests/editor-static.test.mjs`
- Regenerate: catálogo (`npm run components`, por causa de `BenchHudDom`)

**Interfaces:**
- Produces: `definirAreaUI(a: Float64Array | null): void` (`@engine/ui/game_ui`); `uiDoJogoNoEditor(win: number, area: Float64Array, w: number, h: number): void` (`@editor/game_ui_editor`); `mouseApertadoNoMundo(botao: number): boolean`, `ponteiroSobreUI(): boolean` (`@engine/core/entrada`); `UI_DOM` (`@editor/ui_config`); componente `BenchHudDom` (campo `modo`).

- [ ] **Step 0: Linha de base do bench (antes de qualquer mudança desta task)**

Run: `node bench/claude-frame-bench.mjs --only jogo-vitrine --runs 3 --label dom-antes`
Guardar a mediana (cena sem DomCanvas; o depois tem de ficar dentro do ruído da mesma sessão).

- [ ] **Step 1: Write the failing tests**

`tests/test_dom_quadro.ts`:

```ts
// Teste SEM JANELA da integração com o quadro: drawGameUI faz UM render com
// DomCanvas e nenhum sem; área externa (aba Jogo); prévia do editor sem clique
// e com contorno; Play com clique; ponteiroSobreUI.
//   rts.exe run tests/test_dom_quadro.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { DomCanvas } from "@engine/core/dom_canvas";
import { drawGameUI, definirAreaUI } from "@engine/ui/game_ui";
import { domHostRenders, domHostDoc, domHostSeletorSobre } from "@engine/ui/dom_host";
import { ponteiroSobreUI, mouseApertadoNoMundo } from "@engine/core/entrada";
import { uiDoJogoNoEditor } from "@editor/game_ui_editor";
import { scene, S } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const DIR = "build/claude-dom";
fs.create_dir_all(DIR);
fs.write(DIR + "/q.html", "<div class=\"painel\"><span id=\"t\">x</span></div>");
function canvasEm(sc: Scene, nome: string): DomCanvas {
  const o = new GameObject(nome); const c = new DomCanvas(); c.html = DIR + "/q.html"; o.addBehavior(c); sc.add(o); return c;
}

const vazia = new Scene("vazia");
const r0 = domHostRenders();
drawGameUI(vazia, 0, 800, 600);
check(domHostRenders() === r0, "cena sem DomCanvas: nenhum render");

const sc = new Scene("quadro");
const c1 = canvasEm(sc, "A"); canvasEm(sc, "B");
drawGameUI(sc, 0, 800, 600);
check(domHostRenders() === r0 + 1, "dois canvases, um render");
const h = domHostDoc();
const regiao = dom.querySelector(h, "#dom-regiao");
check(dom.inlineProperty(h, regiao, "width") === "800px" && dom.inlineProperty(h, regiao, "left") === "0px", "sem área externa: a janela");
const area = new Float64Array(4); area[0] = 100; area[1] = 50; area[2] = 400; area[3] = 300;
definirAreaUI(area); drawGameUI(sc, 0, 800, 600); definirAreaUI(null);
check(dom.inlineProperty(h, regiao, "left") === "100px" && dom.inlineProperty(h, regiao, "height") === "300px", "área externa (aba Jogo)");

scene.clear();
const hud = canvasEm(scene, "HUD");
const raizHud = hud.documento.noDom(hud.documento.raiz());
S.simulating = 0; S.gameView = 0;
const r1 = domHostRenders();
uiDoJogoNoEditor(0, area, 800, 600);
check(domHostRenders() === r1, "aba Cena fora do Play: nada");
S.gameView = 1; S.selected = 0;
uiDoJogoNoEditor(0, area, 800, 600);
check(domHostRenders() === r1 + 1 && dom.inlineProperty(h, regiao, "pointer-events") === "none", "prévia na aba Jogo, sem clique");
check(dom.cssText(h, raizHud).indexOf("dashed") >= 0, "contorno no canvas selecionado");
S.simulating = 1;
uiDoJogoNoEditor(0, area, 800, 600);
check(dom.inlineProperty(h, regiao, "pointer-events") === "auto" && dom.cssText(h, raizHud).indexOf("dashed") < 0, "Play: cliques e sem contorno");
S.simulating = 0; S.gameView = 0;

domHostSeletorSobre(".forcado");
check(!ponteiroSobreUI(), "nada sob o ponteiro");
const v = c1.documento;
dom.setAttr(h, v.noDom(v.querySelector("#t")), "class", "forcado");
check(ponteiroSobreUI() && !mouseApertadoNoMundo(0), "sobre a UI: o mundo não recebe o clique (sem janela: nunca apertado)");
domHostSeletorSobre("");
sc.clear(); scene.clear();
io.print("[PASSOU] quadro: um render por quadro, nenhum sem canvas, área da aba Jogo, prévia, Play e sobre-UI");
```

`tests/claude-test-dom-gc.ts`:

```ts
// Sonda de ALOCAÇÃO do DomCanvas por quadro. Rodar com RTS_GC_DEBUG=1 e contar
// as linhas "rts-gc" ENTRE os marcadores FASE (as de antes do primeiro são do setup):
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-dom-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
// Portão: 0 coletas em cada fase (GC_N padrão 200000).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { DomCanvas } from "@engine/core/dom_canvas";
import { drawGameUI } from "@engine/ui/game_ui";
import { domHostPump, domHostSobreUI } from "@engine/ui/dom_host";
import { mouseApertadoNoMundo } from "@engine/core/entrada";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const sc = new Scene("gc-dom");
const o = new GameObject("HUD"); const c = new DomCanvas(); c.html = "assets/ui/claude-bench-hud.html"; o.addBehavior(c); sc.add(o);
const v = c.documento;
const t = v.querySelector("#l0");
const barra = v.querySelector("#b0");
const A = "rótulo A"; const B = "rótulo B";
// aquece: tabela de números, estilos e o primeiro layout
let k = 0;
while (k < 1000) { v.setNumero(t, k, 0); k = k + 1; }
v.setClass(t, "alerta", false); v.setStyleNumero(barra, "width", 70, "%");
drawGameUI(sc, 0, 1280, 720); domHostPump();
let soma = 0;

io.print("FASE render-pump " + n);
let i = 0;
while (i < n) { drawGameUI(sc, 0, 1280, 720); domHostPump(); i = i + 1; }
io.print("FASE settext-igual " + n);
i = 0; while (i < n) { v.setText(t, A); i = i + 1; }
io.print("FASE settext-novo " + n);
i = 0; while (i < n) { v.setText(t, (i & 1) === 0 ? A : B); i = i + 1; }
io.print("FASE setnumero-igual " + n);
i = 0; while (i < n) { v.setNumero(t, 57.0, 0); i = i + 1; }
io.print("FASE setnumero-novo " + n);
i = 0; while (i < n) { v.setNumero(t, i % 1000, 0); i = i + 1; }
io.print("FASE estilo-classe-igual " + n);
i = 0; while (i < n) { v.setClass(t, "alerta", false); v.setStyleNumero(barra, "width", 70.2, "%"); i = i + 1; }
io.print("FASE sobre-ui " + n);
i = 0; while (i < n) { if (domHostSobreUI() || mouseApertadoNoMundo(0)) soma = soma + 1; i = i + 1; }
io.print("FASE fim " + soma);
```

Em `tests/editor-static.test.mjs`:

```js
test('HTML is rendered once by drawGameUI and pumped right after endFrame', () => {
  assert.match(read('game.ts'), /app\.endFrame\(\);\s*\n\s*domHostPump\(\);/);
  assert.match(read('main.ts'), /app\.endFrame\(\);\s*\n\s*domHostPump\(\);/);
  assert.match(read('main.ts'), /uiDoJogoNoEditor\(WIN, /);
  assert.doesNotMatch(read('main.ts'), /drawGameUI\(/);
  assert.match(read('src/engine/ui/game_ui.ts'), /domHostRender\(win, /);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `$RTS run tests/test_dom_quadro.ts; node --test tests/editor-static.test.mjs`
Expected: FAIL (`definirAreaUI`, `uiDoJogoNoEditor`, `mouseApertadoNoMundo` não existem; regex do estático não casa).

- [ ] **Step 3: Write minimal implementation**

`src/editor/ui_config.ts`, depois de `UI_EDITOR_API` (linha 219):

```ts
/// DomCanvas no editor: prévia da aba Jogo e o pacote assets/pacotes/dom/.
export const UI_DOM = {
  /// Contorno CSS do canvas selecionado na prévia (a cor de UI_C.previewBorder).
  contornoSelecao: "2px dashed #6A9DD2", semContorno: "none",
  /// Intervalo do vigia de recarga de .html/.css (Editor.every).
  recargaMs: 500,
  icone: "ui-html", nomeObjeto: "DomCanvas",
  modeloHtml: "assets/ui/exemplo.html", modeloCss: "assets/ui/exemplo.css",
  recarregar: "Recarregar", abrir: "Abrir no editor",
  estadoNos: "Nós: ", estadoErro: "  erro: ", estadoOk: "  sem erro",
  /// Máximo de nós listados por `dom <obj> query`.
  queryMax: 16,
};
```

`game_ui.ts` (acrescentar imports e trocar `drawGameUI`):

```ts
import { domHostRender } from "./dom_host";

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
```

`src/editor/game_ui_editor.ts`:

```ts
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
```

`main.ts`:
- imports (perto da linha 35, no lugar de `import { drawGameUI } from "@engine/ui/game_ui";`): `import { uiDoJogoNoEditor } from "@editor/game_ui_editor";` e `import { domHostPump } from "@engine/ui/dom_host";`.
- linha 1027: `uiDoJogoNoEditor(WIN, workspaceViews.game ? vistasJogo.area : S.areaVista, W, H);` (comentário: "UI do JOGO: no Play como na build; fora dele, prévia do HTML na aba Jogo").
- depois de `app.endFrame();` (linha 1707): `domHostPump();   // cliques do HTML viram callbacks (1 quadro depois)`.

`game.ts`:
- import: `import { domHostPump } from "@engine/ui/dom_host";`.
- depois da linha 60: `const cenaEnv = process.env("RTS_SCENE"); if (cenaEnv.length > 0) sceneFile = cenaEnv;   // bench/claude-frame-bench.mjs`.
- depois de `app.endFrame();` (linha 209): `domHostPump();`.

`ui_button.ts` linha 58 (e `import { domHostSobreUI } from "@engine/ui/dom_host";`):

```ts
    // HTML sob o ponteiro com bloqueiaCliques consome o clique (fase 1: :hover do quadro anterior)
    this.clicked = (this.hot !== 0 && input.mousePressed(win, 0) && !domHostSobreUI()) ? 1 : 0;
```

`entrada.ts`, depois de `mouseSegurado` (linha 32), com `import { domHostSobreUI } from "@engine/ui/dom_host";`:

```ts
/// O ponteiro está sobre um elemento de um DomCanvas que bloqueia cliques.
export function ponteiroSobreUI(): boolean { return domHostSobreUI(); }
/// Botão apertado NESTE quadro e fora da UI em HTML: use no pick 3D.
export function mouseApertadoNoMundo(botao: number): boolean {
  return janela !== 0 && ativa && input.mousePressed(janela, botao) && !domHostSobreUI();
}
```

`assets/ui/claude-bench-hud.html` (o HUD do rts-fps no spike: 10 linhas, 2 barras e a mira):

```html
<style>
  .hud { position: absolute; left: 14px; top: 14px; color: #E8F0FF; font-size: 16px; line-height: 20px; pointer-events: none; }
  .barra { width: 200px; height: 8px; margin-top: 4px; background: rgba(0, 0, 0, 0.5); }
  .barra > div { height: 100%; background: #6BD06B; }
  .alerta { color: #FF6060; }
  .mira { position: absolute; left: 50%; top: 50%; color: #FFFFFF; font-size: 20px; pointer-events: none; }
</style>
<div class="hud">
  <div id="l0">0</div><div id="l1">linha 1 do HUD</div><div id="l2">linha 2 do HUD</div>
  <div id="l3">linha 3 do HUD</div><div id="l4">linha 4 do HUD</div><div id="l5">linha 5 do HUD</div>
  <div id="l6">linha 6 do HUD</div><div id="l7">linha 7 do HUD</div><div id="l8">linha 8 do HUD</div>
  <div id="l9">linha 9 do HUD</div>
  <div class="barra"><div id="b0" style="width: 70%"></div></div>
  <div class="barra"><div id="b1" style="width: 40%"></div></div>
</div>
<div class="mira">+</div>
```

`assets/scripts/BenchHudDom.ts`:

```ts
import { Behavior } from "@engine/core/behavior";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";

/**
 * @componentCategory Demo
 * @componentDescription Bench do DomCanvas: modo 1 troca o texto de #l0 a cada quadro (bench/claude-frame-bench.mjs).
 * @componentKeywords bench dom hud html
 */
export class BenchHudDom extends Behavior {
  /// 0 = HUD parado; 1 = um texto novo por quadro.
  modo: number = 0;
  private canvas: DomCanvas | null = null;
  private no: number = 0 - 1;
  private quadro: number = 0;
  mount(): void { this.ligar(); }
  onDomReload(): void { this.ligar(); }
  private ligar(): void {
    this.canvas = domCanvasDe(this.owner);
    this.no = this.canvas !== null ? this.canvas.documento.querySelector("#l0") : 0 - 1;
  }
  update(dt: f64): void {
    if (this.modo === 0 || this.canvas === null || this.no < 0) return;
    this.quadro = (this.quadro + 1) % 1000;
    this.canvas.documento.setNumero(this.no, this.quadro, 0);
  }
}
```

`tools/gerar-bench-hud.ts`:

```ts
// Gera as quatro cenas do bench do DomCanvas a partir de scenes/shadowdemo.json:
// sem HUD, HUD de 10 UIText, HUD HTML parado e HUD HTML com um texto por quadro.
//   rts.exe run tools/gerar-bench-hud.ts
import io from "@compat/io.ts";
import { writeFileSync } from "node:fs";
import { scene } from "@editor/control/session";
import { loadSceneFrom, sceneToJSON } from "@editor/sceneio";
import { GameObject } from "@engine/core/gameobject";
import { UIText } from "@engine/core/ui_text";
import { DomCanvas } from "@engine/core/dom_canvas";
import { BenchHudDom } from "../assets/scripts/BenchHudDom";

const BASE = "scenes/shadowdemo.json";
const LINHAS = 10; const MARGEM = 14; const LINHA_Y = 20; const TAMANHO = 16; const COR = 0xE8F0FFFF;
function salvar(caminho: string): void { writeFileSync(caminho, sceneToJSON()); io.print("[bench-hud] " + caminho + ": " + scene.objects.length + " objetos"); }
function hudDom(modo: number): void {
  const o = new GameObject("HUD");
  const c = new DomCanvas(); c.html = "assets/ui/claude-bench-hud.html"; c.bloqueiaCliques = false;
  const b = new BenchHudDom(); b.modo = modo;
  o.addBehavior(c); o.addBehavior(b);
  scene.add(o);
}
loadSceneFrom(BASE); salvar("scenes/claude-bench-hud-sem.json");
loadSceneFrom(BASE);
let i = 0;
while (i < LINHAS) {
  const o = new GameObject("Linha " + i);
  o.transform.px = MARGEM; o.transform.py = MARGEM + i * LINHA_Y;
  o.addBehavior(new UIText("linha " + i + " do HUD", TAMANHO, COR, 0));
  scene.add(o);
  i = i + 1;
}
salvar("scenes/claude-bench-hud-2d.json");
loadSceneFrom(BASE); hudDom(0); salvar("scenes/claude-bench-hud-dom.json");
loadSceneFrom(BASE); hudDom(1); salvar("scenes/claude-bench-hud-dom-texto.json");
```

`bench/claude-frame-bench.mjs`, em `CENARIOS` (antes do `].filter`):

```js
  { tag: 'jogo-hud-sem', file: 'game.ts', env: { RTS_SCENE: 'scenes/claude-bench-hud-sem.json' } },
  { tag: 'jogo-hud-2d', file: 'game.ts', env: { RTS_SCENE: 'scenes/claude-bench-hud-2d.json' } },
  { tag: 'jogo-hud-dom', file: 'game.ts', env: { RTS_SCENE: 'scenes/claude-bench-hud-dom.json' } },
  { tag: 'jogo-hud-dom-texto', file: 'game.ts', env: { RTS_SCENE: 'scenes/claude-bench-hud-dom-texto.json' } },
```

Depois: `npm run components && $RTS run tools/gerar-bench-hud.ts`.

- [ ] **Step 4: Run tests, sonda e bench**

Run:
```
npm run components && npm run test:components && npm run components:check && npm run check:params
$RTS run tests/test_dom_quadro.ts
$RTS run tests/test_game_ui.ts
$RTS run tests/test_dom_canvas.ts
node --test tests/editor-static.test.mjs
RTS_GC_DEBUG=1 $RTS run tests/claude-test-dom-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
RTS_GC_DEBUG=1 $RTS run tests/claude-test-frame-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
node bench/claude-frame-bench.mjs --only jogo-vitrine,jogo-hud-sem,jogo-hud-2d,jogo-hud-dom,jogo-hud-dom-texto --runs 3 --label dom-depois
```
Expected: testes verdes; nenhuma linha de fase com contagem nas duas sondas (0 coletas); bench, medianas da mesma sessão: `jogo-hud-dom − jogo-hud-2d ≤ 0,15 ms`, `jogo-hud-dom-texto − jogo-hud-sem ≤ 0,5 ms`, GC/1000 quadros = 0 nas quatro cenas e `jogo-vitrine` dentro do ruído da linha de base do Step 0. Anotar os números e a carga da máquina no relatório da task; se uma meta falhar, parar e reportar (não afrouxar a meta).

- [ ] **Step 5: Portão de revisão**

Revisor com diff, saídas das sondas e tabela do bench. Pontos: um único `render` por quadro (nenhum outro chamador de `domHostRender` no caminho do jogo); `domHostPump` só depois do `endFrame`; `uiDoJogoNoEditor` não deixa `definirAreaUI` apontando para a área do editor depois de retornar; `UIButton` e `mouseApertadoNoMundo` sem alocação; números do bench dentro das metas.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(ui): HTML no quadro (3D -> DOM -> 2D), pump apos endFrame, previa na aba Jogo, bloqueio de clique; sonda e bench do DomCanvas"`

---

### Task 5: Recarga do HTML/CSS no editor (`Editor.every` + vigia por mtime)

**Files:**
- Create: `assets/pacotes/dom/dom_recarga.ts`
- Modify: `src/editor/api.ts` (`Editor.every`, `pollEditorTimers`)
- Modify: `main.ts` (`pollEditorTimers(Date.now());` depois de `editorBuild.poll();`, linha 1697)
- Regenerate: `src/engine/generated/editor_extensions.ts` (`npm run components`)
- Test: `tests/test_dom_recarga.ts`

**Interfaces:**
- Produces (`@editor/api`): `Editor.every(segundos: number, fn: GanchoFn): boolean`; `pollEditorTimers(agoraMs: number): void`.
- Produces (pacote): `vigiarDom(arg: string): number` (quantos canvases recarregou).
- Consumes: `DomCanvas.recarregar/erro/montado`, `DomVista.valido/escritas`, `UI_DOM.recargaMs`.

- [ ] **Step 1: Write the failing test**

`tests/test_dom_recarga.ts`:

```ts
// Teste SEM JANELA da recarga: o vigia só anota na primeira passada, recarrega
// quando mtime/tamanho mudam, invalida ids antigos, avisa onDomReload, mantém o
// conteúdo e loga o erro se o arquivo some; Editor.every no intervalo.
//   rts.exe run tests/test_dom_recarga.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import "@engine/generated/editor_extensions";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { DomCanvas } from "@engine/core/dom_canvas";
import { instalarEditorReal } from "@editor/editor_host";
import { Editor, pollEditorTimers } from "@editor/api";
import { scene } from "@editor/control/session";
import { logEntries, LOG_ERROR } from "@engine/core/logger";
import { vigiarDom } from "../assets/pacotes/dom/dom_recarga";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Ouvinte extends Behavior {
  recargas: number;
  constructor() { super(); this.recargas = 0; }
  onDomReload(): void { this.recargas = this.recargas + 1; }
}
instalarEditorReal();
const DIR = "build/claude-dom";
const ARQ = DIR + "/r.html";
fs.create_dir_all(DIR);
fs.write(ARQ, "<p id=\"v\">um</p>");
scene.clear();
const o = new GameObject("R"); const c = new DomCanvas(); c.html = ARQ; const ouv = new Ouvinte();
o.addBehavior(c); o.addBehavior(ouv); scene.add(o);
const v = c.documento;
const antigo = v.querySelector("#v");
check(vigiarDom("") === 0, "primeira passada só anota");
fs.write(ARQ, "<p id=\"v\">dois</p><p id=\"w\">novo</p>");
check(vigiarDom("") === 1 && ouv.recargas === 1, "arquivo mudou: recarrega e avisa onDomReload");
const e0 = v.escritas;
v.setText(antigo, "x");
check(!v.valido(antigo) && v.escritas === e0 && v.getText(antigo) === "", "id anterior à recarga virou no-op");
check(v.getText(v.querySelector("#v")) === "dois" && v.querySelector("#w") >= 0, "conteúdo novo");
check(vigiarDom("") === 0, "sem mudança, sem recarga");
const erros0 = logEntries(LOG_ERROR, "DomCanvas").length;
fs.remove_file(ARQ);
check(vigiarDom("") === 1 && c.erro().indexOf("r.html") >= 0 && logEntries(LOG_ERROR, "DomCanvas").length === erros0 + 1, "arquivo sumiu: erro no Console");
check(v.getText(v.querySelector("#v")) === "dois" && ouv.recargas === 1, "conteúdo anterior mantido, sem onDomReload");
fs.write(ARQ, "<p id=\"v\">tres</p>");
pollEditorTimers(Date.now() + 10000000);
check(v.getText(v.querySelector("#v")) === "tres" && c.erro() === "", "o temporizador do editor roda o vigia");
let chamadas = 0;
check(Editor.every(0.5, (a: string): void => { chamadas = chamadas + 1; }), "every registra");
check(!Editor.every(0.0, (a: string): void => {}), "intervalo 0 recusado");
const t0 = Date.now() + 20000000;
pollEditorTimers(t0); pollEditorTimers(t0 + 100.0);
check(chamadas === 1, "dentro do intervalo: uma chamada");
pollEditorTimers(t0 + 600.0);
check(chamadas === 2, "depois do intervalo: outra");
scene.clear();
io.print("[PASSOU] recarga: vigia por mtime/tamanho, ids por geração, onDomReload, erro mantém o conteúdo, Editor.every");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$RTS run tests/test_dom_recarga.ts`
Expected: FAIL (`pollEditorTimers`, `Editor.every` e o pacote não existem).

- [ ] **Step 3: Write minimal implementation**

`src/editor/api.ts`, antes de `export class Editor`:

```ts
class TemporizadoresEditor {
  intervaloMs: number[]; proximoMs: number[]; fns: GanchoFn[];
  constructor() { this.intervaloMs = []; this.proximoMs = []; this.fns = []; }
}
const temporizadores = new TemporizadoresEditor();
/// main.ts chama uma vez por quadro. O quadro só compara números; a chamada
/// (com try, em função própria) roda só quando o intervalo vence.
export function pollEditorTimers(agoraMs: number): void {
  if (!estado.host.ativo) return;
  const t = temporizadores;
  let i = 0;
  while (i < t.fns.length) {
    if (agoraMs >= t.proximoMs[i]) { t.proximoMs[i] = agoraMs + t.intervaloMs[i]; rodarTemporizador(i); }
    i = i + 1;
  }
}
function rodarTemporizador(i: number): void {
  try { temporizadores.fns[i](""); } catch (error) { logError("Editor.every: " + String(error)); }
}
```

E em `class Editor`:

```ts
  /// Chama `fn` a cada `segundos` no editor (nunca no jogo exportado): vigias
  /// baratos, como a recarga de arquivos. false para intervalo <= 0.
  static every(segundos: number, fn: GanchoFn): boolean {
    const ok = segundos > 0.0;
    if (ok) { temporizadores.intervaloMs.push(segundos * 1000.0); temporizadores.proximoMs.push(0.0); temporizadores.fns.push(fn); }
    return ok;
  }
```

`main.ts` depois de `editorBuild.poll();` (linha 1697): `pollEditorTimers(Date.now());` (e `pollEditorTimers` no import de `@editor/api`, se `main.ts` ainda não importa dali, novo `import { pollEditorTimers } from "@editor/api";`).

`assets/pacotes/dom/dom_recarga.ts`:

```ts
/** @editorOnly */
// Pacote dom/: recarga do HTML/CSS de cada DomCanvas da cena editada quando o
// arquivo muda no disco (editor externo). A cada UI_DOM.recargaMs compara
// "mtime:tamanho" de .html e .css; nunca por quadro e nunca no jogo exportado.
import { statSync } from "node:fs";
import { Editor } from "@editor/api";
import { DomCanvas } from "@engine/core/dom_canvas";
import { UI_DOM } from "@editor/ui_config";

const AUSENTE: string = "?";
class VigiaDom {
  canvases: DomCanvas[]; caminhos: string[]; assinaturas: string[];
  constructor() { this.canvases = []; this.caminhos = []; this.assinaturas = []; }
}
const vigia = new VigiaDom();
function assinaturaArquivo(caminho: string): string {
  if (caminho.length === 0) return "";
  try { const st: any = statSync(caminho); return st.mtimeMs + ":" + st.size; }
  catch (e) { return AUSENTE; }
}
function esquecerDesmontados(): void {
  let k = vigia.canvases.length - 1;
  while (k >= 0) {
    if (!vigia.canvases[k].montado()) { vigia.canvases.splice(k, 1); vigia.caminhos.splice(k, 1); vigia.assinaturas.splice(k, 1); }
    k = k - 1;
  }
}
/// Uma passada do vigia; devolve quantos canvases recarregou.
export function vigiarDom(arg: string): number {
  const sc = Editor.scene();
  if (sc === null) return 0;
  esquecerDesmontados();
  let recarregados = 0;
  const objs = sc.uiObjs;
  let i = 0;
  while (i < objs.length) {
    const bs = objs[i].behaviors;
    let j = 0;
    while (j < bs.length) {
      const b = bs[j];
      if (b instanceof DomCanvas && (b as DomCanvas).montado()) {
        const c = b as DomCanvas;
        const caminho = c.html + "|" + c.css;
        const a = assinaturaArquivo(c.html) + "|" + assinaturaArquivo(c.css);
        const k = vigia.canvases.indexOf(c);
        if (k < 0) { vigia.canvases.push(c); vigia.caminhos.push(caminho); vigia.assinaturas.push(a); }
        else if (vigia.caminhos[k] !== caminho) { vigia.caminhos[k] = caminho; vigia.assinaturas[k] = a; }   // o campo mudou: onValidate já recarregou
        else if (vigia.assinaturas[k] !== a) { vigia.assinaturas[k] = a; c.recarregar(); recarregados = recarregados + 1; }
      }
      j = j + 1;
    }
    i = i + 1;
  }
  return recarregados;
}
Editor.every(UI_DOM.recargaMs / 1000.0, (a: string): void => { vigiarDom(a); });
```

Depois: `npm run components`.

- [ ] **Step 4: Run tests**

Run:
```
npm run components && npm run components:check && npm run check:params
$RTS run tests/test_dom_recarga.ts
$RTS run tests/test_editor_api.ts
node --test tests/editor-static.test.mjs
RTS_GC_DEBUG=1 $RTS run tests/claude-test-frame-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
```
Expected: `[PASSOU] recarga: ...`; `test_editor_api` verde; sonda de quadro sem coletas.

- [ ] **Step 5: Portão de revisão**

Revisor com diff e saídas. Pontos: `pollEditorTimers` não aloca quando nada vence; o `try` fica em `rodarTemporizador`/`assinaturaArquivo`; `recarregar` com erro não chama `onDomReload` nem troca o conteúdo; trocar o caminho pelo Inspector não recarrega duas vezes.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(editor): Editor.every e recarga do HTML/CSS do DomCanvas por mtime (pacote dom)"`

---

### Task 6: Pacote `assets/pacotes/dom/` — Inspector, gizmo, `Criar/UI/DomCanvas`, comando `dom`, modelo e exemplo

**Files:**
- Create: `assets/pacotes/dom/dom_editor.ts`, `assets/ui/exemplo.html`, `assets/ui/exemplo.css`, `assets/scripts/ExemploDomContador.ts`
- Modify: `src/engine/core/inspector_ui.ts` (registro `registerInspectorDrawer`), `src/editor/api.ts` (reexporta `registerInspector`), `src/editor/inspector.ts` (linha 563)
- Modify: `assets/editor/icons/source.json` (paleta `html`; ícone `ui-html`); Regenerate: `assets/editor/icons/ui-html.png` (`npm run icons`)
- Regenerate: catálogo e `editor_extensions.ts` (`npm run components`); `docs/ws-comandos.md` (`npm run docs:ws`)
- Test: `tests/test_pacote_dom.ts`

**Interfaces:**
- Produces (`@engine/core/inspector_ui`): `type InspectorFn = (comp: Behavior, ui: InspectorUI) => void`, `registerInspectorDrawer(tipo, fn): boolean`, `inspectorDrawerIndex(tipo): number`, `runInspectorDrawer(i, comp, ui): void`; `@editor/api` reexporta `registerInspector` e `InspectorFn`.
- Produces (pacote): `class DomMenu { static domCanvas() }` (`@menuItem Criar/UI/DomCanvas`); comando `dom`; `class ExemploDomContador extends Behavior`.
- Consumes: `UI_DOM`, `registerGizmo`, `registerCommand`, `Editor.*`, `ScriptEditor`.

- [ ] **Step 1: Write the failing test**

`tests/test_pacote_dom.ts`:

```ts
// Teste SEM JANELA do pacote dom/: Criar/UI/DomCanvas, gizmo, Inspector
// registrado por tipo, comando `dom` (set, html, query, click, css, reload,
// info, lista) e o exemplo ExemploDomContador.
//   rts.exe run tests/test_pacote_dom.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import "@engine/generated/editor_extensions";
import { Behavior } from "@engine/core/behavior";
import { InspectorUI, inspectorDrawerIndex, runInspectorDrawer } from "@engine/core/inspector_ui";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";
import { domHostPump } from "@engine/ui/dom_host";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { executarItemDeMenu, indiceDoCaminho } from "@editor/menu_items";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { gizmosBegin } from "@engine/core/gizmos";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { createComponent } from "@editor/components";
import { UI_DOM } from "@editor/ui_config";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class GuiGravador extends InspectorUI {
  campos: string[]; botoes: string[]; apertar: string;
  constructor() { super(); this.campos = []; this.botoes = []; this.apertar = ""; }
  field(nome: string): void { this.usos = this.usos + 1; this.campos.push(nome); }
  button(rotulo: string): boolean { this.usos = this.usos + 1; this.botoes.push(rotulo); return rotulo === this.apertar; }
}
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];

// menu
check(executarItemDeMenu(indiceDoCaminho("Criar/UI/DomCanvas"), 0 - 1) === "", "Criar/UI/DomCanvas");
const o = scene.objects[S.selected];
const c = domCanvasDe(o) as DomCanvas;
check(o.name === UI_DOM.nomeObjeto && c !== null && c.html === UI_DOM.modeloHtml && c.css === UI_DOM.modeloCss && c.montado() && c.erro() === "", "cria com o modelo, montado");
check(history.undoDepth() === 1, "entra no Desfazer");
const v = c.documento;
check(v.querySelector("#valor") >= 0 && v.querySelector("button") >= 0, "modelo tem #valor e o botão");

// gizmo
scene.computeWorld();
const gp = new Float64Array(8); gp[2] = 0 - 20.0; gp[5] = 1.0; gp[6] = 1280.0; gp[7] = 720.0;
gizmosBegin(gizmosDoEditor, gp); coletarGizmos(gizmosDoEditor, scene, 0 - 1);
check(gizmosDoEditor.nIc === 1 && gizmosDoEditor.icNomes[0] === UI_DOM.icone, "ícone ui-html");

// Inspector registrado por tipo
const iDom = inspectorDrawerIndex("DomCanvas");
check(iDom >= 0, "Inspector do DomCanvas registrado pelo pacote");
const gui = new GuiGravador();
runInspectorDrawer(iDom, c, gui);
check(gui.campos.indexOf("html") >= 0 && gui.campos.indexOf("css") >= 0 && gui.campos.indexOf("bloqueiaCliques") >= 0, "campos");
check(gui.botoes.indexOf(UI_DOM.recarregar) >= 0 && gui.botoes.indexOf(UI_DOM.abrir) >= 0, "botões Recarregar e Abrir no editor");

// comando dom
check(execCommand(800, 600, "dom").indexOf(UI_DOM.nomeObjeto) >= 0, "dom sem argumentos lista os canvases");
check(execCommand(800, 600, "dom DomCanvas set #valor 42").indexOf("[ok]") === 0 && v.getText(v.querySelector("#valor")) === "42", "set");
const q = execCommand(800, 600, "dom DomCanvas query #valor");
check(q.indexOf("[dom] 1") === 0 && q.indexOf("texto=\"42\"") > 0 && q.indexOf("caixa=") > 0, "query com texto e caixa");
check(execCommand(800, 600, "dom DomCanvas query #nada").indexOf("[erro]") === 0, "seletor sem casamento é erro");
check(execCommand(800, 600, "dom DomCanvas css #valor color #FF0000").indexOf("[ok]") === 0 &&
      dom.inlineProperty(v.doc(), v.noDom(v.querySelector("#valor")), "color").length > 0, "css");
check(execCommand(800, 600, "dom 99 set #valor 1").indexOf("[erro]") === 0, "objeto sem DomCanvas");
check(execCommand(800, 600, "dom DomCanvas").indexOf("[erro] uso") === 0, "uso");

// clique + exemplo
const ex = createComponent("ExemploDomContador"); o.addBehavior(ex); ex.mount();
check(execCommand(800, 600, "dom DomCanvas click button").indexOf("[ok]") === 0, "click enfileirado");
domHostPump(); ex.update(0.016);
check(v.getText(v.querySelector("#valor")) === "1", "clique -> onUIClick(ok) -> contador no HTML");

// html: arquivo (salvo, com Desfazer) e literal (execução)
fs.create_dir_all("build/claude-dom");
fs.write("build/claude-dom/p.html", "<p id=\"valor\">P</p>");
const d0 = history.undoDepth();
check(execCommand(800, 600, "dom DomCanvas html build/claude-dom/p.html").indexOf("[ok]") === 0 && c.html === "build/claude-dom/p.html" && history.undoDepth() === d0 + 1, "html <arquivo> muda o campo com Desfazer");
check(v.getText(v.querySelector("#valor")) === "P", "conteúdo do arquivo novo");
check(execCommand(800, 600, "dom DomCanvas html <b>lit</b>").indexOf("[ok]") === 0 && v.querySelector("b") >= 0 && history.undoDepth() === d0 + 1, "html literal: execução, sem Desfazer");
fs.write("build/claude-dom/p.html", "<p id=\"valor\">P2</p>");
check(execCommand(800, 600, "dom DomCanvas reload").indexOf("[ok]") === 0 && v.getText(v.querySelector("#valor")) === "P2", "reload");
check(execCommand(800, 600, "dom DomCanvas info").indexOf("html=build/claude-dom/p.html") > 0, "info");
check(execCommand(800, 600, "help").indexOf("dom [<obj>") >= 0, "no help");
scene.clear();
io.print("[PASSOU] pacote dom/: menu, gizmo, Inspector por tipo, comando dom e exemplo");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$RTS run tests/test_pacote_dom.ts`
Expected: FAIL (`inspectorDrawerIndex` não existe; item de menu inexistente).

- [ ] **Step 3: Write minimal implementation**

`src/engine/core/inspector_ui.ts`, no fim (e `import type { Behavior } from "./behavior";`):

```ts
/// GUI do Inspector para um TIPO de componente (typeName), fornecida por um
/// pacote do editor quando o componente é do núcleo e a GUI precisa do editor.
export type InspectorFn = (comp: Behavior, ui: InspectorUI) => void;
const tiposInspector: string[] = [];
const fnsInspector: InspectorFn[] = [];
export function registerInspectorDrawer(tipo: string, fn: InspectorFn): boolean {
  const ok = tipo.length > 0 && tiposInspector.indexOf(tipo) < 0;
  if (ok) { tiposInspector.push(tipo); fnsInspector.push(fn); }
  return ok;
}
export function inspectorDrawerIndex(tipo: string): number { return tiposInspector.indexOf(tipo); }
export function runInspectorDrawer(i: number, comp: Behavior, ui: InspectorUI): void { fnsInspector[i](comp, ui); }
```

`src/editor/api.ts`, junto do reexport do gizmo (linhas 18-19):

```ts
export { registerInspectorDrawer as registerInspector } from "@engine/core/inspector_ui";
export type { InspectorFn } from "@engine/core/inspector_ui";
```

`src/editor/inspector.ts`, linha 563 (dentro do `if ((component.falhasEditor & FALHA_GUI) === 0)`, com `import { inspectorDrawerIndex, runInspectorDrawer } from "@engine/core/inspector_ui";`):

```ts
          const iExt = inspectorDrawerIndex(component.typeName());
          if (iExt >= 0) runInspectorDrawer(iExt, component, this.gui);
          else component.onInspectorGUI(this.gui);
```

`assets/editor/icons/source.json`: na `palette`, `"html": "#E8A26B"`; em `icons`, depois de `"camera"`:

```json
    "ui-html": [{"kind":"polygon","points":[[1,3],[15,3],[15,13],[1,13]],"color":"html"},{"kind":"line","x1":6,"y1":6,"x2":4,"y2":8,"width":1.3,"color":"ink"},{"kind":"line","x1":4,"y1":8,"x2":6,"y2":10,"width":1.3,"color":"ink"},{"kind":"line","x1":10,"y1":6,"x2":12,"y2":8,"width":1.3,"color":"ink"},{"kind":"line","x1":12,"y1":8,"x2":10,"y2":10,"width":1.3,"color":"ink"},{"kind":"line","x1":9,"y1":5.5,"x2":7,"y2":10.5,"width":1.3,"color":"ink"}]
```

`assets/ui/exemplo.html`:

```html
<div class="painel">
  <h3 id="titulo">DomCanvas</h3>
  <p>cliques: <span id="valor">0</span></p>
  <button data-acao="ok">OK</button>
</div>
```

`assets/ui/exemplo.css`:

```css
.painel { position: absolute; left: 16px; top: 16px; padding: 8px 12px; background: rgba(20, 24, 32, 0.8); color: #E8F0FF; border-radius: 6px; font-family: sans-serif; }
.painel h3 { margin: 0 0 6px 0; font-size: 1.1em; }
.painel p { margin: 0 0 6px 0; }
.painel button { padding: 4px 12px; background: #3B4252; color: #ECEFF4; border: 1px solid #4C566A; border-radius: 4px; }
.painel button:hover { background: #BF616A; }
```

`assets/scripts/ExemploDomContador.ts`:

```ts
import { Behavior } from "@engine/core/behavior";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";

/**
 * @componentCategory Demo
 * @componentDescription Exemplo de DomCanvas: conta os cliques no botão data-acao="ok" e mostra em #valor.
 * @componentKeywords exemplo dom html contador botao
 */
export class ExemploDomContador extends Behavior {
  private cliques: number = 0;
  private canvas: DomCanvas | null = null;
  private valor: number = 0 - 1;
  mount(): void { this.ligar(); }
  onDomReload(): void { this.ligar(); }
  private ligar(): void {
    this.canvas = domCanvasDe(this.owner);
    this.valor = this.canvas !== null ? this.canvas.documento.querySelector("#valor") : 0 - 1;
  }
  onUIClick(nome: string): void { if (nome === "ok") this.cliques = this.cliques + 1; }
  update(dt: f64): void {
    if (this.canvas !== null && this.valor >= 0) this.canvas.documento.setNumero(this.valor, this.cliques, 0);
  }
}
```

`assets/pacotes/dom/dom_editor.ts`:

```ts
/** @editorOnly */
// Pacote dom/: Inspector do DomCanvas (campos, Recarregar, Abrir no editor,
// estado), ícone de gizmo, Criar/UI/DomCanvas e o comando `dom` da porta de
// controle — a entrada que a IA usa para ler e testar a UI em HTML.
import fs from "@compat/fs.ts";
import { Editor, registerCommand, registerGizmo, registerInspector, Gizmos } from "@editor/api";
import type { GameObject } from "@engine/core/gameobject";
import type { Behavior } from "@engine/core/behavior";
import type { InspectorUI } from "@engine/core/inspector_ui";
import { DomCanvas, domCanvasDe } from "@engine/core/dom_canvas";
import type { DomVista } from "@engine/ui/dom_vista";
import { ScriptEditor } from "@editor/script_editor";
import { UI_DOM } from "@editor/ui_config";

const USO_DOM: string = "dom [<obj> set <seletor> <texto> | html <arquivo|html> | query <seletor> | click <seletor> | css <seletor> <prop> <valor> | reload | info]";
const posIcone = new Float64Array(3);
const abridor = new ScriptEditor();

// ── gizmo ─────────────────────────────────────────────────────────────────
function gizmoDom(g: Gizmos, dono: GameObject, comp: Behavior): void {
  posIcone[0] = dono.transform.wx; posIcone[1] = dono.transform.wy; posIcone[2] = dono.transform.wz;
  g.icon(UI_DOM.icone, posIcone);
}
registerGizmo("DomCanvas", gizmoDom);

// ── Inspector ─────────────────────────────────────────────────────────────
/// Linha de estado refeita só quando o canvas, o erro ou o número de nós muda.
class EstadoInspector {
  canvas: DomCanvas | null; erro: string; nos: number; texto: string;
  constructor() { this.canvas = null; this.erro = ""; this.nos = 0 - 1; this.texto = ""; }
}
const estadoGui = new EstadoInspector();
function linhaEstado(c: DomCanvas): string {
  const nos = c.documento.contar("*");
  const erro = c.erro();
  if (c !== estadoGui.canvas || nos !== estadoGui.nos || erro !== estadoGui.erro) {
    estadoGui.canvas = c; estadoGui.nos = nos; estadoGui.erro = erro;
    estadoGui.texto = UI_DOM.estadoNos + nos + (erro.length > 0 ? UI_DOM.estadoErro + erro : UI_DOM.estadoOk);
  }
  return estadoGui.texto;
}
function abrirNoEditor(caminho: string): void {
  abridor.open(caminho);
  if (abridor.message.length > 0) { Editor.log(abridor.message); abridor.message = ""; }
}
function inspectorDom(comp: Behavior, ui: InspectorUI): void {
  const c = comp as DomCanvas;
  ui.field("html"); ui.field("css");
  ui.field("ancoragem"); ui.field("largura"); ui.field("altura");
  ui.field("escala"); ui.field("ordem"); ui.field("bloqueiaCliques");
  if (ui.button(UI_DOM.recarregar)) c.recarregar();
  if (ui.button(UI_DOM.abrir)) abrirNoEditor(c.html);
  ui.label(linhaEstado(c));
}
registerInspector("DomCanvas", inspectorDom);

// ── menu ──────────────────────────────────────────────────────────────────
function criarDomCanvas(): GameObject | null {
  const sc = Editor.scene();
  if (sc === null) return null;
  const o = sc.createGameObject(UI_DOM.nomeObjeto);
  const c = new DomCanvas(); c.html = UI_DOM.modeloHtml; c.css = UI_DOM.modeloCss;
  o.addBehavior(c);
  c.mount();
  return o;
}
export class DomMenu {
  /** @menuItem Criar/UI/DomCanvas */
  static domCanvas(): void { criarDomCanvas(); }
}

// ── comando `dom` ─────────────────────────────────────────────────────────
function resto(p: string[], de: number): string { return p.slice(de).join(" "); }
function listarCanvases(): string {
  const sc = Editor.scene();
  let out = "[dom]";
  if (sc === null) return out;
  let i = 0;
  while (i < sc.objects.length) {
    const c = domCanvasDe(sc.objects[i]);
    if (c !== null) out = out + " | #" + i + " " + sc.objects[i].name + " html=" + c.html + " montado=" + (c.montado() ? 1 : 0) + (c.erro().length > 0 ? " erro=" + c.erro() : "");
    i = i + 1;
  }
  return out;
}
function domQuery(v: DomVista, sel: string): string {
  const h = v.doc(); const raiz = v.noDom(v.raiz());
  const n = dom.queryAllWithinCount(h, raiz, sel);
  if (n === 0) return "[erro] seletor sem casamento: " + sel;
  let out = "[dom] " + n + " nó(s)";
  let i = 0;
  while (i < n && i < UI_DOM.queryMax) {
    const no = dom.queryAllWithinAt(h, raiz, sel, i);
    out = out + " | no=" + no + " " + dom.tagName(h, no) + " id=" + dom.getAttribute(h, no, "id") +
      " class=" + dom.getAttribute(h, no, "class") + " texto=\"" + dom.getText(h, no) + "\"" +
      " caixa=" + dom.boundingRect(h, no, 0) + "," + dom.boundingRect(h, no, 1) + "," + dom.boundingRect(h, no, 2) + "," + dom.boundingRect(h, no, 3) +
      " display=" + dom.computedProperty(h, no, "display", "");
    i = i + 1;
  }
  return out;
}
function domHtml(c: DomCanvas, arg: string): string {
  if (fs.exists(arg) && !fs.is_dir(arg)) {
    if (arg === c.html) return c.recarregar() ? "[ok] html=" + arg : "[erro] " + c.erro();
    Editor.snapshot("dom html");
    c.html = arg;
    c.onValidate("html");
    return c.erro().length === 0 ? "[ok] html=" + arg : "[erro] " + c.erro();
  }
  c.definirConteudo(arg);
  return "[ok] conteúdo trocado (estado de execução, não salvo)";
}
function cmdDom(p: string[]): string {
  if (p.length === 1) return listarCanvases();
  if (p.length < 3) return "[erro] uso: " + USO_DOM;
  const c = domCanvasDe(Editor.object(p[1]));
  if (c === null) return "[erro] objeto sem DomCanvas: " + p[1];
  const v = c.documento;
  const sub = p[2];
  if (sub === "reload") return c.recarregar() ? "[ok] recarregado " + c.html : "[erro] " + c.erro();
  if (sub === "info") return "[dom] html=" + c.html + " css=" + c.css + " nos=" + v.contar("*") + " erro=" + (c.erro().length > 0 ? c.erro() : "-");
  if (p.length < 4) return "[erro] uso: " + USO_DOM;
  if (sub === "html") return domHtml(c, resto(p, 3));
  if (sub === "query") return domQuery(v, resto(p, 3));
  const no = v.querySelector(p[3]);
  if (no < 0) return "[erro] seletor sem casamento: " + p[3];
  if (sub === "set") { v.setText(no, resto(p, 4)); return "[ok] " + p[3] + " = " + v.getText(no); }
  if (sub === "click") { dom.pushRawEvent(v.doc(), v.noDom(no), "click"); return "[ok] click em " + p[3] + " (entregue no próximo quadro)"; }
  if (sub === "css" && p.length >= 6) { v.setStyle(no, p[4], resto(p, 5)); return "[ok] " + p[3] + " " + p[4] + ": " + resto(p, 5); }
  return "[erro] uso: " + USO_DOM;
}
registerCommand("dom", USO_DOM + " :: UI em HTML do DomCanvas: sem argumentos lista os canvases; set/query/click/css agem no primeiro nó que casa (click é entregue no próximo quadro); html <arquivo> muda o campo (Desfazer), html literal só em execução :: dom HUD query #vida", false, cmdDom);
```

Depois: `npm run icons && npm run components && npm run docs:ws`.

- [ ] **Step 4: Run tests**

Run:
```
npm run icons:check && npm run components:check && npm run test:components && npm run docs:ws:check && npm run check:params
$RTS run tests/test_pacote_dom.ts
$RTS run tests/test_inspector_gui.ts
$RTS run tests/test_menu_items.ts
$RTS run tests/test_icon_images.ts
$RTS run tests/test_ws_manifesto.ts
node --test tests/editor-static.test.mjs
RTS_GC_DEBUG=1 $RTS run tests/claude-test-frame-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
```
Expected: `[PASSOU] pacote dom/: ...`; os demais verdes; a fase Inspector da sonda continua sem coletas (o `inspectorDrawerIndex` por quadro não aloca).

- [ ] **Step 5: Portão de revisão**

Revisor com diff e saídas. Pontos: rótulos e medidas em `UI_DOM`; a linha de estado do Inspector não monta string por quadro; `dom html <arquivo>` tira snapshot antes de mudar o campo e `html` literal não; `click` usa o mesmo caminho do mouse real; nenhum arquivo do pacote contém gatilhos da fachada; `dom` recusa seletor sem casamento.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "feat(pacotes): dom/ com Inspector por tipo, gizmo ui-html, Criar/UI/DomCanvas, comando dom e exemplo"`

---

### Task 7: HUD do rts-fps em `DomCanvas`

**Files (repo `C:\Users\nexga\Documents\GitHub\rts-fps`):**
- Create: `assets/ui/hud.html`, `assets/ui/hud.css`, `src/hud_dom.ts`, `tests/fps-hud-dom.ts`
- Modify: `src/client.ts` (imports, linhas 10-28; criação do HUD perto da linha 83; seção do HUD, linhas 175-182; `domHostPump()` depois de `fpsApp.endFrame()`, linha 184)
- Modify: `tests/fps-quadro-gc.ts` (fase `hud-dom`), `tools/build-exe.mjs` (`ARQUIVOS`, linhas 21-27)
- Modify: submódulo `engine/` (commit de `feat/domcanvas`)

**Interfaces:**
- Consumes: `DomCanvas`, `DomVista`, `drawGameUI`, `domHostPump` do motor (Tasks 3-4).
- Produces: `class FpsHudDom { cena: Scene; canvas: DomCanvas; travado; debug; fps; agoraMs; msSim; msRender; msAnim; desenhados; objetos; atualizar(eu, mundo) }`, `FPS_HUD_HTML`, `FPS_HUD_CSS`; variável de ambiente `FPS_HUD=2d` mantém o HUD `draw2d` antigo até a verificação.

- [ ] **Step 1: Write the failing test**

```
cd /c/Users/nexga/Documents/GitHub/rts-fps
git switch -c feat/hud-domcanvas
git -C engine fetch C:/Users/nexga/Documents/GitHub/rts-game feat/domcanvas && git -C engine checkout FETCH_HEAD
```

`tests/fps-hud-dom.ts`:

```ts
// HUD em HTML/CSS (DomCanvas): valores escritos só quando mudam, alerta de
// vida baixa, painel de depuração, aviso de morte e "clique para jogar".
//   ../rts-uv-mundo/target/release/rts.exe run tests/fps-hud-dom.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { FpsWorld } from "../src/shared/world";
import { FPS_SEMENTE_PADRAO } from "../src/shared/config";
import { FpsHudDom } from "../src/hud_dom";

function fpsCheck(c: boolean, m: string): void { if (!c) throw new Error(m); }
const fpsSc = new Scene("t");
const fpsM = new FpsWorld(fpsSc, FPS_SEMENTE_PADRAO, 1.0);
fpsM.adicionarJogador(false); fpsM.adicionarJogador(true);
const fpsHud = new FpsHudDom();
const fpsEu = fpsM.jogadores[0];
const fpsV = fpsHud.canvas.documento;
function fpsTexto(sel: string): string { return fpsV.getText(fpsV.querySelector(sel)); }
function fpsClasse(sel: string): string { return dom.getAttribute(fpsV.doc(), fpsV.noDom(fpsV.querySelector(sel)), "class"); }
fpsCheck(fpsHud.canvas.erro() === "", "hud.html e hud.css carregados");
fpsHud.atualizar(fpsEu, fpsM);
fpsCheck(fpsTexto("#vida") === "" + Math.round(fpsEu.vida) && fpsTexto("#bots") === "1", "vida e bots");
fpsEu.vida = 25.0; fpsHud.atualizar(fpsEu, fpsM);
fpsCheck(fpsClasse("#status").indexOf("alerta") >= 0 && fpsTexto("#vida") === "25", "vida baixa: alerta");
const fpsE = fpsV.escritas; fpsHud.atualizar(fpsEu, fpsM);
fpsCheck(fpsV.escritas === fpsE, "nada mudou: nenhuma escrita");
fpsCheck(fpsClasse("#debug").indexOf("oculto") >= 0, "depuração escondida");
fpsHud.debug = 1; fpsHud.fps = 60.0; fpsHud.agoraMs = 1000.0; fpsHud.atualizar(fpsEu, fpsM);
fpsCheck(fpsClasse("#debug").indexOf("oculto") < 0 && fpsTexto("#fpsn") === "60" && fpsTexto("#msq") === "16.7" && fpsTexto("#dbg1").indexOf("fps 60") === 0, "F3: depuração e medidas");
fpsCheck(fpsClasse("#clique").indexOf("oculto") < 0, "sem mouse travado: clique para jogar");
fpsEu.vivo = false; fpsEu.tempoRenascer = 2.34; fpsHud.atualizar(fpsEu, fpsM);
fpsCheck(fpsClasse("#morto").indexOf("oculto") < 0 && fpsTexto("#renascer") === "2.3" && fpsClasse("#clique").indexOf("oculto") >= 0, "morto: aviso com contagem");
io.print("[PASSOU] fps-hud-dom: valores, alerta, depuração, morte, sem escrita repetida");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../rts-uv-mundo/target/release/rts.exe run tests/fps-hud-dom.ts`
Expected: FAIL (`../src/hud_dom` não existe).

- [ ] **Step 3: Write minimal implementation**

`assets/ui/hud.html`:

```html
<div class="mira">+</div>
<div class="topo">
  <div id="status">vida <span id="vida">100</span>&nbsp;&nbsp; municao <span id="municao">0</span><span id="recarga" class="oculto"> (recarregando)</span>&nbsp;&nbsp; granadas <span id="granadas">0</span></div>
  <div id="placar">abates <span id="abates">0</span>&nbsp;&nbsp; mortes <span id="mortes">0</span>&nbsp;&nbsp; bots <span id="bots">0</span></div>
  <div id="debug" class="oculto"><div id="dbg1"></div><div id="dbg2"></div><div id="dbg3"></div></div>
</div>
<div id="fps"><span id="fpsn">0</span> fps&nbsp;&nbsp;<span id="msq">0.0</span> ms (vsync)</div>
<div id="morto" class="aviso oculto">voce morreu, renascendo em <span id="renascer">0.0</span> s</div>
<div id="clique" class="aviso">clique para jogar (Esc solta o mouse)</div>
<div id="ajuda">WASD anda | espaco pula | clique atira | R recarrega | G granada | N/M bot +/- | F3 depuracao</div>
```

`assets/ui/hud.css` (as medidas `FPS_HUD_*` de `src/hud.ts` passam para cá):

```css
:root { color: #E8F0FF; font-size: 16px; font-family: sans-serif; pointer-events: none; }
.topo { position: absolute; left: 14px; top: 14px; line-height: 20px; }
#status.alerta { color: #FF6060; }
#debug { margin-top: 16px; color: #9FB4C8; font-size: 13px; line-height: 16px; }
#fps { position: absolute; right: 14px; top: 14px; }
.aviso { position: absolute; left: 50%; top: 50%; margin-left: -170px; margin-top: 40px; }
#morto { color: #FF6060; }
#ajuda { position: absolute; left: 14px; bottom: 14px; color: #708096; font-size: 13px; }
.mira { position: absolute; left: 50%; top: 50%; margin-left: -5px; margin-top: -11px; font-size: 20px; color: #FFFFFF; }
.oculto { display: none; }
```

`src/hud_dom.ts`:

```ts
// HUD do cliente local em HTML/CSS (DomCanvas do motor). Layout, cores e
// posições em assets/ui/hud.css; aqui só os valores, escritos quando mudam:
// setNumero/setClass/setText não tocam o DOM com o mesmo valor, porque no rts
// cada mutação refaz o layout do HUD inteiro. As linhas de depuração (F3) são
// remontadas no máximo a cada FPS_HUD_DOM_INTERVALO_MS, como no HUD draw2d.
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { DomCanvas } from "@engine/core/dom_canvas";
import { DomVista } from "@engine/ui/dom_vista";
import { FpsPlayerState } from "./shared/player";
import { FpsWorld } from "./shared/world";
import { FPS_GRANADAS_POR_JOGADOR } from "./shared/config";

export const FPS_HUD_HTML = "assets/ui/hud.html";
export const FPS_HUD_CSS = "assets/ui/hud.css";
const FPS_HUD_DOM_VIDA_BAIXA: f64 = 30.0;
const FPS_HUD_DOM_INTERVALO_MS: f64 = 250.0;
const FPS_HUD_DOM_CLASSE_ALERTA = "alerta";
const FPS_HUD_DOM_CLASSE_OCULTO = "oculto";

export class FpsHudDom {
  // ── entrada por quadro (o cliente preenche, como no FpsHud) ──
  travado: number = 0;
  debug: number = 0;
  fps: f64 = 0.0;
  agoraMs: f64 = 0.0;
  msSim: f64 = 0.0;
  msRender: f64 = 0.0;
  msAnim: f64 = 0.0;
  desenhados: number = 0;
  objetos: number = 0;
  /// Cena só do HUD: a do mundo não muda (índices dos corpos do FpsWorld).
  cena: Scene;
  canvas: DomCanvas;
  private v: DomVista;
  private nStatus: number; private nVida: number; private nMunicao: number; private nRecarga: number; private nGranadas: number;
  private nAbates: number; private nMortes: number; private nBots: number;
  private nMorto: number; private nRenascer: number; private nClique: number;
  private nFps: number; private nMs: number; private nDebug: number; private nDbg1: number; private nDbg2: number; private nDbg3: number;
  private ultMs: f64;

  constructor() {
    this.cena = new Scene("hud");
    const o = new GameObject("HUD");
    this.canvas = new DomCanvas();
    this.canvas.html = FPS_HUD_HTML; this.canvas.css = FPS_HUD_CSS; this.canvas.bloqueiaCliques = false;
    o.addBehavior(this.canvas);
    this.cena.add(o);
    this.v = this.canvas.documento;
    const v = this.v;
    this.nStatus = v.querySelector("#status"); this.nVida = v.querySelector("#vida"); this.nMunicao = v.querySelector("#municao");
    this.nRecarga = v.querySelector("#recarga"); this.nGranadas = v.querySelector("#granadas");
    this.nAbates = v.querySelector("#abates"); this.nMortes = v.querySelector("#mortes"); this.nBots = v.querySelector("#bots");
    this.nMorto = v.querySelector("#morto"); this.nRenascer = v.querySelector("#renascer"); this.nClique = v.querySelector("#clique");
    this.nFps = v.querySelector("#fpsn"); this.nMs = v.querySelector("#msq"); this.nDebug = v.querySelector("#debug");
    this.nDbg1 = v.querySelector("#dbg1"); this.nDbg2 = v.querySelector("#dbg2"); this.nDbg3 = v.querySelector("#dbg3");
    this.ultMs = 0.0 - FPS_HUD_DOM_INTERVALO_MS;
  }

  atualizar(eu: FpsPlayerState, mundo: FpsWorld): void {
    const v = this.v;
    v.setNumero(this.nVida, eu.vida, 0);
    v.setClass(this.nStatus, FPS_HUD_DOM_CLASSE_ALERTA, eu.vida < FPS_HUD_DOM_VIDA_BAIXA);
    v.setNumero(this.nMunicao, eu.municao, 0);
    v.setClass(this.nRecarga, FPS_HUD_DOM_CLASSE_OCULTO, !(eu.tempoRecarga > 0.0));
    v.setNumero(this.nGranadas, FPS_GRANADAS_POR_JOGADOR - eu.granadasVivas, 0);
    v.setNumero(this.nAbates, eu.abates, 0);
    v.setNumero(this.nMortes, eu.mortes, 0);
    v.setNumero(this.nBots, mundo.jogadores.length - 1, 0);
    v.setClass(this.nMorto, FPS_HUD_DOM_CLASSE_OCULTO, eu.vivo);
    if (!eu.vivo) v.setNumero(this.nRenascer, Math.max(0.0, eu.tempoRenascer), 1);
    v.setClass(this.nClique, FPS_HUD_DOM_CLASSE_OCULTO, !eu.vivo || this.travado !== 0);
    v.setClass(this.nDebug, FPS_HUD_DOM_CLASSE_OCULTO, this.debug === 0);
    if (this.agoraMs - this.ultMs >= FPS_HUD_DOM_INTERVALO_MS) { this.ultMs = this.agoraMs; this.medidas(mundo); }
  }

  // fps e depuração: mudam quase todo quadro, então têm intervalo mínimo.
  private medidas(mundo: FpsWorld): void {
    const v = this.v;
    v.setNumero(this.nFps, Math.floor(this.fps), 0);
    v.setNumero(this.nMs, this.fps > 0.0 ? 1000.0 / this.fps : 0.0, 1);
    if (this.debug === 0) return;
    const m = mundo;
    const consultas = m.ultRaios + m.ultEsferas;
    const usPorConsulta = consultas > 0 ? (m.ultMsConsultas * 1000.0 / consultas) : 0.0;
    v.setText(this.nDbg1, "fps " + Math.floor(this.fps) + "   sim/frame " + this.msSim.toFixed(2) +
      " ms   ultimo tick " + m.ultMsTick.toFixed(2) + " ms   render " + this.msRender.toFixed(2) + " ms   anim " + this.msAnim.toFixed(2) + " ms");
    v.setText(this.nDbg2, "consultas/tick: raios " + m.ultRaios + "  esferas " + m.ultEsferas + "  (" + usPorConsulta.toFixed(1) + " us cada)");
    v.setText(this.nDbg3, "estaticos " + m.mapa.objetos + "   objetos " + this.objetos + "   desenhados " + this.desenhados + "   tiros " + m.tirosDisparados);
  }
}
```

`src/client.ts`:
- imports: `import { FpsHudDom } from "./hud_dom";`, `import { drawGameUI } from "@engine/ui/game_ui";`, `import { domHostPump } from "@engine/ui/dom_host";`.
- perto da linha 83: `const FPS_HUD_2D = process.env("FPS_HUD") === "2d";   // HUD draw2d antigo até a verificação do HTML` e `const fpsHudDom: FpsHudDom | null = FPS_HUD_2D ? null : new FpsHudDom();`.
- função nova, antes de `fpsQuadro`:

```ts
function fpsHudDomQuadro(hd: FpsHudDom, eu: FpsPlayerState, t1: f64): void {
  hd.travado = fpsEntrada.travado; hd.debug = fpsDebug; hd.fps = fpsApp.fps(); hd.agoraMs = t1;
  hd.msSim = fpsMsSimFrame; hd.msRender = fpsMsRender; hd.msAnim = fpsMsAnim; hd.desenhados = fpsDesenhados; hd.objetos = scene.objects.length;
  hd.atualizar(eu, fpsMundo);
  drawGameUI(hd.cena, FPS_WIN, fpsW, fpsH);   // o render do HTML entra na fila depois do 3D
}
```

(com `import { FpsPlayerState } from "./shared/player";`).
- seção do HUD (linhas 176-181): `if (fpsHudDom !== null) fpsHudDomQuadro(fpsHudDom, eu, t1); else { ...as linhas atuais do FpsHud... }`.
- depois de `fpsApp.endFrame();` (linha 184): `if (fpsHudDom !== null) domHostPump();`.

`tests/fps-quadro-gc.ts`, depois da fase `hud` (imports `FpsHudDom`, `drawGameUI`, `domHostPump`):

```ts
const hudDom = new FpsHudDom();
hudDom.fps = 60.0;
hudDom.atualizar(eu, mundo); drawGameUI(hudDom.cena, 0, 1280, 720); domHostPump();
io.print("FASE hud-dom " + n);
f = 0;
while (f < n) {
  hudDom.agoraMs = f * 16.0;
  hudDom.atualizar(eu, mundo); drawGameUI(hudDom.cena, 0, 1280, 720); domHostPump();
  f = f + 1;
}
```

`tools/build-exe.mjs`, em `ARQUIVOS`: `['assets/ui', 'assets/ui'],`.

- [ ] **Step 4: Run tests, sonda, bench e exe**

Run (na raiz do rts-fps):
```
R=../rts-uv-mundo/target/release/rts.exe
$R run tests/fps-hud-dom.ts
for t in tests/fps-*.ts tests/net-*.ts; do $R run $t || echo FALHOU $t; done
RTS_GC_DEBUG=1 $R run tests/fps-quadro-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
node tools/build-exe.mjs && tar -tf build/rts-fps-windows.zip | grep assets/ui/hud.html
```
Bench na janela, mesma sessão, com `config/controle.json` presente e `RTS_VSYNC=0`: rodar `FPS_HUD=2d ../rts-uv-mundo/target/release/examples/ui_fixture.exe src/client.ts` e depois sem `FPS_HUD`; em cada um, `python engine/tools/ws_client.py "prof on"`, esperar 20 s, `python engine/tools/ws_client.py "prof frames 1000"` e anotar a mediana do intervalo; `python engine/tools/ws_client.py "shot build/shots/hud-dom.png"` no HTML e `shot build/shots/hud-2d.png` no draw2d.
Expected: testes e suíte verdes; fase `hud-dom` sem coletas; o zip contém `assets/ui/hud.html`; mediana HTML − draw2d ≤ 0,5 ms; as duas capturas mostram o mesmo HUD (posições, cores, alerta), com o 3D visível atrás do HTML. Ler as duas PNG e comparar antes de concluir.

- [ ] **Step 5: Portão de revisão**

Revisor com diff, saídas, números e as duas capturas. Pontos: prefixo `fps`/`Fps`/`FPS_` em todo nome de topo; `src/shared/` intocado; nenhuma string por quadro com valores parados; o fallback `FPS_HUD=2d` continua funcionando; o ponteiro do submódulo aponta para o commit de `feat/domcanvas` (antes de mesclar no rts-fps, apontar para o commit publicado no `master` do rts-game).

- [ ] **Step 6: Commit (no rts-fps)**

`git add -A && git commit -m "feat(fps): HUD em HTML/CSS com DomCanvas (FPS_HUD=2d mantem o draw2d ate a verificacao)"`

---

### Task 8: Verificação com janela, documentação e pedido da fase 2 ao rts

**Files:**
- Modify: `docs/ui-do-jogo.md` (seção nova "HTML/CSS com DomCanvas"), `docs/components.md` (UI: ponteiro para a seção), `docs/skills/rts-engine-control/SKILL.md` (comando `dom`)
- Create: `docs/superpowers/issues/2026-09-27-rts-domcanvas-fase2.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-7. Não produz código.

- [ ] **Step 1: Roteiro de verificação (o "teste" desta task)**

Editor com janela (worktree `build/domcanvas`): `/c/Users/nexga/Documents/GitHub/rts-uv-mundo/target/release/examples/ui_fixture.exe main.ts` em segundo plano; esperar a porta 7777.

```
python tools/ws_client.py "clear" "spawn Cubo 0 1 0 1 2" "menu Criar/UI/DomCanvas" "addcomp DomCanvas ExemploDomContador" "gameview jogo" "shot build/shots/dom-previa.png jogo"
python tools/ws_client.py "vis DomCanvas" "shot build/shots/dom-sem.png jogo" "vis DomCanvas" "shot build/shots/dom-com.png jogo"
python tools/ws_client.py "shot diff build/shots/dom-sem.png build/shots/dom-com.png 8" "dom DomCanvas query .painel"
python tools/ws_client.py "play" "dom DomCanvas click button"
python tools/ws_client.py "dom DomCanvas query #valor" "shot build/shots/dom-play.png jogo"
python tools/ws_client.py "stop" "dom DomCanvas query #valor"
```

- [ ] **Step 2: Conferir**

Expected (ler cada PNG com a ferramenta de imagem):
- `dom-previa.png`: painel do modelo sobre o cubo, contorno tracejado (selecionado), resto da vista igual ao 3D;
- `shot diff`: a caixa da diferença fica dentro da caixa de `.painel` do `query` (fundo transparente: o HTML não pinta fora do painel);
- depois do `click`: `query #valor` com `texto="1"` no Play; depois do `stop`, `texto="0"` (a cópia não divide estado com o original);
- ordem 2D: acrescentar um `UIText` por cima (`spawn Rotulo 0 0 0 0`, `addcomp Rotulo UIText`, `setfield Rotulo UIText text "SOBRE"`) e capturar: o texto 2D aparece por cima do painel HTML.
- Com mouse real (anotar no relatório; se ninguém estiver na máquina, registrar "não verificado"): `:hover` do botão pinta `#BF616A`; com o cursor sobre o botão, o clique não chega ao pick 3D de um script que usa `mouseApertadoNoMundo`.

- [ ] **Step 3: Documentação**

`docs/ui-do-jogo.md`, seção "HTML/CSS com DomCanvas": quando usar (HUD e menus com layout) e quando o `UIText`/`UIButton` continua melhor; campos; `domCanvasDe(this.owner).documento`, guardar nós no `mount`/`onDomReload`, `setNumero`/`setText`/`setClass` só escrevem quando muda; `data-acao` → `onUIClick`; `pointer-events:none` em invólucros de tela inteira; custos medidos (tabela do spike e do bench da Task 4); limites da fase 1 (um documento por janela, sem escala real, `:hover` do quadro anterior, 2D pintado sobre o HTML também dispara o HTML, `<script>`/`<link>` fora); comando `dom`. `docs/components.md`: uma linha na parte de UI apontando para a seção. `SKILL.md`: `dom <obj> query|set|click|css|html|reload|info` e o uso de `shot ... jogo` para conferir.

`docs/superpowers/issues/2026-09-27-rts-domcanvas-fase2.md` (rascunho de issue para o repo `rts`): título "egui: renderIn com região/escala, ponteiro consumido pelo HTML e vários documentos por janela"; contexto com os números do spike; pedidos: (1) `egui.renderIn(win, doc, buf: Float64Array[x, y, w, h, escala])` com `WidgetCmd::HtmlHandleIn`, `ui` filho com `max_rect`, viewport = rect / escala, sem `allocate_space`, escala por `ui.with_visual_transform`, ponteiro `(p − origem) / escala`; (2) `dom.hoveredNode(doc)` ou retorno 1 de `renderIn` quando o ponteiro está sobre nó não raiz sem `pointer-events:none`; (3) opcional: não clonar a `DisplayList` nem criar `Rc<EguiMeasurer>` por quadro; (4) `simularMouse` para testes de UI; critérios de aceite (dois documentos ancorados por `bottom` visíveis; escala 1,5 com texto escalado; `hoveredNode` com e sem `pointer-events:none`); o que muda no rts-game depois (um documento por DomCanvas, `renderIn` por canvas em ordem de `ordem`, `escala` real, `domHostSobreUI` lê o retorno; API do `DomCanvas` e da `DomVista` inalterada).

- [ ] **Step 4: Rodar a suíte tocada**

Run:
```
npm run components:check && npm run test:components && npm run check:params && npm run docs:ws:check && npm run icons:check
node --test tests/editor-static.test.mjs
for t in tests/test_behavior_ganchos.ts tests/test_dom_css.ts tests/test_dom_host.ts tests/test_dom_canvas.ts tests/test_dom_quadro.ts tests/test_dom_recarga.ts tests/test_pacote_dom.ts tests/test_game_ui.ts tests/test_play_mode.ts tests/test_scene.ts tests/test_editor_api.ts tests/test_inspector_gui.ts; do $RTS run $t || echo FALHOU $t; done
```
Expected: tudo verde.

- [ ] **Step 5: Portão de revisão**

Revisor com as capturas, as respostas do WS e o texto da documentação. Pontos: cada afirmação da doc bate com um teste ou medida; limites da fase 1 listados; o rascunho da issue tem critérios verificáveis e não promete mudança na API do `DomCanvas`.

- [ ] **Step 6: Commit**

`git add -A && git commit -m "docs(ui): DomCanvas (uso, custos, limites da fase 1) e rascunho do pedido da fase 2 ao rts"`

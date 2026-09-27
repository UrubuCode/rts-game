# Luzes, céu, câmera e extensão por script — desenho

Data: 2026-09-26. Pedidos do usuário:
- "skybox, game object de luz, câmera controlável";
- "seria bom se déssemos para adicionar recurso na engine via script";
- "não precisávamos ficar mudando a engine, só mudar o necessário".

O desenho em seções foi aprovado na conversa com um "sim".

## 1. Princípio

O motor ganha só o que um script não consegue fazer sozinho. Isso inclui o shader, que fica no runtime; os dados que o renderer consome; a API pública; e os **pontos de extensão**. Todo o resto vem como script de pacote, usando a mesma API que um dev usaria:
- controles de câmera;
- exemplos de céu;
- ícones e gizmos de Luz e Câmera no editor;
- itens de menu;
- comandos do WebSocket.

Se um pacote precisar de algo que a API não oferece, o motor ganha esse ponto de extensão, não o recurso específico.

## 2. Hoje

- **Luz:** existe uma luz pontual só, sem cor, via `setLight(win, {x, y, z, ambient})`, fixa em `src/editor/sceneio.ts:416`. Não está na cena, não é editável e não é acessível por script. A sombra é única e direcional (`setShadow`).
- **Céu:** estrelado e fixo no shader (`crates/rts-egui/src/frame/scene3d/shader.rs`, `sky_fs`). Só liga e desliga (`setSkybox`) ou troca de cor (`setClearColor`).
- **Câmera:** o componente `Camera` (`src/engine/core/camera.ts`) tem FOV e Main e é usado por `game.ts`. Não tem near/far, fundo, viewport, ortográfica nem API de script. O editor não o desenha.
- **Extensão:**
  - componentes por script já existem (catálogo gerado pelo `tools/generate-components.mjs`, com os JSDoc `@componentCategory` etc.);
  - o editor não oferece gizmos, menus, inspector customizado nem comandos WS registrados por script;
  - `src/editor/control/dispatch.ts` é um `switch` fixo.

## 3. Runtime (repo rts, PR à parte)

**Até 8 luzes num uniform buffer.**
- **Formato:** `setLights(win, dados: Float64Array, n)`, com 16 floats por luz:
  - tipo (0 = direcional, 1 = pontual, 2 = spot);
  - posição (3);
  - direção (3);
  - cor (3);
  - intensidade;
  - alcance;
  - cosseno do ângulo interno e cosseno do ângulo externo (spot);
  - flag de sombra.
- **Shader:** laço de 0 a n. A direcional usa N·L; a pontual e o spot atenuam por `(1 − (d/alcance)²)²`, cortado em zero, e o spot ainda usa smoothstep entre os cossenos. O ambiente continua separado, e só a primeira direcional com sombra usa o shadow map atual.
- **Compatibilidade:** `setLight` antigo vira "1 luz pontual branca" e continua funcionando. `n = 0` é igual ao comportamento de hoje.

**Céu com parâmetros.**
- **Formato:** `setSky(win, dados: Float64Array)`, com:
  - modo: 0 = estrelas (o de hoje), 1 = procedural, 2 = cor, 3 = panorama;
  - cores do topo, do horizonte e do chão (9 floats);
  - direção do sol (3) e tamanho do disco;
  - intensidade das estrelas;
  - exposição;
  - id da textura do panorama (equiretangular, amostrada pela direção do raio).
- **Neblina:** `setFog(win, {cor, densidade})` exponencial no shader principal. Densidade 0 desliga.

**Câmera:**
- `setCamera` ganha `near`, `far`, `ortho` e `orthoSize`, todos opcionais, com o padrão de hoje;
- `setViewport(win, {x, y, w, h})` em fração da janela, para tela dividida. Cada câmera desenha a cena na sua região; sem chamada, vale a janela inteira.

**Custo:** as funções recebem `Float64Array` e poucos parâmetros. O shader com 8 luzes só entra quando `n > 0`.

## 4. Componentes e API (rts-game, núcleo mínimo)

**`Light`** (`src/engine/core/light.ts`, `KIND_LIGHT`)
- **Campos públicos:** `tipo` ("direcional", "pontual" ou "spot"), `cor` (0xRRGGBB), `intensidade`, `alcance`, `anguloSpot` (graus), `sombra` (boolean).
- **Pose:** posição e direção vêm do Transform. A direção é o eixo +Z local, na convenção da câmera.
- **Coleta:** a `Scene` mantém a lista de luzes em cache, como faz com `uiObjs`, atualizada ao adicionar, remover ou ativar. A cada frame, `collectLights(buf: Float64Array)` preenche o buffer e devolve n, respeitando `active`/`enabled` e o limite de 8.
- **Limite de 8:** a direcional principal vem primeiro; as demais seguem por distância à câmera, e a escolha não aloca.

**`Camera`**, ampliando a existente
- **Campos novos:** `near`, `far`, `ortografica`, `tamanhoOrto`, `fundo` ("ceu", "cor" ou "nada"), `corFundo`, `viewport` (x, y, w, h em frações) e `profundidade` (ordem de desenho).
- **Compatibilidade:** o construtor passa a aceitar zero argumentos (CLAUDE.md), e o formato salvo continua compatível.
- **API estática e de instância:**
  - `Camera.main()`;
  - `Camera.all()`;
  - `cam.screenPointToRay(x, y, out: Float64Array)`, com origem e direção;
  - `cam.worldToScreenPoint(x, y, z, out: Float64Array)`, com x, y e profundidade;
  - `cam.viewportPointToRay(u, v, out)`.
- **Parâmetros:** todos com no máximo 4 escalares mais o buffer de saída.

**Várias câmeras:** o `game.ts` desenha as câmeras ativas por ordem de `profundidade`, cada uma na sua viewport e com o seu fundo. Hoje ele desenha só a Main.

**`Ambiente`** (configurações da cena, como o `RenderSettings` da Unity)
- **Onde vive:** um objeto em `scene.ambiente`, salvo no JSON da cena como bloco `"ambiente"`:
  ```json
  { "ceu": { "modo": "procedural", "topo": [..], "horizonte": [..], "chao": [..],
             "estrelas": 0.0, "exposicao": 1.0, "textura": "" },
    "neblina": { "cor": [..], "densidade": 0.0 },
    "luzAmbiente": { "modo": "ceu" | "cor", "cor": [..], "intensidade": 0.25 },
    "sol": "" }
  ```
- **`sol`** é o nome do GameObject da luz direcional que dá a direção ao disco do sol. Vazio significa a primeira direcional.
- **Cena sem bloco** = estrelas, sem neblina e ambiente 0,25, que é o visual de hoje.
- **Scripts** leem e escrevem `scene.ambiente.ceu.topo` etc. A cena envia `setSky`/`setFog` só quando algo muda, controlado por um contador de versão.

## 5. Pontos de extensão

Tudo é declarado no próprio script, lido pelo gerador de catálogo (JSDoc, sem decorators de runtime) ou registrado em código. Nada roda no jogo exportado.

1. **`onDrawGizmos(g: Gizmos)` e `onDrawGizmosSelected(g: Gizmos)`** em qualquer `Behavior`.
   - O editor chama os dois uma vez por frame para os objetos visíveis; o segundo só no selecionado.
   - `Gizmos` é um desenhador imediato do editor: `line(a, b)` com vetores em buffers, `wireSphere(c, r)`, `wireCone`, `icon(nome, pos)` com ícone PNG do pipeline `assets/editor/icons`, e `color(rgb)`.
   - Os ícones são clicáveis. O clique seleciona o objeto dono, usando a mesma área de desenho.
   - **Custo:** os buffers de linhas são reaproveitados, sem alocação por frame.
2. **`@menuItem "Criar/Luz/Pontual"`** num método `static` sem argumentos da classe.
   - O gerador adiciona o item ao catálogo, e o menu global e o de contexto o leem, como os presets de `object_presets.ts`.
   - O método recebe a cena via API (`Editor.scene()`) e cria o objeto com `scene.createGameObject`.
   - Continua valendo que presets de menu não ficam copiados em lugar nenhum.
3. **`onInspectorGUI(ui: InspectorUI)`**: se um componente implementar, o Inspector chama o método no lugar da lista automática de campos.
   - `InspectorUI` expõe `field(nome)`, que desenha o campo automático; `slider`, `button`, `label`, `color` e `dropdown`. Todos usam controles da UIScene com IDs únicos por componente.
   - Medidas e cores vêm do `ui_config.ts`.
4. **`registerCommand(nome, ajuda, fn(partes: string[]) => string)`**: comandos do WebSocket registrados por script (módulo `@editor/api`).
   - O `dispatch.ts` consulta o registro no `default` do `switch`.
   - A resposta segue o padrão `[ok]`/`[erro]`, e o comando aparece no `help`.
   - O registro declara se o comando muta a cena (`muta: boolean`); se mutar, tira snapshot para o Desfazer.
5. **Hooks do editor**, em `Editor.on("salvar" | "abrirCena" | "entrarPlay" | "sairPlay", fn)`.

**API do editor para scripts** (`@editor/api`): `Editor.scene()`, `Editor.selection()`, `Editor.select(obj)`, `Editor.snapshot(rotulo)`, `Editor.log(msg)`.

- **Import de scripts de editor:** um script de jogo pode importar `@editor/api`, mas as chamadas só funcionam no editor. No jogo exportado viram no-ops, sem erro.
- **Anotação por arquivo:** `@editorOnly` em JSDoc no topo do arquivo diz ao build que ele fica fora do jogo exportado.

## 6. Pacotes como script (`assets/pacotes/`)

- **`luz/`:** `LuzGizmos` (sol, lâmpada, cone do spot, esfera de alcance), feito com `onDrawGizmos`. Os itens `Criar/Luz/Direcional|Pontual|Spot` via `@menuItem`. Comandos `luz <obj> set <campo> <valor>` e `luz add <tipo> x y z` via `registerCommand`.
  - `Light` fica no núcleo, porque é dado do renderer.
  - O desenho no editor, o menu e os comandos ficam no pacote.
- **`camera/`:**
  - scripts de controle: `CameraPrimeiraPessoa`, `CameraOrbita`, `CameraSeguir` (suavização por amortecimento crítico) e `CameraRTS`;
  - `CameraGizmos` (ícone e frustum);
  - `Criar/Câmera` via `@menuItem`;
  - comandos `camera <obj> set …`, `camera main <obj>` e `camera ray x y`.
- **`ambiente/`:**
  - `AmbienteInspector` usa `onInspectorGUI` num componente de painel, ou ganha um item de menu "Janela/Ambiente" que seleciona um objeto oculto "Ambiente" da UIScene; escolher entre os dois no plano;
  - `CicloDoDia` gira o sol e interpola as cores do céu;
  - comandos `ambiente set <campo> <valores>` e `ambiente ceu <modo> [textura]`.

Os pacotes seguem as mesmas regras de qualquer script: campos públicos no Inspector, catálogo gerado, `npm run components`.

## 7. Editor, fora da API

- **Janela "Jogo"**, o *Game view* da Unity. A aba "Jogo" já existe (`src/editor/workspace_views.ts`) e hoje mostra a Main. Passa a renderizar exatamente como o jogo exportado:
  - todas as câmeras ativas, por `profundidade`, cada uma com a sua viewport e o seu fundo;
  - um seletor de proporção (Livre, 16:9, 4:3), com a imagem em faixas quando a proporção não bate;
  - um seletor "Câmera" para ver só uma câmera específica, útil em tela dividida.

  Sem nenhuma câmera, continua a mensagem de hoje.

- **Pré-visualização da câmera selecionada:** um quadro pequeno no canto da viewport.
  - O runtime desenha a cena duas vezes, na viewport principal e no retângulo do canto (via `setViewport`).
  - Medidas no `ui_config.ts`; liga e desliga pelo menu.
- **Botão "Alinhar com a vista"** no Inspector da `Camera`: copia a pose da câmera do editor para a câmera selecionada, com Desfazer.

## 8. Custos e testes

**Custos**
- Luzes: coleta sem alocação, no máximo 8 por frame.
- Céu e neblina: enviados só quando mudam.
- Gizmos: só no editor, com buffers reaproveitados.
- Cena sem nada disso: mesmo custo de hoje, com uma medição de referência antes e depois.

**Testes sem janela**
- **Luzes:** coleta respeitando `active`, o limite de 8 e a ordem, com a direcional principal primeiro.
- **Câmera:**
  - `screenPointToRay` no centro da tela dá o `fwd` da câmera;
  - `worldToScreenPoint` de um ponto à frente dá o centro;
  - ida e volta entre os dois;
  - ortográfica;
  - viewport.
- **`Ambiente`:** ida e volta no JSON da cena; cena sem bloco dá o padrão de hoje.
- **Extensão:**
  - `registerCommand` aparece no `help`, responde e tira snapshot só se `muta`;
  - `@menuItem` gera a entrada no catálogo e o menu cria o objeto;
  - `onDrawGizmos` é chamado no editor e nunca no jogo;
  - `onInspectorGUI` substitui a lista de campos;
  - os hooks disparam no salvar e no Play.
- **Pacotes:**
  - `CameraOrbita` mantém a distância do alvo;
  - `CameraSeguir` converge sem ultrapassar;
  - `CameraRTS` respeita os limites do zoom;
  - `CicloDoDia` gira o sol.
- **Regressão:** `check:params`, os scripts de componentes e as suítes do editor.

**Testes com janela** (captura só da janela, via PrintWindow)
- céu procedural com sol;
- 3 luzes pontuais coloridas;
- spot;
- neblina;
- frustum e ícones selecionáveis;
- tela dividida com 2 câmeras.

## 9. Ordem de entrega

1. rts: `setLights`, `setSky`, `setFog`, câmera (near, far, ortográfica) e `setViewport`, com os testes do scene3d.
2. rts-game, núcleo: `Light` e a coleta; `Camera` ampliada com a API; `Ambiente` na cena, com salvar e carregar; `game.ts` com várias câmeras.
3. rts-game, pontos de extensão: `Gizmos`/`onDrawGizmos`, `@menuItem` no gerador, `onInspectorGUI`, `registerCommand`, hooks, `@editor/api` e `@editorOnly` no build.
4. Pacotes: `luz/`, `camera/` e `ambiente/`, com gizmos, menus e comandos.
5. Editor: pré-visualização da câmera e botão "Alinhar com a vista".
6. Verificação com janela e medição de custo.

## 10. Fora deste desenho

- Sombras de luzes pontuais e spot (cubemap/atlas).
- Iluminação global e lightmaps.
- Reflexos e HDR.
- Pós-processamento.
- Editor visual de grafo.
- Recarga de script sem reiniciar o editor (limitação atual do runtime).

# Workspace: Cena/Jogo, Console e documento

Os novos painéis são Behaviors com controles GameObject criados por `EditorUI`/`UIScene`, separados da cena do jogo. Medidas e textos ficam em `ui_config.ts`; IDs são compartilhados entre painéis para não colidir no input nativo.

## Uso

- **Cena** mantém a câmera livre e ferramentas. **Jogo** usa as Cameras ativas da cena (veja abaixo), sem gizmos nem seleção na viewport. Sem Camera, mostra uma mensagem. Alternar a aba não inicia Play nem altera a câmera livre.
- **Console** tem barra compacta, ícones PNG, contadores e filtros independentes de informação/aviso/erro. Agrupar reúne mensagens idênticas sem esconder sua contagem. Busca inclui texto e origem. A seleção é preservada quando novos logs chegam; a seta controla acompanhar a última mensagem. Detalhes têm quebra de linha e rolagem. Usa o histórico limitado a 512 entradas. `logError(mensagem, caminho, linha)` permite abrir a origem no editor configurado; erros capturados sem localização não inventam uma linha.
- **Arquivo** oferece Abrir, Nova cena, Salvar e Salvar como. O asterisco indica alterações nos objetos, nome ou iluminação. Mover apenas a câmera livre não marca alteração. Abrir/nova cena pela UI pede Salvar e continuar, Descartar ou Cancelar.
- **Build** captura a cena atual em `build/editor-build-<timestamp>/`, compila `game.ts` com RTS e copia assets/cenas para a mesma pasta. Não salva por cima da cena de autoria. O Console recebe resultado e caminho; `output.log` guarda a saída completa. Para compartilhar o jogo, envie a pasta inteira (EXE, `.rtsdata` e assets), não apenas o EXE.

O build precisa de Node.js, dependências npm e RTS CLI. `RTS_COMPILER` tem prioridade; a descoberta também procura o checkout irmão `rts`, inclusive quando o projeto está em um worktree dentro de `build/`.

## Aba Jogo, prévia da câmera e Ambiente

- **Várias câmeras.** A aba Jogo desenha todas as `Camera` ativas da cena, em
  ordem de `profundidade` (a menor primeiro). Cada câmera ocupa o próprio
  retângulo `viewportX/Y/W/H` (0..1). Duas câmeras com `0 0 0.5 1` e
  `0.5 0 0.5 1` dão tela dividida. O limite é de 8 vistas.
- **Proporção.** O seletor ao lado das abas oferece Livre, 16:9 e 4:3. Fora de
  Livre, a área do jogo fica centralizada, com faixas nas laterais ou em cima e
  embaixo.
- **Seletor de câmera.** Mostra Todas ou uma câmera só, que então ocupa a área
  inteira.
- **Prévia.** No menu Janela, "Pré-visualização da câmera" liga um quadro no
  canto inferior direito da vista de Cena. O quadro mostra o que a câmera
  selecionada vê e tem moldura e título. Não muda o retângulo da câmera.
- **Janela/Ambiente** (pacote `assets/pacotes/ambiente/`) abre o Ambiente da cena
  no Inspector: céu (modo, cores, exposição, estrelas, textura do panorama),
  neblina (cor e densidade) e luz ambiente (modo, cor e intensidade). As mudanças
  são salvas com a cena, no bloco `"ambiente"`.
- **Controles de jogo no Play** (`CameraPrimeiraPessoa`, `CameraRTS` etc.) só
  recebem teclado e mouse com a aba Jogo ativa. Com um campo de texto ou de
  número do Inspector em edição, ou com um menu aberto, a entrada fica com o
  editor.
- **Camera no Inspector:** FOV em graus, "Alinhar com a vista" (copia a pose da
  vista de Cena, com Desfazer) e o frustum da câmera selecionada na vista de Cena.
  Os ícones de luz e de câmera são clicáveis e selecionam o dono.

### Comandos da porta WS desta etapa

| Comando | O que faz |
|---|---|
| `gameview [jogo\|cena]` | troca a aba; sem argumento, mostra o estado (aba, proporção, câmera, prévia) |
| `gameview proporcao livre\|16:9\|4:3` | proporção da aba Jogo |
| `gameview camera todas\|<obj>` | todas as câmeras ou só uma |
| `gameview previa on\|off` | prévia da câmera selecionada |
| `gizmoat <x> <y>` | clica no ícone de gizmo nesse pixel (mesmo caminho do clique do mouse) |
| `menu [caminho]` | lista os itens `@menuItem` ou executa um (`menu Criar/Luz/Pontual`) |
| `luz add <tipo> <x> <y> <z>` / `luz <obj> set <campo> <valor>` / `luzes` | cria ou edita uma luz (cor em `#RRGGBB`, ângulo do spot em graus) e lista as luzes |
| `camera add` / `camera main <obj>` / `camera ray <x> <y>` / `camera <obj> set <campo> <valores>` / `camera <obj> alinhar` / `cameras` | câmeras: criar, principal, raio da tela, campos (`fov` em graus, `fundo`, `cor`, `viewport x y w h`, `profundidade`), alinhar com a vista e listar |
| `ambiente set <campo> <valores>` / `ambiente ceu <modo> [textura]` / `ambienteinfo` | edita o Ambiente com Desfazer (mesma validação do JSON) e mostra o bloco em JSON |
| `vsync 0\|1` | liga/desliga o vsync com o editor aberto (antes não desligava em tempo de execução) |
| `prof on\|off\|reset` / `prof` | perfil por seção do quadro |

`luz`, `camera` e `ambiente` são registrados pelos pacotes com
`registerCommand` (veja `docs/components.md`). `help` e `doc` listam todos.

### Medir o custo do quadro

- `RTS_VSYNC=0` no ambiente abre o editor ou o jogo sem vsync, para medir o
  custo real do quadro. `vsync 0` pela porta WS faz o mesmo com a janela aberta.
- `node bench/claude-frame-bench.mjs [--runs 5] [--frames 5000] [--only ed-padrao,jogo-vitrine]`
  abre uma janela por execução, com `RTS_VSYNC=0` e `RTS_GC_DEBUG=1`, e mede
  5000 quadros depois do aquecimento. Relata por cenário:
  - parede e CPU do TS por quadro;
  - coletas do GC a cada 1000 quadros e objetos de lixo por quadro;
  - pior quadro e quadros acima de 10 ms;
  - a carga da máquina (typeperf).
- `RTS_JANELA_X/Y` põe a janela em outro monitor, e `RTS_TITULO` dá um título
  próprio para capturas.
- Sonda de alocação sem janela: `tests/claude-test-frame-gc.ts` e
  `tests/claude-test-luzes-gc.ts` (luzes, ambiente, câmeras, gizmos e controles).
  Rode com `RTS_GC_DEBUG=1` e conte as linhas `rts-gc` entre os marcadores. O
  esperado é 0.
- Compare antes e depois na mesma sessão: com a máquina ocupada (jogo, vídeo,
  outra compilação), os ms sobem, mas a contagem de GC não muda.

## Proteções e limites

Salvar reserva um temporário exclusivo junto ao destino, verifica seu conteúdo, renomeia e verifica o destino. Uma falha conserva o documento como alterado. JSON e hierarquia inválidos são rejeitados antes de substituir objetos. Estado ativo, rotação Z e enabled/collapsed dos componentes são preservados no roundtrip. Salvar/build/troca de documento são bloqueados durante Play.

A confirmação cobre trocas pela UI e arrasto de cenas. Os comandos explícitos de automação `clear`/`loadscene` continuam imediatos. Fechar pelo X do Windows ainda não pede confirmação nem recupera alterações após crash: use Salvar antes de fechar. Não há autosave.

A aba Jogo e a prévia da câmera desenham no render da janela, recortado por viewport (sem render target dedicado): a proporção escolhida é uma área centralizada, não uma resolução final. Erros de script capturados durante update pausam Play e aparecem no Console, mas não há extração automática de stack/source map. O Console não captura todo stdout nativo.

## Verificação

- `npm run test:components` e `npm run components:check`.
- RTS: `tests/test_scene_document.ts`, `tests/test_workspace_console.ts`, `tests/test_editor_build.ts`, além das suítes existentes de componentes, UI, Play e cena.
- Aba Jogo, luzes, céu e câmeras: `tests/test_game_view.ts`, `tests/test_light.ts`, `tests/test_camera_api.ts`, `tests/test_ambiente.ts` e `tests/test_gizmos.ts`. Com o editor aberto (`RTS_TITULO="Engine RTS T11"`), `bash tools/claude-verificar-luzes.sh` repete a verificação com janela só pela porta WS e grava as capturas em `build/claude-luzes/`.
- Build real pela janela: conclusão no Console, editor permanecendo aberto; alternância de abas com e sem Camera; Nova cena/Cancelar preservando objetos. O seletor nativo Salvar como e abertura na linha do editor externo ainda requerem validação manual.

Não houve push nem alteração do workflow GitHub neste lote.

## Ícones e referência visual

A organização foi inspirada no [Console do Unity 6](https://docs.unity3d.com/6000.0/Documentation/Manual/Console.html): ferramentas e busca no topo, filtros com contadores, lista plana e detalhes separados. Não há cópia dos assets proprietários: os sete ícones são desenhos originais em `assets/editor/icons/source.json`, rasterizados deterministicamente por `npm run icons` em PNG RGBA de 32 px e exibidos em 16 px. `npm run icons:check` verifica se os arquivos estão atualizados.

O carregador de imagens do editor lê PNG RGBA8 sem interlace, descomprime por `node:zlib`, aplica os filtros PNG e mantém os pixels em cache. `render.image` faz o desenho real com alpha. Testes: `tests/test_icon_images.ts` (decodificação, transparência, antialias, cache e dados inválidos) e `tests/test_workspace_console.ts` (filtros independentes, agrupamento, seleção estável e toolbar estreita). Imagens faltantes geram um aviso único; não são tentadas em todo frame.

Para scripts, use `import { Debug } from "@engine/debug"` com `Debug.Log`, `Debug.LogWarning` e `Debug.LogError`. Essa classe delega ao logger existente; `logInfo`, `logWarn` e `logError` permanecem compatíveis. O logger pertence à engine, não à UI. No jogo separado, ele registra em memória e stdout; ainda não grava automaticamente um arquivo nem transmite esses logs para o editor. `console.log`/`io.print` não são interceptados. `tests/test_debug.ts` verifica a mesma fila sendo consumida pelo Console.

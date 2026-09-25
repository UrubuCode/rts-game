# Workspace: Cena/Jogo, Console e documento

Os novos painéis são Behaviors com controles GameObject criados por `EditorUI`/`UIScene`, separados da cena do jogo. Medidas e textos ficam em `ui_config.ts`; IDs são compartilhados entre painéis para não colidir no input nativo.

## Uso

- **Cena** mantém a câmera livre e ferramentas. **Jogo** usa a Camera ativa da cena, sem gizmos nem seleção na viewport. Sem Camera, mostra uma mensagem. Alternar a aba não inicia Play nem altera a câmera livre.
- **Console** tem barra compacta, ícones PNG, contadores e filtros independentes de informação/aviso/erro. Agrupar reúne mensagens idênticas sem esconder sua contagem. Busca inclui texto e origem. A seleção é preservada quando novos logs chegam; a seta controla acompanhar a última mensagem. Detalhes têm quebra de linha e rolagem. Usa o histórico limitado a 512 entradas. `logError(mensagem, caminho, linha)` permite abrir a origem no editor configurado; erros capturados sem localização não inventam uma linha.
- **Arquivo** oferece Abrir, Nova cena, Salvar e Salvar como. O asterisco indica alterações nos objetos, nome ou iluminação. Mover apenas a câmera livre não marca alteração. Abrir/nova cena pela UI pede Salvar e continuar, Descartar ou Cancelar.
- **Build** captura a cena atual em `build/editor-build-<timestamp>/`, compila `game.ts` com RTS e copia assets/cenas para a mesma pasta. Não salva por cima da cena de autoria. O Console recebe resultado e caminho; `output.log` guarda a saída completa. Para compartilhar o jogo, envie a pasta inteira (EXE, `.rtsdata` e assets), não apenas o EXE.

O build precisa de Node.js, dependências npm e RTS CLI. `RTS_COMPILER` tem prioridade; a descoberta também procura o checkout irmão `rts`, inclusive quando o projeto está em um worktree dentro de `build/`.

## Proteções e limites

Salvar reserva um temporário exclusivo junto ao destino, verifica seu conteúdo, renomeia e verifica o destino. Uma falha conserva o documento como alterado. JSON e hierarquia inválidos são rejeitados antes de substituir objetos. Estado ativo, rotação Z e enabled/collapsed dos componentes são preservados no roundtrip. Salvar/build/troca de documento são bloqueados durante Play.

A confirmação cobre trocas pela UI e arrasto de cenas. Os comandos explícitos de automação `clear`/`loadscene` continuam imediatos. Fechar pelo X do Windows ainda não pede confirmação nem recupera alterações após crash: use Salvar antes de fechar. Não há autosave.

A aba Jogo ainda usa o render full-window com painéis sobrepostos; não é uma prévia de resolução/aspecto final com render target dedicado. Erros de script capturados durante update pausam Play e aparecem no Console, mas não há extração automática de stack/source map. O Console não captura todo stdout nativo.

## Verificação

- `npm run test:components` e `npm run components:check`.
- RTS: `tests/test_scene_document.ts`, `tests/test_workspace_console.ts`, `tests/test_editor_build.ts`, além das suítes existentes de componentes, UI, Play e cena.
- Build real pela janela: conclusão no Console, editor permanecendo aberto; alternância de abas com e sem Camera; Nova cena/Cancelar preservando objetos. O seletor nativo Salvar como e abertura na linha do editor externo ainda requerem validação manual.

Não houve push nem alteração do workflow GitHub neste lote.

## Ícones e referência visual

A organização foi inspirada no [Console do Unity 6](https://docs.unity3d.com/6000.0/Documentation/Manual/Console.html): ferramentas e busca no topo, filtros com contadores, lista plana e detalhes separados. Não há cópia dos assets proprietários: os sete ícones são desenhos originais em `assets/editor/icons/source.json`, rasterizados deterministicamente por `npm run icons` em PNG RGBA de 32 px e exibidos em 16 px. `npm run icons:check` verifica se os arquivos estão atualizados.

O carregador de imagens do editor lê PNG RGBA8 sem interlace, descomprime por `node:zlib`, aplica os filtros PNG e mantém os pixels em cache. `render.image` faz o desenho real com alpha. Testes: `tests/test_icon_images.ts` (decodificação, transparência, antialias, cache e dados inválidos) e `tests/test_workspace_console.ts` (filtros independentes, agrupamento, seleção estável e toolbar estreita). Imagens faltantes geram um aviso único; não são tentadas em todo frame.

Para scripts, use `import { Debug } from "@engine/debug"` com `Debug.Log`, `Debug.LogWarning` e `Debug.LogError`. Essa classe delega ao logger existente; `logInfo`, `logWarn` e `logError` permanecem compatíveis. O logger pertence à engine, não à UI. No jogo separado, ele registra em memória e stdout; ainda não grava automaticamente um arquivo nem transmite esses logs para o editor. `console.log`/`io.print` não são interceptados. `tests/test_debug.ts` verifica a mesma fila sendo consumida pelo Console.

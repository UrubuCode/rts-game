# Rotas, agentes e terreno — primeira etapa

## Rotas e estados

Adicione `RoutePath` e `RouteAgent` ao mesmo GameObject. O caminho usa pontos XZ relativos à posição inicial do objeto; Y permanece inalterado. Configure no inspector a quantidade de pontos e, para cada um, X, Z, pausa em segundos e os índices de destinos separados por vírgula. Novos pontos começam sem conexões. Linhas e esferas do gizmo mostram o caminho quando o componente está selecionado.

`RouteAgent` configura velocidade, ponto inicial, semente de escolha e velocidade angular. A máquina de estados é `WAIT → TURN → WALK`: espera no ponto, escolhe uma conexão permitida, gira e segue o segmento. Evita voltar imediatamente pela conexão anterior quando há alternativas. A semente mantém as escolhas reproduzíveis. Nós sem saída ficam parados. Desabilitar o agente ou o caminho interrompe o movimento. Alterar o grafo pelo inspector reinicia o agente na rota original.

O controlador sem dependência de janela está em `engine/src/engine/core/route_motion.ts`; pode ser usado diretamente por outros sistemas. A cidade usa os componentes nos 20 pedestres e o mesmo controlador nos 8 carros. Personagens compartilham os modelos existentes e usam walk/idle; o ciclo de caminhada acompanha a distância percorrida. Rotas de pedestres são separadas em trechos de calçada; carros têm faixas separadas e retornos nos extremos.

Esta etapa não fornece NavMesh, A*, desvio dinâmico, semáforos, percepção, interação com o jogador ou editor visual de estados. Carros giram nos pontos de retorno, sem física de direção, e as rodas ainda não giram. Os grafos são configurados pelos campos do inspector ou por código, sem arraste dos pontos na viewport. A visualização dos novos controles no editor completo ainda precisa de revisão manual; fábrica, metadados e serialização foram testados.

## Terreno

Adicione `Terrain` a um GameObject sem outro renderer. O componente gera uma grade de alturas, normais e UVs, preserva o relevo ao alterar a resolução e libera a malha GPU anterior quando precisa reconstruí-la. Tamanho permitido: 1–2048 unidades; resolução: 8–128 células por lado. O material padrão é PBR; um componente Material no objeto pode substituir esse padrão.

No inspector, configure o centro X/Z, raio e força do pincel e use **Elevar relevo**, **Rebaixar relevo** ou **Aplainar tudo**. As alterações passam pelo gancho de desfazer do inspector. O gizmo mostra a região do pincel. As alturas são armazenadas junto à cena; identificadores GPU não são salvos.

Para esculpir diretamente com o mouse, use a demonstração dedicada:

```powershell
.\run-pbr.ps1 -Scene terrain
```

- Botão esquerdo sobre o terreno: elevar.
- Shift + botão esquerdo: rebaixar.
- Roda do mouse: mudar raio.
- F5: salvar `assets/pbr/terrain.heightmap.json`; a demonstração carrega esse arquivo na próxima abertura.
- Botão direito + mouse: olhar; WASD e Q/E: mover; R: restaurar câmera; Esc ou X: fechar.

O pincel na viewport pertence à demonstração dedicada nesta etapa. No editor principal, a edição ocorre pelos controles do inspector. Ainda faltam collider de heightfield, camadas de textura, pintura de vegetação, LOD/chunks, streaming e ferramentas de erosão. Não é paridade com um sistema de terreno de produção.

## Verificação

Passaram `tests/pbr-city-motion.ts`, `tests/route-components.ts`, `tests/terrain.ts` e as regressões PBR de serialização. Os testes cobrem transições, conexões permitidas, escolhas determinísticas, pausa/desativação, dados inválidos, normais, índices da malha e preservação das alturas. As capturas reais estão em `build/pbr-city-life.png` e `build/pbr-terrain.png`.

`tools/prepare-pbr-interaction-tests.mjs` gera harnesses a partir das demonstrações reais. Eles verificam Esc na cidade/pátio e, no terreno, pincel com entrada simulada, F5, conteúdo salvo e encerramento por Esc. Devem ser executados com o runtime PBR e `RTS_PBR_FRAMES=30` como limite de segurança. Usam `build/terrain-interaction.json`, separado dos arquivos do usuário.

O registro de componentes foi regenerado com o gerador já existente no checkout de auditoria. Uma cópia do gerador está agora em `engine/tools/generate-components.mjs`, com dependência de desenvolvimento TypeScript 5.9.3 em `engine/package.json`. Depois de instalar essa dependência dentro de `engine`, use `npm run generate:components`. `engine/tsconfig.json` mantém os aliases apontando para esta cópia da engine.

As alterações permanecem locais na branch `feature/render-pbr`; não houve commit ou push. `patches/render-pbr-engine.patch` registra as mudanças de `engine/src` sobre a base preservada. Ferramentas, manifesto, configuração, exemplos, testes e documentação são arquivos adicionais fora desse patch.

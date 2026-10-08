# Consolidação geral da engine

Estado: em implementação. Base histórica da revisão: `103e87a`.

**Atualização de 08/10/2026:** a [auditoria da fundação](engine-foundation-audit-2026-10-08.md) confirmou divergência entre editor/jogo, carga parcialmente síncrona, referências de materiais retidas e hierarquia 3D incompleta. A ordem operacional vigente é o [plano F00–F12](engine-foundation-plan.md). A tabela E abaixo preserva o escopo histórico e não substitui os critérios de aceite novos.
Este documento coordena o trabalho geral; o [plano naval](superpowers/plans/2026-10-02-water-navigation-foundation.md)
fica subordinado às dependências compartilhadas, sem duplicar implementações.

## Ordem de entrega

| Etapa | Estado | Entrega / aceite |
|---|---|---|
| E01 | Em andamento | Runtime fixado, build AOT editor/jogo, smoke e bundle reproduzível; falhar antes de publicar combinação incompatível |
| E02 | Parcial: sondas e profiler CPU | Sondas completas, baseline controlado e profiler CPU/GPU/memória; eliminar alocações estáveis e corrigir regressões confirmadas |
| E03 | Incompleto, reproduzido na auditoria | Transform com orientação completa compartilhada por hierarquia, render, picking, gizmos, serialização e física |
| E04 | Parcial | Física angular, formas orientadas, contratos de backend e colisões contínuas nos casos críticos |
| E05 | Parcial: workers e cache, pausas restantes | Carregamento de modelos/texturas em background, cancelamento e upload fracionado com orçamento |
| E06 | Pendente | Identidade estável de assets, referências, dependências, reimportação e migração de cenas |
| E07 | Parcial, integração pendente | Terreno, vegetação, água, colisão e alterações persistentes sob o mesmo streaming/orçamento |
| E08 | Parcial: input básico e WorldPlayer | Ações de entrada configuráveis e controlador de personagem reutilizável, com rampas/degraus/plataformas móveis |
| E09 | Rotas autorais apenas | Busca de caminho, atualização por chunks, obstáculos dinâmicos e desvio de agentes com custo medido |
| E10 | Parcial | Materiais transparentes, IBL/reflexos e sombras/LOD estáveis, com presets e orçamento gráfico |
| E11 | Parcial: protocolo e componentes | Replicação completa, autoridade, reconciliação e entrada tardia; expandir a rede existente |
| E12 | Pendente | Produzir e exportar dois jogos de gêneros diferentes usando os mesmos sistemas, sem copiar exceções das demos |

Cada etapa terá mudanças pequenas, testes, métricas quando aplicável e atualização
de documentação. Não marcar uma etapa concluída porque um arquivo ou uma demo existe.
O trabalho não termina com E01; as etapas restantes continuam explícitas neste registro.

## Regras de integração

- Build de distribuição usa `runtime.lock.json`, nunca um release `latest` implícito.
- Estado de autoria, estado de execução e handles nativos continuam separados.
- Recursos novos precisam de editor, cena salva, Play/Stop e descarte idempotente.
- Um sistema integra cada entidade; demos fornecem conteúdo e comandos, não outro motor de física.
- Trabalho assíncrono publica revisões atomicamente, descarta resultados antigos e limita filas/memória.
- APIs gerais permanecem independentes de barco, FPS, cidade ou jogo voxel.
- Compatibilidade de cenas e arquivos exige versões e testes de migração.
- Mudanças de caminho por quadro exigem sondas de 200 mil iterações e comparação controlada; carga concorrente invalida conclusões de desempenho.
- O build exportado precisa ser testado fora da estrutura de fontes e das worktrees.

## E01: implementação e verificação

O contrato identifica repositório, commit nativo, versão Rust e SHA-256 do patch
normalizado para LF. A preparação cria checkout isolado por identidade do lock,
recusa alterações posteriores e constrói CLI e staticlib da mesma fonte.
Um manifesto registra hashes dos dois artefatos. O build valida os hashes e
passa explicitamente o archive correto ao compilador.

O CI verifica os componentes, prepara o runtime, executa teste de capacidades
JIT/AOT, compila editor/jogo e exige todos os arquivos obrigatórios antes de
empacotar. O bundle inclui a origem do runtime. Execução de pull request não
publica release.

Critério ainda pendente antes de encerrar E01: execução do novo workflow remoto.
Testes locais não equivalem a aprovação do CI remoto. A distribuição ainda requer
Node.js e ferramentas Windows de linkedição na máquina de desenvolvimento.

## Como preparar o runtime

No Windows x64, com Node, Git, toolchain Rust especificada no lock e ferramentas
MSVC disponíveis:

```powershell
npm ci
npm run runtime:prepare
npm run runtime:check
npm run build:editor
npm run build:game
```

`npm run runtime:prepare -- --debug` seleciona a variante de desenvolvimento.
`--prepare-only` valida checkout/patch sem compilar nem selecionar artefatos.
O build continua sem compilador embutido: eval/new Function não são adicionados.
Depois de alterar o patch, atualizar conscientemente seu hash no lock e preparar
o novo runtime; uma seleção antiga deve falhar. `RTS_COMPILER` só aceita um
diretório com manifesto e hashes compatíveis.

As demos via ui_fixture continuam úteis como ferramentas de desenvolvimento;
elas não substituem a validação dos executáveis distribuídos.

O pacote da IDE também leva o compilador externo, staticlib, fontes e ferramentas
de geração. O compilador embutido continua desativado nos executáveis; são duas
decisões independentes. Dependências e instruções: [distribuição da IDE](editor-distribution.md).

## Evidências locais registradas

- Patch aplicado em checkout limpo da revisão fixada.
- Teste de capacidades passou via runtime e executável AOT independente.
- Editor e jogo completos compilaram e encerraram após smoke de dez quadros.
- Sonda naval de 200 mil iterações terminou sem coletas entre `SAILING_GC_BEGIN`
  e `SAILING_GC_END`. Isso não substitui o baseline de tempo de quadro de E02.
- 16 testes do gerador de componentes e quatro testes do contrato passaram;
  catálogo e verificação de parâmetros também passaram.
- Preparação completa em debug passou; editor e jogo recompilados pelo contrato.
- Pacote criado fora da árvore do projeto: `tools/editor-build.mjs` concluiu
  uma exportação usando o compilador incluído, sem `RTS_COMPILER`. O jogo exportado
  carregou o snapshot em `assets/scene.json` e encerrou após dez quadros.

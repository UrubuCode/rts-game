# Base de renderização e mundo procedural

A entrega integra materiais PBR, carregamento com progresso, terreno editável,
rotas, cidade com pedestres/carros e mundo contínuo com worker nativo e cache.
A prioridade desta etapa foi limitar recursos, reduzir desenho por visibilidade
e distância e sincronizar colisões estáticas com a publicação dos chunks.

## Validação

- 15 testes direcionados passaram: recursos, cache, LOD, mundo, colisões,
  jogador, worker, materiais, glTF, serialização, movimento da cidade, rotas,
  terreno, carregamento de cenas e modelos.
- Catálogo de componentes regenerado; verificação e 16 testes do gerador passaram.
- Teste com GPU passou: rotação sem regeneração, retorno com os mesmos handles,
  liberação integral do orçamento e colisores, encerramento idempotente.
- O runtime teve 56 testes de biblioteca aprovados, incluindo pixels PBR em GPU.
- A sonda `claude-test-frame-gc.ts` terminou sem coletas entre os marcadores
  de quadro; `world-frame-gc.ts` também passou 200 mil passos sem coleta.
- Benchmark curto da cena padrão `jogo-vitrine`, mesmo runtime debug, 300
  quadros e 60 de aquecimento, uma execução por versão: média antes 6,11 ms,
  depois 7,52 ms; CPU TS 5,43/6,57 ms; zero GC em ambas. A carga média da
  máquina mudou de 25,73% para 32,47%. A amostra posterior foi mais lenta;
  esse ensaio não demonstra ganho de desempenho nem isola uma regressão.

O teste legado FPS de resistência continua falhando em dois limites: penetração
máxima de 0,0735289 (limite 0,05) e mediana de tick de 17,52 ms (meta 4 ms, debug).
A comparação no código anterior, commit 2749d9e, com o mesmo runtime confirmou
a mesma penetração e mediana de 17,72 ms. Em ambos: 3600 ticks sem NaN e 227 tiros.
Essas falhas preexistentes não foram corrigidas nesta entrega.

## Próximas etapas

LOD de terreno e HLOD/impostores para ampliar a distância visível; IBL mais
fiel, probes e iluminação/reflexos avançados; persistência de alterações por
chunk e física geral integrada ao streaming. A base atual não equivale ao
conjunto de recursos de uma engine comercial completa.

O runtime nativo é distribuído como patch fixado em uma revisão: veja
[preparação e execução](render-pbr.md). O binário oficial antigo não incorpora
automaticamente esse patch.

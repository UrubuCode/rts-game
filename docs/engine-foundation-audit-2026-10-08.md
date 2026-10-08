# Auditoria da base da engine — 08/10/2026

## Conclusão

A engine já tem componentes, editor, renderização PBR, física com múltiplos backends, áudio, animação, workers, streaming e um protocolo de rede. Isso constitui uma base de prototipagem, mas ainda não uma fundação consolidada para produzir jogos diferentes com comportamento previsível.

O problema principal é a integração: caminhos diferentes executam tarefas equivalentes com contratos diferentes. Um recurso funcionar numa demonstração, no Inspector ou num teste isolado não significa que funciona igualmente no jogo exportado, sob cancelamento, falta de memória ou troca de cena.

A ordem de implementação está em [Plano de consolidação](engine-foundation-plan.md). O [roadmap anterior](engine-roadmap.md) continua como histórico; esta auditoria atualiza prioridades e critérios. Novos efeitos de realismo não devem preceder os bloqueios F00–F05.

## Atualização após o primeiro lote

O defeito A04 de propriedade dos materiais foi corrigido e passou por 50 ciclos na GPU. A07 está protegido pelo runner comum, mas o comportamento nativo permanece. A auditoria abaixo preserva o diagnóstico original; progresso e pendências estão no [registro de execução](engine-foundation-plan.md#registro-de-execução--primeiro-lote).

## Escopo e grau de certeza

Inspeção do checkout build/realism-main, HEAD 0d7e4e5 mais todas as mudanças locais, incluindo AdaptiveWater. A revisão leu entradas editor/jogo, carregadores, recursos, transforms, publicação de mundo, física, entrada, serialização, CI e documentação especializada. Não houve reexecução de toda a suíte, medição nova de todas as cenas nem verificação do CI remoto.

- **Reproduzido:** execução local específica nesta auditoria.
- **Código:** caminho confirmado pela leitura, sem reproduzir todas as consequências em um jogo completo.
- **Histórico:** medição anterior, com ambiente e limites registrados nos documentos de origem.
- **Não encontrado:** busca e inspeção não identificaram um contrato geral; não significa que nenhum experimento exista em outro checkout.

Somente documentos foram alterados nesta revisão. As sondas temporárias estão em build/ e os problemas abaixo continuam pendentes de correção.

## Bloqueios prioritários

### A01 — Editor e jogo não compartilham o mesmo ciclo de execução

**Código.** [main.ts](../main.ts) usa stepsFor/stepMore e [sim_step.ts](../src/editor/sim_step.ts) atualiza com FIXED_DT. [game.ts](../game.ts), linha 139 na revisão auditada, chama scene.update(dts) com delta variável; o backend físico importa FIXED_DT. A entrada exportada em tools/game-build/entry.ts importa esse game.ts.

Consequência: gameplay, física, corrotinas e comportamento sob FPS variável podem diferir entre Play e executável. A prova de aceitação deve rodar a mesma cena/entrada nos dois caminhos, não só compilar ambos.

Além disso, game.ts depende de @editor/control/session e @editor/sceneio. Precisamos de um núcleo de execução, serialização e contexto de mundo independente do editor, com adaptadores de UI por fora.

### A02 — O render exportado divergiu do render do editor

**Código.** O laço manual de game.ts não resolve nem escreve D_MATERIAL para malhas comuns, enquanto [scenedraw.ts](../src/engine/render/scenedraw.ts) usa resolvePbrMaterial e o envia. O laço exportado também verifica o.active diretamente, sem usar a atividade dos ancestrais, e usa raio de culling constante 0,87 multiplicado por escala para malhas comuns. Renderers próprios seguem outra rota.

Consequência: material, visibilidade e descarte de objetos fora da câmera não têm paridade garantida. Unificar o passe é preferível a copiar a cada correção os novos campos para game.ts.

### A03 — Carregamento assíncrono existe, mas não cobre o caminho completo

**Código.** [scene_loading.ts](../src/engine/core/scene_loading.ts) lê/valida JSON em worker, cria objetos incrementalmente e publica uma cena temporária. Isso é trabalho real e deve ser reaproveitado.

Porém, [scene_asset_loading.ts](../src/engine/render/scene_asset_loading.ts) faz readFileSync + JSON.parse no construtor e acquireModel no tick. O [loader de modelos](../src/engine/render/model.ts) lê e calcula hashes das dependências e envia a geometria à GPU sincronamente. O início do editor prepara assets e depois chama o caminho de montagem síncrono; game.ts chama loadSceneFrom diretamente. Abrir/importar/trocar cena não converge para uma única operação.

**Histórico:** [medições de carga](scene-loading-performance.md) registram maior passo de 190,8 ms, apesar do tempo total muito menor. O orçamento cooperativo não interrompe um upload ou mount já iniciado. Uma barra animada e um método tick não garantem ausência de travadas.

Falta: pipeline único de dependências → leitura → decodificação → preparação CPU → upload fracionado → montagem → ativação, com cancelamento, prioridades, filas limitadas e resultado atômico. A carga grande não pode descobrir dependências caras pela primeira vez no draw.

### A04 — Migração de materiais deixou um consumidor com propriedade incorreta

**Reproduzido e código.** [WorldStream](../src/engine/render/world_stream_render.ts) cria Material local, obtém um ID com resolvePbrMaterial e conserva apenas o ID. O cache novo conserva uma referência no Material. dispose ainda chama materialFree diretamente, sem soltar a referência.

Sonda: criar dois WorldStream na mesma janela e chamar dispose nos dois:

| Estado | Entradas no cache | Referências | Descartes |
|---|---:|---:|---:|
| Após criar | 4 | 24 | 0 |
| Após destruir ambos | 4 | 24 | 0 |

Log local: build/foundation-material-probe.log. O teste abriu e fechou apenas sua própria janela.

As referências retidas foram reproduzidas. A chamada direta de materialFree sobre IDs compartilhados também cria risco de invalidar outro consumidor; esse efeito visual não foi exercitado nesta sonda. É um erro da migração recente, não uma funcionalidade futura opcional. Corrigir antes de expandir o streaming e testar dois mundos + objeto comum usando o mesmo material.

### A05 — Reutilização não equivale a gerenciamento completo de memória

**Código e documentação.** [resources.ts](../src/engine/core/resources.ts) já oferece leases/scopes, compartilhamento, descarte adiado e estatísticas. Modelos, materiais, esqueletos e áudio de arquivo têm integração significativa.

Conforme [gerenciador de recursos](resource-manager.md), texturas prontas e ícones ficam retidos; o runtime atual não expõe textureFree. Não há orçamento global de RAM/VRAM, estimativa por estágio, pressão de memória nem expulsão coordenada. O orçamento de chunks cobre um subconjunto estimado de buffers, não toda a engine. Contar referências não mede bytes.

Falta: propriedade consistente em todos os consumidores, liberação nativa de texturas, contabilização de bytes CPU/GPU/pendentes, reserva antes do trabalho, política de cache e tratamento de falta de memória. Testar dezenas de trocas de cena até o consumo estabilizar.

### A06 — Transform e hierarquia ainda não são 3D completos

**Reproduzido.** [applyParentTo em scene.ts](../src/engine/core/scene.ts) rotaciona a posição do filho apenas pelo yaw do pai, soma pitch/yaw e não compõe escala herdada. [Transform](../src/engine/core/transform.ts) não tem pose mundial completa de roll/escala.

Sonda com filho em (1,0,0):

| Alteração no pai | Esperado | Obtido |
|---|---|---|
| Escala uniforme 2 | Filho mundial (2,0,0) | (1,0,0) |
| Roll de π/2 | Filho mundial aproximadamente (0,1,0) | (1,0,0) |

Log: build/foundation-transform-probe.log. Isso afeta câmera em veículo, ferramentas, colisão, picking e objetos filhos. A correção precisa migrar todos os consumidores para a mesma convenção matemática e definir escala não uniforme/shear; adicionar apenas um campo wrz não resolve.

### A07 — Uma rejeição assíncrona pode ser confundida com teste aprovado

**Reproduzido.** Com tools/rts-run.mjs, throw direto e await Promise.reject encerraram com código 1. Entretanto, Promise.resolve(1).then(() => { throw new Error(...); }) emitiu **unhandled promise rejection** e encerrou com código **0**.

Logs: build/foundation-failure-probe.log, foundation-async-failure-probe.log e foundation-detached-failure-probe.log. Portanto o defeito não deve ser generalizado a qualquer exceção: o caso confirmado é rejeição não observada.

[tools/test-world.mjs](../tools/test-world.mjs) já exige marcador e verifica rejeição; [tools/rts-run.mjs](../tools/rts-run.mjs) apenas repassa o status. O CI tem checks reais, mas não executa toda a matriz de recursos/cenas/paridade. Precisamos de um runner geral com timeout, término esperado, detecção de falha e resultado estruturado; corrigir também o comportamento nativo.

## Mapa dos demais sistemas

| Área | O que existe | O que precisa ser consolidado |
|---|---|---|
| Runtime/build | Commit e patch fixados, hashes, compilador externo, exportação e CI | Executar matriz release/debug, pacote fora do checkout, falhas explícitas, paridade editor/jogo e desligamento limpo |
| Execução paralela | Worker de cena, worker de geração, decodificação nativa de textura, kernels de física/partículas | Agendamento comum com dependências, cancelamento por dono/revisão, prioridade, limites de memória e instrumentação; corrotina não é worker |
| Assets | Índice de arquivos, importadores, caminhos normalizados, cache binário glTF | ID persistente independente de caminho, grafo de dependências, opções/versionamento do importador, reimportação e build só com dependências necessárias |
| Cena/persistência | JSON, IDs de objetos, validação, montagem com rollback, save verificado e undo | Versão explícita do esquema global, migrações, referências entre objetos/componentes, contratos de cenas aditivas/persistentes e save de gameplay separado da autoria |
| Ciclo de vida | mount/update, enabled, active, releaseResources, cópia no Play | Ordem formal de criação/ativação/desativação/destruição, mutação durante iteração e limpeza mesmo quando um disposer falha; cancelamento de trabalhos associado ao dono |
| Física | Passo fixo no editor, consultas espaciais, colisores, eventos e backends | Paridade do runtime, física angular/orientação completa, CCD em casos críticos e colisão de Terrain compartilhada com consultas e streaming |
| Terrain/mundo | Pincel, heightmap, máscaras de vegetação, biomas, voxel inicial, workers/cache/LOD | Unificar Terrain editável e mundo gerado; collider sincronizado, alterações persistentes por chunk, navegação e água sob o mesmo orçamento; considerar origem flutuante conforme escala-alvo |
| Entrada/personagem | Teclado/mouse, bloqueio de input no editor, voo, WorldPlayer | Ações nomeadas, rebind, foco/captura, gamepad e controlador reutilizável testado em rampas/degraus/plataformas |
| IA | Rotas e WAIT/TURN/WALK | Busca de caminho, obstáculos dinâmicos, desvio, atualização por região e orçamento por agente; não chamar o grafo de waypoints de navegação geral |
| Animação | Skeleton, clipes, blends/Animator, compartilhamento e poses independentes | Corrigir metas de CPU não atingidas; medir skinning/muitos personagens, culling/LOD de animação antes de multiplicar NPCs |
| Áudio | Mixer, fontes, grupos, relógio DSP, streaming do dispositivo e referências de arquivos | Auditoria de fontes procedurais, pressão de memória e política de decode/stream para faixas longas; medir cenários ativos |
| Renderização | PBR, sombras, água, culling, alguns LODs e agrupamento de mundo | Passe único, bounds corretos, contabilidade GPU, atualização de buffers, cobertura de transparência/alpha em sombras, shaders preparados e recursos por qualidade; IBL/reflexos depois |
| Rede | UDP, ACK, confiabilidade, snapshots, servidor/cliente e componentes | Entrada tardia gradual, interpolação, predição/reconciliação, interesse por região, esquema versionado, autoridade testada; autenticação/transporte adequado antes de internet |
| Água | Spline/superfície, empuxo, novo solver por colunas e snapshot | Resolver custo, atualizar buffers sem recriá-los, saída entre regiões e acoplamento a Terrain/streaming; não é fluido 3D nem worker |
| Ferramentas/diagnóstico | Inspector gerado, Console, WS, profiler CPU e sondas | Medir CPU/GPU/RAM/VRAM por sistema e p95/p99, testes ponta a ponta dos fluxos reais e relatórios acessíveis ao desenvolvedor |

Não identifiquei contratos gerais de AssetId/GUID, JobSystem compartilhado, InputAction ou migração de schema de cena nas buscas realizadas. Componentes existentes e helpers especializados não devem ser descartados: devem implementar esses contratos progressivamente.

Há documentação antiga desatualizada: por exemplo, rotas-e-terreno.md ainda descreve o pincel como exclusivo da demo, mas src/editor/terrain_brush.ts e os testes de arraste mostram integração posterior. Por isso este mapa não usa apenas a lista de pendências dos documentos antigos.

## Critério de base pronta

Proposta de produto inicial: Windows x64, editor e executável AOT, jogo 3D de uma câmera principal, mundo limitado por orçamento configurável e multiplayer opcional. Não assumir desde já suporte universal a todas as plataformas ou equivalência a Unity/Unreal.

A primeira base aceita precisa demonstrar:

1. Mesma cena, scripts e materiais no editor e no executável; física e entrada consistentes em diferentes FPS.
2. Carga fria/quente com progresso, cancelamento, erro recuperável e custo principal medido por etapa, incluindo o maior asset individual.
3. Trocar/fechar cena sem referências abandonadas, handles inválidos ou crescimento ilimitado de recursos.
4. Reabrir conteúdo após mover assets e migrar versões sem perder referências; erro claro para versão futura incompatível.
5. Streaming com alteração persistida: sair, voltar e reiniciar o processo preservam a mudança e a colisão correspondente.
6. Build de jogo que funciona fora do checkout e não depende do estado global do editor.
7. Testes realmente vermelhos quando algo falha; orçamento de desempenho explícito no hardware e perfil declarados.

Meta inicial proposta: 60 FPS = 16,67 ms de quadro. Não é uma medida atingida por todas as cenas. Definir budgets de CPU, GPU, uploads e memória por perfil; começar medindo carga com orçamento alvo de 2–3 ms por tick, p99 e maior passo. Um número alto precisa virar falha rastreável ou limitação assumida, não ser escondido pela média.

Zero GC é útil, mas não prova que um sistema é rápido. O solver AdaptiveWater compilado mediu cerca de 35 ms em 32×32, e testes de animação têm metas históricas não atingidas. Tratar esses casos como evidência de necessidade de perfil/kernel nativo, não de necessidade automática de mais threads ou de reescrever toda a engine.

## Referências externas consultadas

- [Godot: carregamento em background](https://docs.godotengine.org/en/4.4/tutorials/io/background_loading.html): obter o recurso antes de a tarefa terminar ainda pode bloquear. Sustenta separar pedido, progresso, conclusão e ativação.
- [Godot: APIs seguras para threads](https://docs.godotengine.org/en/4.6/tutorials/performance/thread_safe_apis.html): a separação de trabalho em thread e publicação na cena exige contratos de acesso; não se resolve colocando qualquer função em async.
- [Unity: gestão de memória de Addressables](https://docs.unity.cn/Packages/com.unity.addressables%402.3/manual/MemoryManagement.html): referências e liberação efetiva são conceitos distintos, com dependências a considerar.
- [Unreal: Asset Management](https://dev.epicgames.com/documentation/unreal-engine/asset-management-in-unreal-engine) e [carga assíncrona](https://dev.epicgames.com/documentation/unreal-engine/asynchronous-asset-loading-in-unreal-engine): gestão de assets cobre editor e jogo empacotado, com carregamento/descarregamento explícito.

São referências de contratos arquiteturais. Não indicam que esta engine já possua essas capacidades nem obrigam copiar suas APIs.

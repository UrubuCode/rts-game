# Superplano da física da nova engine

> **Aviso (2026-09-20):** documento de referência. Ordem, escopo e aceite são os de
> [`../specs/2026-09-20-paralelismo-e-fundacao-design.md`](../specs/2026-09-20-paralelismo-e-fundacao-design.md), §7 e §14.

**Projeto:** `UrubuCode/rts-game`  
**Escopo:** transformar a física atual em um subsistema sério de produção para uma game engine RTS 3D  
**Base:** `3d29515`  
**Autor:** Manus

## Visão de destino

A engine deve tratar física como um pipeline de simulação com contratos explícitos, não como uma função chamada depois de `update()`. O pipeline de produção precisa separar estado, detecção, constraints, integração, queries, eventos e renderização.

O objetivo não é fazer todos os casos possíveis na primeira versão. O objetivo é construir uma base que não precise ser reescrita quando entrarem OBB, rotação, juntas, projéteis rápidos, replay e milhares de unidades.

O sistema de destino é:

```text
input e comandos
    ↓
pré-sincronização e classificação de mudanças
    ↓
integradores cinemáticos
    ↓
broad-phase persistente
    ↓
persistent pair/contact manager
    ↓
narrow phase e manifolds
    ↓
merge de ilhas e wake-up
    ↓
solver de velocidade + posição
    ↓
CCD/TOI seletivo
    ↓
integração final e sleep por ilha
    ↓
eventos, queries e snapshot de replay
    ↓
espelho para cena/render
```

A principal regra de desempenho é: **não reconstruir dados que não mudaram**. A principal regra de correção é: **nenhum backend pode descartar silenciosamente pares, contatos ou eventos**.

## Diagnóstico da base atual

A base atual já tem bons elementos: timestep fixo, broad-phase por grid no caminho TypeScript e no GPU, sleeping, materiais, triggers na cena, contrato inicial de ownership e um solver Rust paralelo. O problema é que esses elementos ainda estão acoplados a um estado simplificado.

O estado físico atual não possui quaternion, velocidade angular, tensor de inércia, tipo cinemático, máscara de colisão ou manifold persistente. A CPU e o GPU ainda resolvem caixas como AABB. O caminho de estáticos GPU/Rust não aplica integralmente o centro local do `Collider`, o que já cria uma divergência antes da próxima fase.

O projeto também precisa distinguir dois objetivos que não são iguais:

| Perfil | Prioridade | Backend preferencial |
|---|---|---|
| Replay/lockstep | ordem estável, estado reproduzível, latência previsível | Rust determinístico |
| Cena massiva | throughput, milhares de corpos, tolerância a latência | GPU ou Rust paralelo |
| Editor/interação | resposta imediata, queries e eventos | CPU/Rust síncrono |
| Renderização visual | interpolação, sem bloquear GPU gráfica | backend assíncrono com snapshot |

A engine deve expor essa escolha como uma capacidade e não como uma promessa universal de que CPU, GPU e Rust produzem a mesma trajetória bit a bit.

## Princípios de projeto

### Separar o estado da cena do estado da simulação

`GameObject` e `Transform` são uma API conveniente para o editor, mas não devem ser o armazenamento quente da física. O runtime deve possuir um `PhysicsWorld` com IDs estáveis e arrays próprios. A cena recebe snapshots de saída; a física recebe comandos de entrada.

Cada corpo deve ter um `BodyId` com índice e generation. O índice permite arrays densos e a generation impede que um evento antigo seja aplicado a um corpo destruído e reutilizado.

O fluxo recomendado é:

```text
Scene command → Physics command buffer → PhysicsWorld → StateSnapshot → Scene
```

O command buffer deve ser ordenado por `stepId` e por uma chave estável. Assim, spawn, destroy, mudança de pose, força e mudança de filtro não dependem da ordem de callbacks do editor.

### Separar formas, corpos e materiais

Um corpo possui pose e dinâmica. Um collider possui forma, filtros e material. Uma forma cozida é imutável e compartilhada. O mesmo mesh/hull não deve ser copiado por instância.

O collider deve guardar:

- `shapeType`;
- `shapeAssetId` ou `hullId`;
- centro local e orientação local;
- escala ou dimensões já normalizadas;
- material físico;
- layer e mask;
- trigger e modo CCD.

O corpo deve guardar:

- pose de simulação e pose anterior;
- velocidade linear e angular;
- massa, inverso da massa e inércia;
- tipo de movimento;
- flags de sono e rotação fixa;
- proxy do broad-phase;
- ilha atual e generation.

Essa separação corrige a sobrecarga atual em que escala visual, forma de colisão e estado do solver compartilham campos do `Transform`.

## Contrato de layout e memória

A próxima fase deve criar um layout versionado em TypeScript e Rust. O WGSL deve usar os offsets gerados pelo mesmo contrato ou ser validado por um teste que escreva sentinelas em cada campo.

O layout precisa comportar estado mutável. Orientação e velocidade angular não podem ficar somente em `world` de leitura. Impulsos acumulados do manifold também precisam sobreviver ao passo.

A recomendação é usar SoA no caminho quente:

```text
positions[]
orientations[]
linearVelocities[]
angularVelocities[]
invMass[]
invInertia[]
bodyFlags[]
layer[]
mask[]
shapeId[]
proxyId[]
```

Arrays de contatos e pares devem ser pools compactos com capacidade reservada. Cada pool precisa fornecer:

- capacidade atual;
- contagem usada;
- contador de overflow;
- política de fallback;
- métrica de pico;
- geração do frame.

Overflow não pode virar “o par desapareceu”. Em CPU, o mundo deve aumentar o pool ou entrar em modo degradado explícito. Em GPU, o contador deve ser lido e o frame deve registrar fallback ou erro. A documentação de GPU rigid bodies da PhysX trata capacidade pré-alocada e overflow como preocupação de correção, não apenas de performance [5].

## Broad-phase: evolução em duas etapas

### Etapa imediata: melhorar o grid atual

O grid atual é uma boa primeira solução para cenas RTS porque é simples e previsível. Antes de substituí-lo, deve ser transformado em estrutura persistente:

1. cada collider tem um proxy e uma AABB fat;
2. o proxy só muda quando a AABB sai da fat AABB;
3. inserir/remover/mover atualiza apenas células afetadas;
4. pares existentes ficam em uma tabela persistente;
5. layer/mask são filtrados antes de criar o par;
6. estáticos e grandes colliders usam uma estrutura separada;
7. o grid 2D é usado apenas quando a extensão vertical e o caso de uso justificarem isso.

O grid atual recalcula a estrutura por frame e trata objetos grandes por listas auxiliares. Isso é aceitável como fallback, mas será caro quando OBB exigir AABB atualizada por rotação. A AABB fat reduz atualizações quando a unidade se move pouco.

### Etapa de escala: árvore dinâmica ou estrutura híbrida

Para mapas grandes, streaming de cenário e tamanhos muito diferentes, adicionar uma dynamic AABB tree ou uma estrutura híbrida. A escolha deve ser medida em três cenas: unidades concentradas, cenário esparso e grande quantidade de estáticos.

A estrutura ideal para o projeto pode ser híbrida:

- grid uniforme para unidades dinâmicas de tamanho semelhante;
- árvore AABB para estáticos, prédios e colliders grandes;
- lista dedicada para objetos CCD e proxies que atravessam muitas células.

A broad-phase não deve testar todos contra todos. O critério de aceite é que o número de candidatos cresça com a densidade local, não com `n²`, e que os pares sejam persistentes entre passos.

## Persistent pair manager

A cada par candidato, usar uma chave canônica `(minBodyId, maxBodyId, colliderIdA, colliderIdB)`. O registro deve guardar estado do par, manifold anterior, último `stepId`, flags de trigger e capacidade da forma.

O narrow phase deve rodar apenas para pares novos, pares que se moveram, pares com manifold persistente e pares acordados por um vizinho. A documentação da Box2D descreve uma arquitetura equivalente: pares persistem, contatos são criados uma vez e a narrow phase atualiza os contatos antes do solver [2].

O pair manager deve produzir transições:

```text
not touching → touching      = begin
 touching   → touching       = persist
 touching   → not touching   = end
```

O evento deve ser associado ao `stepId` e armazenado em um buffer transitório do frame. Gameplay não deve executar destruição ou spawn no meio do laço de narrow phase.

## Narrow phase e manifolds

### OBB

Para OBB-OBB usar os 15 eixos do SAT, com tratamento explícito de eixos quase paralelos. O resultado deve guardar eixo vencedor, profundidade, feature IDs e convenção de normal. Para OBB-esfera, usar espaço local da caixa. Para hull convexa, manter o caminho baseado em support mapping ou planos, mas limitar o número de vértices/planos para o caminho GPU.

SAT é uma boa narrow phase para caixas, mas não deve ser generalizado sem critério para toda forma. A referência de SAT destaca que o MTV é uma informação local de separação; a resolução de múltiplos corpos é outro problema [1].

### Manifold

Para contato face-face, gerar até quatro pontos e associar cada ponto a features da forma. Para contatos esfera-caixa, manter um ponto. Para edge-edge, usar o ponto de segmentos mais próximos com regra estável.

O manifold precisa existir em CPU, Rust e GPU. No GPU, ele pode ser um pool de contatos com compactação posterior. No Rust, deve ser uma estrutura determinística ordenada por pair key e contact feature.

O warm starting deve reaplicar os impulsos do passo anterior após casar os pontos. A engine deve medir a diferença de iterações e jitter com o cache ligado e desligado.

## Ilhas e sleeping

O projeto atualmente dorme corpos individualmente. A próxima arquitetura deve construir ilhas como componentes conectados por contatos e juntas. Um corpo estático não precisa entrar no grafo; ele pode ser compartilhado por várias ilhas porque não é alterado pelo solver.

Sleeping deve ser decidido por ilha. Se um corpo de uma pilha dorme enquanto outro continua acordado, a pilha pode penetrar ou perder juntas. Wake-up também deve propagar por toda a ilha. A análise da Box2D recomenda exatamente esse modelo e alerta que uma grande ilha ainda pode ser o limite de paralelismo [6].

O algoritmo inicial deve ser DFS determinístico. Union-find paralelo só deve entrar depois que houver um modo de ordenar constraints independentemente do timing dos workers. A ordem de CAS de um union-find paralelo pode ser não determinística e alterar um solver Gauss-Seidel com warm starting [6].

Cada ilha deve possuir:

- lista ordenada de corpos;
- lista ordenada de constraints;
- awake/sleep state;
- AABB agregada;
- custo estimado;
- `islandId` e generation;
- contador de wake-up reason.

## Solver

O solver deve ser separado em três camadas:

1. preparação de constraints;
2. iterações de velocidade;
3. correção de posição.

A preparação calcula massas efetivas, braços `rA/rB`, bias, limites de atrito e impulso acumulado. O solver de velocidade aplica normal e tangentes. O solver de posição reduz penetração sem injetar energia excessiva.

Parâmetros como slop, restituição mínima, número de iterações e limite de velocidade devem ser dados de uma configuração versionada. Cada preset precisa de um teste, porque uma alteração nesses números muda paridade e estabilidade.

Para dinamismo angular, a velocidade no ponto inclui `cross(omega, r)` e o impulso atualiza velocidade linear e angular. O inverso da inércia deve ser calculado no espaço local e transformado para mundo pela orientação.

## CCD e tunneling

O teto de velocidade atual não deve ser tratado como CCD. CCD precisa ser seletivo, porque sweep/TOI é mais caro que simulação discreta [2] [7].

Adicionar modos:

| Modo | Estratégia | Uso |
|---|---|---|
| `discrete` | pose final do passo | objetos comuns |
| `speculative` | contatos previstos pela AABB expandida | unidades rápidas com custo moderado |
| `sweep` | TOI entre pose anterior e atual | projéteis e bullets |
| `disabled` | somente queries/manualmente | efeitos e objetos cosméticos |

O broad-phase deve gerar candidatos CCD somente para corpos cujo deslocamento relativo exceda um limiar. O solver deve limitar o número de TOIs por passo para evitar espiral de custo. Se o limite for atingido, registrar um evento de degradação; não fingir que o resultado é exato.

A primeira implementação deve cobrir esfera e cápsula contra estático. Depois adicionar caixa contra estático. CCD dinâmico-dinâmico deve ser opt-in, pois o custo cresce rapidamente.

## Paralelismo CPU

O solver Rust deve ser o backend de referência para performance e determinismo dentro do escopo definido. O escalonamento deve acontecer por ilhas e por fases:

```text
single-thread: ordenar comandos e construir pares
parallel: narrow phase de pares
single/controlled: merge e ordenação de ilhas
parallel: solver de ilhas independentes
single: eventos e snapshot
```

Para uma ilha grande, usar particionamento determinístico por cores de constraints, ou manter uma ordem serial controlada. Não usar atomics como substituto de ordenação quando o resultado precisa ser replayável.

As funções quentes devem operar em arrays densos e evitar `GameObject`, `Behavior`, strings e `Map`. Handles devem ser convertidos para índices locais no início da fase. A alocação por frame deve ser zero no caminho normal; pools devem crescer fora do frame de simulação.

O benchmark deve medir separadamente:

- comando e sincronização;
- broad-phase;
- pair manager;
- narrow phase;
- construção de ilhas;
- solver;
- integração;
- eventos;
- cópia para snapshot.

## Paralelismo GPU

O GPU deve ser tratado como um executor de throughput, não como prova automática de determinismo. A pipeline ideal é:

```text
clear counters
→ update fat AABBs
→ build broad-phase
→ generate candidate pairs
→ filter layer/mask
→ narrow phase
→ compact contacts
→ build/solve constraints
→ write state and overflow counters
```

A GPU deve manter contatos e estado pelo maior número possível de passos. Readback por frame deve ser reservado para snapshot, debug ou quando a cena realmente precisa de controle CPU. O atual caminho assíncrono deve declarar claramente sua latência; `pbApply` não deve parecer um estado atual quando é um estado atrasado.

Features difíceis de manter GPU-resident, como CCD, triggers sofisticados, queries ordenadas e contact modification, devem ter fallback explícito. A documentação da PhysX mostra que mesmo uma engine madura mantém algumas dessas funções no CPU e exige buffers pré-alocados [5].

## Queries e gameplay

O mundo físico precisa de uma query API independente do backend:

- `raycast`;
- `shapeCast`;
- `overlapAabb`;
- `overlapShape`;
- `closestPoint`;
- `getContacts`.

Cada query deve declarar se consulta o estado do último `stepId` confirmado ou um estado atual. No GPU, uma query não pode bloquear silenciosamente o render; deve existir uma versão assíncrona com ticket e uma versão síncrona para editor/debug.

Eventos devem carregar `stepId`, `BodyId`, `ColliderId`, normal, ponto, impulso e tipo. O gameplay deve receber eventos depois do solver, em ordem estável, com uma fila que não permite mutação estrutural durante a simulação.

## Determinismo e replay

Definir três níveis de garantia:

| Nível | Garantia |
|---|---|
| D0 | mesmo processo, mesma entrada, mesmo resultado aproximado |
| D1 | mesmo binário, máquina e configuração, checksum bit a bit |
| D2 | mesma arquitetura e builds controlados, checksum bit a bit |
| D3 | plataformas diferentes, ainda não prometido |

O replay deve armazenar versão do layout, versão dos parâmetros, seed, comandos por `stepId` e checksum do estado completo. O checksum inclui pose, velocidade, sono, manifolds e eventos.

Ordem de constraints, ordenação de pairs, FMA, funções transcendentais e número de threads precisam estar documentados. A literatura de determinismo alerta que mesmo fixed timestep não resolve diferenças entre compiladores, arquiteturas e modos de otimização [4] [8].

O modo GPU deve ser classificado como visual/throughput até que um experimento prove outra coisa. O modo Rust pode ser D1 ou D2, mas essa garantia precisa ser medida, não inferida do uso de rayon.

## Profiling e observabilidade

Adicionar um `PhysicsStats` por `stepId` com:

- tempo por fase;
- quantidade de corpos awake/sleeping;
- quantidade de ilhas e maior ilha;
- proxies atualizados;
- candidate pairs;
- filtered pairs;
- contatos novos/persistentes/removidos;
- pontos de manifold;
- iterações e convergência;
- CCD tests e TOIs;
- queries;
- eventos;
- bytes enviados/recebidos da GPU;
- overflow de todos os pools;
- motivo de fallback.

O editor deve mostrar esses dados em `dbg`. Nenhum benchmark deve usar `vsync` ligado para concluir sobre custo de simulação. Cada medida precisa registrar hardware, build, número de corpos, densidade, percentagem awake, substeps, queries por frame e modo do backend.

## Fases de entrega

### Fase 0 — estabilização e contratos

Corrigir paridade de collider estático, criar `BodyId/generation`, separar comando/snapshot, definir tipos de corpo, layer/mask, layout versionado e `PhysicsStats`.

**Promoção:** testes de layout, spawn/despawn contínuo, collider deslocado, mask filter, checksum de replay D1 e zero overflow em cenas de referência.

### Fase 1 — broad-phase persistente

Transformar o grid em proxies persistentes com fat AABB, pair cache, filtros antecipados e contadores de overflow. Manter o caminho antigo como comparação.

**Promoção:** candidate pairs subquadráticos, nenhuma perda de contato em movimento, métricas de proxy update e paridade funcional.

### Fase 2 — pose e OBB

Adicionar quaternion, OBB-OBB e OBB-esfera, primeiro CPU/Rust e depois WGSL. Criar testes geométricos independentes do solver.

**Promoção:** normal/profundidade/feature IDs estáveis e mesma resposta dentro de tolerância documentada.

### Fase 3 — contact manager e manifolds

Persistir pairs, manifolds, feature IDs e impulsos. Introduzir warm starting e eventos begin/persist/end.

**Promoção:** pilhas estáveis, menos iterações, eventos sem duplicação e sem pair descartado silenciosamente.

### Fase 4 — ilhas e sleeping correto

Construir ilhas por DFS determinístico. Sleep e wake-up passam a ser por ilha. Paralelizar apenas ilhas independentes.

**Promoção:** wake-up propaga por toda a pilha, cenário parado quase não consome CPU e constraint order é reproduzível.

### Fase 5 — dinâmica angular

Adicionar inércia, omega, torque e quaternion integration. Implementar impacto fora do centro, rotação fixa e constraints angulares.

**Promoção:** casos de inclinação e impacto angular, limites de energia e replay com orientação no checksum.

### Fase 6 — CCD seletivo e queries

Adicionar discrete/speculative/sweep, TOI limitado, raycast, shape cast e overlap com tickets.

**Promoção:** projétil não atravessa parede na cena de referência, custo de CCD aparece separado e queries declaram step/latência.

### Fase 7 — backend GPU residente

Mover broad-phase, narrow phase, manifold e solver para GPU por etapas. Manter fallback por capacidade, com overflow e diagnóstico.

**Promoção:** throughput medido em milhares de corpos awake, sem stalls no render, sem perda de pairs e com snapshot correto.

### Fase 8 — produção e compatibilidade

Congelar formato de cena, migrações, versionamento de parâmetros, documentação de determinismo, ferramentas de replay e testes de regressão por hardware.

**Promoção:** projeto antigo carrega sem mudar comportamento quando usa o modo legado; o novo solver possui rollback de runtime e relatórios de compatibilidade.

## Metas mensuráveis

As metas devem ser definidas por workload, não por número isolado de corpos. A tabela inicial sugerida é:

| Workload | Meta de simulação | Meta de correção |
|---|---:|---|
| 1.000 corpos, 200 awake | abaixo de 4 ms no Rust 16t | zero penetração estrutural após assentamento |
| 2.000 corpos densos | abaixo de 8 ms no backend selecionado | nenhum overflow de pair/contact |
| 5.000 corpos, cena RTS esparsa | abaixo de 16,7 ms incluindo physics | sleep por ilha e wake-up correto |
| 100 projéteis CCD | custo CCD separado abaixo de 2 ms | zero tunneling no cenário de parede |
| pilha 20×20 | convergência em prazo fixo | energia e jitter decrescentes |

Esses valores são metas de engenharia para orientar medição, não resultados já comprovados pelo repositório. Cada um deve ser validado em máquina e build identificados.

## Riscos que devem bloquear a promoção

A promoção deve parar se ocorrer qualquer um destes casos:

- pair/contact é descartado por capacidade sem evento de overflow;
- CPU, Rust e GPU usam convenções diferentes para centro, normal ou orientação;
- uma plataforma cinemática zera a velocidade que deveria comunicar;
- sleeping de um corpo deixa outro corpo da mesma ilha ativo sem justificativa;
- replay diverge sem checksum que indique a primeira fase divergente;
- GPU usa fallback silencioso para um shape ou query;
- benchmark declara ganho com `vsync` ou sem separar tempo de upload/readback;
- mudança de parâmetros invalida paridade sem atualizar a versão do contrato.

## Conclusão

A engine pode chegar a uma física séria sem copiar uma solução externa, mas precisa parar de tratar cada backend como uma implementação independente de detalhes. O contrato deve ser único; os backends podem ter estratégias diferentes, desde que declaresem capacidade, latência, determinismo e fallback.

A recomendação prática é abrir uma sequência de PRs pequenas, cada uma com um contrato e um teste de promoção. A primeira PR não deve ser OBB. Deve ser **estado físico versionado, paridade de collider estático, BodyId/generation, masks, overflow counters e profiling por fase**. Essa base reduz o risco de gastar semanas em uma narrow phase correta que depois não cabe no solver, no replay ou na GPU.

## Referências

[1]: https://dyn4j.org/2010/01/sat/ "SAT — Separating Axis Theorem e Minimum Translation Vector"
[2]: https://box2d.org/documentation/md_collision.html "Box2D Collision — manifolds, warm starting e Time of Impact"
[3]: https://rapier.rs/docs/user_guides/rust/rigid_bodies/ "Rapier Rigid Bodies — corpos fixed, dynamic e cinemáticos"
[4]: https://gafferongames.com/post/deterministic_lockstep/ "Gaffer On Games — Deterministic Lockstep"
[5]: https://nvidia-omniverse.github.io/PhysX/physx/5.4.0/docs/GPURigidBodies.html "PhysX GPU Rigid Bodies — pipeline, limites e memória"
[6]: https://box2d.org/posts/2023/10/simulation-islands/ "Box2D Simulation Islands — sleeping, wake-up e paralelismo"
[7]: https://docs.unity3d.com/6000.6/Documentation/Manual/ContinuousCollisionDetection.html "Unity CCD — discrete, speculative e sweep-based"
[8]: https://gafferongames.com/post/floating_point_determinism/ "Gaffer On Games — Floating Point Determinism"

# Contrato de Consultas Espaciais, Latência e Eventos (Fase 1, §6 e Lote B)

> **Documento Normativo de Contrato**  
> Referência: `docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md` (§6, itens 7 e 8; §7.1; §7.2, Lote B).  
> Branch de revisão: `docs/fisica-contrato-consultas` (PR exclusivo de especificação antes de código).

---

## 1. Contexto e Enquadramento

O motor de física é projetado para **uso geral** (§7.1): deve atender desde jogos com multidões de agentes cinemáticos e estáticos (como RTS ou RPGs de ação) até simulações densas de corpos rígidos em contato contínuo (empilhamentos, tombamentos, destruição).

Em qualquer um desses perfis, consultas espaciais (`raycast`, `overlap`, `shapeCast`) são ferramentas fundamentais de gameplay e simulação:
- Seleção de entidades pela câmera e interação com o mouse;
- Validação espacial de movimentação, encaixe e footprint no cenário;
- Sensores de proximidade, áreas de efeito e volumes de trigger;
- Linha de tiro (LOS) e detecção de obstáculos para navegação.

Com múltiplos backends de aceleração física (CPU, Rust, GPU), a suposição ingênua de que toda consulta ocorre instantaneamente na memória local da CPU com atraso zero é falsa. Este contrato estabelece:
1. Onde reside a verdade do estado físico sob cada backend;
2. A decisão arquitetural de **quem executa** as consultas espaciais e a manutenção do índice espacial;
3. A latência real (medida em **passos**) e o carimbo obrigatório de `stepId`;
4. O payload das consultas, incluindo filtros simétricos `layer`/`mask`, suporte a triggers, listas determinísticas, variantes escalares sem alocação (`NonAlloc`) e a criação do `bodyId` estável serializado;
5. A produção e o ciclo de vida determinístico dos eventos de contato (`begin`/`persist`/`end`).

---

## 2. Posse e Onde Reside a Verdade

O motor opera sob o modelo de **posse de estado** (`pbDono` em `src/engine/core/physics_backend.ts`). O layout físico versionado compõe-se dos quatro buffers canônicos: **`pos`**, **`vel`**, **`ext`** e **`world`**.

```
                       ┌─────────────────────────────────────────┐
                       │           Scene CPU (Host)              │
                       │    GameObjects, Transforms, Colisores   │
                       └──────────────────┬──────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  │ pbDono = CPU          │ pbDono = RUST         │ pbDono = GPU
                  ▼                       ▼                       ▼
       ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
       │   Scene CPU Solver   ││  Rust rts:rigid      ││   GPU gpurigid       │
       │                      ││  (Rayon Workers)     ││   (WGSL Compute)     │
       │  Verdade: RAM Host   ││  Verdade: Buffers    ││  Verdade: VRAM       │
       │  (Scene / Objetos)   ││  do Host (RAM)       ││  (pos, vel, ext, wrd)│
       │                      ││                      ││                      │
       │  Atraso: 0 passos    ││  Atraso: 0 passos    ││  Espelho Host:       │
       │  Velocidade: Sim     ││  Velocidade: Sim     ││  Atraso: 1 a 6 passos│
       │                      ││                      ││  Velocidade: NÃO     │
       └──────────────────────┘└──────────────────────┘└──────────────────────┘
```

### 2.1 Backend CPU (`pbDono === PB_MODO_CPU`)
- **Onde está a verdade:** Na memória RAM do host, nas estruturas da `Scene` e componentes dos `GameObjects`.
- **Atraso:** **0 passos**. As alterações do solver são imediatas.

### 2.2 Backend Rust (`pbDono === PB_MODO_RUST`)
- **Onde está a verdade:** Nos buffers compartilhados de corpos do host (`pos`, `vel`, `ext`, `world`).
- **Atraso:** **0 passos**. O solver Rust executa síncrono na thread JS (distribuindo o cálculo via `rayon` pelos núcleos de CPU) sobre as fatias de memória do host. Ao retornar de `rigid.step()`, os buffers do host já contêm o estado do passo atual.

### 2.3 Backend GPU (`pbDono === PB_MODO_GPU`)
- **Onde está a verdade:** **Na VRAM da GPU**, nos storage buffers `pos`, `vel`, `ext` e `world`.
- **Como o espelho chega no host:**
  - Em regime normal de jogo, o espelho é atualizado via pipeline assíncrono: `rbService` → `read_begin` / `read_poll` com passos devidos (`pbDevidos`).
  - `rigidFlush()` é uma drenagem **síncrona**, reservada exclusivamente para suítes de teste ou momentos de transição de posse.
- **Atraso real em passos:**
  - O atraso da leitura da GPU **não é "1 frame"**: medições instrumentadas na issue #5 revelam atraso variável de **1 a 6 passos de simulação** na mesma cena sob regime pipelined.
  - A unidade de tempo do motor de física é o **passo** (`step`), e nunca o frame de renderização (que varia com VSync e taxa de atualização).
- **Limitação de velocidade:**
  - O espelho da CPU **não possui velocidade**. O procedimento `pbApply()` copia apenas as posições (`pos.xyz`) para os `Transforms` dos `GameObjects`, intencionalmente **não lendo nem sincronizando `vel`** para economizar largura de banda de transferência PCI-e.
- **Requisito normativo do Lote B:**
  - O backend GPU deve **carimbar cada leitura assíncrona** com o `stepCount` do kick exato que a produziu (`pbGpuLastReadbackStep`). Sem este carimbo, qualquer resposta de consulta espacial no modo GPU seria temporalmente cega.

---

## 3. Decisão Central: QUEM Executa a Consulta e o Índice Espacial

O motor adota formalmente o modelo de **Executor Único no Host com Índice Próprio**:

1. **Separação de Papéis:**
   - Os solvers de simulação (`Scene`, `GatherBackend` em Rust, kernel WGSL na GPU) têm como responsabilidade exclusiva **avançar o estado dos corpos** sob forças e contatos.
   - `GatherBackend::supports(raycast)` e `supports(overlap)` permanecem respondendo `false`. O solver nativo não deve ser inflado com lógica de consultas pontuais.
2. **Índice Espacial Próprio do Executor:**
   - O grid espacial existente da `Scene` só é montado quando o solver da CPU roda; nos modos Rust e GPU ele não existe.
   - Portanto, o executor de consultas espaciais mantém um **índice espacial próprio** (grid de células no host), reconstruído a cada estado novo (após o passo do Rust ou após a chegada de um readback da GPU).
   - O custo de reconstrução desse índice entra obrigatoriamente na medição do **benchmark do Lote B**.
3. **Consistência e Zero Divergência:**
   - A geometria e os algoritmos de intersecção (raio×esfera, raio×AABB, raio×casca) rodam no mesmo código no host, garantindo **zero divergência algorítmica** entre backends.
   - O que muda entre os modos é estritamente o carimbo temporal (`stepId`):
     - Em modo CPU ou Rust: consulta lê o passo corrente (`atraso = 0 passos`).
     - Em modo GPU: consulta lê o espelho sincronizado (`atraso = currentStep - pbGpuLastReadbackStep`).
4. **Consultas na VRAM com Gatilho:**
   - Uma implementação de raycast executada diretamente na VRAM via compute shader fica classificada como **otimização de desempenho com gatilho** (§7.3) para quando houver milhares de raios gerados na própria GPU (ex.: partículas orientadas por GPU). Ela **não faz parte do Lote B**.

---

## 4. Latência de Consultas por Modo de Simulação

| Modo Ativo | Onde a Consulta Executa | Atraso da Consulta | `stepId` Reportado | Velocidade no Ponto? | Comportamento sob Carga |
|---|---|:---:|:---:|:---:|---|
| **`PB_MODO_CPU`** | Grid do Executor (Host) | **0 passos** | `currentStep` | Sim | Síncrono no mesmo tick de lógica. |
| **`PB_MODO_RUST`** | Grid do Executor (Host) | **0 passos** | `currentStep` | Sim | Síncrono imediatamente após `rigid.step()`. |
| **`PB_MODO_GPU`** | Grid do Executor (Host) | **1 a 6 passos** | `pbGpuLastReadbackStep` | **Não** | Lê o espelho trazido por `rbService`. |
| **GPU Bloqueante** | `rigidFlush()` no frame | 0 passos | `currentStep` | Sim | **PROIBIDO EM JOGO.** Causa stall de pipeline e stutter severo. |

---

## 5. Payload, Filtros e Interface de Consultas

Toda consulta espacial (`raycast`, `overlap`) retorna uma estrutura estrita contendo metadados de impacto, filtragem e tempo.

### 5.1 Definição de Tipos e Interfaces

```typescript
export interface RaycastHit {
  /** Se houve intersecção válida. */
  hit: boolean;

  /**
   * Identificador estável do corpo/objeto atingido (-1 se nenhum).
   * Persiste através de serialização e recarregamento da cena.
   */
  bodyId: number;

  /** Ponto de impacto em coordenadas globais (xyz). */
  point: [number, number, number];

  /** Normal da superfície no ponto de impacto (xyz normalizado, aponta para fora). */
  normal: [number, number, number];

  /** Distância da origem do raio até o ponto de impacto. */
  distance: number;

  /**
   * Passo exato de física (stepCount) a que correspondem as poses desta resposta.
   * Modos CPU/Rust: stepId === currentStep.
   * Modo GPU: stepId === pbGpuLastReadbackStep (defasado em 1 a 6 passos).
   */
  stepId: number;
}

export interface OverlapHit {
  /** Identificador estável do corpo rígido sobreposto. */
  bodyId: number;

  /** Profundidade máxima de penetração ao longo da normal. */
  depth: number;

  /** Normal de separação (aponta do volume de busca para o corpo atingido). */
  normal: [number, number, number];

  /** Passo exato de física da simulação a que este contato corresponde. */
  stepId: number;
}

export interface SpatialFilter {
  /** Camada a que o agente da consulta pertence (padrão: 1). */
  layer?: number;

  /** Máscara de bits dos alvos aceitos (padrão: 0xFFFF_FFFF). */
  mask?: number;

  /** Se deve atingir volumes marcados como trigger (padrão: false). */
  includeTriggers?: boolean;
}
```

### 5.2 Regras de Filtragem Simétrica (`layer`, `mask`, `triggers`)
1. **Regra de Máscara Simétrica:** Um corpo alvo `B` é elegível para a consulta com filtro `Q` se, e somente se, as máscaras de ambos concordarem mutuamente:
   ```typescript
   (Q.mask & B.layer) !== 0 && (B.mask & Q.layer) !== 0
   ```
   Isso garante consistência com a regra de pares do motor: uma consulta na camada "projétil" só atinge "unidade" se o projétil aceitar colidir com a unidade e a unidade aceitar ser atingida por projéteis.
2. **Triggers:**
   - Volumes colisionais marcados com a flag `trigger` são ignorados por padrão (`includeTriggers = false`).
   - Quando `includeTriggers = true`, são reportados com `depth = 0` em overlap ou no ponto de entrada em raycast.

### 5.3 `overlap` Devolve uma Lista Determinística
- Diferente de `raycast` (que devolve o primeiro impacto ao longo do raio), `overlap` pode atingir múltiplos corpos simultaneamente.
- **Ordem Determinística Obrigatória:** A lista de `OverlapHit` devolvida deve ser **estritamente ordenada por `bodyId` crescente**.
- Sem essa ordenação, iterações de gameplay (como aplicar dano em área ou selecionar unidades) produziriam ordens de processamento distintas dependendo da organização interna das células do grid, quebrando replays determinísticos.

### 5.4 Identificador Estável (`bodyId`) e Serialização na Cena
- No estado atual do `master`, o `GameObject` **não possui id**.
- O **Lote B cria formalmente esse identificador estável** (`id: number`, inteiro monotônico e imutável atribuído na instanciação do objeto).
- **Serialização Obrigatória:** O `bodyId` deve ser **salvo na cena** (`SceneIO` / JSON da cena). Sem a persistência do id, ao salvar e recarregar uma cena a ordenação determinística de `overlap` e a correspondência em replays seriam corrompidas.

### 5.5 Zero Alocação por Consulta (`NonAlloc`) com Parâmetros Escalares
No runtime do motor (`rts`, que compila TypeScript via Cranelift), passar vetores como tuplas `[x, y, z]` aloca arrays no heap a cada chamada. Para consultas de alta frequência, a API deve operar exclusivamente com **parâmetros escalares**:

```typescript
// Reutiliza objeto outHit pré-alocado pelo chamador (zero alocações no heap)
function raycastNonAlloc(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  outHit: RaycastHit,
  mask?: number,
  layer?: number,
  includeTriggers?: boolean,
): boolean;

// Preenche o buffer outHits até maxHits e devolve a contagem real de colisões encontradas
function overlapSphereNonAlloc(
  cx: number, cy: number, cz: number,
  radius: number,
  outHits: OverlapHit[],
  maxHits: number,
  mask?: number,
  layer?: number,
  includeTriggers?: boolean,
): number;
```

---

## 6. Produção e Ciclo de Vida dos Eventos de Contato (Lote B)

O Lote B implementa a notificação reativa de contatos (`contactBegin`, `contactPersist`, `contactEnd`, `triggerEnter`, `triggerExit`).

### 6.1 Quem Produz o Contato em Cada Modo
O executor de consultas espaciais lê apenas posições e não participa da geração de eventos de contato físico. Quem detecta o contato em cada modo é o solver:
- **CPU (`Scene`):** O procedimento de contato (`solvePair`) registra diretamente os pares que colidiram durante o passo.
- **Rust (`rts:rigid`):** O solver passa a devolver um buffer com a lista de pares em contato no passo (mudança no crate `rts-physics` no segundo PR do Lote B).
- **GPU (`gpurigid`):** No Lote B, a GPU recusa eventos (`supports(contact_events) = false`), emitindo diagnóstico explícito e fazendo a cena recair para a CPU quando eventos forem obrigatórios, até que um buffer de contatos com readback carimbado seja viabilizado.

### 6.2 Tabela de Pares Ativos no Host
Para garantir que a geração de `begin`, `persist` e `end` seja rigorosamente idêntica nos backends suportados:
- A **tabela de pares ativos reside no host (CPU)**.
- **Chave canônica:** O par ordenado de identificadores estáveis `(min(bodyIdA, bodyIdB), max(bodyIdA, bodyIdB))`.
- A tabela guarda os pares que estavam em contato no passo anterior ($N-1$).
- Ao final do passo $N$, compara-se o conjunto atual com o anterior:
  1. **Presente em $N$ e ausente em $N-1$:** Dispara evento `contactBegin` (ou `triggerEnter`);
  2. **Presente em $N$ e presente em $N-1$:** Dispara evento `contactPersist`;
  3. **Ausente em $N$ e presente em $N-1$:** Dispara evento `contactEnd` (ou `triggerExit`).

### 6.3 Momento da Emissão e Determinismo
- Os eventos são despachados **estritamente após a conclusão do passo físico** (`postStep`), após a integração de posições e velocidades.
- **Nenhum callback tem permissão para alterar o mundo** durante a resolução do solver.
- A fila de eventos despachada no frame é estritamente ordenada por:
  1. `stepId`;
  2. Chave do par canônico `(min(idA, idB), max(idA, idB))`.

---

## 7. Critérios de Aceite para o Lote B

O Lote B será dividido em dois PRs (1º Consultas, 2º Eventos). Os critérios de aceite exigem:
1. O backend GPU carimbar cada readback com o `stepCount` exato que o produziu (`pbGpuLastReadbackStep`);
2. Consultas em modo GPU reportarem `hit.stepId === pbGpuLastReadbackStep` comprovando o atraso real medido (1 a 6 passos);
3. Consultas em modos CPU e Rust reportarem `hit.stepId === currentStep`;
4. `GameObject` possuir `bodyId` estável serializado na cena (`SceneIO`), preservado após save/load;
5. `overlap` devolver resultados estritamente ordenados por `bodyId` crescente;
6. Filtros com regra simétrica `layer`/`mask` e `includeTriggers` passarem em testes unitários dedicados;
7. **Como medir zero alocações:** Inspeção de código garantindo que o caminho quente não aloca no heap (passagem de parâmetros escalares, buffers pré-alocados pelo chamador), acompanhada de teste medindo a estabilidade de RSS (`process.memoryUsage().rss`) e tempo estável por chamada em várias rodadas de 1.000 chamadas consecutivas de `raycastNonAlloc` e `overlapSphereNonAlloc`;
8. O custo de reconstrução do índice espacial do executor no host ser medido e reportado no benchmark do Lote B.

---

## 8. Topologia do Índice Espacial e Limitações Conhecidas

### 8.1 Grid Híbrido Estático vs. Dinâmico
Para atender simultaneamente a simulações de alta taxa de atualização (60 Hz) com milhares de corpos e consultas espaciais rápidas:
1. **Grid Estático (Multi-célula para Corpos Normais):**
   - Corpos estáticos normais são inseridos em todas as células que sua AABB sobrepõe.
   - A reconstrução ocorre exclusivamente quando a versão composicional da cena (`compVersion`) muda (custo amortizado por passo = 0).
   - O tamanho da célula estática (`sStaticCellSize`) é dimensionado pela **mediana** das meias-extensões dos corpos estáticos normais (`max(2.0, median * 2.0)`).
2. **Grid Dinâmico (Célula Única por Centro + Expansão de Consulta):**
   - Cada corpo dinâmico normal reside em exatamente uma célula determinada por seu centro de massa.
   - Reduz o volume de inserções por passo de ~16.000 para 2.000, permitindo reconstrução em ~0,33 ms para 2.000 corpos.
   - Consultas de overlap e DDA de raycast expandem a região de busca pela maior meia-extensão dinâmica (`sDynamicMaxHalfExtent`).

### 8.2 Lista de Objetos Grandes (`LARGE_OBJECT_THRESHOLD = 16.0`)
Para evitar patologias de fragmentação e inflação dimensional com corpos atípicos:
1. **Limiar de Segregação:** Todo corpo com meia-extensão em qualquer eixo superior a $16.0$ u é classificado como objeto grande e segregado em lista dedicada (`sStaticLargeObjs` e `sDynamicLargeObjs`, pré-alocadas com capacidade 256).
2. **Terrenos e Planos Estáticos (ex.: 200×200 u ou 2.000×2.000 u):**
   - Não são inseridos no grid multi-célula. Isso elimina a fragmentação de dezenas de milhares de entradas na tabela de hash durante `Scene.add()` ou mutações estruturais (evitando picos de 200–800 ms de rebuild e colisões severas de buckets), mantendo a reconstrução estática em $\le 0.35$ ms.
3. **Corpos Dinâmicos Colossais (ex.: chefe de 50 u):**
   - Não entram no grid dinâmico por centro nem inflam `sDynamicMaxHalfExtent`. O grid dinâmico preserva seu tamanho de célula e raio de expansão calibrados para unidades normais (0.5 a 2.0 u).
4. **Resolução em Consultas:**
   - Consultas (`raycastNonAlloc`, `overlapSphereNonAlloc`, `overlapBoxNonAlloc`) percorrem o grid normalmente e, em seguida, testam os corpos da lista de objetos grandes (tipicamente 1 a 2 elementos, com custo $< 1$ µs).

### 8.3 Limitações Conhecidas e Dívidas Técnicas Registradas
1. **Tempo de Overlap em Cenas de Alta Densidade:**
   - Em cenários com alta concentração de corpos na área de consulta (18 a 27 corpos no raio $r=3$), o tempo de `overlapSphereNonAlloc` fica entre 33 µs e 55 µs (acima da meta estrita de 30 µs), devido ao custo de teste geométrico OBB/SAT e ordenação no runtime JS sem aceleração SIMD. Esta meta permanece como dívida técnica registrada para futura otimização nativa em Rust.


# Contrato de Consultas Espaciais, Latência e Eventos (Fase 1, §6 e Lote B)

> **Documento Normativo de Contrato**  
> Referência: `docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md` (§6, itens 7 e 8; §7.1; §7.2, Lote B).  
> Branch de revisão: `docs/fisica-contrato-consultas` (PR exclusivo de especificação antes de código).

---

## 1. Contexto e Enquadramento

O motor de física é projetado para **uso geral** (§7.1): deve atender desde jogos com multidões de agentes cinemáticos e estáticos (como RTS ou RPGs de ação) até simulações densas de corpos rígidos em contato contínuo (empilhamentos, tombamentos, destruição).

Em qualquer um desses perfis, consultas espaciais (`raycast`, `overlap`, `shapeCast`) são indispensáveis ao gameplay e à simulação:
- Seleção de entidades pela câmera e interação com o mouse;
- Validação espacial de movimentação, encaixe e footprint no cenário;
- Sensores de proximidade, áreas de efeito e volumes de trigger;
- Linha de tiro (LOS) e detecção de obstáculos para navegação.

Com múltiplos backends de aceleração física (CPU, Rust, GPU), a suposição ingênua de que toda consulta ocorre instantaneamente na memória local da CPU com atraso zero é falsa. Este contrato estabelece:
1. Onde reside a verdade do estado físico sob cada backend;
2. A decisão arquitetural de **quem executa** as consultas espaciais;
3. A latência real (medida em **passos**) e o carimbo obrigatório de `stepId`;
4. O payload das consultas, incluindo filtros `layer`/`mask`, suporte a triggers, listas determinísticas e variantes sem alocação (`NonAlloc`);
5. O ciclo de vida e a ordenação determinística dos eventos de contato.

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

## 3. Decisão Central: QUEM Executa a Consulta?

O motor adota formalmente o modelo de **Executor Único no Host**:

1. **Separação de Papéis:**
   - Os solvers de simulação (`Scene`, `GatherBackend` em Rust, kernel WGSL na GPU) têm como responsabilidade exclusiva **avançar o estado dos corpos** sob forças e contatos.
   - `GatherBackend::supports(raycast)` e `supports(overlap)` permanecem respondendo `false`. O solver nativo não deve ser inflado com lógica de consultas pontuais.
2. **Um Único Executor de Consultas:**
   - As consultas espaciais são executadas por um **subsistema dedicado no host**, operando sobre o estado autoritativo disponível na CPU (`pos`, `ext`, formas, estáticos).
   - O acelerador espacial no host utiliza a estrutura de **grid espacial** (a mesma que organiza a broad-phase da `Scene`, e não BVH).
3. **Consistência e Zero Divergência:**
   - Como a geometria e os algoritmos de intersecção (raio×esfera, raio×AABB, raio×malha) rodam no mesmo código no host, **não existe divergência algorítmica** entre backends.
   - O que muda entre os modos é estritamente o carimbo temporal (`stepId`):
     - Em modo CPU ou Rust: consulta lê o passo corrente (`atraso = 0`).
     - Em modo GPU: consulta lê o espelho sincronizado (`atraso = currentStep - pbGpuLastReadbackStep`).
4. **Consultas na VRAM com Gatilho:**
   - Uma implementação de raycast executada diretamente na VRAM via compute shader fica classificada como **otimização de desempenho com gatilho** (§7.3) para quando houver milhares de raios gerados na própria GPU (ex.: GPU-driven particles ou sensors). Ela **não faz parte do Lote B**.

---

## 4. Latência de Consultas por Modo de Simulação

| Modo Ativo | Onde a Consulta Executa | Atraso da Consulta | `stepId` Reportado | Velocidade no Ponto? | Comportamento sob Carga |
|---|---|:---:|:---:|:---:|---|
| **`PB_MODO_CPU`** | Grid do Host (CPU) | **0 passos** | `currentStep` | Sim | Síncrono no mesmo tick de lógica. |
| **`PB_MODO_RUST`** | Grid do Host (CPU) | **0 passos** | `currentStep` | Sim | Síncrono imediatamente após `rigid.step()`. |
| **`PB_MODO_GPU`** | Grid do Host (Espelho) | **1 a 6 passos** | `pbGpuLastReadbackStep` | **Não** | Lê o espelho trazido por `rbService`. |
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
   * Persiste através de ressincronizações completas do mundo.
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

### 5.2 Regras de Filtragem (`layer`, `mask`, `triggers`)
1. **Regra de Máscara:** Um corpo `B` é elegível para a consulta se a máscara da consulta concordar com a camada do alvo:
   ```typescript
   (filter.mask & B.layer) !== 0
   ```
2. **Triggers:**
   - Volumes colisionais marcados com a flag `trigger` são ignorados por padrão (`includeTriggers = false`).
   - Quando `includeTriggers = true`, são reportados com `depth = 0` em overlap ou no ponto de entrada em raycast.

### 5.3 `overlap` Devolve uma Lista Determinística
- Diferente de `raycast` (que devolve o primeiro impacto ao longo do raio), `overlap` pode atingir $N$ corpos simultaneamente.
- **Ordem Determinística Obrigatória:** A lista de `OverlapHit` devolvida deve ser **estritamente ordenada por `bodyId` crescente**.
- Sem essa ordenação, iterações de gameplay (como aplicar dano em área ou selecionar unidades) produziriam ordens de processamento distintas dependendo da organização interna das células do grid, quebrando replays determinísticos.

### 5.4 Identificador Estável (`bodyId`)
- Os índices de corpos nos arrays de `physics_backend` (`pbMap`, `Scene.gameObjects`) podem ser reordenados ou compactados durante ressincronizações completas (`crInit`, recriação de buffers em mapas com spawn contínuo).
- O campo `bodyId` reportado deve ser o identificador único estável atribuído ao corpo no momento de sua criação no motor, imutável até sua destruição.

### 5.5 Zero Alocação por Consulta (`NonAlloc`)
Em jogos em tempo real com centenas de consultas por frame, instanciar novos objetos `{ hit, point, normal }` gera sobrecarga intolerável de Garbage Collection (GC). O motor deve disponibilizar variantes `NonAlloc`:

```typescript
// Reutiliza objeto outHit pré-alocado pelo chamador (zero alocações no heap)
function raycastNonAlloc(
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance: number,
  outHit: RaycastHit,
  filter?: SpatialFilter,
): boolean;

// Preenche o buffer outHits até maxHits e devolve a contagem real de colisões encontradas
function overlapSphereNonAlloc(
  center: [number, number, number],
  radius: number,
  outHits: OverlapHit[],
  maxHits: number,
  filter?: SpatialFilter,
): number;
```

---

## 6. Ciclo de Vida dos Eventos de Contato (Lote B)

Além de consultas ativas, o Lote B implementa a notificação reativa de contatos (`contactBegin`, `contactPersist`, `contactEnd`, `triggerEnter`, `triggerExit`).

1. **Momento da Emissão:**
   - Os eventos de contato são gerados e despachados **estritamente após a conclusão do passo físico** (`postStep`), após a integração de posições e velocidades.
   - **Nenhum callback tem permissão para alterar o mundo** (criar corpos, destruir objetos, aplicar forças) durante a execução interna do solver.
2. **Ordenação Determinística da Fila de Eventos:**
   - Todos os eventos gerados em um passo são enfileirados e ordenados por:
     1. `stepId` (passo em que ocorreu o contato);
     2. Par canônico ordenado `(min(bodyIdA, bodyIdB), max(bodyIdA, bodyIdB))`.
3. **Determinismo:**
   - A garantia de ordenação pelo par canônico impede que variações de agendamento de threads no solver alterem a ordem em que os listeners de gameplay recebem os eventos.

---

## 7. Critérios de Aceite para o Lote B

O Lote B só será aprovado quando:
1. O backend GPU carimbar cada readback com o `stepCount` exato que o produziu (`pbGpuLastReadbackStep`);
2. Consultas em modo GPU reportarem `hit.stepId === pbGpuLastReadbackStep` comprovando o atraso real medido (1 a 6 passos);
3. Consultas em modos CPU e Rust reportarem `hit.stepId === currentStep`;
4. `overlap` devolver resultados ordenados deterministicamente por `bodyId`;
5. Filtros por `layer`, `mask` e `includeTriggers` passarem em testes unitários dedicados;
6. A API `NonAlloc` demonstrar zero alocações de memória heap sob medição durante loop de 1.000 consultas consecutivas.

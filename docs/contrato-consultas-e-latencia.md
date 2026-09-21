# Contrato de Consultas Espaciais e Latência (Fase 1, §6)

> **Documento Normativo de Contrato**  
> Referência: `docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md` (§6, itens 7 e 8; §7.2, Lote B).  
> Branch de revisão: `docs/fisica-contrato-consultas` (PR exclusivo de especificação antes de código).

---

## 1. Contexto e Motivação

Até a Fase 0, o motor de física não implementava consultas espaciais (`raycast`, `overlap`, `shapeCast`). Uma busca por `raycast` em `src/engine/` retornava zero ocorrências. No entanto, em um jogo de estratégia em tempo real (RTS), consultas espaciais são a espinha dorsal de quase toda interação de gameplay:
- Clique de seleção de unidades do jogador (raio da câmera contra colisores de unidade);
- Validação de ordens de movimento e construção (overlap de footprint no terreno/grid);
- Campo de visão, visibilidade de projéteis e verificação de linha de tiro (line-of-sight raycast);
- Sensores de proximidade e áreas de efeito (overlap esférico/caixa).

Com a introdução do contrato de posse e múltiplos backends paralelos (CPU, Rust, GPU), a premissa ingênua de que "uma consulta espacial lê o estado atual instantaneamente na memória da CPU sem custo" foi quebrada.

Este documento estabelece as regras formais e definitivas de:
1. Onde reside a verdade do estado físico sob cada backend;
2. Qual é a latência de consultas (`raycast` e `overlap`) em cada backend;
3. Qual é o payload obrigatório de resposta das consultas (incluindo `stepId`);
4. Qual é o comportamento quando um backend não suporta a consulta solicitada.

---

## 2. Posse e Onde Reside a Verdade

O motor opera sob o modelo de **posse de estado** (`pbDono` em `src/engine/core/physics_backend.ts`):

```
                       ┌─────────────────────────────────────────┐
                       │           Scene CPU (Host)              │
                       │   GameObjects, Transforms, Colliders    │
                       └──────────────────┬──────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  │ pbDono = CPU          │ pbDono = RUST         │ pbDono = GPU
                  ▼                       ▼                       ▼
       ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐
       │   Scene CPU Solver   ││  Rust rts:rigid      ││   GPU gpurigid       │
       │                      ││  (Rayon Workers)     ││   (WGSL Compute)     │
       │  Verdade: Memória    ││  Verdade: Buffers    ││  Verdade: VRAM       │
       │  do Host (RAM)       ││  do Host (RAM)       ││  (Storage Buffers)   │
       │                      ││                      ││                      │
       │  Latência: 0         ││  Latência: 0         ││  Espelho Host:       │
       │  Velocidade: Sim     ││  Velocidade: Sim     ││  Latência: 1 frame   │
       │                      ││                      ││  Velocidade: NÃO     │
       └──────────────────────┘└──────────────────────┘└──────────────────────┘
```

### 2.1 Backend CPU (`pbDono === PB_MODO_CPU`)
- **Onde está a verdade:** Na memória RAM do processo, nas estruturas da `Scene` e nos componentes `Transform`/`Rigidbody` dos `GameObjects`.
- **Sincronia:** Imediata. Toda alteração feita pelo solver reflete-se diretamente no mesmo tick.

### 2.2 Backend Rust (`pbDono === PB_MODO_RUST`)
- **Onde está a verdade:** Nos buffers compartilhados de corpo do host (`Float32Array`: `pos`, `vel`, `ext`, `world`).
- **Sincronia:** O solver em Rust roda síncrono na thread JS principal (distribuindo o cálculo via `rayon` nos núcleos de CPU) e atualiza diretamente as fatias de memória dos buffers do host. Ao retornar da chamada `rigid.step()`, os buffers do host contêm o estado atualizado do frame atual.

### 2.3 Backend GPU (`pbDono === PB_MODO_GPU`)
- **Onde está a verdade:** **Na VRAM da GPU**, nos storage buffers `pose`, `motion` e `world`.
- **O estado do espelho no host (CPU):**
  - O host (CPU) só recebe as posições atualizadas após o despacho do compute shader e a conclusão da transferência assíncrona (`readBuffer` / `stagingBuffer` via `rigidFlush`).
  - **O espelho da CPU tem 1 frame de atraso ($N-1$).** Quando o código TypeScript executa no frame $N$, os transforms dos `GameObjects` refletem a posição calculada no frame $N-1$.
  - **O espelho da CPU NÃO possui velocidade.** O procedimento `pbApply()` copia `pos.xyz` para os `Transforms`, mas intencionalmente **não lê nem sincroniza `vel`** para a CPU por restrições de largura de banda e throughput de cópia.
  - **Conclusão normativa:** Quando a GPU detém a posse (`pbDono === PB_MODO_GPU`), a CPU **não possui a verdade do frame corrente**, possuindo apenas uma aproximação atrasada e desprovida de velocidade.

---

## 3. Latência de Raycast e Overlap por Backend

A tabela a seguir define formalmente a latência garantida de consultas espaciais:

| Backend | Método de Execução da Consulta | Latência (Frames) | Velocidade Disponível? | Custo / Impacto |
|---|---|:---:|:---:|---|
| **CPU (`Scene`)** | Síncrono no grafo de cena / BVH local | **0** | Sim | Custo em CPU proporcional ao número de corpos. |
| **Rust (`rts:rigid`)** | Síncrono via buffers do host / acelerador nativo | **0** | Sim | Paralelizável em Rayon, sem stall de GPU. |
| **GPU (Espelho CPU)** | Síncrono na CPU consultando o espelho atrasado | **1** ($N-1$) | **Não** | Imediato na CPU, mas lê a posição do frame anterior. |
| **GPU (Compute)** | Assíncrono via shader de query na VRAM | **1** ($N+1$) | Sim (na VRAM) | Despachado no frame $N$, resposta disponível via readback no frame $N+1$. |
| **GPU (Bloqueante)** | Forçar stall de pipeline (`device.poll` síncrono) | **0** | Sim | **PROIBIDO PELO CONTRATO.** Destrói o paralelismo CPU-GPU e causa stutter visível. |

### 3.1 Regras de Latência para o Gameplay
1. **Consultas de Seleção de UI / Clique do Usuário:**
   - Podem tolerar latência de 1 frame ($N-1$). O clique do jogador ocorre na escala de dezenas de milissegundos; uma defasagem de 16,6 ms (1 frame a 60 FPS) é imperceptível na seleção visual.
2. **Consultas de Lógica de Jogo / Balística / Evasão Física:**
   - Se a cena rodar em modo GPU e exigir resolução de contato com velocidade no frame presente, a consulta **deve declarar a defasagem** ou o decisor deve direcionar o frame para backend capaz de latência 0 (CPU ou Rust).
3. **Proibição de Bloqueio Síncrono da GPU:**
   - É terminantemente proibido inserir esperas bloqueantes (`await readBuffer` ou loop de polling síncrono) dentro do frame de renderização para obter raycast com latência 0 da GPU.

---

## 4. Payload de Resposta do Contrato

Toda consulta espacial (`raycast`, `overlap`) deve retornar uma estrutura padronizada contendo obrigatoriamente os metadados temporais.

### 4.1 Definição de Tipos (TypeScript / Rust)

```typescript
export interface RaycastHit {
  /** Se houve intersecção válida. */
  hit: boolean;

  /** Identificador do corpo rígido ou índice do GameObject atingido (-1 se nenhum). */
  bodyId: number;

  /** Ponto de impacto em coordenadas de mundo (xyz). */
  point: [number, number, number];

  /** Normal da superfície no ponto de impacto, apontando para fora do corpo (xyz normalizado). */
  normal: [number, number, number];

  /** Distância da origem do raio até o ponto de impacto. */
  distance: number;

  /**
   * Identificador monotônico do passo físico (stepId) no qual esta consulta foi calculada.
   * OBRIGATÓRIO: Permite ao chamador distinguir respostas do frame atual daquelas do espelho atrasado.
   */
  stepId: number;
}

export interface OverlapHit {
  /** Se houve sobreposição. */
  hit: boolean;

  /** Identificador do corpo rígido sobreposto. */
  bodyId: number;

  /** Profundidade máxima de penetração. */
  depth: number;

  /** Vetor normal de separação sugerido (aponta de A para B). */
  normal: [number, number, number];

  /** Identificador monotônico do passo físico em que o overlap foi avaliado. */
  stepId: number;
}
```

### 4.2 Por que `stepId` é Obrigatório e Indispensável?
1. **Descarte de acumulador em `stepsFor`:** O sistema de passo fixo descarta o tempo que excede o orçamento do frame para evitar a espiral da morte (`docs/superpowers/specs/2026-09-20-paralelismo-e-fundacao-design.md`, §6 item 10). Portanto, o tempo decorrido em segundos (`dt`) não é correlacionável de forma determinística com os passos simulados. O contador monotônico de passos (`stepCount()`) é o único relógio válido da física.
2. **Identificação de respostas atrasadas:** Ao receber um `RaycastHit`, o sistema consumidor verifica:
   ```typescript
   if (hit.stepId < currentPhysicsStepId) {
     // A resposta veio do espelho do frame anterior (modo GPU).
   }
   ```
3. **Consistência em Replays e Lockstep:** Gravações de replay e verificações de integridade registram as ações de seleção do jogador indexadas ao `stepId`. Sem esse campo, uma consulta reexecutada em um replay divergirá dependendo do backend em que for executada.

---

## 5. Comportamento Quando o Backend Não Suporta

Em estrita conformidade com a **Regra 9 do crate** (`rts-physics` README) e as diretrizes do motor:
> *"Um backend que não sabe recusa pelo nome (`Backend::supports`). Uma recusa explícita é um recurso; uma aproximação em silêncio é um defeito grave."*

### 5.1 Protocolo de Recusa
1. **Declaração Formal via `Needs`:**
   - O campo `needs.raycast = true` ou `needs.overlap = true` é submetido ao backend.
   - O método `supports(&Needs)` do backend responde `false` se o backend não dispuser de aceleração nativa para a consulta (hoje, tanto o `GatherBackend` do Rust quanto o kernel atual da GPU recusam e respondem `false`).
2. **Recusa na Fronteira Nativa:**
   - Se uma chamada de query for dirigida a um backend nativo que não a suporta, o retorno deve ser um erro explícito (`StepOutcome::Unsupported` em Rust, ou retorno com código de erro específico no shim TS), **nunca** um resultado vazio `hit: false` fictício. Um resultado falso faria o jogo acreditar que o caminho está livre quando na verdade a query nem sequer foi executada.
3. **Tratamento no Decisor (`physics_backend.ts`):**
   - **Caminho A (Fallback de Simulação):** Se a cena declarar que depende criticamente de consultas suportadas apenas pela CPU (ex.: `scene.needsRaycast = true`), o decisor rebaixa a simulação da cena para `PB_MODO_CPU`, emitindo aviso diagnóstico com a razão explícita.
   - **Caminho B (Roteamento de Consulta para a CPU com Aviso de Defasagem):** Se a simulação permanecer em GPU/Rust acelerado por razões de performance e uma consulta pontual for solicitada via API de conveniência, a consulta é resolvida pelas estruturas da CPU contra o espelho disponível, marcando obrigatoriamente no resultado `stepId = pbLastStepId` (evidenciando a latência de 1 frame quando a GPU tem a posse).

---

## 6. Critérios de Aceite para o Lote B

Este contrato é a base normativa para o **Lote B (Consultas e Eventos)** (§7.2 do documento de design). O Lote B só poderá ser considerado concluído quando:
1. As interfaces `RaycastHit` e `OverlapHit` incluírem formalmente `stepId`;
2. Testes automatizados comprovarem que consultas executadas com posse na GPU declaram explicitamente a defasagem temporal (`stepId === currentStep - 1`);
3. Backends que não implementam aceleração espacial recusarem expressamente requisições diretas via `supports(need)`, sem degradação silenciosa;
4. Nenhuma consulta síncrona bloqueie a pipeline da GPU.

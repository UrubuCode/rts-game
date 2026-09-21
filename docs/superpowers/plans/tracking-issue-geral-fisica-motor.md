## Visão Geral do Épico

Este é o **quadro geral de acompanhamento** para a evolução completa da física e da arquitetura do motor ([UrubuCode/rts-game](https://github.com/UrubuCode/rts-game) e [UrubuCode/rts](https://github.com/UrubuCode/rts)).

Ele consolida a discussão da [Issue #1](https://github.com/UrubuCode/rts-game/issues/1), a **Revisão 3 da Spec de Paralelismo** (PR #2) e os planos técnicos arquivados em `docs/superpowers/plans/`. 

O objetivo é transformar a física atual (apenas translação em AABB) em um subsistema completo, determinístico e de alta performance com três níveis (`simples`, `orientada` e `completa`), servindo tanto a jogos de estratégia em tempo real (RTS) com milhares de agentes quanto a jogos com física rígida densa.

---

## 🗺️ Mapa de Execução e Checklist Geral

```
Fase 0 (Decisor Honesto) ──► Fase 1 (Contratos) ──► Fase 2 (Lotes A até G) ──► Fases Futuras (GPU Residente / Escalonador)
                                                           │
                                                           └──► Épico RTS (Agentes Cinemáticos, NavGrid, Flow Fields, ORCA)
```

---

### 📦 Fase 0 — Decisor Honesto e Padrão Certo (`2026-09-20-fase0-decisor-medido.md`) *(Concluído)*
> *Objetivo: Eliminar números obsoletos e substituir o modelo analítico/inventado por uma tabela medida `(threads, n) -> ms`.*

- [x] **1. Tabela Medida:** Substituir `rigidCalibrate`, `rigidGpuCostMs` e `rigidCpuCostMs` por interpolação sobre a tabela medida de §2.2 da spec (`backend_profile.ts`).
- [x] **2. Preservar Detecção de GPU:** Manter `pbGpuPresente() = gpu.available()` fora do calibrador.
- [x] **3. Portão de Disponibilidade Rust:** `crAvailable()` respondendo à existência real da feature `physics` no `rts-host` via sondagem.
- [x] **4. Padrão Condicionado ao Perfil:** Modo `AUTO` (`pbModo = 3`) que consulta o perfil medido por (n, threads).
- [x] **5. Limpeza de Números Obsoletos:** Remover comentários defasados (`physics_backend.ts`, `scene.ts:1171,1174`, `claude-bench-computeworld.ts`).
- [x] **6. Atualização de Testes:** Atualizar `tests/claude-test-physics-backend.ts` e `dispatch.ts`.

---

### 📜 Fase 1 — Contratos Fundamentais do Motor
> *Objetivo: Definir o vocabulário e a governança antes de expandir as capacidades do solver.*

- [ ] **1. Contrato `Needs` Completo:** Suporte a `deterministic`, `raycast`, `overlap`, `contact_events` e campo de nível (`simples`, `orientada`, `completa`).
- [ ] **2. Contrato de Consultas e Latência:** Formalizar que consultas síncronas na posse da GPU respondem sobre o último snapshot (1 frame de latência) ou via acelerador CPU.
- [ ] **3. Replay Contado em Passos:** Replay dirigido estritamente pelo contador inteiro `stepId`, imune ao descarte de tempo do acumulador `stepsFor`.
- [ ] **4. Contrato de Sistemas:** Declaração explícita de leitura, escrita e modo (determinístico vs. cosmético).

---

### ⚙️ Fase 2 — O Vocabulário da Física (Sete Lotes de Escopo Firme)
> *Objetivo: Rotação, OBB, manifolds, dinâmica angular e estabilidade.*

#### [x] Lote A — Fundação, Layout e Correções de Paridade *(Concluído)*
- [x] **A1. Host wgpu (`rts`):** `max_storage_buffers_per_shader_stage = 8` no `crates/rts-egui/src/frame/gpu.rs`.
- [x] **A2. Paridade dos Estáticos (`rts-game`):** `rbSyncStatics` e `crSyncStatics` somando `centerLocal*` rotacionado por yaw.
- [x] **A3. Semântica de Cinemáticos (`rts-game`):** `pbEmpurraTeleportes` preservando velocidade de corpos cinemáticos.
- [x] **A4. Layout Versionado nos 3 Backends:** `pose` (8 floats), `motion` (8 floats) e `world_tail` (frio). Tipos canônicos `static`, `kinematic`, `dynamic` e `layer/mask`.
- [x] **A5. Portão de Aceite:** 27 testes do jogo e 36 testes do crate verdes; sem regressão > 5% no nível `simples`.

#### [ ] Lote B — Consultas e Eventos
- [ ] **B1. Consultas Espaciais:** `raycast` e `overlap` com especificação de latência e retorno associado ao `stepId`.
- [ ] **B2. Fila de Eventos:** Eventos `begin`, `persist`, `end` e `trigger` enfileirados estritamente **após** o solver, ordenados pelo par canônico `(minBodyId, maxBodyId)`.

#### [ ] Lote C — OBB sem Torque (A Caixa que Gira Colide Girada)
- [ ] **C1. Pose Canônica:** Quaternion como estado físico (Euler apenas na API/Inspector).
- [ ] **C2. SAT de 15 Eixos (OBB × OBB):** 3 eixos de A, 3 de B e 9 produtos cruzados entre arestas.
- [ ] **C3. Robustez Numérica:** Descarte determinístico de arestas quase paralelas ($\|e_1 \times e_2\| < 10^{-4}$) em favor das faces.
- [ ] **C4. OBB × Esfera:** Clamp do centro da esfera no espaço local da caixa.
- [ ] **C5. Broad-phase:** Indexação no grid pelo AABB do OBB.

#### [ ] Lote D — Manifolds e Estabilidade de Pilha
- [ ] **D1. Manifold sem Memória (Recálculo por Sub-passo):**
  - Recorte de face incidente contra face de referência (até 4 pontos de contato).
  - Contato suave: parâmetros físicos em Hz e amortecimento (substituindo slop empírico).
  - *Mass Splitting* (Tonge et al., 2012) no kernel gather/Jacobi da GPU para eliminar jitter sem locks.
- [ ] **D2. Warm Starting Persistente (Contingência):**
  - Tracking de feature IDs e impulsos acumulados entre frames.
  - *Ativação estritamente condicionada:* somente se D1 reprovar no teste de assentamento de 2.000 caixas.

#### [ ] Lote E — Dinâmica Angular (Torque e Inércia)
- [ ] **E1. Tensores de Inércia:** Cálculo de inércia inversa local e em mundo para caixas e esferas.
- [ ] **E2. Velocidade Angular e Torque:** Ponto de contato na narrow phase gerando torque a partir de impulsos normais e tangenciais de atrito.
- [ ] **E3. Integração de Quaternions:** Atualização da orientação via velocidade angular.
- [ ] **E4. Sono Angular:** Corpos girando não dormem com o centro parado.
- [ ] **E5. Aceite:** Caixas tombam ao serem empurradas pela base; momento conservado.

#### [ ] Lote F — Sono por Ilha
- [ ] **F1. Grafo de Contatos e Ilhas:** DFS determinístico no Rust e propagação por vizinhança na GPU.
- [ ] **F2. Wake-up em Cadeia:** Deslocar a base de uma pilha acorda todos os corpos dependentes.

#### [ ] Lote G — CCD Seletivo (Detecção de Colisão Contínua)
- [ ] **G1. Modos `discrete` e `sweep`:** Habilitação por corpo/projétil.
- [ ] **G2. Sweep contra Estáticos:** Eliminar tunneling sem depender apenas do teto de 48 u/s.

---

### 🚀 Fases Futuras com Gatilho Medido
> *Estruturas de otimização que trocam complexidade por performance e só entram sob demanda comprovada.*

- [ ] **Fase 3 — GPU Residente (`draw_indirect`):**
  - *Gatilho:* `P_MUNDO3D` com preparação de CPU dominando o frame.
  - *Ação:* Desenho de partículas e escombros direto dos buffers da GPU sem readback.
- [ ] **Fase 4 — Escalonador de Tarefas (`rts:jobs`):**
  - *Gatilho:* Sistema individual > 8 ms e ociosidade CPU+GPU > 30% em frame que estoura 16.7 ms (`vsync 0`).
- [ ] **Evolução do Solver Rust — Coloração de Grafos:**
  - *Gatilho:* Solver Rust com ilhas grandes virando gargalo sequencial.
  - *Ação:* Paralelização de Gauss-Seidel por cores de contatos (Box2D v3).

---

### ⚔️ Integração com o Épico RTS (`super-plano-rts.md`)
> *Unidades são agentes cinemáticos, não corpos rígidos dinâmicos no solver denso.*

- [ ] **RTS-0:** `UnitId`, comandos serializáveis por `stepId` e checksum de replay.
- [ ] **RTS-1:** Seleção espacial determinística (caixa de seleção e raycast).
- [ ] **RTS-2:** Agente cinemático com velocidade desejada e aceleração (depende do **Lote A**).
- [ ] **RTS-3 / RTS-4:** NavGrid com A* local e HPA* com portais e clusters para mapas grandes.
- [ ] **RTS-5 / RTS-6:** Formações e desvio local determinístico (ORCA/RVO).
- [ ] **RTS-7:** Flow Fields para navegação em massa de milhares de unidades.
- [ ] **RTS-8:** Combate, disparo de projéteis CCD e fila de dano pós-solver.
- [ ] **RTS-9 / RTS-10:** Fog of War, mapas de influência e lockstep multiplayer.

---

*Este quadro será atualizado a cada avanço, PR ou medição nos repositórios `rts-game` e `rts`.*

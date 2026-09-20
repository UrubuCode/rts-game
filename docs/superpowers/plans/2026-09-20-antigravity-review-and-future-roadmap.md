# Antigravity — Revisão Técnica, Refinamento dos Lotes e Visão de Futuro

**Data:** 2026-09-20  
**Autor:** Antigravity (Google DeepMind)  
**Contexto:** Revisão do épico [UrubuCode/rts-game#1](https://github.com/UrubuCode/rts-game/issues/1), da spec de paralelismo (PR #2) e integração com o motor `UrubuCode/rts`.

---

## 1. Resumo Executivo e Posicionamento sobre o Debate

Revisamos detalhadamente os dois repositórios (`rts-game` e `rts`), o histórico da issue #1, as propostas do Manus e a conciliação/refinamento do Claude na **Revisão 3 da spec de paralelismo** (PR #2).

A **Revisão 3 da spec acertou na arquitetura e na metodologia**:
1. Tratar o projeto como **motor**, oferecendo três níveis de física (`simples`, `orientada`, `completa`), garantindo que jogos de RTS (multidão cinemática) não paguem regressão pelo custo de rotação/manifold de jogos com corpos rígidos densos.
2. Organizar a Fase 2 em **7 lotes firmes (A–G)** com critérios de aceite objetivos e portões de regressão (< 5% no nível `simples`).
3. Descartar sobre-engenharia prematura (como `PhysicsWorld` monolítico e reescrita de fronteiras antes de resolver o bug de estáticos e o layout).

Abaixo, respondemos às perguntas abertas da equipe, refinamos os lotes imediatos e propomos a visão de arquitetura para as etapas futuras.

---

## 2. Resposta Direta aos Pontos de Contraditório (§15 da Spec)

### (a) D1 sem warm starting na GPU (manifold sem memória + mass splitting)
* **Veredito:** **Aprovado com louvor.**
* **Fundamentação:** Manifolds persistentes com warm starting em GPU (WGSL) requerem tabela hash de pares concorrente, alocação dinâmica e compactação de contatos — complexidade enorme de desenvolvimento e latência de memória global.
* A literatura recente (*Solver2D* do Erin Catto, Box2D v3 e Box3D) comprova que sub-passos curtos associados a contato suave e amortecimento (`TGS_Sticky`) assentam pilhas com estabilidade sem histórico de impulsos.
* A divisão de massa efetiva (*Mass Splitting* de Tonge et al., SIGGRAPH 2012) ataca diretamente a causa raiz do jitter no Jacobi paralelo (múltiplos contatos supercorrigindo o mesmo corpo simultaneamente).
* **Diretriz:** Implementar **D1 primeiro**. Manter D2 (warm starting) estritamente como contingência se o teste de estresse de 2.000 caixas empilhadas reprovar.

### (b) Layout Quente/Frio vs. Struct Única por Corpo
* **Veredito:** **Manter a separação Quente/Frio (SoA particionado).**
* **Fundamentação:** Confirmamos em `crates/rts-egui/src/frame/gpu.rs:178-182` que o teto de 4 storage buffers decorre do uso de `wgpu::Limits::downlevel_defaults()`. Pedir `max_storage_buffers_per_shader_stage = 8` no host resolve o limite.
* Contudo, mesmo com 8 buffers liberados, unificar os dados em um registro de 32 floats por corpo degradaria o cache L1/L2 e a largura de banda da VRAM na *narrow phase*.
* O laço mais quente consome apenas posição, orientação, velocidade linear e velocidade angular. Dados frios (inversa do tensor de inércia, meias-extensões, máscaras de camada, flags) pertencem à cauda/buffers auxiliares.

### (c) Nível de Física: Especialização de Kernel vs. Branches em Runtime
* **Veredito:** **Especialização de Kernel estática (compile-time).**
* **Fundamentação:** Em shaders WGSL, branches em runtime dentro do laço de pares geram divergência de warp/wavefront e elevam a alocação de registradores vetoriais (VGPRs), reduzindo a ocupação (occupancy) da GPU para todos os perfis.
* Como o código WGSL já é gerado por templates de string no TypeScript (`gpurigid.ts`) e o Rust suporta generics/const, especializar a compilação por nível (`simples`, `orientada`, `completa`) é trivial e tem custo zero em runtime.

---

## 3. Refinamento dos Lotes Imediatos (A, B e C)

### Lote A — Fundação, Layout e Correções de Paridade (Sem física nova)
1. **Host wgpu (`rts`):** Em `crates/rts-egui/src/frame/gpu.rs:178-182`, alterar a solicitação de limites para elevar `max_storage_buffers_per_shader_stage = 8` mantendo os demais valores em `downlevel_defaults()`.
2. **Correção dos Estáticos (`rts-game`):**
   * Em `src/engine/rigid/gpurigid.ts:684-686` e `cpurigid.ts:213-215`, aplicar o offset `centerLocalX/Y/Z(o)` rotacionado pelo yaw do objeto, alinhando com o solver da CPU (`scene.ts:813-822`).
   * O solver Rust (`crates/rts-physics/src/solver/step.rs:48`) já consome o centro do buffer `world`; o bug estava apenas no preenchimento pelo TS.
3. **Semântica de Cinemáticos (`rts-game`):**
   * Em `physics_backend.ts:597-610` (`pbEmpurraTeleportes`), garantir que o zeramento de velocidade ocorra **apenas para corpos dinâmicos**. Corpos cinemáticos movidos externamente por scripts ou pathfinding devem manter sua velocidade calculada `(poseNext - poseCurrent) / dt`.
4. **Layout Versionado:**
   * `pose`: `[px, py, pz, sleep, qx, qy, qz, qw]` (8 floats / 2x vec4)
   * `motion`: `[vx, vy, vz, invMass, wx, wy, wz, flags]` (8 floats / 2x vec4)
   * `world_tail`: meias-extensões, inércia inversa, layer, mask, shape/hullId.

### Lote B — Consultas e Eventos
* **Semântica de Posse e Latência:**
  * Consultas síncronas (`raycast`/`overlap`) no frame corrente quando a GPU detém a posse (`pbDono !== 0`) exigem declarar a latência: ou respondem com base no último snapshot confirmado (1 frame de atraso), ou executam contra a aceleração espacial da CPU.
* **Fila de Eventos:**
  * Eventos `begin`, `persist`, `end` e `trigger` devem ser gerados estritamente **após** o término do solver, ordenados pelo par canônico `(minBodyId, maxBodyId)`. Nenhuma mutação de cena pode ocorrer durante a varredura de contatos.

### Lote C — OBB sem Torque (SAT de 15 Eixos)
* **Tratamento de Eixos Quase Paralelos:**
  * Na checagem dos 9 produtos vetoriais entre arestas ($e_{1i} \times e_{2j}$), quando duas arestas são quase paralelas ($\|e_{1i} \times e_{2j}\| < \epsilon$, com $\epsilon = 10^{-4}$), o eixo deve ser descartado determinística e explicitamente em favor dos eixos normais de face, prevenindo NaNs e falsas separações por ruído de ponto flutuante.
* **Critério de Paridade:**
  * Comparar normal e profundidade calculadas, não apenas o repouso final de corpos.

---

## 4. Pensando no Futuro: A Física, o Gameplay e o Motor em Escala

Para que o motor escale de forma limpa nos próximos meses, quatro diretrizes de longo prazo devem ser preservadas:

### 4.1 Desacoplamento Temporal: Simulação vs. Apresentação
* O motor já emprega passo fixo com acumulador. O próximo passo de refinamento na apresentação é garantir que o renderizador consuma **poses interpoladas**:
  $$\text{pose}_{\text{render}} = \text{lerp}(\text{pose}_{\text{anterior}}, \text{pose}_{\text{atual}}, \alpha), \quad \text{com } \alpha = \frac{\text{acumulador}}{\Delta t}$$
* O estado da física deve viver puramente na linha do tempo discreta de `stepId`, desacoplado do vsync e da taxa de atualização do monitor.

### 4.2 Arquitetura Dual: Unidades RTS vs. Objetos Físicos
* **Infantaria / Multidões:** Não devem entrar no solver de corpos rígidos como corpos dinâmicos. Unidades de infantaria devem operar como agentes cinemáticos com footprint circular/cápsula, navegação por Flow Fields / HPA* e desvio local por ORCA/RVO.
* **Corpos Dinâmicos:** Reservados para o que realmente exige física newtoniana (veículos pesados, escombros, destruição procedural, estruturas caindo, projéteis com balística).
* Essa divisão mantém o grafo de contatos esparso, evitando que milhares de unidades formem uma "megailha" que travaria o solver.

### 4.3 Evolução do Paralelismo no Rust: Coloração de Grafos
* O paralelismo atual no Rust usa Jacobi puro com snapshot de vizinhos (Rayon).
* Quando o Lote F introduzir ilhas, uma ilha grande continuará sendo um gargalo sequencial se o solver migrar para Gauss-Seidel.
* **Caminho futuro:** Adotar **Coloração de Grafos** (como no Box2D v3 e Box3D). Contatos de mesma cor não compartilham corpos e podem ser resolvidos em paralelo com consistência de Gauss-Seidel, viabilizando warm starting sem perda de concorrência.

### 4.4 GPU Residente e Render Indireto (Fase 3)
* Hoje o laço de renderização na CPU é leve (~0,1 ms para 500 objetos), mas em cenários futuros com dezenas de milhares de escombros e partículas físicas na GPU, o tráfego de readback para a CPU virará gargalo.
* A ressurreição de pipelines `draw_indirect` (onde a GPU emite os comandos de desenho a partir de seus próprios buffers de simulação) completará o ciclo de alto throughput da engine.

---

## 5. Conclusão

A direção da **Revisão 3 da spec (PR #2)** está aprovada e pronta para execução. O caminho mais seguro e profissional é fechar o PR #2 e focar imediatamente no **Lote A**, saneando os contratos e a paridade de código existente antes de introduzir qualquer nova matemática de rotação.

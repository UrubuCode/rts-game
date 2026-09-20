# Revisão técnica — `UrubuCode/rts-game#1`

> **Aviso (2026-09-20):** documento de referência. Ordem, escopo e aceite são os de
> [`../specs/2026-09-20-paralelismo-e-fundacao-design.md`](../specs/2026-09-20-paralelismo-e-fundacao-design.md), §7 e §14.

**Data da revisão:** 20/09/2026  
**Repositório revisado:** `UrubuCode/rts-game`  
**Commit local:** `3d29515` (`docs: design de paralelismo (revisao 2) e plano da Fase 0`)  
**Issue:** [EPIC] Rotação, OBB e manifold: o que falta para a física deixar de ser só translação

## Resumo executivo

A issue está corretamente enquadrada como um épico de arquitetura, não como um bug isolado. O projeto já possui uma base razoável para a próxima etapa: passo fixo, broad-phase por grid no solver TypeScript e no GPU, formas esfera/caixa, materiais, sleeping, triggers no solver de cena e um contrato inicial de posse entre cena e backend.

Entretanto, o núcleo anunciado pela issue ainda não está implementado no commit revisado. A física de corpos continua sem orientação no estado físico, sem OBB, sem velocidade angular/torque e sem manifold persistente. A documentação reconhece isso explicitamente: a orientação prevista em `hullpack.ts` é somente entrada; não existe dinâmica angular.

Minha recomendação é **não iniciar a implementação de OBB diretamente no layout atual**. Primeiro deve ser congelada a decisão de layout/contratos mencionada no plano de paralelismo: orientação, velocidade angular, inventário de contatos/manifold, máscara de camadas e índice de contato. O próprio plano afirma que os 16 floats atuais por corpo estão ocupados e que a limitação de quatro storage buffers impede simplesmente acrescentar um buffer.

## Estado verificado

| Área | Estado observado | Avaliação |
|---|---|---|
| Broad-phase | Grid espacial presente no solver da cena e no GPU | Implementado, mas com limites e paridade ainda dependentes do backend |
| Formas primitivas | Esfera, caixa e caminho parcial para casca convexa | Implementado para casos específicos |
| Orientação física | `Transform` tem rotação para a cena/render; o layout físico não carrega estado angular | Ausente |
| OBB | Solver GPU calcula AABB por eixos; solver CPU resolve caixas alinhadas aos eixos | Ausente |
| Velocidade angular/torque | Não há estado nem resposta angular | Ausente |
| Manifold/warm starting | Há um `Contact` temporário para casca, mas não manifold persistente por par | Ausente |
| Camadas/máscaras | Não há máscara de colisão no corpo nem filtro por bits | Ausente |
| Corpos cinemáticos | `stationary` mistura estático/kinematic; `invMass=0` é imóvel | Ausente |
| Eventos | Triggers são registrados na `Scene`; os backends externos não expõem um canal equivalente de contatos | Incompleto |
| Paridade | Teste de repouso para primitivas; GPU é pulada sem placa | Parcial |

## Achados prioritários

### 1. [P0] O layout físico atual não comporta a próxima fase

Os buffers documentados em `src/engine/rigid/gpurigid.ts` são:

- `pos`: posição + contador de sono;
- `vel`: velocidade linear + forma;
- `ext`: meia-extensão + inverso da massa;
- `world`: parâmetros, estáticos, grid e materiais.

O comentário de `src/engine/core/hullpack.ts` declara a orientação como somente leitura e afirma que não existe velocidade angular nem torque. Isso não satisfaz o título da issue se “rotação” significar dinâmica de corpos; cobre apenas colisão contra geometria orientada fornecida pelo transform.

**Impacto:** qualquer implementação local de OBB que não resolva primeiro o layout terá de ser reescrita quando entrar torque, manifold, máscaras e contatos persistentes.

**Ação recomendada:** antes da matemática de OBB, publicar uma decisão de layout com:

1. quaternion por corpo;
2. velocidade angular por corpo;
3. flags/static/kinematic/trigger;
4. camada e máscara de colisão;
5. identificador de par e índice de ponto de contato;
6. capacidade e política de overflow do manifold;
7. propriedade de cada campo e backend que pode escrevê-lo.

### 2. [P0] OBB ainda não existe; a física continua axis-aligned

No solver CPU, o ramo caixa-caixa usa as penetrações `ox`, `oy`, `oz` calculadas diretamente pelas extensões em X/Y/Z (`src/engine/core/scene.ts`, aproximadamente linhas 859–882). No kernel GPU, `contato()` repete a mesma lógica de AABB (`src/engine/rigid/gpurigid.ts`, aproximadamente linhas 227–235).

A rotação presente em `Transform.rx/ry/rz` não é incorporada à narrow phase. Portanto, uma caixa rotacionada visualmente continua colidindo como caixa alinhada aos eixos.

**Teste que falta:** duas caixas de mesma dimensão, uma girada 45 graus, em contato lateral e sobre uma plataforma. O resultado deve verificar normal, profundidade, separação e repouso, não apenas ausência de penetração.

### 3. [P1] Há divergência real entre CPU e GPU em colliders estáticos deslocados

A CPU aplica o centro local do collider: o caminho de `solvePair` usa os centros calculados com os offsets do component (`src/engine/core/scene.ts`, aproximadamente linhas 891–897 e a preparação de `csCX/csCY/csCZ`).

Já `rbSyncStatics()` no GPU grava diretamente `t.wx`, `t.wy`, `t.wz` (`src/engine/rigid/gpurigid.ts`, aproximadamente linhas 681–692), sem aplicar o centro local do `Collider` nem sua rotação. O comentário do backend Rust reconhece a mesma classe de divergência para estáticos com component `Collider` (`src/engine/rigid/cpurigid.ts`, aproximadamente linhas 190–194).

**Impacto:** uma cena com um `Collider` deslocado pode terminar em posições diferentes dependendo do backend, ainda antes da implementação de OBB.

**Ação recomendada:** centralizar a composição do centro/extensão/orientação em uma função de sincronização compartilhada e criar um teste de paridade com chão ou parede deslocado. O teste atual não cobre esse caso.

### 4. [P1] Corpos cinemáticos não estão modelados

`GameObject.stationary` é documentado como “estático (a colisão não o empurra) — tipo static/kinematic”, mas esses conceitos não são equivalentes (`src/engine/core/gameobject.ts`, linha 22). O plano da própria issue confirma que `invMass = 0` produz um corpo imóvel, não um cinemático.

Além disso, `pbEmpurraTeleportes()` trata qualquer movimento externo como teleporte e zera `vx/vy/vz` (`src/engine/core/physics_backend.ts`, aproximadamente linhas 597–607). Isso impede representar uma unidade controlada por pathfinding ou uma plataforma que se move com velocidade conhecida e deve transferir impulso aos corpos apoiados.

**Ação recomendada:** separar explicitamente `static`, `kinematic` e `dynamic`; definir como a velocidade cinemática é derivada/fornecida; preservar a velocidade no handoff; e testar plataforma móvel, unidade cinemática contra parede e troca de posse entre backends.

### 5. [P1] Manifold e eventos de contato ainda não formam um contrato de gameplay

A CPU registra pares de trigger em arrays (`triggerCount/triggerA/triggerB`) sem executar callbacks dentro do laço quente, o que é uma escolha defensável. Porém, não há contrato equivalente para contatos dos backends GPU/Rust, nem armazenamento persistente de pontos, normal, profundidade ou impulso por par.

Sem manifold persistente não há warm starting, estabilidade robusta para pilhas ou eventos consistentes de entrada/saída de contato. Sem um canal unificado, gameplay como dano, captura de área e “chegou ao destino” depende do backend ativo.

**Ação recomendada:** definir uma fila de eventos com `begin`, `persist`, `end`, `trigger` e `contact`, incluindo `bodyA`, `bodyB`, `contactIndex` e tick/step. O contrato precisa declarar latência quando a GPU estiver um frame atrasada.

### 6. [P1] Máscaras de colisão precisam entrar antes do congelamento do layout

Não encontrei campos nem filtragem de camada/máscara nos corpos. O plano de paralelismo já identifica isso como uma decisão que não pode ser adiada para depois da Fase 2, porque o layout estará condicionado por rotação e OBB.

**Ação recomendada:** especificar `layer` e `mask` com largura fixa, aplicar o filtro antes da narrow phase em CPU/GPU/Rust e testar: camadas que colidem, camadas que não colidem, trigger com máscara e alteração de máscara durante o jogo.

## Qualidade dos testes

O teste `tests/claude-test-paridade-formas.ts` é útil para esfera/caixa e inclui casos diagonais que evitam uma falsa aprovação por contatos apenas axiais. Contudo, ele mede sobretudo estado final de repouso, com tolerância, e não prova trajetória nem paridade angular. Também deixa os dois últimos corpos instáveis fora das asserções.

A suíte disponível não pôde ser executada neste sandbox porque o checkout não contém `rts.exe` e não há checkout correspondente do repositório do engine em `../rts`. Portanto, a afirmação da issue sobre 27 suítes do jogo e 36 testes do crate foi tratada como informação da issue, não como resultado reproduzido nesta revisão.

Antes de marcar a issue como concluída, a suíte deve acrescentar pelo menos:

- OBB contra OBB, OBB contra esfera e OBB contra plano;
- caixa rotacionada em repouso e em impacto oblíquo;
- quaternion/velocidade angular/torque com teste de conservação ou limite definido;
- manifold com múltiplos pontos em contato caixa-caixa;
- warm starting em uma pilha alta;
- filtros de layer/mask;
- corpo cinemático com velocidade não nula;
- paridade CPU/GPU/Rust para a mesma cena e mesmo tick;
- eventos `begin/persist/end` e triggers nos três backends;
- cenário com `Collider` deslocado e estático orientado.

## Ordem de implementação recomendada

1. **Fase de contrato/layout:** decidir campos, buffers, ownership, latência GPU, overflow e determinismo.
2. **Contato sem dinâmica angular:** implementar ponto/normal/profundidade para OBB e validar CPU contra uma referência independente.
3. **Paridade de backend:** transportar a mesma narrow phase para GPU/Rust e corrigir a sincronização de estáticos/offsets.
4. **Corpos cinemáticos e máscaras:** separar semântica e filtrar pares antes do solver.
5. **Manifold persistente:** cache por par, múltiplos pontos, lifetime e warm starting.
6. **Dinâmica angular:** torque, quaternion, velocidade angular e resposta de contato fora do centro.
7. **Eventos e gameplay:** contrato de eventos com tick, índice de contato e latência explícita.
8. **Rebenchmark:** repetir os benchmarks e republicar a tolerância de paridade; a própria documentação avisa que a mudança do solver invalida a medição anterior.

## Conclusão

A issue é tecnicamente válida e o diagnóstico do repositório é, em grande parte, honesto sobre o que ainda não existe. A base atual já não é “só translação” no sentido de integração e resposta linear, mas ainda é “só translação” no sentido central do épico: não há orientação física, OBB, torque nem manifold persistente.

O maior risco não é a falta de uma fórmula SAT; é congelar o layout atual e depois descobrir que orientação, velocidade angular, máscaras, contatos e ownership não cabem nos mesmos contratos. A revisão deve ser considerada **aprovada como roadmap**, mas **não pronta para implementação incremental sem uma decisão de layout e uma correção prévia da paridade dos colliders estáticos**.

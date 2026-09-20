# Superplano RTS — simulação de unidades, navegação e combate

> **Aviso (2026-09-20):** documento de referência. Ordem, escopo e aceite são os de
> [`../specs/2026-09-20-paralelismo-e-fundacao-design.md`](../specs/2026-09-20-paralelismo-e-fundacao-design.md), §7 e §14.

**Projeto:** `UrubuCode/rts-game`  
**Relação:** complemento do plano de física da issue #1  
**Autor:** Manus

## Conclusão principal

O repositório atual é uma base de engine/editor com física genérica, não uma engine RTS completa. A busca no código encontrou `Mover`, `Patrol`, `Rigidbody`, `Collider`, fixed timestep, backends CPU/GPU/Rust e scripts de fluido, mas ainda não encontrou sistemas de unidade, formação, seleção de grupo, navegação, caminho, arma, dano, saúde, projétil, recurso ou eventos de contato entregues ao gameplay.

A arquitetura RTS não deve transformar cada soldado em um rigid body completo. Para milhares de unidades, o movimento estratégico precisa ser um sistema de agentes com dados densos, pathfinding hierárquico ou flow fields e avoidance local. A física rígida deve continuar responsável por objetos que realmente precisam de massa, torque, CCD e contato físico: projéteis, veículos, prédios destrutíveis, portas, pontes, destroços e interações especiais.

Unidades de infantaria podem ter um collider simplificado para seleção, ocupação e bloqueio local, mas a formação e a navegação não devem depender do solver de empilhamento. Caso contrário, uma batalha converte-se em uma única grande ilha física, destrói o paralelismo e produz comportamento instável.

## Modelo de simulação em camadas

A simulação RTS deve ser dividida em camadas com frequências e contratos diferentes:

| Camada | Estado | Frequência sugerida | Determinismo | Responsabilidade |
|---|---|---:|---|---|
| Comandos | ordens, seleção, spawn, ataque | por tick de jogo | obrigatório | intenção do jogador |
| Estratégia | grupos, objetivos e prioridades | 5–20 Hz | obrigatório | decisão de alto nível |
| Navegação | HPA*, flow fields, caminhos | sob demanda/incremental | obrigatório | chegar ao destino |
| Movimento | posição, velocidade desejada, avoidance | 30–60 Hz | obrigatório | mover agentes |
| Física | corpos dinâmicos e contatos | 60 Hz ou perfil | obrigatório para objetos de gameplay | massa, impulso e CCD |
| Combate | cooldowns, dano, projéteis, morte | por tick | obrigatório | resultado do confronto |
| Visual | animação, partículas, áudio, interpolação | render frame | cosmético | apresentação |

A unidade deve ser simulada uma vez. O transform visual não pode ser a fonte de verdade, e um script `update(dt)` não deve movimentar diretamente um corpo que também é integrado pelo backend físico.

## Contrato de unidade

Criar um `UnitId` estável com índice e generation. O componente de unidade deve ser compacto e separado da entidade visual:

```text
UnitState {
  id
  owner/faction
  archetype
  position
  facing
  velocity
  desiredVelocity
  radius/footprint
  height
  layer/mask
  navigationRegion
  pathHandle
  formationHandle
  targetUnit
  health
  stateFlags
  commandSequence
}
```

O estado deve ser armazenado em arrays densos. O arquétipo deve ser compartilhado entre unidades e conter velocidade, aceleração, raio, altura, alcance, dano, recarga, visão, resistência e regras de movimento. Não copiar esses valores completos para cada instância se forem imutáveis.

A unidade precisa de estados explícitos, por exemplo:

```text
Idle → Moving → Arrived
Moving → Attacking → Recovering
Moving → Blocked → Repathing
Any   → Dead → Removed
```

A máquina de estados deve ser dirigida por comandos e resultados do tick, não por callbacks de renderização.

## Física de unidades versus física de mundo

A engine deve declarar três modos de presença física:

| Presença | Exemplo | Solução |
|---|---|---|
| Agente RTS | soldado, trabalhador, enxame | movimento próprio + avoidance + footprint espacial |
| Corpo de gameplay | veículo, tanque, porta, prédio móvel | rigid body completo ou cinemático |
| Corpo cosmético | destroço sem interação, decoração | render/query simples, sem solver |

Um agente RTS não deve receber impulso arbitrário do solver e depois ter seu destino reescrito pelo pathfinding no mesmo tick. Se uma unidade precisa ser empurrada por explosão, ela deve entrar em um estado físico transitório bem definido, ou o sistema de movimento deve aceitar um deslocamento externo quantizado.

A decisão deve ser configurável por arquétipo. Infantaria pode usar círculo/cápsula no plano de navegação, enquanto um tanque usa footprint orientado e pode participar de física de veículos. A física completa continua disponível sem obrigar todas as unidades a pagarem seu custo.

## Comandos, tick e determinismo

O input do jogador deve produzir comandos serializáveis:

```text
MoveSelection(selectionId, destination, formation, queueMode)
AttackSelection(selectionId, targetId)
StopSelection(selectionId)
Build(builderId, blueprintId, position)
Spawn(archetype, owner, position)
```

Cada comando precisa de `matchId`, `playerId`, `sequence`, `stepId` e payload validado. O gameplay não deve enviar posição final de cada unidade como input; deve enviar intenção. A simulação calcula o resultado.

O tick de RTS deve possuir um relógio próprio, alinhado ao `stepCount()` da física quando os sistemas interagem. Comandos tardios, pausa e fast-forward devem ser definidos. O tempo que o fixedstep descarta para evitar espiral não pode ser transformado em comandos aplicados fora de ordem.

O replay deve salvar comandos e snapshots de checksum por intervalo. O checksum deve incluir unidades, grupos, caminhos ativos, alvos, timers, projéteis, recursos e eventos de dano. A física sozinha não é suficiente para reproduzir uma partida.

## Seleção e grupos

### Seleção espacial

A seleção RTS precisa de duas fases:

1. raycast/overlap no mundo físico para obter o terreno e colliders;
2. consulta no índice espacial de unidades para encontrar agentes dentro do retângulo ou laço de seleção.

Não percorrer todas as unidades em cada clique. O índice deve permitir:

- ponto sob o cursor;
- caixa de seleção;
- seleção por facção e tipo;
- seleção de unidades visíveis;
- ordenação determinística por distância e `UnitId`.

A camada visual pode fazer culling separado, mas não deve decidir quais unidades existem para a simulação.

### Group e SelectionId

Uma seleção é um objeto temporário de gameplay; uma formação é um objeto persistente enquanto houver uma ordem ativa. Os membros devem ser ordenados por uma chave estável, não pela ordem de desenho ou pela ordem de alocação do frame.

Quando o jogador dá uma ordem a 200 unidades, o sistema deve gerar uma ordem de grupo e não 200 buscas independentes imediatamente. As unidades podem receber slots de formação e subdestinos derivados de uma única ordem.

## Formação

A formação deve ser calculada separadamente do pathfinding individual. O fluxo recomendado é:

```text
ordem de grupo
 → escolher âncora e orientação
 → calcular slots
 → reservar footprint local
 → path do grupo/âncora
 → mover unidades para slots
 → ajuste local e avoidance
```

Tipos iniciais:

- linha;
- coluna;
- bloco;
- cunha;
- círculo;
- formação livre preservando ordem.

A âncora segue o caminho principal. Cada slot recebe uma posição desejada relativa à âncora. Se um slot estiver bloqueado, a unidade não deve recalcular um caminho global imediatamente; primeiro tenta ajuste local, troca de slot ou atraso controlado.

A formação deve ter políticas para:

- largura maior que um corredor;
- unidade morta no meio;
- terreno irregular;
- obstáculo que divide o grupo;
- ordem de ataque durante movimento;
- entrada em área estreita;
- unidades lentas e rápidas misturadas.

O aceite não é “as unidades chegam”. É manter a formação dentro de erro máximo, não atravessar obstáculos, não produzir deadlock e respeitar prioridade de unidades importantes.

## Navegação em mapas RTS

### Representação do mapa

Criar uma representação de navegação independente da malha visual:

```text
NavCell {
  walkable
  terrainCost
  clearance
  regionId
  obstacleVersion
  height/slope
}
```

Para um RTS 3D com terreno, a célula não precisa ser apenas um grid plano. Pode ser um conjunto de camadas de navegação por altura, regiões conectadas por portais e links especiais para ponte, escada, transporte ou teleporte.

O grid deve conter clearance para suportar unidades de raios diferentes. Um caminho válido para um soldado não é necessariamente válido para um tanque.

### HPA* para caminhos individuais e grupos

HPA* é adequado para reduzir o custo de buscas em mapas grandes: clusters locais possuem entradas e distâncias pré-calculadas; a busca global atravessa clusters em passos maiores. O artigo original relata caminhos próximos do ótimo e redução importante do esforço de busca [1].

A engine deve manter:

- grafo de regiões;
- portais de entrada e saída;
- custo por terreno e movimento;
- versão de obstáculos;
- cache por `(startRegion, goalRegion, movementProfile, obstacleVersion)`.

A busca não precisa gerar o caminho inteiro quando a unidade só precisa dos próximos segmentos. Isso reduz trabalho desperdiçado quando a ordem muda.

### Flow fields para ordens de grupo

Flow field é apropriado quando muitas unidades compartilham o mesmo destino: um campo fornece a direção para qualquer célula alcançar aquele destino [2]. A engine deve calcular:

1. integration field com custo acumulado;
2. direction field com melhor vizinho;
3. clearance e penalidade de ocupação;
4. campos por perfil de movimento quando necessário.

O flow field deve ser cacheado por destino aproximado, perfil e versão dos obstáculos. Não criar um campo diferente para cada soldado de um grupo.

### Obstáculos dinâmicos

Separar obstáculos estáticos de reservas dinâmicas. Construções e terreno alterados invalidam regiões/portais locais. Unidades em movimento não devem reescrever o mapa global a cada tick; elas entram em avoidance e reservas temporárias por célula/portal.

O sistema deve possuir budget de recomputação. Se muitas construções mudam ao mesmo tempo, processar regiões sujas incrementalmente e manter o último campo válido com uma política de fallback.

## Avoidance local e bloqueio

Pathfinding decide por onde ir. Avoidance decide como atravessar o espaço ocupado naquele instante. Não usar colisão rígida pura como avoidance de multidão.

Para a primeira versão, usar vizinhança espacial e regras determinísticas de steering:

- separar unidades sobrepostas;
- combinar velocidade desejada e velocidade atual;
- manter distância mínima;
- respeitar prioridade de unidade;
- evitar obstáculos estáticos próximos;
- aplicar aceleração e curva limitadas.

Para grandes grupos em áreas densas, avaliar ORCA/RVO. ORCA define restrições de velocidade recíprocas e reduz a escolha de velocidade a um problema pequeno, com demonstrações em milhares de agentes [3]. Entretanto, a implementação precisa de uma ordenação determinística de vizinhos e de uma política para agentes não cooperativos, portas estreitas e formações.

ORCA não deve substituir pathfinding, e também não deve ser aplicado cegamente a veículos com dinâmica rígida. O resultado é uma velocidade desejada; o integrador de unidade aplica aceleração, rotação e limites.

### Deadlock e congestionamento

Adicionar detectores de:

- velocidade baixa por vários ticks;
- caminho válido mas progresso nulo;
- duas formações frente a frente;
- corredor ocupado por prioridade maior;
- unidade sem vizinhos livres.

Resoluções possíveis: espera com prioridade, recuo, troca de lado, reserva de corredor, repath de grupo, quebra temporária de formação e rota alternativa. Um sistema RTS não pode depender de pequenas penetrações físicas para resolver deadlock.

## Combate e projéteis

Combate deve ser um sistema de gameplay determinístico, não um efeito colateral de contato físico.

### Ataque

Um ataque deve possuir:

- atacante e alvo;
- tipo de arma;
- alcance e linha de visão;
- cooldown;
- tempo de preparação;
- dano e resistências;
- projétil ou impacto instantâneo;
- regra de prioridade;
- evento de aplicação.

A seleção de alvo deve ter ordenação estável: ameaça, distância, prioridade de arquétipo e `UnitId` como desempate. O alvo não pode mudar apenas porque a ordem de hash table mudou.

### Projéteis

Projéteis rápidos devem usar o subsistema de física/CCD, mas com pool próprio e armazenamento denso. Um projétil precisa de lifetime, owner, damage payload, team mask, posição anterior e modo de colisão.

Para projéteis simples, a engine pode usar shape cast/raycast entre posições consecutivas. Para granadas e objetos que ricocheteiam, usar rigid body. Nunca criar e destruir milhares de objetos de script por frame; usar object pool e eventos compactos.

O dano deve ser aplicado em uma fase posterior ao solver, por fila de impactos ordenada por `stepId`, projectileId e targetId. Isso evita mutar saúde durante a detecção e torna morte/despawn reproduzível.

## Visão, alcance e influência

Separar proximidade física de visibilidade de gameplay. A engine precisa de:

- índice espacial para unidades próximas;
- line of sight por raycast/occlusion;
- fog of war por células/regiões;
- influence maps para ameaça, controle e custo de rota;
- áreas de alcance e zonas de captura.

Fog of war e influence maps não devem consultar todos os objetos a cada frame. Atualizar em tiles sujos, regiões alteradas ou frequência menor que a física. O resultado visual pode ser interpolado; o estado de gameplay deve possuir versão e tick.

## Performance para milhares de unidades

A meta não deve ser “física para 100.000 corpos”. Deve ser uma divisão de orçamento:

| Sistema | Meta inicial por tick de 60 Hz |
|---|---:|
| comandos e estados | 0,5 ms |
| movimento e avoidance | 2,0 ms |
| pathfinding incremental | 1,0 ms médio |
| combate/projéteis | 1,0 ms |
| física de objetos | 2,0 ms |
| eventos/snapshot | 0,5 ms |

Os números são metas iniciais para medir e ajustar, não resultados já demonstrados. O cenário de benchmark deve ter 1k, 5k, 10k e 50k agentes, com percentuais awake, agrupamento, densidade, path requests, projéteis e comandos declarados.

Técnicas prioritárias:

- arrays SoA e IDs densos;
- object pools;
- spatial grid compartilhado entre seleção, avoidance, combate e queries;
- atualização somente de agentes ativos;
- LOD de simulação por distância/visibilidade, sem alterar regras de unidades em combate;
- path requests em fila com orçamento;
- flow field compartilhado por grupo;
- batches de vizinhança;
- atualização de animação separada do tick de gameplay;
- snapshot incremental para render;
- nenhuma alocação normal por frame.

A mesma partição espacial pode atender múltiplos sistemas, mas o contrato de ownership deve impedir que pathfinding, física e combate escrevam posição simultaneamente.

## LOD de simulação

O LOD não pode permitir que uma unidade remota reapareça com vantagem impossível. Definir níveis:

| LOD | Estado | Uso |
|---|---|---|
| 0 | tick completo, avoidance, combate e animação | câmera/perto/conflito |
| 1 | tick de gameplay completo, visual reduzido | área ativa |
| 2 | grupo agregado com estatísticas | longe e fora de visão |
| 3 | simulação estratégica por resultado esperado | grandes distâncias |

A transição deve preservar massa, saúde, recursos, cooldowns e posição aproximada. Agregação só deve ser permitida quando as unidades não estiverem em combate ou em uma interação que dependa de colisão individual.

## Plano de implementação RTS

### RTS-0 — contrato e cenário de benchmark

Criar `UnitId`, archetype, command buffer, step IDs, `PhysicsStats` e uma cena benchmark com seleção, 1k agentes e 100 projéteis. Definir se a partida-alvo é single-player, replay ou multiplayer lockstep.

**Aceite:** ordens repetidas produzem o mesmo estado; spawn/despawn não realoca tudo; benchmark registra todas as contagens.

### RTS-1 — seleção e índice espacial

Implementar seleção de unidade, caixa de seleção, filtros de facção/tipo e consultas espaciais compartilhadas.

**Aceite:** selecionar 10k agentes sem scan global por clique e com ordem determinística.

### RTS-2 — agente e movimento cinemático

Substituir uso direto de `Mover` por um sistema de unidade com velocidade desejada, aceleração, facing e estado. Integrar com o contrato cinemático da física sem tratar pose externa como teleporte.

**Aceite:** unidade recebe ordem, move em tick fixo, não duplica integração e pode ser interrompida/reordenada.

### RTS-3 — navegação base

Criar NavGrid/NavRegion, walkability, clearance, custo de terreno, obstáculos sujos e A* local. A* é um oráculo de correção para as fases seguintes.

**Aceite:** caminhos não atravessam obstáculos, possuem versão e são reproduzíveis.

### RTS-4 — HPA* e cache

Adicionar clusters, portais, custos pré-computados, path requests incrementais e invalidation local.

**Aceite:** caminho em mapa grande usa busca hierárquica, request budget não explode e alterações locais não recalculam o mapa inteiro.

### RTS-5 — formação

Implementar slots, âncora, orientação, resize, unidades lentas, obstáculos e quebra temporária de formação.

**Aceite:** 10, 100 e 1.000 unidades mantêm formação sem deadlock em corredor e sem 1.000 buscas globais.

### RTS-6 — avoidance local

Implementar steering determinístico e depois comparar ORCA/RVO por densidade, qualidade, custo e replay.

**Aceite:** agentes não sobrepõem, não oscilam indefinidamente e a política de prioridade é observável.

### RTS-7 — flow fields

Adicionar integração/direção fields por destino, perfil e versão de obstáculo. Compartilhar campo entre grupos.

**Aceite:** grupo grande usa um campo compartilhado e muda de objetivo sem gerar uma busca por unidade.

### RTS-8 — combate e projéteis

Adicionar ataque, alvo, cooldown, linha de visão, dano, morte, pool de projéteis, CCD/shape cast e eventos ordenados.

**Aceite:** replay repete dano e mortes; projéteis rápidos não atravessam alvos; nenhum callback altera a simulação no meio da fase.

### RTS-9 — fog, influência e LOD

Adicionar visão, fog of war, influence maps, simulação distante e transições de LOD.

**Aceite:** longe reduz custo sem alterar resultado de uma unidade quando ela entra em área ativa, respeitando regras documentadas de aproximação.

### RTS-10 — integração multiplayer/replay

Congelar comandos, checksum, snapshots, resync e diagnóstico da primeira divergência. Somente depois avaliar lockstep entre máquinas.

**Aceite:** replay de uma partida reproduz o checksum completo e relata o primeiro sistema divergente.

## Testes RTS obrigatórios

| Teste | Proteção |
|---|---|
| `test_unit_id_generation` | evento antigo não afeta unidade reutilizada |
| `test_command_order` | comandos têm ordem estável |
| `test_selection_spatial` | seleção não depende de scan/hash |
| `test_kinematic_unit` | movimento não é teleport zerando velocidade |
| `test_nav_clearance` | perfis de unidade respeitam largura |
| `test_nav_invalidation` | obstáculo invalida somente regiões afetadas |
| `test_hpa_vs_astar` | caminho hierárquico continua válido |
| `test_flow_field` | direção leva ao destino e respeita custo |
| `test_formation_slots` | slots estáveis após morte/reordenação |
| `test_avoidance_determinism` | vizinhança ordenada e sem oscilação |
| `test_deadlock_recovery` | corredor e encontro frontal progridem |
| `test_attack_target_order` | alvo e dano são reproduzíveis |
| `test_projectile_ccd` | tiro rápido não atravessa |
| `test_damage_event_order` | morte/despawn têm ordenação estável |
| `test_lod_roundtrip` | agregar e reativar preserva estado permitido |
| `test_match_replay_hash` | estado completo da partida reproduz |

## Decisões em aberto que precisam de resposta

Antes da implementação RTS-0, o projeto deve decidir o tamanho-alvo de uma partida, o plano de movimento principal, se há multiplayer lockstep, se unidades podem empurrar umas às outras, se prédios são corpos rígidos, quantas ordens simultâneas são esperadas e qual percentual de unidades pode estar em combate.

Também é necessário decidir se o mapa é principalmente 2D com altura visual ou 3D navegável com pontes, rampas e múltiplos andares. Essa escolha muda NavGrid, clearance, raycast, formação e o uso de OBB.

## Referências

[1]: http://webdocs.cs.ualberta.ca/~mmueller/ps/2004/hpastar.pdf "Near Optimal Hierarchical Path-Finding — HPA*"
[2]: https://www.redblobgames.com/blog/2024-04-27-flow-field-pathfinding/ "Red Blob Games — Flow field pathfinding"
[3]: https://gamma.cs.unc.edu/ORCA/ "Optimal Reciprocal Collision Avoidance — UNC"
[4]: https://gameprogrammingpatterns.com/spatial-partition.html "Game Programming Patterns — Spatial Partition"
[5]: https://gafferongames.com/post/deterministic_lockstep/ "Gaffer On Games — Deterministic Lockstep"

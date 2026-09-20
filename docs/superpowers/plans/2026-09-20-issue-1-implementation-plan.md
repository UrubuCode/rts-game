# Plano de implementação futura — física 3D da issue #1

> **Aviso (2026-09-20):** documento de referência. Ordem, escopo e aceite são os de
> [`../specs/2026-09-20-paralelismo-e-fundacao-design.md`](../specs/2026-09-20-paralelismo-e-fundacao-design.md), §7 e §14.

**Projeto:** `UrubuCode/rts-game`  
**Issue:** [Rotação, OBB e manifold](https://github.com/UrubuCode/rts-game/issues/1)  
**Base analisada:** commit `3d29515`  
**Autor da análise:** Manus

## Decisão executiva

A implementação deve ser conduzida como uma evolução do contrato físico, e não como a adição isolada de uma função `obbOverlap`. O repositório atual possui três leitores da física: o solver TypeScript da cena, o kernel WGSL e o solver Rust. Todos precisam receber a mesma semântica de pose, massa, contato e ownership.

A ordem recomendada é:

> **contrato e layout → pose orientada → contato OBB → corpos cinemáticos e máscaras → manifold → dinâmica angular → eventos e queries → otimização GPU**

Essa ordem é deliberada. O teste SAT pode retornar um eixo de menor penetração, mas isso é apenas informação de detecção e correção local. A resolução estável de pilhas exige constraints por contato e um manifold que sobreviva entre passos [1] [2].

## Estado atual e problema que precisa ser resolvido

O `Transform` atual possui posição, rotação Euler e velocidade linear, mas não possui quaternion, velocidade angular ou tensor de inércia. Os buffers físicos atuais `pos`, `vel` e `ext` usam os 16 floats por corpo. O próprio código documenta que a rotação planejada em `hullpack.ts` seria somente entrada; não há torque nem dinâmica angular.

A narrow phase da CPU resolve caixa-caixa com AABB e o kernel GPU implementa a mesma ideia em WGSL. Portanto, uma caixa girada visualmente continua sendo tratada como alinhada aos eixos. A CPU já possui um caminho para esfera contra casca convexa, mas GPU e Rust ainda não suportam casca e fazem fallback para CPU.

Há uma divergência anterior à issue que deve ser corrigida no primeiro lote: a CPU usa o centro local do `Collider`, enquanto `rbSyncStatics()` e o caminho equivalente do Rust ainda sincronizam estáticos usando a posição do transform sem incorporar o offset do collider. Um teste de paridade com collider deslocado deve ser obrigatório.

## Contrato físico proposto

### Pose e estado

A pose física deve ser uma transformação rígida composta por `position: vec3` e `orientation: quaternion`. Euler pode continuar existindo na API do editor, mas deve ser convertido para quaternion antes de entrar no solver. O solver não deve usar `rx`, `ry` e `rz` diretamente como estado dinâmico.

O estado mínimo de um corpo precisa conter posição, orientação, velocidade linear, velocidade angular, inverso da massa, inverso da inércia, tipo de movimento, flags de sono, camada e máscara. O collider deve conter forma, meia-extensão ou raio, centro local, material e identificador de forma compartilhada.

### Tipos de corpo

Os três tipos devem ser distintos:

| Tipo | Integração | Resposta a força/contato | Uso esperado |
|---|---|---|---|
| `fixed` | não integra | não se move | chão, parede, cenário |
| `dynamic` | integra força e torque | recebe impulsos | unidades, caixas, detritos |
| `kinematic_position` | pose alvo definida pelo jogo | não é deslocado pelo solver; fornece velocidade implícita | plataforma, elevador, unidade comandada por pose |
| `kinematic_velocity` | velocidade definida pelo jogo | não é alterado pelo solver | plataforma ou unidade comandada por velocidade |

Essa separação segue a semântica usada por engines físicas maduras: corpos cinemáticos não devem ser representados como `invMass = 0` sem guardar a velocidade que eles comunicam aos corpos dinâmicos [3]. A semântica de posição deve derivar `v = (p_next - p_current) / dt`; a semântica de velocidade deve integrar a posição a partir da velocidade fornecida.

### Camadas e máscaras

Cada corpo deve ter `layer: u32` e `mask: u32`. Um par só entra na narrow phase quando:

```text
(bodyA.mask & bodyB.layer) != 0 && (bodyB.mask & bodyA.layer) != 0
```

O filtro precisa ocorrer antes do teste geométrico e deve ser idêntico nos três backends. A alteração durante a execução deve invalidar o broad-phase, mas não deve exigir recompilar o pipeline.

### Ownership e relógio

O contrato de posse atual deve ser estendido para incluir orientação e velocidade angular. Quando GPU ou Rust são donos, a cena deve ser apenas espelho. Um movimento externo precisa ser classificado como:

- mudança intencional de pose cinemática;
- teleporte explícito, que zera velocidades;
- edição do usuário, que pode acordar o corpo sem destruir a velocidade angular por padrão.

A unidade de replay deve ser o número do passo físico, não o `dt` do frame. Fixed timestep é necessário, mas não garante determinismo entre máquinas: ordem de constraints, compilador e comportamento de ponto flutuante também precisam ser especificados [4].

## Layout de dados: decisão antes da implementação

O layout não deve ser congelado dentro de `gpurigid.ts`. Deve existir um módulo de contrato compartilhado, por exemplo `src/engine/rigid/layout.ts`, com offsets, tamanhos de registro e versão do layout. O crate Rust deve consumir uma descrição equivalente testada contra os mesmos offsets.

A proposta mais segura é abandonar a ideia de codificar muitos significados em `vel.w`. Forma, layer, tipo de corpo e flags são campos semanticamente diferentes e devem ter campos explícitos em uma estrutura de estado. Se o limite de quatro storage buffers continuar válido, a solução deve ser uma destas, decidida por benchmark:

1. ampliar o limite de buffers por pipeline e manter SoA separado;
2. usar um `bodyState` estruturado com todos os campos por corpo;
3. separar passes: integração, broad-phase, narrow phase e solver;
4. manter metadados estáticos no `world`, mas não esconder estado mutável no mesmo buffer somente leitura.

O ponto essencial é que orientação, velocidade angular, impulsos acumulados e flags do manifold precisam de armazenamento gravável. A documentação atual já reconhece que a rotação somente de entrada não permite torque.

Uma versão conceitual do registro é:

```text
BodyState {
  position      vec4   // xyz + sleep/flags, se o layout final justificar
  orientation   vec4   // quaternion unitário
  linearVel     vec4   // xyz + tipo/flags apenas se explicitamente documentado
  angularVel    vec4   // xyz + reservado
  shape         vec4   // half extents/radius + shape id
  massProps     vec4   // invMass + material/inertia index
  collisionBits vec4   // layer, mask, body flags, generation
}
```

Isso é uma proposta de contrato, não uma decisão de bytes. Os bytes finais devem ser escolhidos junto com o crate Rust e com um microbenchmark de upload, leitura e largura de banda.

## Narrow phase em lotes incrementais

### Lote A — pose e formas sem torque

Primeiro, introduzir quaternion e garantir que uma caixa estática orientada afete a detecção corretamente, ainda sem aplicar torque. Isso permite validar a geometria sem misturar imediatamente integração angular.

Para OBB contra OBB, usar os 15 eixos clássicos do SAT: três eixos locais da caixa A, três eixos locais da caixa B e nove produtos vetoriais entre arestas. Para cada eixo, projetar as duas caixas, rejeitar imediatamente se houver separação e guardar o menor overlap restante. O eixo escolhido deve ser orientado de A para B de forma determinística.

O teste deve usar uma tolerância explícita para eixos quase paralelos. O resultado deve conter, no mínimo:

```text
hit
normalWorld
penetration
referenceFeature
incidentFeature
axisKind
```

O `axisKind` não é apenas diagnóstico. Ele será usado para selecionar as faces de referência e incidente na geração do manifold.

Para OBB contra esfera, transformar o centro da esfera para o espaço local da caixa, fazer clamp no AABB local e transformar o ponto/normal de volta. Para esfera contra casca convexa, reaproveitar `hullContactLocal`, mas o centro deve ser obtido a partir da pose completa e o backend deve usar a mesma convenção de normal.

### Lote B — geração de manifold

Quando o eixo vencedor for uma face, escolher a face de referência e a face incidente. Recortar o polígono incidente contra as quatro arestas laterais da face de referência e manter no máximo quatro pontos. Para edge-edge, gerar um ponto de segmento mais próximo ou um ponto representativo estável, conforme o limite de complexidade aceito.

Cada ponto deve armazenar:

```text
localPointA
localPointB
normal
separation
featureIdA
featureIdB
normalImpulse
tangentImpulse1
tangentImpulse2
persisted
```

A chave de persistência deve ser formada pelos feature IDs e pelo par ordenado de corpos, não apenas pela distância entre posições. Isso evita perder o contato a cada frame e permite warm starting. A documentação do Box2D destaca justamente que vários pontos de um contato poligonal compartilham uma normal e que o manifold melhora a estabilidade de empilhamento [2].

### Lote C — solver de constraints

O solver atual mistura correção posicional, resposta linear e regras específicas de coluna. A próxima versão deve separar as etapas:

1. detectar contatos e construir manifolds;
2. casar pontos com o manifold do passo anterior;
3. aplicar impulsos acumulados do passo anterior;
4. executar várias iterações de velocidade;
5. executar correção posicional limitada;
6. armazenar os novos impulsos e gerar eventos.

Para cada ponto de contato, a velocidade relativa no ponto deve incluir a contribuição angular:

```text
vPoint = vLinear + cross(angularVelocity, r)
```

A massa efetiva deve incluir os termos de inércia dos dois corpos. O impulso normal deve ser limitado a não-negativo. Os impulsos tangenciais devem respeitar o cone de Coulomb, usando o impulso normal como limite. Restituição deve ser aplicada apenas acima de uma velocidade limiar, para não reintroduzir o ciclo-limite nas pilhas.

O solver deve manter o `slop`, a correção parcial e o limite de restituição que já foram medidos, mas esses valores precisam ser tratados como parâmetros de contrato versionados. Depois da mudança para manifold, todos precisam ser re-medidos.

### Lote D — dinâmica angular

Adicionar torque e velocidade angular somente depois que o manifold estiver estável. O corpo deve possuir tensor de inércia em espaço local e seu inverso transformado para mundo pela orientação.

O integrador deve atualizar a orientação com quaternion e renormalização controlada. A normalização deve ter uma política determinística e um teste de erro máximo. O impulso aplicado em um ponto fora do centro deve alterar `angularVelocity` por:

```text
deltaAngularVelocity = inverseInertiaWorld * cross(r, impulse)
```

O primeiro teste angular deve ser uma caixa apoiada fora do centro, seguida de uma colisão lateral. O resultado esperado é inclinação, não somente translação. Um segundo teste deve confirmar que uma esfera permanece invariante à orientação.

## Fases e critérios de aceite

### Fase 0 — contrato e correções preparatórias

Criar o módulo de layout compartilhado, separar `fixed/kinematic/dynamic`, adicionar layer/mask e corrigir a sincronização de centro local dos estáticos. Esta fase não deve mudar ainda a resposta OBB.

O aceite exige paridade CPU/Rust/GPU para uma cena com chão deslocado, parede esférica, collider com centro local diferente de zero, trigger e alteração de máscara. Também exige que mover uma plataforma cinemática não zere sua velocidade implícita.

### Fase 1 — quaternion e pose orientada

Adicionar quaternion à cena, serialização, editor e ponte cena-backend. O editor pode continuar aceitando Euler, mas deve salvar uma representação canônica e evitar conversões acumulativas.

O aceite exige que uma cena salva e recarregada preserve a pose dentro de uma tolerância definida, que uma caixa girada renderize e que os três backends recebam a mesma pose.

### Fase 2 — OBB sem dinâmica angular

Implementar SAT e OBB-esfera na CPU. Em seguida portar a mesma decisão para GPU e Rust. A CPU deve continuar sendo o oráculo temporário, mas o teste deve comparar também normal e profundidade, não apenas posição final.

O aceite mínimo é composto por caixas face a face, canto contra face, arestas quase paralelas, caixa girada 45 graus, OBB-esfera e separação em todos os eixos. O teste deve incluir casos sem contato para detectar falsos positivos.

### Fase 3 — manifolds e solver de contato

Adicionar geração, persistência e casamento de pontos. Introduzir warm starting atrás de uma flag de teste para comparar estabilidade com e sem cache.

O aceite exige uma pilha de caixas com número fixo de passos, menos jitter do que o solver anterior e nenhum crescimento de energia em repouso. O teste deve registrar número médio de pontos, taxa de persistência e iterações necessárias para repouso.

### Fase 4 — dinâmica angular

Adicionar tensor de inércia, torque, velocidade angular e atualização de quaternion. Começar no backend Rust determinístico, depois portar para CPU TypeScript e GPU.

O aceite exige queda de uma caixa inclinada, impacto fora do centro, conservação aproximada de momento angular em uma cena sem dissipação e dissipação controlada em uma cena com atrito. A tolerância deve ser específica para cada propriedade; uma única tolerância de posição não é suficiente.

### Fase 5 — queries e eventos

Implementar `raycast`, `overlap` e `shapeCast` com declaração de capacidade por backend. Criar eventos de contato e trigger com `begin`, `persist` e `end`, associados a um `stepId`.

O aceite deve verificar uma query durante o play com GPU assíncrona e declarar explicitamente se a resposta é do estado corrente ou do último estado confirmado. Eventos devem ter a mesma ordem em CPU, Rust e GPU quando o backend determinístico for usado.

### Fase 6 — performance e ativação gradual

Medir o custo de OBB, manifold, upload, readback, broad-phase e solver separadamente. Não usar a antiga tabela de custos para justificar o novo desenho. Publicar máquina, build, número de corpos, número de contatos, subpassos e se `vsync` estava desligado.

A ativação deve ser gradual: flag de runtime para solver antigo, OBB novo em cenas de teste, fallback explícito quando um backend não suporta uma capacidade e diagnóstico visível no editor.

## Testes que devem nascer antes do código principal

Os seguintes testes devem ser escritos como contratos, mesmo que inicialmente falhem:

| Teste | O que protege |
|---|---|
| `test_layout_contract` | offsets e tamanhos iguais em TS, WGSL e Rust |
| `test_pose_roundtrip` | quaternion, Euler, serialização e normalização |
| `test_obb_sat` | os 15 eixos, separação, eixo vencedor e profundidade |
| `test_obb_manifold` | clipping, feature IDs e máximo de pontos |
| `test_manifold_persistence` | casamento entre passos e warm starting |
| `test_kinematic_velocity` | plataforma com velocidade comunicada ao dinâmico |
| `test_kinematic_position` | velocidade implícita derivada da pose alvo |
| `test_collision_masks` | filtros simétricos e invalidação do broad-phase |
| `test_static_collider_offset` | paridade de centro local entre backends |
| `test_angular_impulse` | torque por contato fora do centro |
| `test_contact_events` | begin/persist/end e triggers |
| `test_replay_hash` | estado completo por `stepId`, não apenas posição |

O teste de replay deve incluir posição, orientação, velocidades, sono, manifolds persistentes e eventos. Comparar somente `x/y/z` não detecta divergência angular.

## Riscos e decisões que precisam de dono

O maior risco é tentar preservar o kernel gather atual sem decidir como armazenar manifold e impulsos mutáveis. O segundo é prometer determinismo multiplataforma com base apenas no solver Rust determinístico dentro de uma mesma máquina. O terceiro é deixar a GPU suportar apenas uma parte do contrato e transformar fallback em comportamento silencioso.

Cada decisão precisa ter um dono e um teste. Em particular, o projeto deve decidir se GPU e Rust precisam de paridade de trajetória ou apenas de repouso; se a GPU pode ter um frame de latência para queries; qual é o limite de corpos cinemáticos; qual é a política de overflow do manifold; e se corpos dinâmicos com casca convexa usarão aproximação esférica ou entrarão em um caminho SAT separado.

## Conclusão

A equipe já possui a ordem geral correta no documento de paralelismo, mas o plano ainda deve ser convertido em contratos executáveis. A próxima mudança não deveria ser “adicionar OBB ao `solvePair`”. Deveria ser “introduzir a versão 2 do estado físico, com pose, tipos de corpo, filtros e capacidade de contato”.

Depois dessa base, OBB pode ser implementado como uma narrow phase testável. O manifold deve vir antes da dinâmica angular, porque é ele que transforma uma interseção geométrica em contatos estáveis. Torque e velocidade angular devem ser os últimos elementos do núcleo, não os primeiros.

## Referências

[1]: https://dyn4j.org/2010/01/sat/ "SAT — Separating Axis Theorem, MTV e limites da resolução local"
[2]: https://box2d.org/documentation/md_collision.html "Box2D Collision Documentation — contact manifolds, warm starting e time of impact"
[3]: https://rapier.rs/docs/user_guides/rust/rigid_bodies/ "Rapier Rigid Bodies — fixed, dynamic e corpos cinemáticos"
[4]: https://gafferongames.com/post/deterministic_lockstep/ "Gaffer On Games — Deterministic Lockstep"

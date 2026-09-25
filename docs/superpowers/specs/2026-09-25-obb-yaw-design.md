# OBB em Y (Lote C0) — desenho e medição

Data: 2026-09-25. Primeiro degrau do Lote C do tracking #3 ("a caixa que gira
colide girada"), escolhido para **não adicionar peso**: nenhum buffer novo,
nenhuma mudança de layout do `Transform` nem dos três backends.

## O que é, e o que NÃO é

- É: na CPU, uma caixa com `transform.ry != 0` colide como OBB girado em Y —
  caixa × caixa por SAT (2 eixos XZ de cada caixa + Y), caixa × esfera pelo
  ponto mais próximo no espaço local da caixa. Casca (`hull`) já era girada.
- Não é: orientação como estado dinâmico. A física não *produz* rotação
  (torque, velocidade angular, tombar) — isso é o Lote E, depois do C completo
  (quaternion, `rx`/`rz`) e do D (manifold). O yaw vem de script/editor.
- Caixas com `ry = 0` seguem exatamente o ramo AABB anterior: o desvio é uma
  comparação por par.

## Onde a orientação mora (a pergunta da issue #1)

Ainda não precisou de resposta: `ry` já está entre os 15 slots inline do
`Transform` e a narrow phase CPU já o lia para o offset do colisor. Rust e GPU
não leem `ry`; enquanto tratarem caixa como AABB, **caixa girada pede o passo na
CPU** pelo mesmo mecanismo de casca/offset (`pbYaw` em `physics_backend.ts`,
contado na mudança de composição e, por passo, sobre os dinâmicos que o backend
acompanha). A decisão de buffers fica para quando a orientação virar estado.

## Convenção de rotação

A mesma de `applyParentTo` e do offset do colisor: eixo local X vira
`(cos ry, −sin ry)` em `(x, z)`; eixo local Z vira `(sin ry, cos ry)`.
Inversa (mundo → local): `ox = c·x − s·z`, `oz = s·x + c·z`.

## Medido (2026-09-25, release, CPU, máquina com ~65 % de carga alheia, A/B
alternado HEAD × atual, 3 rodadas; `bench/claude-bench-obb-yaw.ts`)

| n caixas | yaw = 0, HEAD | yaw = 0, atual | yaw ≠ 0, atual |
|---|---|---|---|
| 100 | 0,089 / 0,103 / 0,095 ms | 0,102 / 0,081 / 0,091 ms | 0,106 / 0,088 / 0,094 ms |
| 500 | 0,580 / 0,608 / 0,480 ms | 0,458 / 0,447 / 0,475 ms | 0,772 / 0,472 / 0,477 ms |

Sem regressão no caminho AABB; o OBB custa o que o AABB custava. Alocação:
100 caixas giradas, 2 000 → 20 000 passos: 1 → 2 coletas (não escala com os
passos; `scratch/escala_obb.ts`).

## Testes

`tests/claude-test-obb-yaw.ts` (9): AABB inalterado; esfera fora da pegada
girada atravessa e sobre ela para; quina girada encosta na face a 1,21 u
(AABB: 1,0); quina girada na parede reta para a 1,83 (AABB: 2,04) sem desvio
em z; backend Rust recusa com caixa girada. Quina contra quina a 45° é
degenerado de propósito (o SAT empurra na diagonal) e não é asserção.

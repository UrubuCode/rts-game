# Eventos de contato (Lote B2) — desenho

Data: 2026-09-25. Fecha o item B2 do tracking #3 (fila de eventos após o solver).
Escopo: `rts-game`; o crate `rts-physics` não muda.

## 1. Objetivo

Scripts no modelo Unity recebem `onCollisionEnter/Stay/Exit` e
`onTriggerEnter/Stay/Exit`, com o outro `GameObject` e o `stepId`, entregues
**depois** do passo de física, em ordem determinística, sem alocação por passo.

## 2. O que a pesquisa fixou (Box2D v3, Jolt, Rapier, PhysX/Unity)

| Decisão | Referência |
|---|---|
| Eventos são *begin/end*; *stay* é opt-in por colisor | Box2D v3 e Rapier não emitem *persist*; Unity `OnCollisionStay` é o caro |
| Opt-in por colisor: só pares com um lado inscrito são registrados | `b2ShapeDef::enableContactEvents`, `ActiveEvents::COLLISION_EVENTS` |
| Nunca callback na narrow phase; buffer e entrega após o passo, com estado do fim do passo | Jolt (várias threads, só leitura), PhysX `fetchResults`, Box2D arrays transientes |
| Conjunto **persistente** de pares tocando; a narrow phase só adiciona | Box2D: flag *touching* em contatos persistentes |
| *End* também quando um corpo é removido | Box2D: "end touch events may be generated due to a user operation" |
| Um objeto de evento reutilizado por entrega | Unity "Reuse Collision Callbacks"; rts#2760 |

O conjunto persistente é obrigatório aqui: a narrow phase CPU **pula** corpos
dormindo e corpos que não se moveram (`moved2 < MOVE_EPS2`), então um conjunto
recalculado por passo emitiria *Exit* falso assim que um corpo parasse.

## 3. Peças

### `Collider.events` (0 = nenhum, 1 = enter/exit, 2 = também stay)
Campo do componente, editável no inspector (campo 7, "Events"), serializado em
`toData`/`buildObject`. `eventsOf(o)` lê pelo `colIdx`, como `triggerOf`.

### `src/engine/core/contact_events.ts`
- `ContactInfo { self, other: GameObject; trigger; stepId }` — **uma** instância
  por `ContactEvents`, mutada a cada entrega.
- `ContactEvents` (uma por `Scene`, em `scene.contacts`):
  - conjunto persistente, ordenado por `(minId, maxId)`: `pA/pB` (ids),
    `pObjA/pObjB` (referências — sobrevivem à remoção até o *Exit*), `pTrig`,
    `pStay`, `pSeen` (stepId da última confirmação), `pEnd` (marcado para sair).
  - vistos no passo: `sIa/sIb/sTrig/sStay` (índices), com duplicatas (um por
    lado, como `tgA/tgB`).
  - eventos do passo: `evA/evB/evKind/evTrig` (kind 1 enter, 2 stay, 3 exit).
  - `beginStep()`, `record(ia, ib, trig, stay)`, `absorb(objs, stepId)`
    (vistos → persistente; novo par → *Enter*; visto e `pStay` → *Stay*),
    `count()/seen(k, step)/objA(k)/objB(k)/confirm(k, step)/markEnd(k)`,
    `sweepEnded()` (compacta), `dispatch(stepId)` (enter → stay → exit; para cada
    par, A recebe com `other = B`, depois B com `other = A`; dentro do objeto,
    todos os `behaviors` habilitados).
  - Ordem: persistente já ordenado; *Enter* ordenado por inserção (insertion
    sort em ids). Sem `Map`, sem closures, helpers com ≤ 4 parâmetros.

### `Scene`
- `contacts: ContactEvents`; tabela `csEvents[i]` preenchida em
  `collectColliders`.
- A função de par, no ponto "houve contato" (antes do ramo de gatilho e da
  separação): se `csEvents[ia] || csEvents[ib]`, `record(...)`.
- `resolveCollisions()` = `contacts.beginStep()`; passes atuais (movidos para
  `resolvePasses()`, com suas saídas antecipadas); `finishContacts(this, stepCount())`
  **sempre**: absorve, re-testa cada par persistente não visto com
  `pairOverlaps(objs, trs, ia, ib)` (mesma geometria da função de par, sem
  resposta; `active === 0` ou `sceneIndex < 0` = separado), marca *Exit*,
  compacta, despacha. Scripts podem mutar a cena durante o despacho: as
  varreduras já terminaram.
- `GameObject.sceneIndex` (−1 fora da cena), mantido em `add`, `removeAt`,
  `moveSubtree` e `computeWorld` (auto-cura).

### `Behavior`
Seis hooks vazios: `onCollisionEnter/Stay/Exit(c: ContactInfo)`,
`onTriggerEnter/Stay/Exit(c: ContactInfo)` (`import type` — o RTS aceita o
ciclo de tipos, verificado em `scratch/cyc`).

### Backend (`physics_backend.ts`)
`pbEventos` contado no *dirty* como `pbCascas`. Se `> 0`, `rigidStep` solta o
dono e devolve 0 (CPU), com aviso único: Rust/GPU não expõem pares. É a regra
"backend que não sabe recusa pelo nome" (`Needs.contact_events`). Follow-up no
repo `rts`: buffer de pares em `rts-physics` + readback na GPU.

## 4. Custo (medido, 2026-09-25, release, CPU)

Por passo: O(V) para absorver os vistos, O(T) para os persistentes não vistos
(re-teste geométrico só quando um dos corpos se moveu pelo critério da própria
narrow phase — `moved2 >= MOVE_EPS2`, não dorme e não é estático; caso
contrário confirma sem geometria, como Box2D não revisita ilhas dormindo),
O(E) entregas. Busca no conjunto persistente é binária; inserção desloca
O(T).

`scratch/diag2_eventos.ts`, 50 caixas dormindo sobre o chão, `resolveCollisions`
×10 000: **42,6 µs sem inscrição → 48,6 µs com 50 pares inscritos** (enter/exit):
6 µs/passo, 0,12 µs/par. `bench/claude-bench-eventos-contato.ts` (mesmos
componentes em todas as variantes; só `events` muda): `Stay` em 200 pares custa
~0,25 ms/passo — 1,2 µs/par, que é a entrega (2 lados × 3 behaviors × hook
virtual), por isso `Stay` é opt-in.

Alocação por passo: 50 pares com `Stay`, 20 000 passos → 3 coletas contra 2 no
controle sem inscrição (`scratch/escala_eventos.ts` / `escala_controle.ts`):
o lixo é do caminho pré-existente do `Rigidbody`; os eventos acrescentam no
máximo ~1 coleta por 20 000 passos.

Armadilha de medição registrada: comparar cenas com conjuntos de componentes
diferentes mede o `update` virtual dos behaviors extras (~1 µs/objeto), não os
eventos.

## 5. Testes (`tests/claude-test-eventos-contato.ts`)

1. Sem inscrição: nenhum evento, `contacts.count() === 0`.
2. Queda no chão: exatamente um *Enter* (não um por passada/lado), com `other`
   e `stepId` corretos; nenhum *Stay* com `events = 1`.
3. `events = 2`: *Stay* a cada passo enquanto toca; para de vir ao separar.
4. Corpo em repouso (dormindo) não gera *Exit*/*Enter* espúrios em 300 passos.
5. Separação (impulso para cima): um *Exit*.
6. Remoção (`removeAt`) de um corpo tocando: um *Exit* para o sobrevivente.
7. Gatilho: `onTriggerEnter/Exit` na zona e no passante; nada em `onCollision*`.
8. Ordem: três pares no mesmo passo chegam em ordem `(minId, maxId)`.
9. Script que remove `other` dentro de `onCollisionEnter` não quebra o passo.
10. Backend Rust selecionado + colisor inscrito → `rigidBackendName()` cai para
    CPU e os eventos chegam.

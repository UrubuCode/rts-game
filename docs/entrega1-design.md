# FPS multiplayer, entrega 1: núcleo FPS local (desenho)

- **Data:** 2026-09-23
- **Repositório:** `rts-fps` (originalmente no branch `feature/jogo-fps` do rts-game)
- **Código do jogo:** `src/` (simulação em `src/shared/`, cliente em `src/client.ts`)
- **Contexto:** `README.md` (decisões gerais e achados do teste de UDP)

## 1. Objetivo

Um FPS **jogável localmente** contra bots, que já use o motor em condições
reais: mapa grande com milhares de estáticos, raycast, overlap, pool e
criação/remoção de objetos. A arquitetura separa entrada e simulação desde o
início, para a entrega 2 (servidor dedicado UDP) rodar a mesma simulação sem
reescrita.

**Fora de escopo nesta entrega:** rede, placar entre máquinas, rampas
inclinadas (o índice só aceita rotação em Y), jogadores empurrando uns aos
outros.

Som: entregue em 2026-09 (`src/som.ts`), só no cliente local; o cliente de
rede fica sem som enquanto tiros não forem replicados.

## 2. Critérios de sucesso

1. `client.ts` abre uma janela onde se joga contra 12 bots: andar, pular, subir
   escadas de degraus, atirar, lançar granada, morrer e renascer.
2. **Tick de simulação ≤ 4 ms** com 12 bots e ~3.000 estáticos; render a 60 fps
   (vsync) no mesmo cenário. Medido com A/B e a saída colada, conforme
   `docs/licoes-revisao.md`.
3. Todos os testes sem janela da seção 11 passam.
4. Teste de resistência: 12 bots por 60 s de simulação sem `NaN` e sem jogador
   dentro da geometria.

## 3. Estrutura

```

  README.md
  shared/            sem janela e sem GPU: roda no cliente e (na entrega 2) no servidor
    config.ts        todas as constantes nomeadas (nomes definidos nas seções 6 a 10)
    layers.ts        bits de camada: MAPA, JOGADOR, GRANADA, EFEITO
    input.ts         PlayerInput + helpers de montagem
    player.ts        PlayerState + simulatePlayer()
    weapons.ts       tiro hitscan e granadas
    bots.ts          IA que produz PlayerInput
    map.ts           geração do mapa por semente
    consultas.ts     invólucros de raycast/overlap que contam consultas e tempo (painel F3)
    world.ts         FpsWorld: cena, jogadores, granadas, pools, tick fixo
  client.ts          janela, entrada, câmera, render, HUD
tests/
  fps-map.ts  fps-player.ts  fps-weapons.ts  fps-determinismo.ts  fps-resistencia.ts
```

**Sem ciclos de import:** `weapons.ts` e `bots.ts` não importam `world.ts`;
recebem por parâmetro o que precisam, e o `world.ts` aplica os resultados.

**Nomes de topo com prefixo `fps`/`FPS_`:** neste runtime, nomes de topo de
módulos diferentes colidem (ver `examples/physics_demo.ts`).

**Regra de fronteira:** nada em `shared/` importa `rts:egui`, `rts:input`,
`@engine/render/*` nem `@compat/app.ts`. Um teste sem janela que importe
`shared/world.ts` comprova a regra.

## 4. Laço e tick

- Simulação em **tick fixo de 60 Hz** (`TICK_DT = 1/60`) com acumulador; no
  máximo 4 ticks por frame, e o excedente é descartado para não entrar em
  espiral.
- Ordem de um tick em `World.tick(inputs)`:
  1. cada jogador vivo: `simulatePlayer(estado, input, TICK_DT)`;
  2. tiros e lançamentos de granada pedidos pelos inputs;
  3. granadas: integração, quiques, explosões;
  4. mortes e renascimentos;
  5. sincroniza estado → `GameObject` (posição e `active`), chama
     `scene.computeWorld()` e **`spatialRebuildIndex(scene)`**. O índice só se
     reconstrói sozinho quando o contador de passos da física muda, e o jogo não
     usa esse contador.
- O cliente lê teclado e mouse **uma vez por frame**, monta o `PlayerInput` do
  humano e o repete em todos os ticks daquele frame. Bots produzem o seu dentro
  do tick.

## 5. Mapa (`map.ts`)

- `gerarMapa(semente, escala, scene)` é **determinística**: mesma semente,
  mesma lista de objetos na mesma ordem. Usa um PRNG próprio (LCG), nunca
  `Math.random`.
- Conteúdo:
  - chão de 400 × 400 u (cai na lista de colossais do índice);
  - um grid de quarteirões com prédios (meia-extensão de 4 a 20 u), muros,
    caixotes, pilares e **escadas de degraus** (degraus de 0,3 u de altura);
  - bordas altas para ninguém sair do mapa.
- Todos os objetos do mapa são `stationary = 1`, na camada `MAPA`, criados
  **antes** do primeiro tick. Nada do mapa muda durante o jogo.
- `escala` controla a densidade. Meta padrão: **~3.000 estáticos**. Com
  `escala <= 0` gera só chão, bordas e pontos de renascimento: é o mapa vazio
  que os testes usam para montar cenários exatos.
- A função também devolve os **pontos de renascimento** (sobre o piso, fora dos
  prédios).

## 6. Jogador (`player.ts`)

**Estado** (só números, serializável):

```
PlayerState { id, x, y, z, vx, vy, vz, yaw, pitch, noChao,
              vida, vivo, tempoRenascer, municao, tempoRecarga, cadenciaRestante,
              granadasVivas, tempoGranada, abates, mortes, ultimoInputSeq }
```

**Entrada:**

```
PlayerInput { seq, frente, lado, pulo, yaw, pitch, atirar, recarregar, granada }
```

`frente` e `lado` valem −1, 0 ou 1; o resto é booleano ou ângulo em radianos.

**Corpo:** duas esferas de raio 0,4 (pés e cabeça), altura total 1,8. Para
ser atingido, cada jogador tem um `GameObject` dinâmico na camada `JOGADOR`:
uma caixa de 0,8 × 1,8 × 0,8.

**`simulatePlayer`, um tick:**

1. Velocidade horizontal desejada: `frente`/`lado` girados por `yaw`, módulo
   `VEL_ANDAR` (6 u/s). No chão, a velocidade vira a desejada na hora; no ar,
   converge para ela à taxa `ACEL_AR` (3 por segundo).
2. Pulo (`VEL_PULO` 5,5 u/s) somente se `noChao`. Gravidade `GRAVIDADE`
   (18 u/s²), com queda limitada a `VEL_QUEDA_MAX` (20 u/s). O limite mantém o
   deslocamento por tick (0,33 u) abaixo do raio do corpo, então a separação
   por esferas nunca atravessa um piso.
3. **Mover e deslizar:** aplica o deslocamento; para cada esfera,
   `overlapSphereNonAlloc` com máscara `MAPA`, e empurra para fora por
   `normal × profundidade`. Até `ITER_SEPARACAO` (3) iterações. Se a normal
   aponta para cima (> 0,7), zera `vy` negativo.
4. **Degrau:** se o deslocamento horizontal foi barrado, raycast para baixo a
   partir de (posição + direção × 0,5 + `ALTURA_DEGRAU`); se encontrar piso
   entre o pé e `ALTURA_DEGRAU` (0,45 u), sobe até ele.
5. **Chão:** raycast para baixo de comprimento `DIST_CHAO` (0,1 u) decide
   `noChao`; ao descer, gruda no piso se o vão for ≤ `ALTURA_DEGRAU`.
6. Abaixo de `Y_MORTE` (−50) o jogador morre.

**Regra de isolamento:** o movimento consulta só a camada `MAPA`; jogadores não
colidem entre si nesta entrega.

## 7. Armas (`weapons.ts`)

**Fuzil hitscan:**
- `CADENCIA` 10 tiros/s, `PENTE` 30, `TEMPO_RECARGA` 1,5 s, `ALCANCE` 300 u,
  `DANO` 25, multiplicado por 2 se o impacto ficar acima de 70% da altura da
  caixa do alvo (cabeça).
- **Origem do raio:** o olho fica dentro da própria caixa, e um raycast que
  começa dentro de um corpo acerta esse corpo a distância 0. O tiro parte do
  **ponto de saída do raio da própria caixa**, calculado com slab test
  (`saidaDaCaixa()`), mais um épsilon.
- Um `raycastNonAlloc` com máscara `MAPA | JOGADOR`. O acerto em `JOGADOR` é
  mapeado de volta ao `PlayerState` pelo `bodyId`.
- Espalhamento: 0 para humanos, `ERRO_MIRA_BOT` para bots.

**Granada:**
- Máximo `GRANADAS_POR_JOGADOR` (2) vivas; recarga `TEMPO_GRANADA` (3 s).
- Lançamento: direção da mira, velocidade `VEL_GRANADA` (14 u/s) mais
  `IMPULSO_CIMA_GRANADA` (3 u/s).
- Integração própria: a cada tick, um raycast no trecho percorrido, com máscara
  `MAPA`. No impacto, reflete a velocidade pela normal, multiplica por
  `QUIQUE` (0,5) e reposiciona no ponto de impacto + normal × raio.
- Explode após `PAVIO` (2,5 s): `overlapSphereNonAlloc(r = RAIO_EXPLOSAO = 6)`
  com máscara `JOGADOR`; para cada alvo, um raycast de **linha de visada** da
  explosão até o centro do alvo, com máscara `MAPA`. Se algo estiver no
  caminho, não há dano. Dano `DANO_GRANADA × (1 − d/r)` (100 no centro), mais
  empurrão `EMPURRAO_GRANADA` na direção do alvo.
- A granada é um `GameObject` dinâmico na camada `GRANADA`, **vindo de um
  pool** (seção 8), e nenhuma consulta de jogo a acerta.

## 8. Pools e ciclo de vida

- **Morte:** `vivo = false` e o `GameObject` do jogador fica `active = 0`.
  **Renascimento** após `TEMPO_RENASCER` (3 s): escolhe um ponto de
  renascimento livre (`overlapSphereNonAlloc` com máscara `JOGADOR` vazio num
  raio de 3 u) e reativa (`active = 1`). É o caminho do pool no índice.
- **Pool de granadas:** `POOL_GRANADAS` objetos criados no início; lançar ativa
  um, explodir desativa.
- **Efeitos visuais:** marcas de impacto, traçadores e explosões são
  **registros simples** num anel de `POOL_EFEITOS` (256), fora da cena e fora do
  índice, desenhados pelo cliente. (Um `GameObject` com malha sempre ganha
  colisor em `setMesh`, então não serviria.) Nenhuma alocação durante o jogo.
- **Bots entram e saem:** teclas `N`/`M` adicionam ou removem um bot com
  `scene.add`/`scene.removeAt`, exercitando a fila incremental do índice.

## 9. Bots (`bots.ts`)

- Produzem um `PlayerInput` por tick; **nunca** mexem no `PlayerState`
  diretamente.
- Estados:
  - **patrulha:** anda até um ponto de renascimento aleatório; troca de ponto
    ao chegar ou se ficar parado 2 s;
  - **perseguir:** mira no alvo visível mais próximo a até `VISAO_BOT` (60 u);
  - **atirar:** atira com erro `ERRO_MIRA_BOT` enquanto houver linha de visada.
- A linha de visada roda `VISADAS_BOT_HZ` (5) vezes por segundo por bot,
  **escalonada** (o bot `i` verifica nos ticks em que `tick % 12 == i % 12`),
  para não concentrar raycasts num tick.
- O PRNG de cada bot é semeado pelo `id`, então a IA é determinística.

## 10. Cliente (`client.ts`)

- Janela 1280 × 720 com `createAppAt`; `setVsync(1)`.
- **Entrada:** clique trava o cursor (`mouseLock`), `Esc` solta.
  WASD / espaço / botão esquerdo / `R` / `G` / `N` / `M` / `F3`.
  Sensibilidade `SENS_MOUSE` aplicada a `mouseDeltaX/Y`; `pitch` limitado a
  ±1,45 rad.
- **Câmera:** no olho do jogador local (altura `ALTURA_OLHO` = 1,6).
- **Render:** percorre `scene.objects` com `frustumBegin`/`inFrustumFast` e
  `drawGPU`, como os demos em `examples/`.
- **HUD:** mira, vida, munição, abates/mortes e contagem de bots.
- **Painel `F3`:** fps, ms de simulação por tick, ms de render, raycasts e
  overlaps por tick, µs médio por consulta, estáticos/dinâmicos/desenhados.
- A **porta de controle** WebSocket (7777) fica ligada, para inspeção remota.
- **Constantes:** tudo em `shared/config.ts`, com nome. As medidas de layout do
  HUD ficam num bloco próprio no topo de `client.ts`, também com nome (o
  `ui_config.ts` é do editor, não do jogo).

## 11. Testes

Todos sem janela, rodados com `rts.exe run tests/<arquivo>.ts`.

| arquivo | verifica |
|---|---|
| `fps-map.ts` | mesma semente gera a mesma lista (tipo, posição, escala) na mesma ordem; semente diferente gera mapa diferente; contagem na faixa da meta |
| `fps-player.ts` | andar 5 s contra uma parede não atravessa; sobe degrau de 0,3 u; não sobe degrau de 0,6 u; queda sobre piso não penetra; pulo só no chão |
| `fps-weapons.ts` | tiro não acerta o próprio atirador em nenhuma direção (inclusive para baixo); tiro atrás de parede não acerta; tiro na cabeça dá dano dobrado; granada não fere atrás de parede; granada fere com dano decrescente com a distância |
| `fps-determinismo.ts` | duas instâncias de `World` com a mesma semente e a mesma sequência de inputs terminam com `PlayerState`s idênticos após 600 ticks |
| `fps-resistencia.ts` | 12 bots, 3.600 ticks: nenhum `NaN`; a cada tick, `overlapSphereNonAlloc` no corpo de cada jogador vivo contra `MAPA` tem profundidade ≤ 0,05; imprime ms por tick (mediana e p99) |

Além disso, verificação visual rodando o `client.ts`.

## 12. Riscos

- **Custo de render com ~3.000 estáticos.** Os demos desenham objeto a objeto
  com `drawGPU`. Se passar do orçamento de frame, a escala padrão do mapa cai
  até caber, e o número fica registrado no README.
- **Degraus × separação por esferas:** a esfera dos pés pode ser empurrada para
  cima pela quina do degrau antes da lógica de degrau rodar. O teste de
  degrau alto (0,6 u) existe para pegar isso.
- **Índice global:** o índice espacial ainda é um estado global único (dívida
  registrada no #9). O jogo usa uma cena só, então não é afetado; se o
  `SpatialIndex` por cena entrar no `master` antes do fim, faz-se rebase.

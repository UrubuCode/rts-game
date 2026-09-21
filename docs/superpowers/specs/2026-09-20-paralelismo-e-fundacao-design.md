# Paralelismo e fundação: o plano

**Data:** 2026-09-20 · **Revisão 3** (revisão 2 + a discussão da issue #1: a
Fase 2 virou sete lotes de escopo firme, medidos em dois perfis de jogo, §7)
· **Estado:** desenho para revisão. Nada implementado.

---

## 1. Como este documento nasceu, e o que ele errou na primeira versão

Sete análises independentes propuseram arquiteturas para "usar todos os
dispositivos da máquina". Todas pediram a mesma medição antes de construir.
A medição foi feita, derrubou a premissa de duas delas — e a **revisão 1 deste
documento, escrita em cima dela, cometeu três erros que quatro revisores
acharam**. Ficam registrados porque o tipo do erro importa mais que o erro.

**Erro 1 — denominadores misturados.** A revisão 1 afirmou "a física é o passo
mais caro, por margem de ~3×" usando os 36,9 ms do **solver TS que este plano
abandona**, enquanto o backend escolhido faz a mesma cena em 0,62 ms. O "~3×"
não sai de medição nenhuma. É o mesmo erro de denominador que o `rigidReport`
registra ter custado uma campanha a este projeto.

**Erro 2 — a "inversão" do bench de render não existe.** A revisão 1 listou como
risco que o `scenedraw.ts` afirma 3× a favor de uma variante enquanto a medição
deu o contrário. São **benches diferentes**: os 2,910→0,920 ms vêm do
`claude-bench-lacoprep.ts`; os 0,060/0,110 vêm do `claude-bench-render-loop.ts`.
Erro 1 outra vez, agora dentro da tabela de riscos.

**Erro 3 — convergência tratada como evidência.** Três análises independentes
concluíram "fixe o Rust como padrão". A revisão 1 chamou isso de sinal forte.
Não era: as três liam **a mesma tabela, medida numa máquina de 16 threads**.
Convergência de análises que compartilham a mesma medição enviesada é a mesma
opinião contada três vezes. Foi preciso um revisor encarregado de *atacar* para
achar o viés — e a medição abaixo para confirmá-lo.

### O número obsoleto que iniciou tudo (confirmado)

`computeWorld` "custa 14,20 ms a 8000 objetos" — dito em `scene.ts:1171,1174` e
repetido em `bench/claude-bench-computeworld.ts:8`. **Medido: 0,57 ms parada,
0,81 ms movendo.** Era verdadeiro quando escrito; as otimizações posteriores o
derrubaram e o texto não acompanhou.

---

## 2. Os números que valem (release, 2026-09-20)

### 2.1 O solver legado × os backends rápidos

Denominadores separados de propósito: a primeira linha é o código que este plano
tira do caminho, as outras duas são candidatos reais.

| 2000 corpos densos, por frame (2 sub-passos) | ms |
|---|---|
| solver TS da `Scene` (legado) | **36,92** (97% é a conta de pares) |
| backend Rust, 16 threads | **0,62** |
| backend GPU | **1,95** |

### 2.2 O cruzamento depende de THREADS e de n

ms por passo simulado, contato denso. **Negrito = vencedor.**

| n | GPU | Rust 1t | Rust 2t | Rust 4t | Rust 16t |
|---|---|---|---|---|---|
| 250 | 0,52 | **0,14** | **0,10** | **0,07** | **0,04** |
| 1 000 | 0,73 | 0,77 | **0,43** | **0,26** | **0,18** |
| 2 000 | 0,97 | 1,87 | **0,98** | **0,55** | **0,31** |
| 4 000 | 1,63 | 4,55 | 2,33 | **1,25** | **0,63** |
| 8 000 | 3,43 | 10,38 | 5,30 | 2,75 | **1,42** |

**Joelho por contagem de threads:** 1 thread cruza em ~1 000 corpos; 2 threads em
~2 000; 4 threads em ~8 000; 16 threads não cruza na faixa medida.

**A decisão de backend é real e tem duas variáveis.** O que estava podre não era
existir decisor — era um decisor que mede uma sonda n² não correspondente ao
kernel e devolve ruído.

### 2.3 Outros custos, à mesma escala

| trabalho | ms |
|---|---|
| `computeWorld`, 8000 objetos movendo | 0,81 |
| `computeWorld`, 8000 objetos parados | 0,57 |
| laço de render (CPU), 500 objetos | 0,06–0,11 |
| colisão CPU (TS), 2000 espalhados | 1,01 |

### 2.4 O que NÃO é confiável e não deve ser citado

- **Linhas de n ≥ 16 000 do bench denso.** `y_gpu` termina **positivo** (o corpo
  0 subiu): a GPU não assentou. O rodapé do próprio bench avisa que um backend
  que não simula é sempre o mais rápido. Os cruzamentos de §2.2 ficam em
  n ≤ 8 000, onde ambos assentam — a conclusão vale, o topo da tabela não.
- **A linha do frame do editor** (16,04 ms, `present` 89,6%, física 1,06). Com
  vsync ligado `present` é **espera bloqueante**: ele absorve toda a folga por
  construção. Não sustenta nenhuma conclusão sobre ociosidade. Re-medir com
  `vsync 0` antes de usar.

---

## 3. O que os números estabelecem

1. **O custo dominante é o solver TS legado**, e sair dele vale entre 1,8× e 60×
   conforme threads e n. É o maior ganho disponível no projeto.
2. **`computeWorld` não é problema** nesta escala. SoA no grafo de cena por causa
   dele seria otimizar um número que não existe mais.
3. **Não há evidência de escassez para escalonar.** Também não há evidência do
   contrário: a única medição de frame é vsync-limitada. Escalonador continua
   adiado por **falta de evidência**, não por evidência de folga.
4. **Nenhum backend vence sempre.** A escolha depende da máquina e da cena.

---

## 4. O princípio que ordena o plano

Uma engine decide o que **todo sistema futuro herda**. A ordenação é pelo custo
de mudar depois:

| caro de mudar depois | barato de trocar depois |
|---|---|
| layout dos buffers | qual backend roda |
| quem escreve o quê e quando | física em threads ou GPU |
| a fronteira determinístico × cosmético | culling na CPU ou GPU |
| quais perguntas a física sabe responder | o escalonador |

**Construir os contratos agora; adiar a maquinaria.** O escalonador não é a
fundação: Bevy e DOTS mostram que o grafo é problema resolvido, e o difícil é a
disciplina de dados. A regra 2 do `rts-physics` já obriga a isso — um worker só
vê `&[f32]`, logo um sistema só vai para threads se já estiver plano.

---

## 5. Fase 0 — o decisor honesto e o padrão certo

**Um único commit.** Os itens são interdependentes: trocar o padrão antes de
corrigir o teste deixa a suíte vermelha no meio do caminho.

1. **Substituir o modelo de custo por uma tabela medida.** `rigidCalibrate` e
   `rigidGpuCostMs`/`rigidCpuCostMs` saem; entra um perfil `(threads, n) → ms`
   com os pontos de §2.2, interpolado dentro da faixa e **recusando fora dela**
   em vez de extrapolar. Sem coeficiente inventado.
2. **Preservar a detecção de GPU fora do calibrador.** Hoje
   `pbTemGpu = gpu.available()` é escrito **só** dentro de `rigidCalibrate`
   (`physics_backend.ts:144`) e lido em `pbAlvo` (`:692`). Removê-lo sem mover
   isso quebraria a queda para a CPU que o próprio arquivo chama de "não
   opcional".
3. **Portão de disponibilidade do backend Rust.** `crAvailable()` devolve `1`
   fixo e o ramo do modo 2 não tem portão — mas rayon é thread de SO (não existe
   em wasm) e `physics` é *feature* opcional no `rts-host`. Num build sem ela o
   padrão falharia no carregamento. `crAvailable()` passa a responder de verdade
   e `pbAlvo` cai para GPU ou CPU quando `rts:rigid` não existe.
   *Limite achado na implementação (`803c3f7`):* o import de `@compat/rigid.ts`
   é de topo, então um build sem o módulo falha no **carregamento**, antes de
   qualquer sondagem. A queda em runtime só existe com import dinâmico; até lá
   o portão cobre "o módulo está e recusa", não "o módulo não está".
4a. **Histerese na troca de dono.** O modo AUTO reavalia o perfil a cada passo;
   perto do joelho (≈2 000 corpos com 2 threads) uma cena com spawn contínuo
   trocaria Rust↔GPU repetidamente, pagando leitura síncrona e ressincronização
   a cada troca. Só troca quem vence por margem ≥ 20% durante N passos seguidos.
4. **Padrão → Rust, condicionado ao perfil.** Nesta máquina (16 threads) ele
   vence em toda a faixa; numa de 1–2 threads com cena grande, não.
5. **Corrigir o que a mudança quebra**, nominalmente:
   - `tests/claude-test-physics-backend.ts` — importa `rigidCalibrate`,
     `rigidReport`, `rigidBackendFor`, `rigidBand` (`:19`) e pina
     `check("modo padrao = GPU")` (`:70`). Reescrever, não só rodar.
   - `src/editor/control/dispatch.ts:95` — `fisica auto` → `rigidSetMode(2)`.
     Renomear para `fisica rust`; `:96` usa `rigidReport()`.
6. **Matar os números obsoletos na mesma passada**, com a data da medição:
   - `physics_backend.ts:309-312` — a tabela "por que a GPU é o padrão"
     (CPU 2000 = 21,40 e GPU = 0,75; medidos 36,92 e 1,95: **as duas colunas
     erradas**). É a justificativa que esta fase derruba.
   - `physics_backend.ts:25-26` — "500 em movimento = 14,05 ms".
   - `scene.ts:1171,1174` e `bench/claude-bench-computeworld.ts:8` — o 14,20 ms.
   - `physics_backend.ts:251,781-796` — literais 9,55 / 0,52 / "superestima 3,3x",
     que saem junto com o modelo.
   - **Verificar antes de manter:** `scenedraw.ts:50-54` (rodar
     `claude-bench-lacoprep.ts`), `scene.ts:70,343`, `cpurigid.ts:36-37`,
     `transform.ts:41`.

**Aceite (comandos, não adjetivos):**

```bash
cd ../rts && cargo build --release --bin rts          # obrigatório antes dos testes
cd ../rts-game
for f in tests/*.ts; do ../rts/target/release/rts.exe run "$f"; done   # 27 arquivos, todos [PASSOU]
cd ../rts && cargo test --release -p rts-physics      # 36 testes
```

Mais: perfil respondendo a **mesma** faixa em 4 execuções consecutivas
(variação < 10%, contra os ±40% de hoje); e medição de frame com **`vsync 0`**,
cena nomeada de 2 000 corpos acordados, 1 200 frames, antes e depois, publicada
no commit. Com vsync ligado a diferença é invisível e o critério não vale.

**Rollback:** `rigidSetMode(1)` restaura a GPU em runtime; a porta de controle
(`fisica gpu`) continua funcionando.

---

## 6. Fase 1 — os contratos

7. **`Needs` nasce completo, não só com determinismo.** `deterministic`,
   `raycast`, `overlap`, `contact_events`. Um backend que não sabe **recusa pelo
   nome** (regra 9 do crate, `Backend::supports`). Se a Fase 1 congelar um
   `Needs` que só fala de determinismo, a primeira query obriga a reabri-lo — o
   custo-de-mudar-depois que a §4 existe para evitar.
8. **Contrato de consulta.** Hoje **não existe raycast/overlap/sweep** (`grep`
   por `raycast` em `src/engine/` dá zero), e um RTS faz raycast em todo clique
   de seleção e toda ordem de movimento. Sob o contrato de posse, com
   `pbDono !== 0` o estado mora no backend e o espelho da GPU tem **um frame de
   atraso e sem velocidade** (`pbApply` não lê `vel`). O contrato tem de dizer
   **de quem é a verdade e qual é a latência**. *Aceite:* um raycast durante o
   play responde sobre o frame atual ou declara o atraso.
9. **Reserva de layout: máscaras de camada e canal de contatos.** Máscara é
   **bits no buffer**, e `docs/colisores.md` §4 já mostra que os 16 floats por
   corpo estão ocupados. Decidir isso depois da Fase 2 é decidir depois de o
   layout estar congelado por rotação e OBB. **Entra na decisão de layout da
   issue #1, não depois dela.**
10. **Replay contado em passos.** `stepsFor` **descarta** o tempo que não coube
    (defesa contra a espiral da morte), então replay dirigido por `dt` é
    irreprodutível por construção. O relógio é `stepCount()`. *Depende do item 4:*
    só o backend Rust é determinístico bit a bit.
11. **Contrato de sistema — com consumidor.** Todo sistema novo declara o que lê,
    o que escreve, onde roda e se é determinístico ou cosmético. **Com um
    verificador em modo debug** que confira as declarações contra as escritas
    reais numa cena de teste. Sem consumidor o contrato degrada para comentário
    em três meses — este documento tem o caso registrado na §1. *Se o verificador
    não couber nesta fase, o item sai; contrato sem verificação é burocracia.*

**Aceite da fase:** um teste de replay que roda a mesma cena duas vezes, N passos,
e compara todos os transforms **bit a bit**; depois com 1, 2 e 16 threads.

---

## 7. Fase 2 — o vocabulário da física (issue #1)

Ver [UrubuCode/rts-game#1](https://github.com/UrubuCode/rts-game/issues/1).
Reescrita na **revisão 3**, depois da discussão na issue (quatro comentários de
revisão externa, conferidos contra o código em `3d29515`).

### 7.1 A premissa: é um motor, e o jogo não é conhecido

A revisão 3 inicial ordenou esta fase assumindo um RTS ("unidade não é corpo
rígido, então torque é opcional"). **Premissa errada para um motor**: quem vai
usar a engine pode querer um RTS de mil agentes ou um jogo de empilhar caixas, e
a física tem de servir aos dois. O que muda:

- **Os cinco lotes são escopo firme.** Manifold e dinâmica angular não esperam
  gatilho de jogo nenhum; a ordem entre eles é só a da dependência técnica.
- **Nenhuma decisão de jogo bloqueia a fase.** O que a issue listou como
  "decisões em aberto" (unidades se empurram? lockstep?) vira **opção que o motor
  expõe**, não pergunta que ele faz ao dono do projeto.

Os dois perfis que cada lote tem de atender, e que viram as cenas de referência
de todo aceite e de todo bench:

| perfil | cena de referência | o que estressa |
|---|---|---|
| **multidão** | 5 000 cinemáticos com footprint + 500 dinâmicos + estáticos | filtro por máscara, cinemático empurrando, consultas por frame, custo por corpo *que não colide* |
| **rígido denso** | 2 000 caixas dinâmicas empilhadas e tombando | narrow phase, manifold, solver, sono |

O motor oferece os dois caminhos e documenta o custo de cada um: um agente pode
ser `kinematic` (barato, não recebe impulso) ou `dynamic` (caro, físico de
verdade), e pares agente × agente podem ser desligados por máscara. **Escolher é
do jogo.** O que o motor deve é que as duas escolhas funcionem e que a cara
avise quanto custa — mil `dynamic` em contato formam uma ilha só, e isso aparece
no `dbg`, não numa recusa.

Consequência de escala: o alvo volta a ser **milhares de corpos dinâmicos**, a
faixa de §2.2 em que GPU e Rust disputam. Por isso o layout do Lote A reserva
orientação e velocidade angular **graváveis nos três backends** desde o primeiro
dia — a GPU não pode ficar para trás na rotação, que era o que `docs/colisores.md`
§4 aceitava ("rotação é entrada, não estado").

### 7.1.1 O dev escolhe a física, e só paga pela que escolheu

Completo **e** eficiente só fecha de um jeito: cada recurso é opcional e o que
está desligado custa zero. O dev declara o nível por projeto ou por cena; o motor
roda o kernel mais barato que atende.

| nível | o que simula | quem quer |
|---|---|---|
| `simples` | esfera e caixa alinhada, sem rotação — **o solver de hoje** | RTS, top-down, multidão, protótipo |
| `orientada` | + quaternion e OBB, sem torque (Lote C) | rampas, paredes giradas, plataformas |
| `completa` | + manifold, warm starting, dinâmica angular, sono por ilha (D–F) | empilhar, tombar, destruição |

CCD (Lote G) e consultas/eventos (Lote B) são ortogonais ao nível: ligam por
corpo e por uso.

Como isso vira código sem virar três motores:

- **Um layout, um contrato, N kernels.** O layout do Lote A é o mesmo nos três
  níveis; o nível `simples` simplesmente não lê nem escreve `quat`/`angVel` e
  não aloca `contacts`. O WGSL já é montado por string — o nível entra como
  especialização na montagem, não como `if` dentro do laço quente. No Rust, o
  mesmo por parâmetro genérico/const.
- **O nível é um campo de `Needs` (Fase 1).** Backend que não implementa o nível
  pedido recusa pelo nome e o decisor cai para outro — o mecanismo que já existe
  para casca (`rigidNeedsFallback`), sem caminho novo.
- **O perfil medido da Fase 0 ganha a dimensão nível:** `(nível, threads, n) → ms`.
  O decisor só é honesto se souber que `completa` custa mais que `simples`.

**Regra de aceite que vale para todo lote:** o nível `simples` **não regride**.
Bench das duas cenas de §7.1 no nível `simples`, antes e depois; mais de 5% de
perda reprova o lote. É isso que garante que quem não pediu rotação não paga por
ela — e é o que torna seguro entregar os lotes D–G sem medo de estragar o RTS.

### 7.2 Os lotes, na ordem

Cada lote tem aceite próprio e deixa a suíte verde; a fase pode parar entre dois
lotes sem dívida.

**Lote A — layout e tipos (um PR, sem matemática nova).**

1. *Teste primeiro:* paridade com **estático de centro deslocado**. Confirmado em
   `3d29515`: `rbSyncStatics` (`gpurigid.ts:684-686`) e `crSyncStatics`
   (`cpurigid.ts:213-215`) gravam `t.wx/wy/wz` cru, enquanto o solver da cena
   soma `centerLocalX/Y/Z` (`collider.ts:246-252`). As meias-extensões já passam
   por `collider.ts` — o comentário de `cpurigid.ts:190-194` que diz o contrário
   está **obsoleto** e sai na mesma passada.
2. **Layout versionado, uma definição e três leitores** (TS, WGSL, Rust), com um
   teste que confere offsets nos três. Proposta a validar por bench antes de
   congelar — ela **cabe nos 4 bindings** sem remover o limite da janela:

   | binding | acesso | conteúdo por corpo |
   |---|---|---|
   | `pose` | read_write | `pos.xyz` + sono · `quat` |
   | `motion` | read_write | `vel.xyz` + invMass · `angVel.xyz` + livre |
   | `world` (cauda) | read | `ext.xyz` · `invInércia.xyz` · bits: tipo, forma, `hullId`, flags · `layer`, `mask` — ao lado de materiais, estáticos e grid, que já moram ali |
   | `contacts` | read_write | manifold e impulsos acumulados (Lote D); vazio até lá |

   **O teto de 4 é configuração, não hardware** (verificado, §15.1): a janela
   abre com `config = 0` e o device nasce com `downlevel_defaults`. Pedir só
   `max_storage_buffers_per_shader_stage = 8` sobre o downlevel é uma mudança
   pequena no host e deixa o resto da economia de RAM intacta. A tabela acima
   continua sendo a proposta — separar quente de frio vale pela banda de memória,
   não mais pela contagem — mas o layout **deixa de ser refém** do quarto binding,
   e o Lote D pode ter buffers próprios.

   `ext` é somente leitura hoje e ocupa um binding inteiro; movê-lo para a cauda
   do `world` é o que libera o quarto. `vel.w` deixa de codificar forma e
   `hullId`. O bench compara o kernel atual contra o novo layout **sem mudar a
   física**, 2 000 e 8 000 corpos densos, `vsync 0`: regressão acima de 10%
   reabre a decisão.
3. **Tipo de corpo com três valores:** `static`, `kinematic`, `dynamic`. Um só
   cinemático, dirigido por velocidade; quem dirige por posição entrega
   `(poseNext − poseAtual) / dt` na borda. `pbEmpurraTeleportes`
   (`physics_backend.ts:597-610`) passa a zerar velocidade **só** para `dynamic`
   teleportado; `stationary` continua como campo de cena e é mapeado para o tipo.
4. **Layer/mask**, filtrado antes da narrow phase e idêntico nos três backends:
   `(A.mask & B.layer) != 0 && (B.mask & A.layer) != 0`.

*Aceite:* os 27 arquivos de `tests/` e os 36 do crate verdes; paridade nova
(centro deslocado, cinemático empurrando pilha sem perder velocidade, par
filtrado por máscara) dentro da tolerância; bench do item 2 publicado no commit.

**Lote B — consultas e eventos.** `raycast` e `overlap` primeiro; `shapeCast`
quando houver projétil. Cada resposta carrega o `stepId` a que se refere (§6
item 8). Eventos `begin/persist/end/trigger` saem **depois** do solver, em fila
ordenada por `stepId` e par canônico `(min, max)`; nenhum callback altera o mundo
durante a narrow phase. Fecha os itens 7–9 da Fase 1 — se a Fase 1 já os tiver
entregue, este lote é só a implementação por backend.

**Lote C — OBB sem torque.** Quaternion como estado canônico (Euler continua na
API do editor). SAT de 15 eixos para OBB-OBB, clamp em espaço local para
OBB-esfera — o mesmo "transformar o outro corpo" de `docs/colisores.md` §4. A
narrow phase devolve `normal`, `penetração` e ids de feature; eixos quase
paralelos têm tolerância escrita e desempate determinístico. CPU e Rust primeiro,
WGSL depois. *Aceite:* paridade comparando **normal e profundidade**, não só a
posição final; rampa e parede orientadas; save/load conserva a pose.

**Lote D — manifold, em duas metades** (reordenado pela pesquisa, §15.2).
*D1 — manifold sem memória:* até 4 pontos recalculados a cada sub-passo, contato
suave (frequência em Hz + razão de amortecimento no lugar do slop 0,04 / 85%),
passada de relaxamento, e **divisão de massa** no kernel gather da GPU (cada corpo
divide sua massa efetiva pelo número de contatos que tem, em vez de aplicar
"metade da correção" de cada par). Nada persiste entre passos, então nada disso
precisa do buffer `contacts`. *D2 — warm starting:* casamento por feature id e
impulsos acumulados, **só se D1 reprovar no aceite da pilha**. É a parte mais
cara de portar para a GPU e a literatura mostra pilha estável sem ela. Recorte de face incidente, até 4 pontos,
casamento entre passos por feature id. *Aceite:* pilha de caixas com jitter e
energia em repouso medidos, com e sem warm starting.

**Lote E — dinâmica angular.** Tensor de inércia, velocidade angular, torque.
Vem **depois** do manifold: com um único ponto de contato, uma caixa em repouso
com torque oscila para sempre. *Aceite:* apoio fora do centro inclina; impacto
lateral gira; esfera invariante; momento conservado dentro de tolerância escrita.

**Lote F — sono por ilha.** Com torque, uma caixa dormindo dentro de uma pilha
acordada deixa de ser cosmético e vira pilha que não desaba. Ilhas por DFS
determinístico na CPU/Rust; na GPU, propagação de "acordado" por vizinhança em
passes. *Aceite:* tirar a base de uma pilha adormecida acorda a pilha inteira.

**Lote G — CCD seletivo.** Modos `discrete` e `sweep` por corpo; primeiro
esfera/cápsula contra estáticos por `shapeCast` (que o Lote B já entregou).
O teto de 48 u/s deixa de ser a única defesa. *Aceite:* projétil acima do teto
não atravessa a parede de referência; custo do CCD medido em separado.

`docs/colisores.md` §3 continua valendo como limite **de desempenho**, não de
escopo: casca dinâmica contra casca dinâmica entra como esfera até alguém pagar
o SAT geral, e isso é recusado pelo nome (`Backend::supports`), nunca em silêncio.

### 7.3 O que fica adiado, com gatilho — só estrutura de desempenho

Recurso de física não espera gatilho (é o que um motor deve). O que espera
medição é **estrutura de otimização**, que troca complexidade por velocidade e só
se paga quando o perfil mostra:

| proposta | por que não agora | gatilho |
|---|---|---|
| `PhysicsWorld` SoA com `BodyId + generation` | o backend Rust já é SoA (`&[f32]`) e o contrato de posse já separa cena de solver; reescrever a fronteira antes do Lote A é mexer em dois eixos de uma vez | resync por spawn (`crInit`, §9) acima de 1 ms numa cena de spawn contínuo |
| broad-phase persistente, fat AABB, DBVT | o grid é medido e exato; nenhum perfil mostra a broad-phase dominando | broad-phase > 30% do passo em uma das três cenas (densa, esparsa, escalas mistas) |
| paralelismo por ilha no Rust | o Lote F entrega ilhas para o sono; usá-las para distribuir o solver é outra coisa | solver > 50% do passo no perfil rígido denso com threads ociosas |
| GPU-resident completa | já é a Fase 3 deste plano | §8 |

Recusado de vez: quatro variantes de tipo de corpo (duas de cinemático) — uma
basta, a outra é conversão na borda.

O plano de RTS (unidades, HPA*, flow fields, formação, ORCA, combate) é outro
épico: `docs/superpowers/plans/2026-09-20-super-plano-rts.md` (commit `57221ad`).
Deste documento ele recebe o nível `simples` com corpos `kinematic` (§7.1.1) e
os contratos do Lote B; o
`RTS-2` dele (agente cinemático) **depende do Lote A** e de nada depois dele.

**Nota de aceite:** os lotes C–E mudam o solver e **invalidam a paridade medida
na Fase 0**. A tolerância de 0,15 será re-medida e republicada em cada um.

---

## 8. Fases 3 e 4 — adiadas, com gatilho

**Fase 3 — GPU-resident.** Ressuscitar o `draw_indirect` perdido no porte (o pass
3D novo tem onze membros e nenhum desenha a partir de buffer de GPU). Não era um
recurso de partículas, era o mecanismo geral: destrava partículas, fluido visual
e culling residentes. *Gatilho:* `P_MUNDO3D` decomposto em preparação × submissão
mostrar a preparação dominando. Hoje o laço custa 0,06–0,11 ms a 500 objetos.

**Fase 4 — escalonador.** *Gatilho, duas condições juntas:* um sistema sozinho
passando de 8 ms por frame sem saída algorítmica, **e** ociosidade somada de
CPU+GPU acima de 30% num frame que estoura 16,7 ms — medida com `vsync 0`.

Quando vier, a forma já está desenhada: escalonador em Rust (`rts:jobs`),
sistemas declarando ids de buffer, recusa em conflito de escrita (como
`rigid.step` já recusa), GPU como executor com ticket.

---

## 9. Limites declarados (o que hoje não existe e não será escondido)

- **Corpos cinemáticos não existem.** `invMass = 0` dá **imóvel**, não
  cinemático. E `pbEmpurraTeleportes` trata movimento externo como teleporte e
  **zera a velocidade** — exatamente o comportamento errado para uma unidade
  andando por pathfinding. Bug latente já presente; resolvido no Lote A da
  Fase 2 (§7.2), que é o primeiro — não espera por OBB.
- **Eventos de colisão não chegam ao gameplay.** O solver gather descarta o par
  ao resolver. Sem dano, sem área de captura, sem "chegou ao destino".
- **Determinismo é entre contagens de thread no mesmo binário.** Entre máquinas
  ninguém verificou — mas o caminho é mais curto do que parecia (§15.3): `rustc`
  não contrai FMA por conta própria, então o que falta é (a) nenhuma
  transcendental no caminho do solver — só `+ − × ÷ sqrt`; Euler→quaternion
  acontece na borda —, (b) ordem de redução fixa no rayon, (c) o teste. **Não
  prometer lockstep antes do teste**, que é o do Box2D: mesma cena em x64 e ARM,
  comparar o número de passos até tudo dormir e o hash dos transforms.
- **Estáticos divergem entre backends quando o `Collider` tem centro deslocado.**
  GPU e Rust gravam `t.wx/wy/wz` cru; a cena soma `centerLocal*`. As
  meias-extensões já estão certas (o comentário de `cpurigid.ts:190-194` ficou
  obsoleto). Primeiro item do Lote A, §7.2.
- **Dívida aceita do Lote A: o solver ficou mais caro por contato** (issue #5).
  Tipo de corpo e máscara custaram +9–10% no Rust em 4 000–8 000 corpos e +7%
  na GPU em 8 000, medido A/B contra a base em 2026-09-21, cena sem máscaras.
  O `any_mask` não resolveu porque o custo é **por contato** (registro de
  material mais largo lido por par), não do filtro. Aceito pelo dono do projeto
  para mergear; **tem de ser pago antes do Lote C**, que mexe no mesmo laço — do
  contrário a regressão do OBB e esta ficam impossíveis de separar.
- **`crInit(m)` realoca o mundo inteiro** quando a contagem muda, e
  `compVersion` invalida tudo: num mapa com spawn contínuo, cada unidade criada
  paga um resync completo.

---

## 10. O que o plano recusa

- **Plugar Rapier, Jolt ou PhysX.** Perderíamos paridade entre backends e
  determinismo (regra 10). Um backend externo entra declarado **fora** do grupo
  de paridade, nunca como substituto.
- **iGPU como processador de física.** 5–20× mais fraca, sem memória
  compartilhada com a discreta, e toda troca passa pela CPU. Só se paga em
  trabalho que nasce e morre nela.
- **SoA no grafo de cena agora.** O número que a justificava não existe mais.
  Revisitar se `computeWorld` passar de 3 ms numa cena real.
- **Decidir pelo jogo.** O motor não recusa mil soldados `dynamic`; ele oferece
  `kinematic` e máscara como caminho barato e mostra o custo do caro (§7.1).
- **SAT isolado no layout atual.** `vel.w` já codifica forma e `hullId`; OBB em
  cima disso congela o layout errado. Layout primeiro (Lote A).
- **Apagar a decisão de backend.** Tentado na revisão 1 e derrubado pela medição:
  a decisão é real e tem duas variáveis.

---

## 11. Riscos

| risco | mitigação |
|---|---|
| Testes codificam o comportamento antigo | Nominalmente listados na Fase 0 item 5; reescrita faz parte do commit |
| Superfície pública quebrada (`dispatch.ts`, porta de controle usada pela skill) | Item 5; renomear `fisica auto` → `fisica rust` |
| Editor abre no padrão novo sem opt-in; cenas salvas não gravam backend | `rigidSetMode(1)` como rollback em runtime; medir `scenes/stress500.json` visualmente antes e depois |
| **Deriva entre repositórios** — esquecer `cargo build` e testar binário velho | §12, regra de trabalho. É o modo de falha mais provável deste plano |
| Outros números do código obsoletos como o do `computeWorld` | Fase 0 item 6 lista os conhecidos e os suspeitos; medir antes de citar, sempre |
| Fase 2 é grande e pode parar no meio | Lotes A–G de §7.2, cada um com aceite próprio e suíte verde ao fim |
| Recurso novo encarece quem não o usa | Níveis de §7.1.1; aceite de todo lote exige `simples` sem regressão > 5% |
| Otimizar para um perfil e regredir o outro | Todo bench de lote roda as **duas** cenas de §7.1 |
| Layout novo (4 bindings, `ext` na cauda do `world`) regride o kernel | Bench do Lote A item 2 antes de congelar; > 10% reabre a decisão |
| Quatro planos sobrepostos no repositório, com fases de mesmo nome e conteúdo diferente | §14: este documento é o normativo; os outros são referência e levam aviso no topo |
| Contato descartado em silêncio quando um bucket do grid enche (32 vagas) | Lote A ganha contador de overflow por passo, exposto no `dbg`; aceite exige zero nas cenas de referência |
| Paridade da Fase 0 invalidada pela Fase 2 | Re-medir e republicar a tolerância (§7) |

---

## 12. Regras de trabalho (não são opcionais)

Os dois repositórios são acoplados: o solver vive em `UrubuCode/rts` e é chamado
do TS em `rts-game`.

- Toda mudança em `crates/` exige **`cd ../rts && cargo build --release --bin rts`**
  antes de rodar qualquer coisa em `tests/`. Sem isso o lado TS testa o binário
  velho e conclui errado.
- Para abrir o editor com a mudança: **`cargo build --release -p rts-host
  --example ui_fixture --features ui`**.
- `cargo test --release -p rts-physics` (36 testes) roda **separado** dos 27
  arquivos de `tests/` e entra no aceite de qualquer fase que toque o crate.

---

## 13. Pré-requisito da Fase 0 (não é "dado faltante")

**A máquina-piso e o alvo.** A §2.2 mostra que o joelho se move de ~1 000 corpos
(1 thread) para além de 32 000 (16 threads). Sem saber o piso, o perfil da Fase 0
não tem faixa para cobrir, e a afirmação da revisão 1 de que "as Fases 0 e 1
valem em qualquer máquina" era falsa.

Além disso, contagem de unidades e **número de queries por frame** decidem o
layout da Fase 2 — então o alvo não afeta só as fases adiadas.

Perguntas abertas: editor, partida de RTS (com qual N), ou demo? Piso de 2, 4 ou
16 núcleos?

As "decisões de jogo" que a issue #1 levantou **não são pré-requisito**: num
motor cada uma vira opção exposta, e o lote que a entrega está ao lado.

| pergunta da issue | como o motor responde |
|---|---|
| unidades se empurram? | tipo do corpo + máscara, por objeto (Lote A) |
| mapa 2,5D ou 3D navegável? | consultas são 3D (Lote B); 2,5D é um caso particular |
| quais objetos são rígidos? | componente `Rigidbody` por objeto, como hoje |
| replay ou lockstep? | `Needs.deterministic` escolhe o backend (Fase 1); o limite entre máquinas está em §9 |

---

## 14. Precedência entre os documentos (para quem for implementar)

O commit `57221ad` pôs em `docs/superpowers/plans/` quatro textos da revisão
externa. Eles se sobrepõem a este e entre si — "Fase 0" significa três coisas
diferentes. A regra:

| documento | papel |
|---|---|
| **este** | normativo: ordem, escopo, gatilhos e aceite |
| `2026-09-20-fase0-decisor-medido.md` | plano executável da Fase 0 daqui (§5). Inalterado pela revisão 3 |
| `2026-09-20-issue-1-implementation-plan.md` | referência de **matemática** para os Lotes C–G (SAT de 15 eixos, recorte do manifold, fórmulas angulares, lista de testes). A ordem e os tipos de corpo de lá **não valem** |
| `2026-09-20-super-plano-fisica.md` | catálogo do que fica adiado em §7.3; nada dele entra sem o gatilho |
| `2026-09-20-super-plano-rts.md` | épico separado; ainda sem plano executável |
| `2026-09-20-review-issue-1.md`, `…research-notes-physics.md` | histórico e bibliografia |

Onde eles discordam deste, e o que vale:

| ponto | lá | aqui | por quê |
|---|---|---|---|
| unidades | `dynamic` num plano, agente no outro | os dois são suportados; o jogo escolhe (§7.1) | é um motor |
| ilhas e CCD | fases 4 e 6 de lá | Lotes F e G daqui | são recurso, não otimização — entram sem gatilho |
| tipos de corpo | quatro, dois cinemáticos | três | posição → velocidade é conversão na borda |
| primeira entrega | `BodyId`, comando/snapshot, `PhysicsStats`, layout, máscara, tudo junto | Lote A, sem `BodyId` nem snapshot | um PR que troca a fronteira **e** o layout não tem bisect |
| broad-phase persistente antes de OBB | Fase 1 de lá | adiado, §7.3 | nenhum perfil mostra a broad-phase dominando |
| metas de tempo | "2 000 densos < 8 ms" | §2.1: já medido **0,62 ms** | meta mais frouxa que o presente não orienta nada; a meta é *não regredir mais de 10%* por lote |
| limite de 4 bindings | remover, ou `bodyState` único, a decidir | cabe em 4 movendo `ext` (§7.2) | a validar por bench; se falhar, as opções de lá são o plano B |

Cada lote de §7.2 ainda precisa do seu plano executável (tarefas, arquivos,
comandos), no formato do da Fase 0, **escrito logo antes de ser implementado** —
um plano de tarefas envelhece com o código, e o do Lote C escrito hoje citaria
linhas que o Lote A vai mover.

---

## 15. Pesquisa externa (2026-09-20): o plano está na direção certa?

Cada item diz o que foi verificado, onde, e o que mudou neste documento.

### 15.1 O "teto de 4 storage buffers" — verificado no código, era premissa falsa

`src/compat/app.ts:131` chama `openWindow(titulo, w, h, 0)`. No host,
`rts-egui/src/frame/gpu.rs:178-182` escolhe `Limits::downlevel_defaults()` quando
o bit 2 (`high_limits`) está desligado. No `wgpu-types 29.0.3` que o projeto usa
(`limits.rs:385,500`): **default = 8, downlevel = 4**. O compute sem janela já
pede `high_limits` (`compute.rs:105`) — por isso o teto só aparece "com janela
aberta". `docs/colisores.md` §4 e o cabeçalho de `gpurigid.ts:38-40` tratam isso
como fato do dispositivo; é uma escolha de RAM feita para UI 2D.

*Mudou:* §7.2 item 2. *Tarefa nova no Lote A:* limite pedido campo a campo no
host (repositório `rts`), com a RAM do processo medida antes e depois.

### 15.2 Solver — a direção está certa, e dois atalhos apareceram

- **Sub-passos valem mais que iterações.** Conclusão do Solver2D de Erin Catto
  (oito solvers comparados) e base do Box2D v3 e do Box3D (junho de 2026). O
  kernel daqui já usa "sub-passos no papel das iterações" — decisão confirmada,
  não mexer.
- **Pilha estável não exige warm starting.** No mesmo estudo, o `TGS_Sticky`
  empilha sem impulsos acumulados; o que segura é sub-passo + atrito forte +
  relaxamento. *Mudou:* Lote D partido em D1/D2.
- **Contato suave** (Hz + amortecimento) substitui Baumgarte/slop com parâmetros
  que têm significado físico e não dependem do `dt`. Entra no D1, versionado.
- **Jacobi na GPU tem solução publicada para o jitter:** divisão de massa (Tonge,
  Benevolenski, Voroshilov, SIGGRAPH 2012 — 5 000 corpos empilhados a 60 FPS em
  GPU da época). Encaixa no modelo gather sem mudar a estrutura do kernel. A
  "herança de apoio" que mata o ciclo-limite de coluna é um remendo para o
  sintoma que essa técnica trata na causa; **o D1 deve medir se ela ainda é
  necessária depois**. *Atenção:* a busca devolveu patentes da NVIDIA de título
  correlato ("Modified effective mass for parallel rigid body simulation").
  Conferir o alcance antes de adotar a formulação do artigo ao pé da letra;
  média de Jacobi simples é anterior e é o plano B.
- **Gauss-Seidel paralelo se faz por coloração de grafo** (Box2D v3, Box3D). É a
  forma que o §7.3 "paralelismo por ilha no Rust" deve tomar quando o gatilho
  disparar — ilha grande não paraleliza, cor paraleliza.

### 15.3 Determinismo entre máquinas — mais perto do que o §9 dizia

Box2D v3 conseguiu, e a receita é curta: sem FMA contraído, sem fast-math,
`sin/cos/atan2` próprios (o `atan2f` da libc diverge entre plataformas; `sqrt`
não), e ordem determinística na junção do trabalho das threads. Rapier faz o
mesmo com a feature `enhanced-determinism` sobre `libm`. `rustc` não contrai FMA
sem `mul_add` explícito, então o crate já cumpre a parte do compilador. *Mudou:*
§9. A GPU continua fora do grupo determinístico — nenhuma das referências
promete isso.

### 15.4 "O dev escolhe a física" — é como os motores maduros fazem

Rapier liga determinismo, SIMD e paralelismo por *feature*; Unity separa Unity
Physics (sem estado, barato) de Havok (com cache, caro). Os níveis de §7.1.1 são
a mesma ideia com granularidade de cena. Nada a mudar.

### 15.5 O que a pesquisa NÃO cobriu

Broad-phase (grid × BVH dinâmica) em cena de escalas mistas; CCD especulativo ×
sweep; custo real do SAT de 15 eixos em WGSL com divergência de ramo. Ficam para
antes dos lotes C e G, junto com o plano executável de cada um.

Fontes: [Solver2D](https://box2d.org/posts/2024/02/solver2d/) ·
[Determinism (Box2D)](https://box2d.org/posts/2024/08/determinism/) ·
[Announcing Box3D](https://box2d.org/posts/2026/06/announcing-box3d/) ·
[Mass Splitting, TOG 2012](https://dl.acm.org/doi/10.1145/2185520.2185601) ·
[Rapier: Determinism](https://rapier.rs/docs/user_guides/rust/determinism/) ·
[RFC 3514, float semantics](https://rust-lang.github.io/rfcs/3514-float-semantics.html) ·
[wgpu Limits](https://docs.rs/wgpu/latest/wgpu/struct.Limits.html)

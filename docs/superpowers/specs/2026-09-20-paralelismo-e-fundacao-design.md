# Paralelismo e fundação: o plano

**Data:** 2026-09-20 · **Revisão 3** (revisão 2 + a discussão da issue #1: a
Fase 2 foi reordenada em lotes e ganhou a fronteira agente × corpo rígido, §7)
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

### 7.1 A decisão que ordena a fase: unidade não é corpo rígido

O dilema "qual física para o RTS" tinha uma premissa escondida: que a física
rígida carrega as unidades. **Não carrega.** Mil soldados em contato formam uma
única ilha de restrições — o pior caso de qualquer solver, em qualquer backend —
e o que um soldado precisa (não atravessar o vizinho, contornar, parar no
destino) é *avoidance*, não impulso e atrito.

| classe | quem é | onde vive | o que paga |
|---|---|---|---|
| **agente** | infantaria, veículo comum | sistema de unidades (fora deste plano) | footprint circular, vizinhança espacial, steering |
| **corpo de gameplay** | porta, ponte, destroço que bloqueia, projétil físico | solver rígido | tudo desta fase |
| **cosmético** | estilhaço, poeira | solver rígido ou GPU, fora do grupo determinístico | nada de contrato |

O agente entra no solver rígido **só como cinemático**: empurra corpos, não é
empurrado por eles. É por isso que cinemático, máscara e consulta sobem para o
topo da fase e a dinâmica angular desce para o fim — a ordem anterior (rotação
primeiro) servia a uma demo de física, não a um RTS.

Consequência de escala: o `n` de corpos rígidos de uma partida é **centenas a
poucos milhares**, não dezenas de milhares. Na tabela de §2.2 isso é a faixa onde
o backend Rust vence com 2+ threads. O maior custo de hoje continua sendo o de
§3.1 — o solver TS legado, 36,92 ms contra 0,62 — e ele é resolvido pela Fase 0,
não por esta.

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

**Lote D — manifold e warm starting.** Recorte de face incidente, até 4 pontos,
casamento entre passos por feature id. *Aceite:* pilha de caixas com jitter e
energia em repouso medidos, com e sem warm starting.

**Lote E — dinâmica angular.** Tensor de inércia, velocidade angular, torque.
Vem **depois** do manifold: com um único ponto de contato, uma caixa em repouso
com torque oscila para sempre. *Aceite:* apoio fora do centro inclina; impacto
lateral gira; esfera invariante; momento conservado dentro de tolerância escrita.

**D e E têm gatilho, não data:** só entram quando um corpo de gameplay real
precisar tombar ou empilhar com rotação. Para portas, pontes e projéteis, A–C
bastam. `docs/colisores.md` §3 continua valendo: casca dinâmica entra como
esfera.

### 7.3 O que a revisão externa propôs e fica adiado, com gatilho

| proposta | por que não agora | gatilho |
|---|---|---|
| `PhysicsWorld` SoA com `BodyId + generation` | o backend Rust já é SoA (`&[f32]`) e o contrato de posse já separa cena de solver; reescrever a fronteira antes do Lote A é mexer em dois eixos de uma vez | resync por spawn (`crInit`, §9) acima de 1 ms numa cena de spawn contínuo |
| broad-phase persistente, fat AABB, DBVT | o grid é medido e exato; nenhum perfil mostra a broad-phase dominando | broad-phase > 30% do passo em uma das três cenas (densa, esparsa, escalas mistas) |
| ilhas e sono por ilha | o modelo gather da GPU não tem ordem de restrições a preservar; ilha só paga em Gauss-Seidel na CPU | corpo dormindo dentro de pilha acordada reproduzido em teste, ou paralelismo por ilha necessário no Rust |
| CCD/TOI | o teto de 48 u/s é declarado, não escondido | primeiro projétil físico mais rápido que o teto — entra junto com `shapeCast` |
| GPU-resident completa | já é a Fase 3 deste plano | §8 |

Recusado de vez: quatro variantes de tipo de corpo (duas de cinemático) — uma
basta, a outra é conversão na borda.

O plano de RTS (unidades, HPA*, flow fields, formação, ORCA, combate) é outro
épico: `docs/superpowers/plans/2026-09-20-super-plano-rts.md` (commit `57221ad`).
Deste documento ele recebe a fronteira da §7.1 e os contratos do Lote B; o
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
  exige fixar contração de FMA e codegen, e ninguém verificou. **Não prometer
  lockstep antes disso.**
- **Estáticos divergem entre backends quando o `Collider` tem centro deslocado.**
  GPU e Rust gravam `t.wx/wy/wz` cru; a cena soma `centerLocal*`. As
  meias-extensões já estão certas (o comentário de `cpurigid.ts:190-194` ficou
  obsoleto). Primeiro item do Lote A, §7.2.
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
- **Soldado como corpo rígido.** Uma batalha vira uma ilha só e nenhum backend
  escala nisso. Unidade é agente; entra no solver como cinemático (§7.1).
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
| Fase 2 é grande e pode parar no meio | Lotes A–E de §7.2, cada um com aceite próprio; D e E só com gatilho |
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

Decisões de jogo que a Fase 2 precisa antes do Lote B (vieram da issue #1):

- unidades se empurram ou só se desviam? (decide se agente × agente passa pelo
  solver; a §7.1 assume que **não**)
- mapa 2,5D ou 3D navegável com pontes e andares? (decide se `raycast` basta
  para seleção e ordem de movimento)
- quais objetos são corpos de gameplay de verdade? (decide se os Lotes D e E
  algum dia entram)
- single-player com replay, ou lockstep? (decide se o grupo determinístico é só
  o backend Rust — §9 — ou se a GPU fica restrita a cosmético)

---

## 14. Precedência entre os documentos (para quem for implementar)

O commit `57221ad` pôs em `docs/superpowers/plans/` quatro textos da revisão
externa. Eles se sobrepõem a este e entre si — "Fase 0" significa três coisas
diferentes. A regra:

| documento | papel |
|---|---|
| **este** | normativo: ordem, escopo, gatilhos e aceite |
| `2026-09-20-fase0-decisor-medido.md` | plano executável da Fase 0 daqui (§5). Inalterado pela revisão 3 |
| `2026-09-20-issue-1-implementation-plan.md` | referência de **matemática** para os Lotes C–E (SAT de 15 eixos, recorte do manifold, fórmulas angulares, lista de testes). A ordem e os tipos de corpo de lá **não valem** |
| `2026-09-20-super-plano-fisica.md` | catálogo do que fica adiado em §7.3; nada dele entra sem o gatilho |
| `2026-09-20-super-plano-rts.md` | épico separado; ainda sem plano executável |
| `2026-09-20-review-issue-1.md`, `…research-notes-physics.md` | histórico e bibliografia |

Onde eles discordam deste, e o que vale:

| ponto | lá | aqui | por quê |
|---|---|---|---|
| unidades | `dynamic` (tabela de tipos do plano da issue) | agente, cinemático no solver (§7.1) | o próprio plano de RTS do mesmo autor diz o contrário do plano da issue |
| tipos de corpo | quatro, dois cinemáticos | três | posição → velocidade é conversão na borda |
| primeira entrega | `BodyId`, comando/snapshot, `PhysicsStats`, layout, máscara, tudo junto | Lote A, sem `BodyId` nem snapshot | um PR que troca a fronteira **e** o layout não tem bisect |
| broad-phase persistente antes de OBB | Fase 1 de lá | adiado, §7.3 | nenhum perfil mostra a broad-phase dominando |
| metas de tempo | "2 000 densos < 8 ms" | §2.1: já medido **0,62 ms** | meta mais frouxa que o presente não orienta nada; a meta é *não regredir mais de 10%* por lote |
| limite de 4 bindings | remover, ou `bodyState` único, a decidir | cabe em 4 movendo `ext` (§7.2) | a validar por bench; se falhar, as opções de lá são o plano B |

Cada lote de §7.2 ainda precisa do seu plano executável (tarefas, arquivos,
comandos), no formato do da Fase 0, **escrito logo antes de ser implementado** —
um plano de tarefas envelhece com o código, e o do Lote C escrito hoje citaria
linhas que o Lote A vai mover.

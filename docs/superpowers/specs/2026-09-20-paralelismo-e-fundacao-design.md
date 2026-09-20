# Paralelismo e fundação: o plano

**Data:** 2026-09-20 · **Revisão 2** (após quatro revisões adversariais e a medição
de escala por threads) · **Estado:** desenho para revisão. Nada implementado.

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

Rotação, OBB e manifold, na ordem que a dependência impõe: ponto de contato →
OBB → dinâmica angular → manifold com warm starting.
Ver [UrubuCode/rts-game#1](https://github.com/UrubuCode/rts-game/issues/1).

**Mudança em relação à issue:** o que ela chama de "pergunta de layout de buffer"
é uma **decisão de layout**, e a lista do que precisa caber é maior do que ela
diz: orientação, velocidade angular, manifold, `hullId`, **máscara de camada** e
**índice de contato**. A §4 de `docs/colisores.md` já demonstrou que essa conta
não fecha nos 4 storage buffers — remover esse limite é parte da fase, não um
pré-requisito não financiado.

**Nota de aceite:** esta fase muda o solver e **invalida a paridade medida na
Fase 0**. A tolerância de 0,15 será re-medida e republicada.

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
  andando por pathfinding. Bug latente já presente; resolvido na Fase 2.
- **Eventos de colisão não chegam ao gameplay.** O solver gather descarta o par
  ao resolver. Sem dano, sem área de captura, sem "chegou ao destino".
- **Determinismo é entre contagens de thread no mesmo binário.** Entre máquinas
  exige fixar contração de FMA e codegen, e ninguém verificou. **Não prometer
  lockstep antes disso.**
- **Estáticos divergem entre backends quando têm component `Collider`.**
  `rbSyncStatics` não passa por `collider.ts`; o teste de paridade não enxerga
  por construção (`cpurigid.ts:190-194`).
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
| Fase 2 é grande e pode parar no meio | Lotes da issue #1 são independentes, cada um com aceite próprio |
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

# Colisores que acompanham a geometria

Como uma forma arbitrária — a casca convexa de uma malha — atravessa a fronteira
para a GPU e é testada, **de modo que os dois backends terminem no mesmo lugar**.

Este documento decide. Onde ele diz um número, o número saiu de contar operações
no kernel que existe (`engine/rigid/gpurigid.ts`) ou de um limite já medido e
registrado neste repositório; onde não há número, está dito que é razão e qual é.

O componente já existe: `engine/core/collider.ts` declara `SHAPE_HULL` e
`hullId`, e já decidiu que a casca é da **malha** e não do corpo. Este documento
é o outro lado dessa decisão — como ela chega ao kernel.

---

## O limite que decide quase tudo: quatro storage buffers

Nada aqui se entende sem isto, e não é uma preferência de desenho:

> Com uma **janela aberta**, o device nasce com limites downlevel — **máximo de
> 4 storage buffers por estágio**.

Está medido e registrado em dois lugares independentes deste repositório:
`engine/fluid/gpufluid.ts:53` (a densidade foi para o `w` da posição por causa
dele) e `engine/rigid/gpurigid.ts:73` (o grid espacial foi para a cauda do
`world` por causa dele).

O kernel de colisão **já liga os quatro**: `pos`, `vel`, `ext`, `world`.

Consequência dura, e é a régua de todas as respostas abaixo: **não existe um
quinto buffer para os planos da casca, nem para a orientação.** Tudo que for
novo mora na cauda do `world` ou num campo que já existe. Um desenho que peça um
buffer novo compila headless e falha no jogo — que é o pior lugar para descobrir
isso, e é literalmente o que o comentário do `gpurigid.ts` avisa.

---

## 1. Como a forma cruza

**Uma tabela de planos empacotada, subida UMA vez, na cauda do `world`.**

O precedente é do próprio projeto e é citado como tal: `meshUpload` manda a
malha inteira como `Float32Array` numa travessia, e `drawMeshBatch` manda N
transformações num array só. A regra que os dois seguem — e a razão de
`crates/rts-ui/src/lib.rs` receber views tipadas em vez de ponteiro — é que a
fronteira se paga por **upload**, não por item.

Uma casca convexa é uma interseção de semiespaços. Cada plano é
`(nx, ny, nz, d)` — quatro floats, exatamente um `vec4`, que é o que o `world`
já é. Então a casca **não precisa de formato novo**: ela é uma corrida de vec4.

    world (vec4<f32>):
      [0]                          params: dt, nEstaticos, tamCélula, nHulls
      [1 .. 1+512)                 estáticos (centro, meia-extensão)
      [HULL_DIR .. +nHulls)        diretório: (offset, nPlanos, raioLocal, -)
      [HULL_PLANES .. +totalPlanos) os planos, em espaço LOCAL da malha
      [ORI .. +n)                  orientação por corpo (quaternion)
      [GRID ..]                    contagens e vagas (como hoje)

**Custo, em números.** Uma casca de 12 planos ocupa 12 vec4 = **192 bytes**. Um
projeto com 64 malhas distintas gasta **12 KB**. O `world` já é alocado com
~1,09 MB por causa do grid (`(2052 + 8192 + 8192·32)·4`), então a tabela de
cascas é **1,1 % do que já se aloca**. Não há decisão de memória a tomar aqui.

**Quantas travessias por frame: zero.** As cascas sobem no carregamento da cena,
junto dos estáticos, pelo `gpu.write` que já existe. Elas não mudam — a casca é
da malha, e a malha não muda de forma durante o jogo.

**Qual casca cada corpo usa: no `vel.w`, sem campo novo.** Hoje `vel.w` é
`0 = esfera, 1 = caixa`. A extensão que não quebra nada:

    vel.w  <  2      forma primitiva, exatamente como hoje
    vel.w >=  2      casca, com hullId = vel.w - 2

Um `f32` representa inteiros exatamente até 2^24, ou seja **16 777 216 ids de
casca** — quatro ordens de grandeza acima de qualquer projeto. A codificação é
segura pelo número, não por otimismo, e todo corpo que já existia continua com
o significado de ontem, que é a condição que `rbSetBody` documenta ao manter
`COL_BOX` como default.

---

## 2. Onde a casca vive

**Na tabela, uma vez por MALHA. Nunca no corpo.**

`collider.ts` já tomou essa decisão e já escreveu a razão: mil instâncias do
mesmo modelo compartilham uma casca e diferem só na transformação. O que este
desenho acrescenta é que a decisão **sobrevive à travessia**: o corpo carrega um
`hullId` de um float, e o diretório é quem sabe onde os planos estão.

O número que mostra que isso importa: **1000 cristais do mesmo modelo, 12 planos
cada**.

| | bytes na GPU |
|---|---|
| casca por corpo | 1000 × 192 B = **192 KB**, resubidos a cada spawn |
| casca por malha (este desenho) | **192 B**, subidos uma vez |

Fator 1000, e o lado errado também paga travessia toda vez que um objeto nasce.

O `hullId` **0 é reservado para "nenhuma"** — é o default do componente — então
o diretório é indexado a partir de 1 e um corpo sem casca nunca lê a casca de
outro por engano.

---

## 3. O teste no kernel, e o teto

Aqui está a resposta que vale mais que uma implementação, e ela é um **não**.

O kernel não é O(n²) desde a campanha do grid: a varredura é 27 células × até 32
vagas, e a célula é dimensionada em `2 × maiorMeiaExtensão` justamente para que
a varredura seja **exata** e não uma aproximação (`rbWriteWorld`). Chame de `k` o
número de candidatos que sobram por corpo.

**Esfera contra casca — O(M), e escala.** M avaliações de plano, cada uma um
`dot` e uma comparação:

    2000 corpos × k=20 × M=12 = 480 000 testes de plano por sub-passo
    × 4 sub-passos              = 1,9 milhão por frame

Para uma GPU isso é ruído. Escala.

**Casca contra casca — SAT completo, e NÃO escala.** SAT entre dois convexos
precisa dos eixos de face de A, dos de B, **e dos produtos vetoriais aresta ×
aresta**, que é o termo quadrático:

    eixos = M_A + M_B + E_A·E_B

Para duas cascas de 12 planos e ~18 arestas: `12 + 12 + 18×18 = 348 eixos`. Cada
eixo projeta os dois conjuntos de vértices (~20 cada, 40 produtos escalares):

    348 × 40                    = 13 920 produtos escalares POR PAR
    2000 × 20 × 13 920          = 557 milhões por sub-passo
    × 4 sub-passos              = 2,2 BILHÕES de produtos escalares por frame

E são divergentes: cada thread sai do laço num eixo diferente, que é o pior caso
para uma GPU. **O teto de casca-contra-casca no modelo gather deste kernel é da
ordem de dezenas de corpos, não de milhares.**

### O que se faz, então

**Cascas nas coisas que não se mexem; primitivas nas que se mexem.**

Não é um recuo: é o que a exigência realmente pede. O que precisa acompanhar a
geometria é o **mundo** — a pedra chanfrada, o cristal alongado, o degrau, a
rampa. Corpos dinâmicos aos milhares são detritos, projéteis, blocos: esfera e
caixa descrevem bem, e é o que a campanha do castelo já sintonizou.

Com essa regra **todo par é primitiva-contra-casca**, que é O(M), e o teto
some — o custo volta a ser o do grid, que já foi medido nesta engine.

Quando um corpo dinâmico *precisa* de casca, ele entra no teste **como esfera de
raio `min(ext)`**. Essa não é uma convenção nova: é exatamente o que o
`raio()` do kernel já faz, e o `radiusOf` da CPU também — "a esfera cabe dentro
da caixa, então nunca há empurrão fantasma". Reusar a regra que já existe é o
que impede um segundo significado de "raio" neste projeto.

Três camadas, e cada uma só paga o que a anterior deixou passar:

| camada | custo | o que resolve |
|---|---|---|
| grid (já existe) | O(n·k) | quem nem chega perto |
| AABB da casca (o diretório guarda o raio local) | O(1) por par | quem chega perto e não toca |
| planos | O(M) | o contato de verdade |

A segunda camada é a que faz M ser pago só por quem sobrou, e ela é **um
`dot` e uma comparação** — o `raioLocal` que o diretório carrega existe para
isso.

---

## 4. A rotação

Duas respostas, e a primeira é um achado que muda o escopo.

### Não há onde guardar orientação, e isso é um fato aritmético

Os três buffers por corpo somam 16 floats, e **todos os 16 estão ocupados**:

| | x | y | z | w |
|---|---|---|---|---|
| `pos` | centro | centro | centro | contador de sono |
| `vel` | velocidade | velocidade | velocidade | forma |
| `ext` | meia-extensão | meia-extensão | meia-extensão | invMass |

O `vel.w` — que este documento acabou de usar para o `hullId` — era o último
campo livre, e o cabeçalho do `gpurigid.ts` já registra que os outros foram
descartados **por motivo**, não por gosto.

Então a orientação vai para a cauda do `world`, como um array de quaternions por
corpo: 2000 corpos × 16 B = **32 KB**. Cabe, e não custa um buffer.

Mas o `world` é ligado **somente leitura** ao kernel de colisão. Isso força uma
decisão de arquitetura e é melhor dizê-la do que descobri-la:

> **A rotação é ENTRADA, não estado.** O kernel lê a orientação e nunca a
> escreve. Não há velocidade angular, não há torque de contato. Quem manda na
> orientação é o transform, na CPU.

Isso cobre o que a exigência pede: um colisor que acompanha a geometria de um
objeto orientado — uma rampa virada, uma pedra deitada — colide certo. O que
**não** cobre é uma pedra que começa a girar por causa de uma batida.

Dinâmica angular exige quaternion **e** velocidade angular por corpo, os dois
`read_write`, ou seja dois vec4 num buffer gravável — e não há. Ela é uma
campanha à parte, e ela **começa por remover o limite de 4 buffers** (não manter
janela aberta durante a física, ou dividir em mais passes), não por escrever
matemática de rotação. Registrado aqui para que ninguém comece pelo fim.

### Transformar o OUTRO corpo, não os planos

    transformar N planos por par     M rotações de vetor  = 12 × ~30 flops = 360
    transformar o outro corpo        2 rotações (ida do centro, volta da normal)
                                                          =  2 × ~30 flops =  60

**Seis vezes mais barato em M=12, e a razão cresce linear com M** — em M=32 é
dezesseis vezes. A conta é essa e ela decide sozinha.

Mas há uma segunda razão, e ela é melhor que a aritmética: **uma esfera é
invariante a rotação.** No espaço local da casca, a esfera continua sendo uma
esfera de mesmo raio — nada nela precisa ser rotacionado, só o centro
transladado e girado. O teste vira exatamente o mesmo `dot` contra plano que o
caso sem rotação, sem um ramo a mais. Transformar os planos, além de mais caro,
não teria dado essa simplificação.

Volta: a normal sai em espaço local e é rotacionada de volta ao mundo — uma
rotação — porque o solver aplica impulso em coordenadas de mundo e a regra de
`herança de apoio` testa `|ny| > 0.5`, que só significa algo lá.

---

## 5. Paridade entre os dois backends

**A CPU implementa o caso convexo. Não cai para AABB.** Isto é decisão, e a
razão tem número.

O `solvePair` e o `contato()` do WGSL já são duas cópias de uma regra, mantidas
em passo à mão — o próprio kernel diz que é "a tradução" do `solvePair` e que
qualquer divergência aparece como os dois backends terminando em lugares
diferentes. Acrescentar um terceiro caso dobra esse risco, então a pergunta
"pode a CPU só cair para AABB?" merece resposta explícita.

**Não pode, e o motivo não é precisão — é que muda de RAMO.** O solver decide o
que fazer pelo valor da normal:

    |ny| > 0.5  →  regras da coluna: corte de restituição, herança de apoio
    caso contrário →  impulso comum

Uma pedra chanfrada dá `ny ≈ 0,62` como casca e `ny = 1,0` como AABB. Os dois
passam do 0,5, mas o corpo de cima **herda o vy do suporte** num caso e
**recebe impulso** no outro, e essa é precisamente a bifurcação que o
ciclo-limite de coluna da campanha do castelo explora. Um fallback não degrada
suavemente: ele troca de bug. Numa rampa a 40° a diferença é maior ainda — a
casca dá uma normal inclinada que faz o corpo deslizar, o AABB dá uma normal
vertical que faz o corpo ficar parado no ar em degraus.

Então: **uma definição de contato, dois leitores.** Concretamente:

1. A matemática do teste esfera-contra-casca fica escrita **uma vez em
   TypeScript** (`engine/core/hullpack.ts::hullContact`), e é o que a CPU chama.
2. O WGSL é a tradução dela, com a mesma ordem de operações, e o comentário
   aponta para a função — o mesmo contrato que `contato()` já tem com
   `solvePair`.
3. **O teste de paridade é o que faz o contrato valer.** `tools/test_gpurigid.ts`
   já é a rede da campanha do castelo; o caso da casca precisa da sua linha lá:
   mesma cena, mesma semente, N passos, os dois backends, posições finais
   comparadas com tolerância.

Sem o item 3 os itens 1 e 2 são uma intenção. Com ele, uma divergência falha um
teste em vez de virar um relato de "a física está estranha na GPU".

---

## O que este desenho NÃO resolve

Dito aqui para que não seja descoberto como surpresa:

- **Casca côncava.** `collider.ts` já respondeu: composição de vários colisores
  no mesmo objeto, que é como Unity e Godot fazem.
- **Casca dinâmica contra casca dinâmica.** O número da seção 3 diz que não
  escala no modelo gather; o corpo dinâmico entra como esfera.
- **Torque.** Seção 4: falta buffer gravável, e é uma campanha que começa por
  remover o limite de 4.
- **Cápsula.** `SHAPE_CAPSULE` está reservado e não implementado. O desenho aqui
  a acomoda sem mudança — uma cápsula contra casca é o mesmo teste de planos com
  um segmento no lugar de um ponto.

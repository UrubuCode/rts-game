# Física em paralelo — o que dá, o que não dá, e por quê

**Status: direção registrada, nada implementado.** Escrito em 2026-08-10, quando
a medição mostrou que a física come 84% do orçamento de 60 fps com 500 objetos.

## O número que motiva isto

Medido em release, headless (sem janela, sem `drawMesh`), por
`tools/claude-bench-fisica-partes.ts`:

| objetos em movimento | `update` | `resolveCollisions` | `computeWorld` | total |
|---|---|---|---|---|
| 500 | 2,95 ms | **9,55 ms** | 1,55 ms | 14,05 ms |
| 1000 | 6,13 ms | **18,83 ms** | 4,47 ms | 29,43 ms |

O orçamento de 60 fps é 16,7 ms. Escala linear, então o grid espacial está
correto — o que custa é a constante por objeto. Parados custam 4-5× menos, que é
o sleeping pulando corpos dormindo.

## Três caminhos, e eles não competem

### 1. GPU compute — existe, escrito, e é o mais próximo

`engine/rigid/gpurigid.ts` já é esta física no modelo **gather/Jacobi**: cada
corpo lê todos os outros e escreve só o próprio, sem atomics e sem contenção. É
o mesmo padrão que `engine/fluid/gpufluid.ts` usa para a água, e a água é a prova
de que funciona aqui: **quatro dispatches por sub-passo, independente de haver
mil ou cinquenta mil partículas.**

O TypeScript nunca toca um corpo: sobe o estado, submete os passos e lê as
posições de volta uma vez por frame, com um frame de latência (o `gfStep` lê o
resultado do frame anterior, que a GPU teve o frame inteiro para terminar).

### 2. Threads de CPU — POSSÍVEL hoje, e a restrição decide a forma

A primeira leitura do `CLAUDE.md` sugere o contrário: o namespace `rts:thread`
foi removido em 2026-08-10 porque *"precisa de duas threads de SO rodando
JavaScript, e este motor não pode"*. **Isso envelheceu.** `node:worker_threads`
foi construído depois e um `Worker` é uma thread de SO de verdade, rodando o
motor de verdade — ela compila a fonte pelo `evaluator` do host, instala o
próprio contexto e a própria região.

A restrição que sobra é a que importa: **nada é compartilhado.** Nem heap, nem
célula, nem lock. `SharedArrayBuffer` está fora pela mesma razão — "não há com o
que compartilhar". O que cruza entre threads é uma **cópia**.

Para física isso não é fatal, é um orçamento:

- O estado de um corpo é ~10 floats. 500 corpos são ~20 KB por direção.
- Copiar 40 KB por frame é barato **comparado com 9,55 ms** — mas é preciso
  MEDIR, não supor. Uma cópia que custe 3 ms devora o ganho de dividir por 4.
- A broadphase é o que paraleliza bem (cada thread cuida de uma faixa do grid);
  a resolução de pares precisa de cuidado, porque dois pares podem tocar o mesmo
  corpo — que é exatamente o problema que o modelo **gather** da GPU resolve, e
  a mesma solução serve aqui.

### 3. Física nativa em Rust — o teto, e o mais longe

Mover o solver para um crate do motor e paralelizar com `rayon` tira as duas
limitações de uma vez: sem cópia entre threads e sem o custo por acesso a campo
de objeto JS. É também o que a maioria das engines faz (o solver é nativo; o
script só descreve a cena).

O preço é o de sempre: a física deixa de ser código do jogo, editável por quem
faz o jogo, e passa a ser código do motor. Vale quando o desenho estabilizar, não
antes.

## A ordem que faz sentido

1. **Consertar o sleeping do `gpurigid`** — `tools/test_gpurigid.ts` dá 5 ok /
   2 falhas, ambas de sono (`vmax=0` e `dormindo=0/33`: a física está certa, o
   contador não chega). Ligar um solver que não adormece troca um gargalo por
   outro, porque é o sono que faz repouso custar 4× menos.
2. **Escolha de backend na `Scene`**, no mesmo formato que `engine/fluid/decide.ts`
   já usa para a água. Com fallback obrigatório: `gpu.available()` responde 0 em
   máquina sem GPU e o editor tem de abrir do mesmo jeito.
3. **Baixar a constante do caminho CPU** — ele continua sendo o fallback e o
   caminho de quem não tem GPU, então ganho ali nunca é desperdiçado.
4. **Só então** threads, medindo o custo da cópia antes de acreditar no ganho.

## A regra que vale para tudo aqui

Este repositório tem quatro campanhas de otimização feitas no raciocínio e
**refutadas pela medição** — numa delas, todas as quatro premissas eram falsas.
Nenhum número deste documento veio de estimativa: cada um tem um comando que o
produz, em release, e quem duvidar deve rodá-lo em vez de discutir.

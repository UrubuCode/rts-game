# Sobrecarga de operador: funciona, e quase nunca é o que queremos

O motor RTS ganhou sobrecarga de operador — `a + b` pode ser respondido pelo
objeto. Este documento existe para que ninguém precise medir de novo antes de
decidir usá-la, e para registrar por que o uso mais óbvio é justamente o
errado.

A superfície do motor está em `rts/docs/engine/operator-overloading.md`. Aqui
fica só o que decide o uso **neste** jogo.

```ts
import { operators } from "rts";

class Vec3 {
  constructor(public x: number, public y: number, public z: number) {}
  [operators.add](o: Vec3, reversed: boolean): Vec3 {
    return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z);
  }
}

a + b;      // a[operators.add](b, false)
2 * v;      // v[operators.mul](2, true)  — a forma refletida
```

## O que foi verificado rodando

Todas as formas, numa sonda executada contra o binário deste repositório:
`+`, `-`, `*`, a forma **refletida** (`2 * a`, com o operando objeto à
direita), o unário `-`, o `==` entre dois objetos, e a atribuição composta
`+=`. Nenhuma delas falhou.

`+x`, `x++` e `x--` **não** são sobrecarregáveis, e isso é da linguagem, não
uma limitação daqui.

## O custo, medido

Quatro rodadas de cada, variação abaixo de 8%. Laço de 2 a 3 milhões de
operações, `Date.now()` em volta, uma execução de aquecimento descartada.

| Caso | Tempo | Contra o escalar |
|---|---|---|
| Matemática **escalar** (o que o `Transform` faz hoje) | 6 ms | — |
| A mesma conta com `Vec3`, **sem** operador (construtor na mão) | 270 ms | **45×** |
| A mesma conta com `Vec3` **e** operador | 805 ms | **135×** |

E, separadamente, o custo de apenas *ter importado* `operators`:

| Caso | Sem `import rts` | Com `import rts` |
|---|---|---|
| Aritmética escalar (`a.x + b.x`) | 38 ms | 38 ms — **zero** |
| Operando **objeto** sem sobrecarga (`"" + p`) | 3,31 s | 3,53 s — **+7%** |

## As três coisas que esses números dizem

**1. Importar `operators` é seguro.** Era a dúvida que mais pesava, porque a
doc do motor avisa que, com `rts` importado, todo operando objeto passa a
pagar uma busca de propriedade por símbolo. É verdade e custa 7% — mas só
onde um operando É um objeto, o que neste motor significa formatação de
string e log, não o laço de física. A aritmética escalar não paga nada: 38 ms
idênticos, com e sem.

**2. Os 45× não são culpa do operador — são da alocação.** Metade da conta
acima é `new Vec3` por operação. O operador acrescenta 3× em cima disso
(270 → 805 ms), o que é o despacho e a chamada. Quem lê "sobrecarga de
operador é lenta" está lendo o número errado: o caro é trocar escalar por
objeto.

**3. E é por isso que o uso óbvio é o errado.** `Transform` guarda posição,
rotação e escala como campos escalares, e o comentário no topo de
`src/engine/core/transform.ts` diz por quê: os primeiros `INLINE_SLOTS = 15`
campos de um objeto vivem em slots inline que o código compilado alcança por
offset constante, e "a ordem desta declaração é desempenho, não estilo".
Trocar três escalares por uma referência a `Vec3` desfaz essa decisão antes
de qualquer operador entrar em cena.

Em orçamento de quadro, a 60 fps (16,6 ms): 500 objetos × 10 operações
vetoriais custam **~2 ms com operadores** contra **~0,015 ms com escalares**.
Doze por cento do quadro contra um décimo de por cento.

## A regra

**Não use no caminho quente.** `Transform`, o passo de física, o laço de
render, qualquer coisa que rode uma vez por objeto por quadro.

**Use onde a matemática já é objeto e o laço é frio** — uma vez por quadro, ou
uma vez por ação do usuário, e não uma vez por objeto. A matemática do gizmo
em `src/editor/gizmo.ts`, serialização de cena, contas de câmera. Ali os
0,4 µs por operação desaparecem e a legibilidade é ganho real: `p + v * dt`
diz o que faz de um jeito que três linhas de `.x`, `.y`, `.z` não dizem.

**A pergunta a fazer não é "fica mais bonito?" e sim "quantas vezes por
quadro isto roda?".** Se a resposta tiver a palavra "por objeto", a resposta
é não.

## Como refazer a medida

A sonda é descartável e não está versionada — de propósito, porque um número
de hoje versionado vira uma medida sem data se passando por referência, que é
a mesma razão pela qual `prof.txt` está no `.gitignore`. Para refazer: um
laço de 2 milhões de iterações fazendo `p = p + v * 0.016`, contra o mesmo
laço em `px/py/pz` escalares, com `Date.now()` em volta e uma execução de
aquecimento descartada antes de medir.

Precisa de um binário do motor com a sobrecarga — qualquer um a partir de
`rts/docs/engine/operator-overloading.md` existir.

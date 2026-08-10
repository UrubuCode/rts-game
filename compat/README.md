# `compat/` — a superfície do motor antigo, sobre a do motor novo

O motor novo do RTS não tem `rts:io`, `rts:math`, `rts:fs`, `rts:process` nem
`rts:net`. O que ele tem responde às mesmas perguntas com outros nomes: `print`
é global, trigonometria é `Math`, arquivos são `node:fs`, e assim por diante.

Cada arquivo aqui é a API antiga escrita sobre a nova. A consequência é a razão
de existirem: **nenhum corpo de função do jogo mudou.** Só a linha de `import`
trocou de `"rts:io"` para `"…/compat/io.ts"`, e `io.print(x)` continua sendo
`io.print(x)` nos 269 lugares onde já estava.

## Por que um shim e não uma reescrita

Uma reescrita de `io.print` para `print` toca 269 linhas em 31 arquivos e
mistura, num mesmo diff, a mudança de motor com a mudança de estilo. Se algo
quebrar, não há como saber qual das duas causou. O shim separa: primeiro o jogo
volta a rodar sem que uma linha de lógica mude, e a reescrita de estilo — se for
desejada — vira um segundo passo, opcional e verificável contra um jogo que já
funciona.

## Isto é uma etapa, não o destino

Um shim é dívida com data: cada função aqui é uma tradução que existe só porque
o código chama o nome antigo. Onde a tradução for exata (`math` é `Math`), ela
some sozinha numa substituição. Onde ela for aproximada, está **dito no próprio
arquivo** — e essas são as que precisam de decisão em vez de tradução.

O que não está aqui e não vai estar: `rts:ptr` (eliminado por decisão do motor)
e `rts:render` (o rasterizador por software foi aposentado em favor de
`rts:egui`/`gpu3d`).

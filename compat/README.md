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

O que não está aqui e não vai estar: `rts:ptr` (eliminado por decisão do motor).

`rts:render` está aqui, mas só em três quartos: `rect`, `text` e `line` traduzem
exatamente para `drawRect`/`drawText`/`drawLine`, e `image` **lança** — o egui
não tem blit de framebuffer, e o rasterizador por software que o alimentava foi
aposentado em favor de `rts:egui`/`gpu3d`.

## Os quatro que sobraram, e por que dois não têm arquivo

`rts:time` e `rts:audio` viraram arquivo. `rts:net` e `rts:ws` **não**, e a
ausência é a decisão, não uma pendência.

Os dois primeiros cabem num shim porque a pergunta que o chamador faz continua
tendo resposta: `time.sleep_ms` só mudou de endereço, e `audio.open_output`
responde 0 — "não há dispositivo" — que é verdade e é um caminho que o mixer do
jogo já sabia percorrer.

Os dois últimos não cabem, e pelo mesmo motivo nos dois casos: **a API antiga
BLOQUEIA e a nova não.** `net.tcp_accept` parava o programa até um cliente
chegar; `ws.recv` era perguntado 1× por frame. As superfícies novas (`node:net`,
o pacote `ws`) entregam por CALLBACK, e um callback só roda quando o laço do
host anda — coisa que um `while` de render nunca oferece sozinho. Escrever um
`accept()` que finge bloquear exigiria rodar o laço de eventos por dentro dele,
o que reentra no meio do frame: é a mentira do `buffer.ptr()` outra vez, só que
com um deadlock em vez de um endereço velho.

O que substitui os dois não é um shim, é `editor/control/server.ts` — 78 linhas,
já commitadas, já rodando: os handlers registrados uma vez e `pumpEvents()`
chamado 1× por frame, no ponto seguro entre dois frames. Portar `wsharness.ts`
é seguir aquele arquivo; portar `netharness.ts` é a mesma reescrita, para um
transporte que o `wsharness` já cobre melhor.

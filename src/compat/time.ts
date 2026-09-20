// `rts:time` sobre o `time` do especificador bare `rts`.
//
// É o shim mais barato do diretório, e por um motivo que vale registrar: o
// namespace não foi reprojetado, só MUDOU DE ENDEREÇO. `crates/rts-std/src/
// machine/time.rs` expõe exatamente `now_ms` e `sleep_ms`, com esses nomes e
// essas assinaturas — o que era `import time from "rts:time"` é hoje
// `import { time } from "rts"`, e nada mais.
//
// O único chamador do jogo é `castelo_gpu_demo.ts:605`, que usa `sleep_ms` para
// devolver ao SO o que sobra do orçamento de frame.
//
// `now_ms` vai junto mesmo sem chamador, porque é o outro membro do namespace
// antigo e reexportá-lo custa uma linha — não é superfície nova inventada aqui,
// é a mesma que já existia dos dois lados.
//
// SOBRE `sleep_ms` E O LAÇO: o doc comment do motor diz que ele dorme em
// fatias, entregando o laço de eventos entre elas, em vez de bloquear o
// processo inteiro. Isso é MELHOR que o antigo, não pior — mas é uma diferença
// de comportamento, e a nota fica aqui para quem um dia estranhar um callback
// rodando "dentro" de um sleep.
//
// Este arquivo é dívida com data de validade curta: dois membros, dois
// chamadores. A substituição direta por `import { time } from "rts"` é uma
// linha em `castelo_gpu_demo.ts`, e aí ele some.

import { time } from "rts";

export default {
  now_ms(): number {
    return time.now_ms();
  },

  sleep_ms(ms: number): void {
    time.sleep_ms(ms);
  },
};

// DELIBERADAMENTE AUSENTE: nada. O namespace antigo, ATÉ ONDE O JOGO O USA, é
// `sleep_ms` — e o novo tem os dois membros que eu sei que existiam. Se o
// `rts:time` antigo tinha `now_us`, `monotonic` ou afins, nenhum aparece no
// jogo e eu não sei se existiam; não foram inventados.

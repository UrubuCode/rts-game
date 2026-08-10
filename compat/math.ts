// `rts:math` é `Math`.
//
// Os dez membros que o jogo usa — sin, cos, tan, sqrt, floor, ceil, abs, min,
// max, atan — têm o mesmo nome e a mesma semântica no `Math` da linguagem, que
// o motor novo tem completo. Não há tradução nenhuma neste arquivo, e é por isso
// que ele é o candidato óbvio a desaparecer numa substituição de `math.` para
// `Math.` quando alguém quiser.
//
// CUIDADO com o nome parecido: o `math` do especificador `rts` (`import { math }
// from "rts"`) NÃO é este. Aquele é matemática de máquina — `abs_i64`, `add`,
// `mul` — e não tem `sin`. Foi exatamente essa confusão que fez o jogo morrer em
// `math.sin is not a function`.

export default Math;

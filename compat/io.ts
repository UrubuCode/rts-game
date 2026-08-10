// `rts:io` sobre os globais do motor novo.
//
// O namespace foi removido por medição: dos 818 arquivos da suíte do RTS, 224
// importavam `rts:io` e exatamente UM chamava `io.print`. O que sobrou virou
// global — `print`, `println`, `write`, `prompt` — que é a forma como o código
// já estava escrito na maioria dos casos.
//
// Aqui é o contrário: 269 chamadas de `io.print`. Então o objeto volta, sobre
// os globais.

// SEM `declare const print` — e não por estilo. No motor novo um `declare const
// x` cria um binding vazio que SOMBREIA o global de mesmo nome, então `print`
// dentro deste arquivo passava a valer `undefined` e a primeira chamada morria
// com "print is not a function". Isso é um bug do motor, não uma regra de
// TypeScript: `declare` não emite nada, por definição.

export default {
  // `println`, não `print`: o `print` do motor novo NÃO quebra linha (três
  // chamadas seguidas saem como "ABC"), e o `io.print` antigo quebrava — que é
  // o que os 269 chamadores, quase todos logs, esperam.
  print(text: any): void {
    println(String(text));
  },

  println(text: any): void {
    println(String(text));
  },

  // O antigo devolvia a linha sem o `\n`; `prompt` devolve `null` no fim da
  // entrada, e a string vazia é a tradução mais próxima de "não veio nada" para
  // um chamador que espera texto. O único chamador no jogo é um harness.
  stdin_read_line(): string {
    return prompt() ?? "";
  },
};

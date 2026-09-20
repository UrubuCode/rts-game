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

  // A linha sem o `\n`, ou `null` no fim da entrada.
  //
  // O `null` do `prompt` é REPASSADO em vez de virar `""`. A versão anterior
  // fazia `prompt() ?? ""` e explicava que a string vazia era "a tradução mais
  // próxima de não veio nada" — mas ela colapsa dois eventos que o único
  // chamador precisa distinguir: o pipe fechou, e o usuário mandou uma linha
  // em branco. Um harness que trata os dois igual encerra no meio de um
  // roteiro que contenha uma linha vazia, e o sintoma é uma sessão que
  // termina cedo sem dizer por quê.
  //
  // O antigo `stdin_read_line(ptr, len)` distinguia pelo retorno `<= 0`, e
  // esta é a forma que preserva essa distinção sem reintroduzir um ponteiro.
  stdin_read_line(): string | null {
    return prompt();
  },
};

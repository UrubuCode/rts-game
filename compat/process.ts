// `rts:process` sobre `node:child_process`.
//
// O jogo usa uma coisa só: disparar a compilação num terminal separado, sem
// esperar. `process.wait` aparece apenas em comentários explicando por que NÃO é
// chamado — ele bloquearia o editor por um minuto — então não está aqui. Um
// `wait` que não bloqueasse teria o nome de uma coisa e o comportamento de
// outra, que é o modo de falhar mais caro que existe.

import { spawn } from "node:child_process";

export default {
  // O antigo recebia o programa e os argumentos como uma string só, sem shell.
  // `spawn` quer um array, então a string é dividida em espaços — que é
  // exatamente o que o único chamador do jogo espera, e por isso ele já evita
  // aspas no comando.
  spawn(program: string, args: string): void {
    const child = spawn(program, args.split(" "), {
      detached: true,
      stdio: "ignore",
    });
    // Sem isto o processo pai fica vivo esperando o filho — o oposto de
    // "dispara em background", que é a razão de esta função existir.
    child.unref();
  },
};

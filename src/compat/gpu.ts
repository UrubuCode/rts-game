// `rts:gpu` — a MESMA superfície, quatro nomes em outra grafia.
//
// O motor novo padronizou os membros em camelCase; o antigo usava snake_case.
// Nada mais mudou: mesma ordem de argumentos, mesma semântica, mesmos handles.
// São quatro renomeações e seis nomes idênticos, e é por isso que este é o shim
// mais fino do diretório — e o que destrava mais coisa por linha escrita.
//
//   bind_buffer → bindBuffer      write_at   → writeAt
//   read_begin  → readBegin       read_poll  → readPoll
//
// O que isto liga: `engine/rigid/gpurigid.ts` e `engine/fluid/gpufluid.ts`, os
// dois caminhos de compute que o projeto já tinha escritos e que estavam
// inalcançáveis no motor novo por causa de quatro nomes. A física de corpos
// rígidos na GPU não precisou ser escrita — precisou ser CHAMADA.
//
// Reexportado membro a membro em vez de `export default gpu`: um `import * as`
// não deixaria renomear, e um objeto montado à mão é onde a diferença fica
// visível para quem ler.

import {
  available, shader, buffer, write, writeAt, bindBuffer,
  dispatch, read, readBegin, readPoll, bufferFree, adapterName,
} from "rts:gpu";

export default {
  available(): number { return available() ? 1 : 0; },

  shader(src: string): number { return shader(src); },
  buffer(bytes: number): number { return buffer(bytes); },
  dispatch(pipe: number, x: number, y: number, z: number): void { dispatch(pipe, x, y, z); },

  write(buf: number, data: any): void { write(buf, data); },
  write_at(buf: number, off: number, data: any): void { writeAt(buf, off, data); },
  bind_buffer(pipe: number, slot: number, buf: number): void { bindBuffer(pipe, slot, buf); },

  // ── AQUI a superfície mudou de FORMA, não só de nome ──────────────────────
  //
  // Foi o que quebrou o `gpurigid` de um jeito traiçoeiro: as posições chegavam
  // certas e o contador de sono ficava sempre em 0, então parecia bug de shader.
  // Não era. O shader estava correto o tempo todo.
  //
  //   antiga:  read(gbuf, destino, tamanho)   → ESCREVE no destino
  //   nova:    read(gbuf, bytes)              → RETORNA um Uint8Array
  //
  // A primeira versão deste shim repassava os argumentos na ordem antiga, então
  // o DESTINO ia parar no lugar do TAMANHO e o retorno era descartado. O buffer
  // do jogo nunca era atualizado — e como ele já tinha as posições escritas na
  // inicialização, o que se via era um estado plausível e velho, que é o modo de
  // falhar mais caro que existe.
  read(buf: number, out: Uint8Array, size: number): void {
    const data = read(buf, size);
    if (data !== undefined) out.set(data.subarray(0, out.length));
  },

  read_begin(buf: number, size: number): number { return readBegin(buf, size); },

  // `readPoll` distingue TRÊS estados onde a antiga usava um inteiro: `null` =
  // ainda em voo, `false` = falhou (e o ticket morreu), `Uint8Array` = pronto.
  // A superfície antiga devolvia -1 para falha, que passa num `if` — é a razão
  // declarada da mudança. Traduzido de volta para o inteiro que o jogo espera:
  // 1 pronto, 0 em voo, -1 falhou.
  read_poll(ticket: number, out: Uint8Array): number {
    const r = readPoll(ticket);
    if (r === null || r === undefined) return 0;
    if (r === false) return 0 - 1;
    out.set((r as Uint8Array).subarray(0, out.length));
    return 1;
  },

  // Não existiam na superfície antiga; ficam disponíveis porque não custam
  // nada e a alternativa seria o chamador importar `rts:gpu` direto e passar a
  // ter duas origens para a mesma coisa.
  bufferFree(buf: number): void { bufferFree(buf); },
  adapterName(): string { return adapterName(); },
};

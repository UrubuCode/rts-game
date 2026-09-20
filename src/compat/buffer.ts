// `rts:buffer` sobre `ArrayBuffer`/`DataView` do motor novo.
//
// O namespace antigo era memória fora do heap: `alloc` devolvia um handle para
// um bloco malloc'ado, `free` o devolvia ao alocador, e `ptr` revelava o
// endereço cru para quem precisasse passá-lo a uma função nativa. Aqui o bloco
// é um `ArrayBuffer` e o "handle" é uma view tipada sobre ele — o coletor
// conhece a célula, então não há nada a liberar à mão.
//
// ---------------------------------------------------------------------------
// A DECISÃO: `ptr()` NÃO EXISTE, e isso é deliberado.
// ---------------------------------------------------------------------------
//
// `buffer.ptr(b)` devolvia um ENDEREÇO. No motor novo um endereço não é um
// valor que se possa guardar: o coletor move células, então o número lido hoje
// aponta para outro lugar depois da próxima coleta — e os 13 chamadores do jogo
// fazem exatamente o que torna isso fatal, que é guardar o endereço numa `const`
// de topo (`main.ts:49`, `harness.ts:63`, `netharness.ts:41,47`) e reusá-lo por
// toda a execução. É por isso que a superfície nova recebe views tipadas:
// `egui.meshUpload` quer a view, não o número.
//
// As duas saídas eram:
//
//   (a) `ptr(b)` devolve um número fingido (um índice, um id de tabela). Isso
//       compila e passa nos 13 lugares, e mente: `fs.read_all(path, ptr, sz)`
//       escreveria em lugar nenhum, e o erro apareceria como pixels errados ou
//       silêncio, longe daqui. É a regra que o CLAUDE.md do motor chama de
//       "uma superfície que não faz o que o nome diz não é entregue".
//
//   (b) o "buffer" É a view tipada, e `ptr` simplesmente NÃO existe. Quem hoje
//       escreve `buffer.ptr(b)` passa a escrever `b`.
//
// Escolhi (b). O preço é honesto e imediato: os 13 sítios de `ptr()` param de
// COMPILAR ("Property 'ptr' does not exist"), em vez de rodarem errado. Cada um
// precisa de decisão humana, não de tradução — ver a lista no fim do arquivo.

// O bloco é um `Uint8Array`; a `DataView` sobre o mesmo `ArrayBuffer` é o que
// responde às leituras/escritas tipadas em offsets arbitrários (a view de bytes
// não sabe ler um f32 em offset 7, e a antiga `read_f32(b, off)` nunca exigiu
// alinhamento — usar `Float32Array` no lugar imporia um alinhamento que o
// código do jogo não respeita).
export type Buf = Uint8Array;

// `DataView` por bloco, criada uma vez. Um expando na própria `Uint8Array`
// (`(b as any).__dv`) seria mais barato, mas propriedade extra em array tipado
// é justamente o tipo de coisa que o motor novo ainda decide caso a caso; um
// `Map` é uma estrutura que ele já tem e cujo comportamento não está em dúvida.
const views = new Map<Buf, DataView>();

function dv(b: Buf): DataView {
  let v = views.get(b);
  if (v === undefined) {
    v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    views.set(b, v);
  }
  return v;
}

// Todas as leituras/escritas são LITTLE-ENDIAN porque o `rts:buffer` antigo era
// memória crua lida na ordem do host, e todo host onde este jogo roda (x86-64,
// ARM64) é little-endian. Não é uma escolha de formato, é a tradução exata do
// que acontecia antes.
const LE = true;

export default {
  // `alloc` antigo NÃO zerava; `ArrayBuffer` sempre zera. A diferença é a favor
  // do chamador (nenhum código depende de ler lixo), então `alloc` e
  // `alloc_zeroed` são a mesma coisa aqui — e `alloc_zeroed` continua existindo
  // porque `harness.ts` e `netharness.ts` a chamam pelo nome.
  alloc(n: number): Buf {
    return new Uint8Array(n | 0);
  },

  alloc_zeroed(n: number): Buf {
    return new Uint8Array(n | 0);
  },

  // NO-OP, e não por preguiça: o bloco é uma célula do heap gerenciado, então
  // liberá-la à mão é impossível e desnecessária. Mantida como função para que
  // as 20 chamadas existentes continuem compilando — o que ela faz é soltar a
  // `DataView` associada, para que o `Map` acima não vire um vazamento que
  // segura blocos que o coletor recolheria.
  free(b: Buf): void {
    views.delete(b);
  },

  // APROXIMAÇÃO MARCADA: o antigo era um `memset` em Rust sobre `count` bytes.
  // `Uint8Array.fill(value, start, end)` é o mesmo memset, mas em JS — a nota
  // em `raster.ts:13` que diz "memset em Rust — 2 chamadas" deixa de valer como
  // argumento de desempenho. O RESULTADO é idêntico; o custo, não.
  fill(b: Buf, value: number, count: number): void {
    b.fill(value & 0xff, 0, count | 0);
  },

  // O antigo decodificava o bloco INTEIRO, incluindo os zeros do fim — é por
  // isso que `harness.ts` faz `full.substring(0, n)` logo depois. Mantido
  // assim: cortar no primeiro NUL aqui mudaria o comportamento de um chamador
  // que já corta sozinho.
  //
  // Decodificação byte-a-byte (latin1), não UTF-8: é o que reproduz "um byte,
  // um char" que o `substring(0, n)` dos chamadores pressupõe — com UTF-8, `n`
  // bytes não são `n` caracteres. Comandos da porta de controle são ASCII.
  to_string(b: Buf): string {
    let s = "";
    let i = 0;
    while (i < b.length) {
      s = s + String.fromCharCode(b[i]);
      i = i + 1;
    }
    return s;
  },

  read_u8(b: Buf, off: number): number {
    return b[off | 0];
  },

  write_u8(b: Buf, off: number, v: number): void {
    b[off | 0] = v & 0xff;
  },

  read_i32(b: Buf, off: number): number {
    return dv(b).getInt32(off | 0, LE);
  },

  write_i32(b: Buf, off: number, v: number): void {
    dv(b).setInt32(off | 0, v | 0, LE);
  },

  read_f32(b: Buf, off: number): number {
    return dv(b).getFloat32(off | 0, LE);
  },

  write_f32(b: Buf, off: number, v: number): void {
    dv(b).setFloat32(off | 0, v, LE);
  },

  read_f64(b: Buf, off: number): number {
    return dv(b).getFloat64(off | 0, LE);
  },

  write_f64(b: Buf, off: number, v: number): void {
    dv(b).setFloat64(off | 0, v, LE);
  },
};

// ---------------------------------------------------------------------------
// DELIBERADAMENTE AUSENTES
// ---------------------------------------------------------------------------
//
// `ptr`     — a decisão explicada no topo. Ausente para falhar na compilação.
// `read_u16/i16/i64/u32/u64`, `write_*` correspondentes, `copy`, `len`,
//             `realloc`, `from_string` — nenhum chamador no jogo. Não foram
//             inventados; se algum aparecer, `DataView` já tem o método.
//
// O que eu NÃO sei sobre a superfície antiga, e portanto não reproduzi:
//   - se `read_u8` fora dos limites devolvia 0 ou lia lixo adjacente. Aqui
//     devolve `undefined` (comportamento de `Uint8Array`), o que vira `NaN` em
//     aritmética — mais barulhento que o antigo, provavelmente.
//   - se `fill` com `count` maior que o bloco escrevia além dele. Aqui o `fill`
//     do `Uint8Array` satura no fim, sem erro.
//
// ---------------------------------------------------------------------------
// OS 13 SÍTIOS DE `ptr()` QUE PRECISAM DE MUDANÇA MANUAL
// ---------------------------------------------------------------------------
//   editor/thumbs.ts:45,135,136
//   engine/render/gpu3d.ts:41,262,263
//   engine/render/model.ts:382,419
//   harness.ts:63        main.ts:49        netharness.ts:41,47
//
// Os de `egui.meshUpload` (gpu3d.ts:41) e `render.image` (thumbs.ts:45) são
// substituição direta: passe `vbuf` no lugar de `buffer.ptr(vbuf)`.
// Os de `fs.read_all(path, ptr, sz)` e `imgdec.decode(ptr, n)` NÃO são: essas
// APIs precisam elas mesmas aceitar uma view, o que é uma decisão do shim de
// `fs`/`imgdec` e não deste arquivo.
// Os de `io.stdin_read_line(cptr, 512)` idem — o `compat/io.ts` de hoje tem um
// `stdin_read_line()` SEM argumentos que devolve a string pronta, então esses
// três (`harness.ts`, `netharness.ts`, `main.ts`) provavelmente perdem o buffer
// inteiro em vez de ganharem uma view.

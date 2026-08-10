// `rts:audio` — NÃO HÁ SUBSTITUTO. Este arquivo diz isso e nada mais.
//
// ---------------------------------------------------------------------------
// VERIFICADO ANTES DE AFIRMAR
// ---------------------------------------------------------------------------
//
// Nenhum crate do workspace do motor oferece áudio. Os 16 membros de
// `E:\rts\Cargo.toml` foram lidos um a um — não há `cpal`, `rodio`, nem
// dispositivo de som em lugar nenhum — e o próprio manifesto já dizia, na nota
// que aposentou a feature `asio`: *"Nothing in this engine provides audio yet"*.
// Isto não é uma superfície que mudou de nome; é uma capacidade que o motor
// novo não tem.
//
// ---------------------------------------------------------------------------
// A DECISÃO: `open_output` devolve 0, os outros seis membros LANÇAM.
// ---------------------------------------------------------------------------
//
// A tentação óbvia era escrever um mixer para o nada: `write` aceita as
// amostras e as descarta, `queued_frames` devolve um número plausível, e o jogo
// roda mudo sem reclamar. É exatamente o erro do `buffer.ptr()` — uma
// superfície que não faz o que o nome diz — e seria pior aqui, porque o mixer
// de `engine/audio/audio.ts` continuaria gastando o frame inteiro sintetizando
// amostras que ninguém ouve.
//
// A saída honesta não precisou ser inventada, porque o jogo já a tinha: o
// `initAudio` de `engine/audio/audio.ts:73` faz
//
//     const h = audio.open_output(0, 0, 0);
//     if (h === 0) return 0;              // segue mudo, sem erro
//
// e o comentário logo acima diz por quê — *"uma máquina sem placa de som não
// deve derrubar o jogo"*. Um motor sem áudio É uma máquina sem placa de som.
// Devolver 0 não finge nada: é a resposta verdadeira à pergunta "consegui abrir
// um dispositivo?", e ela põe o jogo no caminho de silêncio que ele já sabe
// percorrer — `dev` fica 0, `voice()` recusa na entrada, `pumpAudio()` retorna
// antes de sintetizar coisa alguma. Nenhum ciclo é gasto no mixer.
//
// Os outros seis membros só são alcançáveis com um handle não-zero, que não
// existe. Se algum for chamado, é porque alguém contornou o teste de `dev` — e
// aí a resposta certa é o erro, não o silêncio.
//
// ---------------------------------------------------------------------------
// POR QUE UM SHIM E NÃO O CORTE
// ---------------------------------------------------------------------------
//
// `engine/audio/audio.ts` é alcançado por SEIS arquivos —`main.ts` (o editor),
// `castelo_demo.ts`, `castelo_agua_demo.ts`, `castelo_gpu_demo.ts`,
// `scripts/audiosource.ts` e `editor/control/commands/scene.ts`. Cortar o
// mixer levaria os seis junto, e o que se perderia não é só o som: é a
// SÍNTESE, que são ~250 linhas de mixagem, panning e gerenciamento de vozes que
// não dependem de dispositivo nenhum e voltam a valer no dia em que o motor
// tiver saída de áudio. Descartá-las porque falta o último passo do caminho é
// jogar fora o que está pronto para consertar o que não está.

const SEM_AUDIO =
  "rts:audio não existe no motor novo: nenhum crate do workspace oferece " +
  "saída de som (ver a nota da feature `asio` em Cargo.toml). O mixer de " +
  "engine/audio/audio.ts segue funcionando, mas não há para onde escrever as " +
  "amostras.";

function ausente(membro: string): never {
  throw new Error("audio." + membro + " — " + SEM_AUDIO);
}

export default {
  // O ÚNICO membro que responde, e responde a verdade: "não abri dispositivo".
  // `initAudio` trata 0 como "máquina sem placa de som" e segue mudo — que é a
  // descrição literal da situação.
  //
  // O aviso sai UMA vez, na abertura: um jogo silencioso sem explicação manda
  // a pessoa procurar defeito no volume do sistema. Dizer o motivo custa uma
  // linha de log e economiza a busca.
  open_output(_rate: number, _channels: number, _flags: number): number {
    println("[compat/audio] " + SEM_AUDIO + " O jogo segue MUDO.");
    return 0;
  },

  // Daqui para baixo: inalcançáveis enquanto `dev` for 0, e ruidosos se não
  // forem. Nenhum devolve um valor plausível de propósito — um `sample_rate`
  // que responde 48000 sem dispositivo é a mentira que este arquivo recusa.
  sample_rate(_dev: number): number { ausente("sample_rate"); },
  channels(_dev: number): number { ausente("channels"); },
  master_volume(_dev: number, _v: number): void { ausente("master_volume"); },
  queued_frames(_dev: number): number { ausente("queued_frames"); },
  write(_dev: number, _buf: any, _samples: number): number { ausente("write"); },
  close(_dev: number): void { ausente("close"); },
};

// ---------------------------------------------------------------------------
// O QUE ISSO CUSTA, DITO INTEIRO
// ---------------------------------------------------------------------------
//
// O jogo roda MUDO. Não há tradução, aproximação nem caminho parcial: o editor
// e as três demos de castelo perdem o som por completo, e nenhuma linha deste
// diretório pode devolvê-lo. Volta quando o motor tiver um crate de áudio, e
// nesse dia este arquivo vira um shim de verdade ou desaparece.
//
// `close` está aqui sem chamador no jogo (a varredura só encontra os seis
// outros) porque um `open_output` sem `close` é uma superfície torta de ler;
// se ele não existia no namespace antigo, é o único membro deste arquivo que
// eu não tenho como confirmar.
//
// ---------------------------------------------------------------------------
// MUDANÇA MANUAL NECESSÁRIA FORA DAQUI
// ---------------------------------------------------------------------------
//
// `engine/audio/audio.ts:16` — trocar o import para este arquivo.
//
// E uma que NÃO é sobre áudio: as linhas 61/67 declaram `let mixBuf: i64 = 0` e
// `silBuf`, que recebem `buffer.alloc(...)`. Com `compat/buffer.ts` isso passou
// a ser um `Uint8Array`, então a anotação `i64` está errada e o arquivo não
// compila por causa DISSO, não por causa do áudio. Como `dev` fica 0, os dois
// buffers nunca chegam a ser alocados — o conserto é de tipo, e ambos podem
// virar `Uint8Array | null`.

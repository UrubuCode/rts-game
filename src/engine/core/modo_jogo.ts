// Engine RTS — modo_jogo: UM flag global "estamos em Play/jogo" (não editor
// parado, não carregamento de cena, não anexar um componente no editor).
//
// Existe porque `playOnAwake`-like (ParticleSystem, AudioSource) só deve
// tocar sozinho DENTRO do Play/jogo — carregar uma cena no editor ou
// arrastar um script novo para um objeto NÃO deveria começar a simular nada.
// Antes deste arquivo, `AudioSource` resolvia isso com um flag próprio
// (`audioEmJogo`, em `engine/audio/audio.ts`); esta é a mesma decisão,
// promovida pra um lugar comum, pra qualquer Behavior com `playOnAwake`
// concordar sem duplicar o flag (dois flags independentes poderiam divergir
// se algum caminho de Play/Stop esquecesse de atualizar um dos dois).
let emJogoFlag: number = 0;

/// Chamado por `play_mode.ts` ao entrar no Play, e por `game.ts` no início
/// do jogo exportado (onde é sempre "em jogo", sem editor).
export function entrarJogo(): void { emJogoFlag = 1; }
/// Chamado por `play_mode.ts` ao sair do Play (voltar pro editor parado).
export function sairJogo(): void { emJogoFlag = 0; }
/// 1 = Play/jogo rodando agora; 0 = editor parado (cena carregada, componente
/// recém-anexado, prévia de edição). Lido por `mount()` de componentes com
/// `playOnAwake` antes de tocar sozinhos.
export function emJogo(): number { return emJogoFlag; }

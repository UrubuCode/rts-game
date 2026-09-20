// ═══════════════════════════════════════════════════════════════════════════
// O RELÓGIO — um segundo é um segundo, a qualquer frame rate.
//
// ── O DEFEITO QUE FEZ ISTO EXISTIR ─────────────────────────────────────────
//
// Nenhuma pasta abria no painel Project. A janela do duplo-clique era contada em
// FRAMES: `frame - lastClickFrame < 24`. Isso vale 400 ms a 60 fps, que é como o
// número nasceu e é razoável. O editor passou a rodar a 442 fps — e ali 24
// frames são 54 MILISSEGUNDOS, rápido demais para uma mão humana.
//
// O motor ficar sete vezes mais rápido quebrou o duplo-clique, e o sintoma não
// parecia desempenho: parecia que a UI tinha quebrado.
//
// Uma contagem de frame carrega uma suposição escondida sobre o frame rate, e
// ela morre em silêncio quando o desempenho muda. Este módulo existe para que
// essa suposição não tenha onde se esconder.
//
// ── UMA LEITURA POR FRAME, E ISSO É AS DUAS COISAS ─────────────────────────
//
// `performance.now()` aparecia em 24 lugares do jogo, cada um perguntando ao SO
// por conta própria. A 442 fps isso é 24 travessias por frame, mais de dez mil
// por segundo, para responder um número que não muda dentro do frame.
//
// Aqui o relógio do SO é lido UMA vez, no topo do frame, e todo mundo pergunta a
// este módulo. Isso compra duas coisas que costumam ser tratadas como
// alternativas:
//
//   CUSTO      N travessias por frame viram uma. Quanto isso vale nesta máquina
//              não foi medido, e por isso não há número aqui — o que se afirma é
//              a estrutura, não a economia.
//   CORREÇÃO   duas coisas que perguntam "que horas são" no mesmo frame recebem
//              o MESMO instante. Com leituras independentes elas recebem
//              instantes diferentes, e um intervalo calculado entre elas pode
//              sair negativo — que é a classe de bug que só aparece sob carga.
//
// ── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────
//
// Não substitui `fixedstep.ts`. Aquele decide QUANTOS passos de simulação
// rodam; este responde QUE HORAS SÃO. Um é a cadência da física, o outro é o
// relógio de parede — e misturá-los é como a física volta a depender do frame
// rate, que é exatamente o que o passo fixo existe para impedir.
//
// Nem substitui o `profiler.ts`, que precisa do relógio DENTRO do frame para
// medir seções e por isso continua lendo direto. Medir o frame é a única coisa
// que não pode usar o valor cacheado do frame.
// ═══════════════════════════════════════════════════════════════════════════

/// O instante do frame corrente, em milissegundos. Lido uma vez por
/// `clockTick`.
let agora: f64 = 0.0;
/// O instante do frame anterior, para o delta.
let antes: f64 = 0.0;
/// Segundos decorridos desde o frame anterior, já com o teto aplicado.
let delta: f64 = 0.0;
/// Quantos frames desde o início. Contagem, e NUNCA tempo — está aqui para quem
/// genuinamente conta frames (um contador de fps, um índice de buffer), e o doc
/// diz isso para ninguém a usar como relógio de novo.
let frames = 0;
/// Se `clockTick` já rodou. Antes disso `clockNow()` responderia 0 e todo
/// intervalo calculado contra ele seria o tempo desde a época.
let iniciado = 0;

/// Teto do delta, em segundos.
///
/// Um frame que demorou 3 segundos — janela minimizada, ponto de parada, o SO
/// paginando — não deve mover nada 3 segundos de uma vez: uma câmera daria um
/// salto e um corpo atravessaria o chão. 0,25 s é o mesmo espírito do
/// `MAX_STEPS` do passo fixo, aplicado ao relógio de parede.
const DT_MAX: f64 = 0.25;

/// Marca o começo de um frame. UMA chamada, no topo do laço, antes de tudo.
export function clockTick(): void {
  const t: f64 = performance.now();
  if (iniciado === 0) {
    // O primeiro frame não tem anterior. Delta zero, e não um número enorme
    // desde a época — que faria a primeira animação do programa pular.
    agora = t; antes = t; delta = 0.0; iniciado = 1;
  } else {
    antes = agora;
    agora = t;
    const bruto: f64 = (agora - antes) / 1000.0;
    delta = bruto > DT_MAX ? DT_MAX : (bruto < 0.0 ? 0.0 : bruto);
  }
  frames = frames + 1;
}

/// Que horas são, em milissegundos, NESTE frame.
///
/// O mesmo valor para todo mundo que perguntar dentro do frame — é isso que
/// torna um intervalo entre dois pontos do mesmo frame igual a zero em vez de
/// um número que depende de quem perguntou primeiro.
export function clockNow(): f64 { return agora; }

/// Segundos desde o frame anterior, com teto. O que multiplica uma velocidade.
export function clockDelta(): f64 { return delta; }

/// Milissegundos decorridos desde um instante que `clockNow()` respondeu.
///
/// Existe para o chamador não escrever `clockNow() - marca` e um dia escrever
/// `marca - clockNow()`: o sinal trocado é uma janela que nunca fecha, e ela
/// falha de um jeito que parece "o clique não registrou".
export function clockSince(marca: f64): f64 { return agora - marca; }

/// A janela de interação humana passou?
///
/// `marca` é o que `clockNow()` respondeu quando o gesto começou. Use isto para
/// TUDO que descreve o que uma pessoa faz — duplo-clique, segurar, esperar um
/// tooltip, repetir uma tecla. É a função que impede o defeito do cabeçalho de
/// voltar: ela não tem como ser escrita em frames.
export function clockExpired(marca: f64, janelaMs: f64): number {
  return agora - marca >= janelaMs ? 1 : 0;
}

/// 400 ms — a janela do duplo-clique, e o padrão que os sistemas operacionais
/// usam. Um nome e não um literal para que o segundo lugar que precisar dela use
/// o MESMO número: duas janelas de duplo-clique diferentes na mesma aplicação é
/// como uma delas fica estranha sem ninguém saber dizer por quê.
export const DOUBLE_CLICK_MS: f64 = 400.0;

/// Quantos frames desde o início. CONTAGEM, nunca tempo — se você está prestes a
/// comparar isto com um limiar para saber se "já passou tempo suficiente", a
/// função que você quer é `clockExpired`.
export function clockFrames(): number { return frames; }

/// Zera. Depois de carregar uma cena ou sair de uma pausa longa, onde o tempo
/// decorrido não representa nada que devesse ter acontecido.
export function clockReset(): void {
  iniciado = 0; agora = 0.0; antes = 0.0; delta = 0.0;
}

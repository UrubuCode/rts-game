// ═══════════════════════════════════════════════════════════════════════════
// PASSO FIXO — a física deixa de depender do frame rate.
//
// É o `FixedUpdate` da Unity, o `fixedDeltaTime` do Godot, o "Fix Your
// Timestep!" do Gaffer: o render anda no ritmo que a máquina der, a física anda
// sempre no MESMO passo.
//
// ── O QUE ISTO CONSERTA, E NÃO É COSMÉTICO ─────────────────────────────────
//
// O editor rodava `scene.update(dt)` com o `dt` do FRAME, limitado a 100 ms. Os
// três defeitos que vêm junto:
//
// 1. NÃO DETERMINÍSTICO. A mesma cena com as mesmas entradas dá resultados
//    diferentes em máquinas diferentes — e no MESMO computador, se o frame
//    variar. Nada que dependa de física fica reproduzível: nem um replay, nem um
//    teste, nem um bug relatado.
//
// 2. TUNNELING. A 7 fps o passo é 100 ms, e um corpo em queda percorre meio
//    metro entre duas verificações — atravessa qualquer colisor mais fino que
//    isso. O `MAX_FALL = 60 u/s` do `Rigidbody` é um REMENDO desse problema, e
//    o comentário dele admite: "com vy=-200 a bola passava direto por um chão de
//    1 unidade". Com passo fixo de 1/60, o corpo anda no máximo ~0,016 × v por
//    passo, e o teto passa a ser uma rede em vez da defesa principal.
//
// 3. EXPLOSÃO. Integração explícita com passo grande cria energia do nada: a
//    pilha do castelo "respira", a água ferve. Foi por isso que o solver do
//    fluido já usava sub-passo fixo — este arquivo estende a mesma lição ao
//    resto da física, em vez de deixá-la valendo só onde alguém se queimou.
//
// ── A ESPIRAL DA MORTE, E POR QUE HÁ UM TETO ───────────────────────────────
//
// Se um frame demora 500 ms, o acumulador pede 30 passos. Se rodar os 30, o
// frame seguinte demora mais ainda, que pede mais passos — e o programa nunca
// mais alcança o tempo real. É a "spiral of death", e a defesa é DESCARTAR o
// tempo que não coube: a simulação fica em câmera lenta por um instante, o que
// é visível e recuperável, em vez de travar de vez, que não é.
//
// ── INTERPOLAÇÃO ───────────────────────────────────────────────────────────
//
// Com passo fixo, o render quase nunca cai em cima de um passo: sobra uma fração
// no acumulador. Desenhar o último estado físico faz o movimento tremer (judder)
// mesmo com a física perfeita. `stepAlpha()` responde essa fração para quem
// quiser interpolar entre o estado anterior e o atual — é o que o
// `Rigidbody.interpolation` da Unity faz.
//
// A interpolação NÃO é aplicada aqui: quem desenha é que sabe o que interpolar,
// e mexer nas posições da própria simulação para o render ver é como se perde a
// distinção entre estado e apresentação.
// ═══════════════════════════════════════════════════════════════════════════

/// O passo. 1/60 s, que é o que a maioria das engines usa como default e o que
/// os solvers deste projeto já assumem (`RB_DT` no `gpurigid`, o sub-passo do
/// fluido). Um número menor é mais estável e custa proporcionalmente mais.
export const FIXED_DT: f64 = 1.0 / 60.0;

/// Teto de passos por frame — a defesa contra a espiral da morte.
///
/// 5 passos = 83 ms de simulação por frame. Acima disso o tempo é descartado: a
/// física fica em câmera lenta em vez de o programa parar de responder.
const MAX_STEPS = 5;

/// Teto de MILISSEGUNDOS por frame — a segunda defesa, e a que o `MAX_STEPS`
/// não dá.
///
/// As duas medem coisas diferentes e as duas são necessárias. `MAX_STEPS` conta
/// quantos passos de simulação cabem no tempo REAL decorrido; ele não sabe
/// quanto cada passo CUSTA. A 4000 corpos na CPU um único passo custa 76 ms, e o
/// teto de 5 passos deixa o frame passar de 380 ms sem reclamar — o jogo trava
/// com a defesa contra travamento ligada.
///
/// 8 ms é metade de um frame de 60 Hz. A escolha é essa e não "o frame inteiro"
/// porque o que sobra tem de desenhar: um frame gasto todo em física entrega uma
/// imagem congelada, que para o jogador é a mesma coisa que travar.
const ORCAMENTO_MS_PADRAO: f64 = 8.0;

let acumulador: f64 = 0.0;
let ultimoAlpha: f64 = 0.0;
let passosNoFrame = 0;
let passosTotais = 0;
let descartes = 0;
let orcMs: f64 = ORCAMENTO_MS_PADRAO;
let orcT0: f64 = 0.0;
let cortes = 0;
let passosCortados = 0;

/// Quantos passos de física este frame deve rodar, dado o tempo REAL decorrido.
///
/// Chame uma vez por frame com o delta de verdade (em segundos) e rode a física
/// exatamente esse número de vezes, sempre com [`FIXED_DT`] — nunca com o dt do
/// frame, que é o ponto inteiro deste arquivo.
///
/// ```ts
/// const passos = stepsFor(dtReal);
/// for (let i = 0; i < passos; i++) { scene.update(FIXED_DT); scene.resolveCollisions(); }
/// ```
export function stepsFor(dtReal: f64): number {
  // Um dt negativo ou absurdo vem de relógio ajustado, de um breakpoint ou da
  // janela minimizada. Zero passos é a resposta certa: o mundo não avança
  // porque alguém parou o processo.
  if (dtReal <= 0.0 || dtReal > 10.0) {
    ultimoAlpha = acumulador / FIXED_DT;
    passosNoFrame = 0;
    return 0;
  }

  // O relógio do orçamento começa aqui e não no primeiro passo: o que interessa
  // é quanto do FRAME a física já consumiu, e quem chama pode ter trabalho entre
  // este ponto e o laço.
  orcT0 = performance.now();

  acumulador = acumulador + dtReal;
  let n = 0;
  while (acumulador >= FIXED_DT && n < MAX_STEPS) {
    acumulador = acumulador - FIXED_DT;
    n = n + 1;
  }

  // Não coube: joga fora o resto em vez de acumular dívida impagável.
  if (acumulador >= FIXED_DT) {
    descartes = descartes + 1;
    acumulador = 0.0;
  }

  ultimoAlpha = acumulador / FIXED_DT;
  passosNoFrame = n;
  passosTotais = passosTotais + n;
  return n;
}

/// Rodo mais um passo? Chame no topo do laço, com quantos já rodaram.
///
/// ```ts
/// const passos = stepsFor(dtReal);
/// let i = 0;
/// while (stepMore(i, passos) !== 0) { simule(FIXED_DT); i = i + 1; }
/// ```
///
/// O PRIMEIRO PASSO SEMPRE RODA, e essa é a regra que faz isto ser degradação em
/// vez de falha: numa máquina onde um único passo já estoura o orçamento, cortar
/// o primeiro faria o mundo PARAR — e um mundo parado é indistinguível de um
/// programa travado, que é justamente o que este teto existe para evitar. Com
/// ele, a física anda devagar e o jogo continua respondendo.
///
/// O tempo cortado é DESCARTADO, não acumulado: guardar a dívida é exatamente a
/// espiral da morte que o `MAX_STEPS` já recusa, e cortar por orçamento para
/// depois pagar no frame seguinte seria reintroduzi-la por outra porta.
export function stepMore(jaRodados: number, planejados: number): number {
  if (jaRodados >= planejados) return 0;
  if (jaRodados === 0) return 1;
  if (performance.now() - orcT0 < orcMs) return 1;
  cortes = cortes + 1;
  passosCortados = passosCortados + (planejados - jaRodados);
  acumulador = 0.0;
  passosNoFrame = jaRodados;
  ultimoAlpha = 0.0;
  return 0;
}

/// Muda o teto de milissegundos. 0 ou menos DESLIGA o corte.
///
/// Desligável porque uma medição de física quer o custo real e não o custo
/// truncado — um benchmark com o teto ligado mede o teto.
export function stepSetBudgetMs(ms: f64): void { orcMs = ms > 0.0 ? ms : 1000000.0; }
export function stepBudgetMs(): f64 { return orcMs; }

/// Quantos frames tiveram passos cortados por ORÇAMENTO, e quantos passos.
///
/// Separado de [`stepDiscards`] de propósito: aquele conta tempo que não coube
/// no teto de PASSOS (a máquina está atrás do relógio), este conta tempo que não
/// coube no teto de MILISSEGUNDOS (um passo é caro demais). O primeiro pede uma
/// cena menor; o segundo pede um backend mais rápido, e confundir os dois manda
/// a investigação para o lado errado.
export function stepBudgetCuts(): number { return cortes; }
export function stepStepsDropped(): number { return passosCortados; }

/// A fração de passo que sobrou, entre 0 e 1 — para interpolar o render.
///
/// 0 significa "acabei de simular"; 0,5 significa "estou na metade do caminho
/// para o próximo passo". Quem desenha usa isto para misturar o estado anterior
/// com o atual e matar o tremor.
export function stepAlpha(): f64 { return ultimoAlpha; }

/// Quantos passos rodaram no último frame. 0 é normal (frame rápido demais),
/// e [`MAX_STEPS`] repetido significa que a máquina não alcança o tempo real.
export function stepsLastFrame(): number { return passosNoFrame; }

/// Quantas vezes tempo foi DESCARTADO por não caber no teto.
///
/// Diagnóstico, não estatística: se isto cresce, a física está em câmera lenta e
/// o jogador percebe. É o número que diz "reduza a cena ou troque de backend"
/// antes de alguém culpar o solver.
export function stepDiscards(): number { return descartes; }

/// Total de passos desde o início — o relógio da SIMULAÇÃO, que é o que um
/// replay determinístico conta, em vez de segundos de parede.
export function stepCount(): number { return passosTotais; }

/// Zera o acumulador. Para depois de carregar uma cena ou sair de uma pausa
/// longa, onde o tempo decorrido não representa simulação a fazer.
export function stepReset(): void {
  acumulador = 0.0;
  ultimoAlpha = 0.0;
  passosNoFrame = 0;
}

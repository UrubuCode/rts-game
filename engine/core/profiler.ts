// ═══════════════════════════════════════════════════════════════════════════
// PROFILER POR SEÇÃO — onde o frame foi gasto, medido e não adivinhado.
//
// É o Profiler da Unity reduzido ao essencial: marque o começo e o fim de cada
// trecho, e no fim do frame a tabela diz quanto cada um custou.
//
// ── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// Sem ele, um "está a 40 fps" só permite adivinhar. Nesta sessão o palpite foi
// errado DUAS vezes: primeiro culpando o `drawMesh` (era a física), depois
// culpando a física (o render está travado no vsync, e o custo real era um
// round-trip de GPU síncrono). As duas vezes custaram tempo que uma tabela teria
// economizado.
//
// ── MÉDIA MÓVEL, NÃO O ÚLTIMO FRAME ────────────────────────────────────────
//
// Um frame isolado varia demais para significar algo: o GC, o SO e a fila da GPU
// entram e saem. A média exponencial de ~1 s é o que um humano consegue ler e o
// que mostra tendência quando você muda alguma coisa.
//
// ── O CUSTO DE MEDIR ───────────────────────────────────────────────────────
//
// O relógio é `performance.now()`, e não `Date.now()`. Era `Date.now()`, com a
// ressalva de que uma seção mais curta que 1 ms aparecia como 0; o que revelou
// que a ressalva não bastava foi tentar SUBDIVIDIR a UI 2D, que custa ~2,9 ms
// inteira: cada pedaço caía abaixo do passo do relógio e a tabela respondia
// zeros com um total não-zero. `performance.now()` é fração de milissegundo e a
// subdivisão passa a significar alguma coisa.
//
// A SOMA continua sendo o que vale para trechos curtos, e é por isso que
// `secBegin`/`secEnd` acumulam em vez de guardar o último valor.
// Desligado (`profEnable(0)`), o par vira um `if` e um retorno — barato o
// bastante para ficar no código em produção, que é como a Unity faz.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_SEC = 16;

const nomes: string[] = [];
const acum: f64[] = [];      // soma do frame corrente
const media: f64[] = [];     // média exponencial entre frames
const inicio: f64[] = [];    // marca do `secBegin` aberto
let nSec = 0;
let ligado = 0;
let frameT0: f64 = 0.0;
let frameMedia: f64 = 0.0;
let frames = 0;

/// Liga ou desliga. Desligado, o par begin/end custa um `if`.
export function profEnable(on: number): void { ligado = on; }
export function profEnabled(): number { return ligado; }

/// Registra uma seção e devolve o id — chame UMA vez, na inicialização.
///
/// Um id em vez do nome a cada frame: comparar strings 16 vezes por frame no
/// laço mais quente é exatamente o tipo de custo que um profiler não pode ter.
export function profSection(nome: string): number {
  if (nSec >= MAX_SEC) return 0;
  const id = nSec;
  nomes.push(nome);
  acum.push(0.0);
  media.push(0.0);
  inicio.push(0.0);
  nSec = nSec + 1;
  return id;
}

export function profFrameBegin(): void {
  if (ligado === 0) return;
  frameT0 = performance.now();
  let i = 0;
  while (i < nSec) { acum[i] = 0.0; i = i + 1; }
}

export function secBegin(id: number): void {
  if (ligado === 0) return;
  inicio[id] = performance.now();
}

export function secEnd(id: number): void {
  if (ligado === 0) return;
  acum[id] = acum[id] + (performance.now() - inicio[id]);
}

export function profFrameEnd(): void {
  if (ligado === 0) return;
  const total = performance.now() - frameT0;
  // Peso 0,05 ≈ um segundo de história a 60 fps. Menos que isso treme, mais
  // demora a reagir quando você troca algo.
  frameMedia = frames === 0 ? total : frameMedia * 0.95 + total * 0.05;
  let i = 0;
  while (i < nSec) {
    media[i] = frames === 0 ? acum[i] : media[i] * 0.95 + acum[i] * 0.05;
    i = i + 1;
  }
  frames = frames + 1;
}

/// A tabela, pronta para imprimir ou mandar pela porta de controle.
///
/// Inclui a linha "resto": o que o frame custou MENOS o que as seções somam. Ela
/// é a mais importante da tabela — é onde mora o custo que ninguém instrumentou,
/// e um "resto" grande significa que a instrumentação está no lugar errado.
export function profReport(): string {
  if (ligado === 0) return "[prof] desligado — use `prof on`";
  if (frames === 0) return "[prof] nenhum frame medido ainda";
  // SÓ as seções de topo somam para o "resto". As sub-seções (nome começando
  // com espaço) já estão CONTIDAS na seção que as envolve — contá-las de novo
  // fazia a soma passar do total e o resto ficar NEGATIVO, que foi como este
  // defeito apareceu. Uma tabela que mente é pior que nenhuma.
  let soma: f64 = 0.0;
  let out = "[prof] frame " + frameMedia.toFixed(2) + " ms (" +
            (frameMedia > 0.0 ? (1000.0 / frameMedia).toFixed(0) : "-") + " fps) media de " + frames + " frames\n";
  let i = 0;
  while (i < nSec) {
    const aninhada = nomes[i].charCodeAt(0) === 32;
    if (!aninhada) soma = soma + media[i];
    const pct = frameMedia > 0.0 ? (media[i] / frameMedia * 100.0) : 0.0;
    out = out + "  " + nomes[i].padEnd(18) + media[i].toFixed(2).padStart(7) + " ms  " + pct.toFixed(1).padStart(5) + "%\n";
    i = i + 1;
  }
  const resto = frameMedia - soma;
  const pctR = frameMedia > 0.0 ? (resto / frameMedia * 100.0) : 0.0;
  out = out + "  " + "(resto/vsync)".padEnd(18) + resto.toFixed(2).padStart(7) + " ms  " + pctR.toFixed(1).padStart(5) + "%";
  return out;
}

/// O tempo médio de UMA seção, para quem quer o número sem a tabela.
export function profSectionMs(id: number): f64 { return id < nSec ? media[id] : 0.0; }
export function profFrameMs(): f64 { return frameMedia; }

/// Zera a história. Depois de trocar de backend ou de cena — senão a média
/// mistura dois regimes e não descreve nenhum.
export function profReset(): void {
  frames = 0;
  frameMedia = 0.0;
  let i = 0;
  while (i < nSec) { media[i] = 0.0; acum[i] = 0.0; i = i + 1; }
}

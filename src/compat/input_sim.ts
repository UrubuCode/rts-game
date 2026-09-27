// ENTRADA SIMULADA: mouse, teclado e texto injetados pela porta de controle
// (`input ...`), lidos pelo MESMO ponto que lê a entrada real (`@compat/input`).
// Toda a UI do editor é de modo imediato e lê a entrada por ali — Inspector,
// menus, Hierarquia, Project, gizmo — e o jogo em Play também (entrada.ts),
// então um clique injetado é indistinguível de um clique físico para eles.
//
// # Como funciona
//
// Os comandos enfileiram EVENTOS (mover, apertar, soltar, tecla, texto, roda)
// separados por QUEBRAS de quadro. No início de cada quadro (`entradaQuadro`,
// chamado pelo `beginFrame` do app) os eventos até a próxima quebra são
// aplicados, e as bordas (apertou/soltou neste quadro) saem da comparação com
// o quadro anterior. O estado persiste: um botão apertado segue apertado até o
// evento de soltar. Um clique é mover | apertar | soltar: três quadros, como
// a mão faria.
//
// Enquanto a simulação está ATIVA, a entrada real é ignorada (inclusive o
// mouse físico): o que o agente injetou não pode ser misturado com o que a mão
// do usuário faz ao mesmo tempo. Ela desliga com `input off` ou sozinha depois
// de `SIM_OCIOSA_MS` sem injeção, fila vazia e nada segurado.
//
// # Custo
//
// Nada aloca por quadro: a fila é um Float64Array fixo e o texto fica num
// array de strings criado pelo comando (não pelo quadro). Inativa, a leitura
// custa um `if` a mais.

/// Tamanho da fila (eventos). Um arrasto de 60 quadros usa ~130.
const FILA_MAX: number = 4096;
const CAMPOS: number = 3;   // tipo, a, b
/// Teclas simuláveis (os códigos neutros de rts-input vão até 151).
export const SIM_TECLAS: number = 256;
/// Botões do mouse: 0 esquerdo, 1 direito, 2 do meio.
export const SIM_BOTOES: number = 3;
/// Distância máxima (pixels) entre apertar e soltar para contar como clique
/// (a mesma tolerância do egui para um clique não virar arrasto).
export const SIM_CLIQUE_MAX_DIST: f64 = 6.0;
/// Desliga sozinha depois deste tempo sem injeção (fila vazia, nada segurado).
export const SIM_OCIOSA_MS: number = 30000;

// tipos de evento
const EV_QUEBRA: number = 0;
const EV_MOVER: number = 1;
const EV_APERTAR: number = 2;
const EV_SOLTAR: number = 3;
const EV_TECLA_DESCE: number = 4;
const EV_TECLA_SOBE: number = 5;
const EV_TEXTO: number = 6;
const EV_RODA: number = 7;
// modificadores como "teclas" fora da faixa dos códigos neutros
export const SIM_TECLA_CTRL: number = 250;
export const SIM_TECLA_SHIFT: number = 251;
export const SIM_TECLA_ALT: number = 252;

const fila = new Float64Array(FILA_MAX * CAMPOS);
let filaIni = 0;
let filaN = 0;
const textos: string[] = [];

let ativa = 0;
let quadro = 0;
let quadroUltimoEvento = 0 - 1;
let ultimaInjecaoMs: number = 0;

let mx: f64 = 0.0; let my: f64 = 0.0;
let dx: f64 = 0.0; let dy: f64 = 0.0;
let roda: f64 = 0.0;
let textoQuadro = "";
const botoes = new Uint8Array(SIM_BOTOES);
const botoesAntes = new Uint8Array(SIM_BOTOES);
const soltouLonge = new Uint8Array(SIM_BOTOES);
const apertoX = new Float64Array(SIM_BOTOES);
const apertoY = new Float64Array(SIM_BOTOES);
const teclas = new Uint8Array(SIM_TECLAS);
/// Borda da tecla neste quadro: 1 desceu, 2 subiu, 0 nada.
const bordaTecla = new Uint8Array(SIM_TECLAS);

/// A simulação está valendo (a entrada real é ignorada)?
export function simAtiva(): boolean { return ativa !== 0; }
/// Quadros vistos por `entradaQuadro` (um por quadro do app).
export function simQuadro(): number { return quadro; }
/// Fila vazia e o último evento já foi visto por um quadro INTEIRO (o quadro
/// que o aplicou terminou): quem espera pode responder.
export function simConcluida(): boolean { return filaN === 0 && quadro > quadroUltimoEvento; }
export function simFilaTamanho(): number { return filaN; }

function empurra(tipo: number, a: f64, b: f64): boolean {
  if (filaN >= FILA_MAX) return false;
  const k = ((filaIni + filaN) % FILA_MAX) * CAMPOS;
  fila[k] = tipo; fila[k + 1] = a; fila[k + 2] = b;
  filaN = filaN + 1;
  ativa = 1;
  ultimaInjecaoMs = Date.now();
  return true;
}

/// Espaço livre na fila (o comando recusa em vez de enfileirar pela metade).
export function simEspacoLivre(): number { return FILA_MAX - filaN; }
export function simMover(x: f64, y: f64): void { empurra(EV_MOVER, x, y); }
export function simApertar(botao: number): void { empurra(EV_APERTAR, botao, 0.0); }
export function simSoltar(botao: number): void { empurra(EV_SOLTAR, botao, 0.0); }
export function simTeclaDesce(codigo: number): void { empurra(EV_TECLA_DESCE, codigo, 0.0); }
export function simTeclaSobe(codigo: number): void { empurra(EV_TECLA_SOBE, codigo, 0.0); }
export function simRoda(d: f64): void { empurra(EV_RODA, d, 0.0); }
export function simTexto(t: string): void {
  textos.push(t);
  empurra(EV_TEXTO, 0.0, 0.0);
}
/// Fim do quadro: os eventos seguintes só valem no próximo.
export function simQuebra(): void { empurra(EV_QUEBRA, 0.0, 0.0); }

/// Solta tudo, esvazia a fila e volta à entrada real.
export function simDesligar(): void {
  filaIni = 0; filaN = 0; textos.length = 0;
  let b = 0; while (b < SIM_BOTOES) { botoes[b] = 0; botoesAntes[b] = 0; b = b + 1; }
  let t = 0; while (t < SIM_TECLAS) { teclas[t] = 0; bordaTecla[t] = 0; t = t + 1; }
  dx = 0.0; dy = 0.0; roda = 0.0; textoQuadro = "";
  ativa = 0;
}

function algoSegurado(): boolean {
  let b = 0; while (b < SIM_BOTOES) { if (botoes[b] !== 0) return true; b = b + 1; }
  let t = 0; while (t < SIM_TECLAS) { if (teclas[t] !== 0) return true; t = t + 1; }
  return false;
}

/// Início de um quadro: aplica os eventos até a próxima quebra. Chamado pelo
/// `beginFrame` do app (e pelos testes sem janela, no lugar dele).
export function entradaQuadro(): void {
  quadro = quadro + 1;
  if (ativa === 0) return;
  // bordas e deltas valem UM quadro
  let b = 0;
  while (b < SIM_BOTOES) { botoesAntes[b] = botoes[b]; soltouLonge[b] = 0; b = b + 1; }
  let t = 0;
  while (t < SIM_TECLAS) { bordaTecla[t] = 0; t = t + 1; }
  dx = 0.0; dy = 0.0; roda = 0.0; textoQuadro = "";
  if (filaN === 0) {
    if (Date.now() - ultimaInjecaoMs >= SIM_OCIOSA_MS && !algoSegurado()) ativa = 0;
    return;
  }
  while (filaN > 0) {
    const k = filaIni * CAMPOS;
    const tipo = fila[k]; const a = fila[k + 1]; const c = fila[k + 2];
    const i = a | 0;   // índice de botão/tecla
    filaIni = (filaIni + 1) % FILA_MAX; filaN = filaN - 1;
    quadroUltimoEvento = quadro;
    if (tipo === EV_QUEBRA) break;
    if (tipo === EV_MOVER) { dx = dx + (a - mx); dy = dy + (c - my); mx = a; my = c; }
    else if (tipo === EV_APERTAR) { botoes[i] = 1; apertoX[i] = mx; apertoY[i] = my; }
    else if (tipo === EV_SOLTAR) {
      botoes[i] = 0;
      const ddx = mx - apertoX[i]; const ddy = my - apertoY[i];
      soltouLonge[i] = ddx * ddx + ddy * ddy > SIM_CLIQUE_MAX_DIST * SIM_CLIQUE_MAX_DIST ? 1 : 0;
    }
    else if (tipo === EV_TECLA_DESCE) { teclas[i] = 1; bordaTecla[i] = 1; }
    else if (tipo === EV_TECLA_SOBE) { teclas[i] = 0; bordaTecla[i] = 2; }
    else if (tipo === EV_TEXTO) { textoQuadro = textoQuadro + (textos.length > 0 ? textos.shift() : ""); }
    else if (tipo === EV_RODA) roda = roda + a;
  }
  if (filaN === 0) textos.length = 0;
}

// ── leituras (a forma de rts:input) ─────────────────────────────────────────
function botaoValido(b: number): boolean { return b >= 0 && b < SIM_BOTOES; }
export function simMouseX(): f64 { return mx; }
export function simMouseY(): f64 { return my; }
export function simMouseDeltaX(): f64 { return dx; }
export function simMouseDeltaY(): f64 { return dy; }
export function simRodaQuadro(): f64 { return roda; }
export function simMouseDown(b: number): boolean { return botaoValido(b) && botoes[b] !== 0; }
export function simMousePressed(b: number): boolean { return botaoValido(b) && botoes[b] !== 0 && botoesAntes[b] === 0; }
export function simMouseReleased(b: number): boolean { return botaoValido(b) && botoes[b] === 0 && botoesAntes[b] !== 0; }
export function simMouseClicked(b: number): boolean { return simMouseReleased(b) && soltouLonge[b] === 0; }
export function simArrastando(): boolean {
  let b = 0;
  while (b < SIM_BOTOES) {
    if (botoes[b] !== 0) {
      const ddx = mx - apertoX[b]; const ddy = my - apertoY[b];
      if (ddx * ddx + ddy * ddy > SIM_CLIQUE_MAX_DIST * SIM_CLIQUE_MAX_DIST) return true;
    }
    b = b + 1;
  }
  return false;
}
/// `key(code, fase)`: 0 segurada, 1 desceu neste quadro, 2 subiu neste quadro.
export function simTecla(codigo: number, fase: number): boolean {
  if (codigo < 0 || codigo >= SIM_TECLAS) return false;
  if (fase === 0) return teclas[codigo] !== 0;
  if (fase === 1) return bordaTecla[codigo] === 1;
  return bordaTecla[codigo] === 2;
}
export function simTextoQuadro(): string { return textoQuadro; }
export function simCtrl(): boolean { return teclas[SIM_TECLA_CTRL] !== 0; }
export function simShift(): boolean { return teclas[SIM_TECLA_SHIFT] !== 0; }
export function simAlt(): boolean { return teclas[SIM_TECLA_ALT] !== 0; }

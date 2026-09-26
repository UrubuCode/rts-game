// Entrada para scripts de jogo (controles de câmera etc.): teclado e mouse da
// janela do jogo. Sem janela (testes, sem definirJanelaEntrada) ou com a entrada
// desligada pelo editor (definirEntradaAtiva) tudo responde 0.
import input from "rts:input";
export const TECLA_W: number = 122; export const TECLA_S: number = 118;
export const TECLA_A: number = 100; export const TECLA_D: number = 103;
export const TECLA_ESPACO: number = 3;
export const TECLA_CIMA: number = 5; export const TECLA_BAIXO: number = 6;
export const TECLA_ESQUERDA: number = 7; export const TECLA_DIREITA: number = 8;
export const BOTAO_DIREITO: number = 1;
/// Fase "segurada" de rts:input.key (a mesma de compat/app.ts:PHASE_DOWN).
const FASE_SEGURADA: number = 0;
let janela = 0;
/// O editor desliga a entrada dos scripts fora da aba Jogo ou com um campo de
/// texto em edição (main.ts); o jogo exportado nunca mexe: fica sempre ligada.
let ativa = true;
/// Teclas seguradas por simulação (testes sem janela): somam-se às da janela.
const TECLAS_SIMULAVEIS: number = 256;
const simuladas = new Uint8Array(TECLAS_SIMULAVEIS);
export function simularTecla(codigo: number, segurada: boolean): void {
  if (codigo >= 0 && codigo < TECLAS_SIMULAVEIS) simuladas[codigo] = segurada ? 1 : 0;
}
export function definirJanelaEntrada(win: number): void { janela = win; }
export function definirEntradaAtiva(a: boolean): void { ativa = a; }
export function entradaAtiva(): boolean { return ativa; }
export function teclaSegurada(codigo: number): boolean {
  if (!ativa) return false;
  if (codigo >= 0 && codigo < TECLAS_SIMULAVEIS && simuladas[codigo] !== 0) return true;
  return janela !== 0 && input.key(janela, codigo, FASE_SEGURADA);
}
export function eixoTeclas(positiva: number, negativa: number): number { return (teclaSegurada(positiva) ? 1 : 0) - (teclaSegurada(negativa) ? 1 : 0); }
export function mouseSegurado(botao: number): boolean { return janela !== 0 && ativa && input.mouseDown(janela, botao); }
export function mouseDX(): number { return janela !== 0 && ativa ? input.mouseDeltaX(janela) : 0.0; }
export function mouseDY(): number { return janela !== 0 && ativa ? input.mouseDeltaY(janela) : 0.0; }
export function rodaMouse(): number { return janela !== 0 && ativa ? input.wheel(janela) : 0.0; }

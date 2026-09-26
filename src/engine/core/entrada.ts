// Entrada para scripts de jogo (controles de câmera etc.): teclado e mouse da
// janela do jogo. Sem janela (testes, sem definirJanelaEntrada) tudo responde 0.
import input from "rts:input";
export const TECLA_W: number = 122; export const TECLA_S: number = 118;
export const TECLA_A: number = 100; export const TECLA_D: number = 103;
export const TECLA_ESPACO: number = 3;
export const BOTAO_DIREITO: number = 1;
/// Fase "segurada" de rts:input.key (a mesma de compat/app.ts:PHASE_DOWN).
const FASE_SEGURADA: number = 0;
let janela = 0;
export function definirJanelaEntrada(win: number): void { janela = win; }
export function teclaSegurada(codigo: number): boolean { return janela !== 0 && input.key(janela, codigo, FASE_SEGURADA); }
export function eixoTeclas(positiva: number, negativa: number): number { return (teclaSegurada(positiva) ? 1 : 0) - (teclaSegurada(negativa) ? 1 : 0); }
export function mouseSegurado(botao: number): boolean { return janela !== 0 && input.mouseDown(janela, botao); }
export function mouseDX(): number { return janela !== 0 ? input.mouseDeltaX(janela) : 0.0; }
export function mouseDY(): number { return janela !== 0 ? input.mouseDeltaY(janela) : 0.0; }
export function rodaMouse(): number { return janela !== 0 ? input.wheel(janela) : 0.0; }

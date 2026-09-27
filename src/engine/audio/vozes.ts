// A tabela de vozes: um Float64Array de MAX_VOZES × VOZ_FLOATS (spec §3.4), no
// lugar dos 14 arrays paralelos. Chega ao mixer POR PARÂMETRO (20 ns por
// acesso, contra 260 ns de um array de módulo — medido).
export const MAX_VOZES: number = 32;
export const VOZ_FLOATS: number = 28;

export const V_ESTADO: number = 0;
export const V_CLIPE: number = 1;
export const V_POS: number = 2;       // posição fracionária, quadros do clipe
export const V_PASSO: number = 3;     // pitch × taxa do clipe / taxa do dispositivo
export const V_LACO: number = 4;
export const V_GL: number = 5;        // ganho corrente (início do próximo bloco)
export const V_GR: number = 6;
export const V_ALVO_L: number = 7;    // ganho no fim do próximo bloco
export const V_ALVO_R: number = 8;
export const V_LP_COEF: number = 9;
export const V_LP_L: number = 10;
export const V_LP_R: number = 11;
export const V_GRUPO: number = 12;
export const V_FONTE: number = 13;    // id do GameObject da fonte, −1 sem fonte
export const V_FLAGS: number = 14;
export const V_VOLUME: number = 15;
export const V_X: number = 16;
export const V_Y: number = 17;
export const V_Z: number = 18;
export const V_BLEND: number = 19;
export const V_MIN: number = 20;
export const V_MAX: number = 21;
export const V_ROLLOFF: number = 22;
export const V_PITCH: number = 23;
export const V_CANAIS: number = 24;
export const V_DIST: number = 25;     // distância ao ouvinte no último bloco
export const V_CORTE: number = 26;    // corte do passa-baixa em Hz no último bloco
export const V_GERACAO: number = 27;  // conta alocações do slot; faz o id antigo ficar inválido

export const ESTADO_LIVRE: number = 0;
export const ESTADO_TOCANDO: number = 1;
export const ESTADO_PAUSADA: number = 2;

export const FLAG_VIRTUAL: number = 1;
export const FLAG_ONESHOT: number = 2;
export const FLAG_PREVIA: number = 4;
export const FLAG_3D: number = 8;
export const FLAG_CONGELADA: number = 16;   // grupo em pausa: não anda nem mixa

export const ROLLOFF_LOG: number = 0;
export const ROLLOFF_LINEAR: number = 1;
/// Corte do passa-baixa "aberto" (frente, perto): acima disto o filtro é desligado.
export const CORTE_ABERTO: f64 = 22000.0;

// Pedido de voz: o que `tocarClipe` recebe (≤ 4 parâmetros por chamada).
export const PEDIDO_VOLUME: number = 0;
export const PEDIDO_PITCH: number = 1;
export const PEDIDO_LACO: number = 2;
export const PEDIDO_GRUPO: number = 3;
export const PEDIDO_FONTE: number = 4;
export const PEDIDO_FLAGS: number = 5;
export const PEDIDO_X: number = 6;
export const PEDIDO_Y: number = 7;
export const PEDIDO_Z: number = 8;
export const PEDIDO_BLEND: number = 9;
export const PEDIDO_MIN: number = 10;
export const PEDIDO_MAX: number = 11;
export const PEDIDO_ROLLOFF: number = 12;
export const PEDIDO_FLOATS: number = 13;
const VOZ_MIN_PADRAO: f64 = 1.0;
const VOZ_MAX_PADRAO: f64 = 500.0;

export function pedidoPadrao(p: Float64Array): void {
  p[PEDIDO_VOLUME] = 1.0; p[PEDIDO_PITCH] = 1.0; p[PEDIDO_LACO] = 0.0; p[PEDIDO_GRUPO] = 0.0;
  p[PEDIDO_FONTE] = 0.0 - 1.0; p[PEDIDO_FLAGS] = 0.0; p[PEDIDO_X] = 0.0; p[PEDIDO_Y] = 0.0; p[PEDIDO_Z] = 0.0;
  p[PEDIDO_BLEND] = 0.0; p[PEDIDO_MIN] = VOZ_MIN_PADRAO; p[PEDIDO_MAX] = VOZ_MAX_PADRAO; p[PEDIDO_ROLLOFF] = ROLLOFF_LOG;
}

/// Um pedido novo com os padrões. Aloca: crie uma vez e reaproveite.
export function novoPedido(): Float64Array {
  const p = new Float64Array(PEDIDO_FLOATS);
  pedidoPadrao(p);
  return p;
}

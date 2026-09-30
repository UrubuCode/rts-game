// Índices do descritor de `mix_add` e do vetor de `mix_level` — espelho de
// `crates/rts-audio/src/mix.rs`. Mudar um lado sem o outro é ler o campo
// errado sem erro nenhum; `tests/test_audio_nativo.ts` pega (paridade).
export const D_POS: number = 0;
export const D_PASSO: number = 1;
export const D_CANAIS_SRC: number = 2;
export const D_CANAIS_DST: number = 3;
export const D_QUADROS: number = 4;
export const D_GL0: number = 5;
export const D_GR0: number = 6;
export const D_GL1: number = 7;
export const D_GR1: number = 8;
export const D_LP_COEF: number = 9;
export const D_LP_L: number = 10;
export const D_LP_R: number = 11;
export const D_LACO_INI: number = 12;
export const D_LACO_FIM: number = 13;
export const D_MIXADOS: number = 14;
export const D_FIM: number = 15;
export const DESC_FLOATS: number = 16;

export const N_CANAIS: number = 0;
export const N_QUADROS: number = 1;
export const N_PICO_L: number = 2;
export const N_PICO_R: number = 3;
export const N_RMS_L: number = 4;
export const N_RMS_R: number = 5;
export const N_CORTADAS: number = 6;
export const NIVEL_FLOATS: number = 8;

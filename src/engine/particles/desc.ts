// Layout do "desc" de emissão (Float64Array, ≤ 4 parâmetros no caminho de
// emitirN/atualizar — o desc entra como UM parâmetro, não N escalares).
export const FORMA_PONTO: number = 0;
export const FORMA_ESFERA: number = 1;
export const FORMA_CONE: number = 2;
export const FORMA_CAIXA: number = 3;

export const D_FORMA: number = 0;
export const D_RAIO: number = 1;
export const D_ANGULO: number = 2;   // cone, graus
export const D_CAIXA_X: number = 3; export const D_CAIXA_Y: number = 4; export const D_CAIXA_Z: number = 5;
export const D_VEL_MIN: number = 6; export const D_VEL_MAX: number = 7;
export const D_TAM_MIN: number = 8; export const D_TAM_MAX: number = 9;
export const D_VIDA_MIN: number = 10; export const D_VIDA_MAX: number = 11;
export const D_ROT0: number = 12;
export const D_COR_R: number = 13; export const D_COR_G: number = 14; export const D_COR_B: number = 15;
export const DESC_FLOATS: number = 16;

// Layout de uma linha do pool (SoA: cada campo é uma COLUNA, ver sim.ts).
export const P_X: number = 0; export const P_Y: number = 1; export const P_Z: number = 2;
export const P_VX: number = 3; export const P_VY: number = 4; export const P_VZ: number = 5;
export const P_IDADE: number = 6; export const P_VIDA: number = 7;
export const P_TAM0: number = 8; export const P_ROT: number = 9;
export const P_COR_R: number = 10; export const P_COR_G: number = 11; export const P_COR_B: number = 12; export const P_COR_A: number = 13;
export const P_FLOATS: number = 14;

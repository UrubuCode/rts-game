// Pool de partículas em SoA: um Float64Array só, P_FLOATS colunas por
// partícula, reaproveitado entre quadros (zero alocação — CLAUDE.md "Custo
// por quadro"). Reciclagem por lista de livres (pilha): O(1) para emitir e
// para reciclar, sem compactar o pool a cada morte.
import { aleatorio, aleatorioEntre } from "@engine/core/aleatorio";
import { FORMA_PONTO, FORMA_ESFERA, FORMA_CONE, FORMA_CAIXA,
         D_FORMA, D_RAIO, D_ANGULO, D_CAIXA_X, D_CAIXA_Y, D_CAIXA_Z,
         D_VEL_MIN, D_VEL_MAX, D_TAM_MIN, D_TAM_MAX, D_VIDA_MIN, D_VIDA_MAX, D_ROT0, D_COR_R, D_COR_G, D_COR_B,
         P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_IDADE, P_VIDA, P_TAM0, P_ROT, P_COR_R, P_COR_G, P_COR_B, P_COR_A, P_FLOATS } from "./desc";

const DOIS_PI: f64 = 6.283185307179586;

export class PoolParticulas {
  dados: Float64Array;
  max: number;
  vivas: number;
  /// Pilha de índices livres (topo em `nLivres`); nasce cheia (todos livres).
  livres: Int32Array;
  nLivres: number;
  constructor(max: number) {
    this.dados = new Float64Array(max * P_FLOATS);
    this.max = max; this.vivas = 0;
    this.livres = new Int32Array(max);
    let i = 0;
    while (i < max) {
      this.livres[i] = max - 1 - i;
      // marca todo slot como livre (P_VIDA<0): distingue de uma partícula viva
      // com vida sorteada em 0 (ver atualizarVidas) — o default 0.0 do
      // Float64Array seria indistinguível de "viva, vida=0".
      this.dados[i * P_FLOATS + P_VIDA] = -1.0;
      i = i + 1;
    }
    this.nLivres = max;
  }
}
export function criarPool(maxParticulas: number): PoolParticulas { return new PoolParticulas(maxParticulas); }

/// Direção aleatória na esfera unitária (Marsaglia): 2 sorteios, sem trig.
const dirTmp = new Float64Array(3);
function direcaoAleatoria(): Float64Array {
  let x1 = 0.0; let x2 = 0.0; let s = 1.0;
  while (s >= 1.0) { x1 = aleatorioEntre(-1.0, 1.0); x2 = aleatorioEntre(-1.0, 1.0); s = x1 * x1 + x2 * x2; }
  const f = 2.0 * Math.sqrt(1.0 - s);
  dirTmp[0] = x1 * f; dirTmp[1] = x2 * f; dirTmp[2] = 1.0 - 2.0 * s;
  return dirTmp;
}
function amostrarPosVel(desc: Float64Array, pos: Float64Array, vel: Float64Array): void {
  const forma = desc[D_FORMA];
  const speed = aleatorioEntre(desc[D_VEL_MIN], desc[D_VEL_MAX]);
  if (forma === FORMA_ESFERA) {
    const r = desc[D_RAIO] * Math.pow(aleatorio(), 1.0 / 3.0);
    const d = direcaoAleatoria();
    pos[0] = d[0] * r; pos[1] = d[1] * r; pos[2] = d[2] * r;
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  } else if (forma === FORMA_CONE) {
    // amostragem uniforme por ÁREA no casquete esférico (não por ângulo):
    // cosT = 1 - u·(1 - cos(meiaAngulo)) dá densidade uniforme no ângulo
    // sólido; sortear `abre` uniforme em [0,meiaAngulo] concentraria amostras
    // perto do eixo.
    const meiaAngulo = desc[D_ANGULO] * 0.5 * 0.017453292519943295;
    const cosMeia = Math.cos(meiaAngulo);
    const ang = aleatorio() * DOIS_PI;
    const cosT = 1.0 - aleatorio() * (1.0 - cosMeia);
    const sinT = Math.sqrt(Math.max(0.0, 1.0 - cosT * cosT));
    const sx = sinT * Math.cos(ang); const sz = sinT * Math.sin(ang); const sy = cosT;
    pos[0] = 0.0; pos[1] = 0.0; pos[2] = 0.0;
    vel[0] = sx * speed; vel[1] = sy * speed; vel[2] = sz * speed;
  } else if (forma === FORMA_CAIXA) {
    pos[0] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_X];
    pos[1] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_Y];
    pos[2] = aleatorioEntre(-0.5, 0.5) * desc[D_CAIXA_Z];
    const d = direcaoAleatoria();
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  } else { // FORMA_PONTO
    pos[0] = 0.0; pos[1] = 0.0; pos[2] = 0.0;
    const d = direcaoAleatoria();
    vel[0] = d[0] * speed; vel[1] = d[1] * speed; vel[2] = d[2] * speed;
  }
}

/// Buffers de saída de `amostrarPosVel`, reaproveitados entre chamadas: chamado
/// por quadro (emissão por taxa), então não pode alocar por chamada.
const pvTmp = new Float64Array(3);
const vvTmp = new Float64Array(3);

/// Emite até `n` partículas (menos se o pool não tiver slots livres o
/// suficiente — o resto é descartado, `maxParticles` nunca é excedido).
/// 3 parâmetros: pool e desc chegam por referência, dentro do limite do RTS.
export function emitirN(pool: PoolParticulas, desc: Float64Array, n: number): number {
  const pv = pvTmp; const vv = vvTmp;
  let emitidas = 0;
  while (emitidas < n && pool.nLivres > 0) {
    pool.nLivres = pool.nLivres - 1;
    const slot = pool.livres[pool.nLivres];
    amostrarPosVel(desc, pv, vv);
    const k = slot * P_FLOATS;
    pool.dados[k + P_X] = pv[0]; pool.dados[k + P_Y] = pv[1]; pool.dados[k + P_Z] = pv[2];
    pool.dados[k + P_VX] = vv[0]; pool.dados[k + P_VY] = vv[1]; pool.dados[k + P_VZ] = vv[2];
    pool.dados[k + P_IDADE] = 0.0;
    pool.dados[k + P_VIDA] = aleatorioEntre(desc[D_VIDA_MIN], desc[D_VIDA_MAX]);
    pool.dados[k + P_TAM0] = aleatorioEntre(desc[D_TAM_MIN], desc[D_TAM_MAX]);
    pool.dados[k + P_ROT] = desc[D_ROT0];
    pool.dados[k + P_COR_R] = desc[D_COR_R]; pool.dados[k + P_COR_G] = desc[D_COR_G]; pool.dados[k + P_COR_B] = desc[D_COR_B]; pool.dados[k + P_COR_A] = 1.0;
    pool.vivas = pool.vivas + 1;
    emitidas = emitidas + 1;
  }
  return emitidas;
}

/// Envelhece todas as partículas por `dt`; recicla as que morreram (idade >=
/// vida) devolvendo o slot à pilha de livres. 2 parâmetros. Devolve `vivas`.
///
/// Alocado/livre é decidido por `P_VIDA >= 0.0` (marcador), não por
/// `idade < vida`: uma partícula emitida com vida sorteada em 0 (desc com
/// vidaMin=vidaMax=0, ou desc não preenchido) precisa envelhecer e reciclar
/// na primeira chamada, não ficar presa para sempre (vazamento do pool).
export function atualizarVidas(pool: PoolParticulas, dt: f64): number {
  let slot = 0;
  while (slot < pool.max) {
    const k = slot * P_FLOATS;
    if (pool.dados[k + P_VIDA] >= 0.0) {
      pool.dados[k + P_IDADE] = pool.dados[k + P_IDADE] + dt;
      if (pool.dados[k + P_IDADE] >= pool.dados[k + P_VIDA]) {
        pool.dados[k + P_VIDA] = 0.0 - 1.0; // marca livre (vida<0: nunca mais entra aqui até reemitir)
        pool.livres[pool.nLivres] = slot; pool.nLivres = pool.nLivres + 1;
        pool.vivas = pool.vivas - 1;
      }
    }
    slot = slot + 1;
  }
  return pool.vivas;
}

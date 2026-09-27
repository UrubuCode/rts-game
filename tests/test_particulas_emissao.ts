import { criarPool, emitirN, atualizarVidas } from "@engine/particles/sim";
import { FORMA_PONTO } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import process from "@compat/process.ts";

function assertEq(msg: string, a: f64, b: f64): void {
  if (Math.abs(a - b) > 1e-9) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); }
}

fixarSementeAleatorio(12345);
const pool = criarPool(100);
const desc = new Float64Array(16); // forma=ponto, vida fixa 1s, velocidade fixa
desc[0] = FORMA_PONTO; desc[10] = 1.0; desc[11] = 1.0; // vidaMin=vidaMax=1.0

// rateOverTime acumulado por vários quadros de dt irregular não perde nem duplica.
let acumulado = 0.0;
let dt = 0.016;
let i = 0;
while (i < 625) { // 625 * 0.016 = 10s
  acumulado = acumulado + dt * 10.0; // rate=10/s
  const inteiras = Math.floor(acumulado);
  if (inteiras > 0) { emitirN(pool, desc, inteiras); acumulado = acumulado - inteiras; }
  i = i + 1;
}
assertEq("emitiu ~100 partículas em 10s a 10/s", pool.vivas, 100);

// maxParticles nunca excedido: emitir mais 50 num pool de 100 já cheio.
const antes = pool.vivas;
emitirN(pool, desc, 50);
assertEq("emissão além do pool é descartada", pool.vivas, antes);

// morte e reciclagem: 1s depois, todas as 100 morrem; emitir 10 novas reaproveita slots.
atualizarVidas(pool, 1.001);
assertEq("todas morreram", pool.vivas, 0);
emitirN(pool, desc, 10);
assertEq("reciclagem sem buraco", pool.vivas, 10);

// vida sorteada em 0 não vaza o pool: recicla na 1ª atualizarVidas (revisão
// da Task 2, item 1 — marcador de alocação em P_VIDA).
{
  const poolZero = criarPool(50);
  const descZero = new Float64Array(16); // vidaMin=vidaMax=0.0 (índices 10/11 ficam 0 por padrão)
  descZero[0] = FORMA_PONTO;
  let rodada = 0;
  while (rodada < 10000) {
    emitirN(poolZero, descZero, 1);
    atualizarVidas(poolZero, 0.016);
    assertEq("vazamento com vida=0 na rodada " + rodada, poolZero.vivas, 0);
    rodada = rodada + 1;
  }
  // nenhuma capacidade perdida (cursor rotativo, ruling P6): um desc com vida
  // longa agora preenche o pool inteiro, sem slot "esquecido" nunca marcado livre.
  const descCheio = new Float64Array(16);
  descCheio[0] = FORMA_PONTO; descCheio[10] = 100.0; descCheio[11] = 100.0;
  emitirN(poolZero, descCheio, 50);
  assertEq("nenhuma capacidade perdida após 10k emissões com vida=0", poolZero.vivas, 50);
}

// cursor de emissão nunca sonda sem limite (ruling P6): pedir mais do que o
// pool tem espaço não trava nem escaneia o pool inteiro por partícula.
{
  const poolCursor = criarPool(20);
  const descCursor = new Float64Array(16);
  descCursor[0] = FORMA_PONTO; descCursor[10] = 100.0; descCursor[11] = 100.0;
  const emitidas1 = emitirN(poolCursor, descCursor, 1000);
  assertEq("cursor: nunca excede maxParticles mesmo pedindo muito mais", emitidas1, 20);
  const emitidas2 = emitirN(poolCursor, descCursor, 5);
  assertEq("cursor: pool cheio nao emite (sai antes de sondar)", emitidas2, 0);
}

console.log("[PASSOU] test_particulas_emissao");

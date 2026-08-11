// Testes da casca convexa (`engine/core/hull.ts`).
//
// Cada teste fixa um COMPORTAMENTO, não uma implementação: "um cubo dá seis
// planos" continua verdade se o algoritmo mudar de incremental para quickhull,
// e é a afirmação que a Fase 2 vai depender.

import io from "../compat/io.ts";
import { Hull, hullFromMesh, hullContains, hullSupport, HULL_MAX_PLANES } from "../engine/core/hull";

let ok = 0;
let fail = 0;

function check(cond: number, nome: string): void {
  if (cond !== 0) { ok = ok + 1; io.print("  ok     " + nome); }
  else { fail = fail + 1; io.print("  FALHOU " + nome); }
}

function near(a: f64, b: f64, tol: f64): number {
  const d = a - b;
  return (d < 0.0 ? 0.0 - d : d) < tol ? 1 : 0;
}

/// Monta o array intercalado que `gpu3d.upload()` usa: 8 floats por vértice
/// (pos, normal, uv). Os testes só se importam com a posição, mas passam pelo
/// layout REAL — se o stride fosse tratado errado, um teste com stride 3 não
/// perceberia.
function mesh(pontos: f64[]): f64[] {
  const v: f64[] = [];
  let i = 0;
  while (i < pontos.length) {
    v.push(pontos[i]); v.push(pontos[i + 1]); v.push(pontos[i + 2]);
    v.push(0.0); v.push(1.0); v.push(0.0);   // normal (ignorada pela casca)
    v.push(0.0); v.push(0.0);                // uv     (idem)
    i = i + 3;
  }
  return v;
}

// ── CUBO: a forma cujo resultado é sabido de cor ───────────────────────────
io.print("== CUBO 2x2x2 centrado na origem ==");
const cubo = mesh([
  0.0 - 1.0, 0.0 - 1.0, 0.0 - 1.0,   1.0, 0.0 - 1.0, 0.0 - 1.0,
  1.0, 1.0, 0.0 - 1.0,               0.0 - 1.0, 1.0, 0.0 - 1.0,
  0.0 - 1.0, 0.0 - 1.0, 1.0,         1.0, 0.0 - 1.0, 1.0,
  1.0, 1.0, 1.0,                     0.0 - 1.0, 1.0, 1.0,
]);
const hc = hullFromMesh(cubo, 8);
check(hc.ok, "a casca do cubo e valida");
check(hc.vertexCount() === 8 ? 1 : 0, "8 vertices (era " + hc.vertexCount() + ")");
check(hc.planeCount() === 6 ? 1 : 0, "6 planos, nao 12 (era " + hc.planeCount() + ")");
check(hc.simplified === 0 ? 1 : 0, "nao precisou simplificar");
// Um cubo de lado 2 tem suporte 1 em cada eixo e sqrt(3) na diagonal do canto.
check(near(hullSupport(hc, 1.0, 0.0, 0.0), 1.0, 0.0001), "suporte em +X = 1");
check(near(hullSupport(hc, 0.0, 0.0 - 1.0, 0.0), 1.0, 0.0001), "suporte em -Y = 1");
const s3 = 1.0 / Math.sqrt(3.0);
check(near(hullSupport(hc, s3, s3, s3), Math.sqrt(3.0), 0.0001), "suporte na diagonal = raiz(3)");
check(hullContains(hc, 0.0, 0.0, 0.0, 0.0), "o centro esta DENTRO");
check(hullContains(hc, 0.9, 0.9, 0.9, 0.0), "um ponto perto do canto esta DENTRO");
check(hullContains(hc, 1.5, 0.0, 0.0, 0.0) === 0 ? 1 : 0, "(1.5,0,0) esta FORA");
check(hullContains(hc, 1.1, 1.1, 1.1, 0.0) === 0 ? 1 : 0, "alem do canto esta FORA");
// A casca IGNORA vértices interiores: acrescentar o centro não muda nada. É o
// que garante que uma malha com miolo (um torus, um prédio com quartos) não
// engorde a casca.
const cuboMaisMiolo = mesh([
  0.0 - 1.0, 0.0 - 1.0, 0.0 - 1.0,   1.0, 0.0 - 1.0, 0.0 - 1.0,
  1.0, 1.0, 0.0 - 1.0,               0.0 - 1.0, 1.0, 0.0 - 1.0,
  0.0 - 1.0, 0.0 - 1.0, 1.0,         1.0, 0.0 - 1.0, 1.0,
  1.0, 1.0, 1.0,                     0.0 - 1.0, 1.0, 1.0,
  0.0, 0.0, 0.0,                     0.2, 0.1, 0.0 - 0.3,
]);
const hcm = hullFromMesh(cuboMaisMiolo, 8);
check(hcm.vertexCount() === 8 ? 1 : 0, "vertices INTERIORES sao descartados");
check(hcm.planeCount() === 6 ? 1 : 0, "e os planos seguem 6");

// ── CUBO COM VÉRTICES REPETIDOS (o caso do `buildFlat`) ────────────────────
io.print("== CUBO com cada canto repetido 3x (como buildFlat emite) ==");
const rep: f64[] = [];
let r = 0;
while (r < 3) {
  let c = 0;
  while (c < 8) {
    rep.push(((c & 1) !== 0 ? 1.0 : 0.0 - 1.0));
    rep.push(((c & 2) !== 0 ? 1.0 : 0.0 - 1.0));
    rep.push(((c & 4) !== 0 ? 1.0 : 0.0 - 1.0));
    c = c + 1;
  }
  r = r + 1;
}
const hr = hullFromMesh(mesh(rep), 8);
check(hr.ok, "casca valida apesar da repeticao");
check(hr.vertexCount() === 8 ? 1 : 0, "dedup: 24 entradas viram 8 vertices (era " + hr.vertexCount() + ")");

// ── ESFERA TESSELADA: a mesma que `gpu3d` monta (LAT 16 × LON 24) ──────────
io.print("== ESFERA tesselada raio 0.5 (LAT 16 x LON 24) ==");
const esf: f64[] = [];
const LAT = 16; const LON = 24; const PI = 3.14159265358979;
let ii = 0;
while (ii <= LAT) {
  const theta: f64 = PI * (ii / LAT);
  const st: f64 = Math.sin(theta); const ct: f64 = Math.cos(theta);
  let jj = 0;
  while (jj < LON) {
    const phi: f64 = 2.0 * PI * (jj / LON);
    esf.push(0.5 * st * Math.cos(phi)); esf.push(0.5 * ct); esf.push(0.5 * st * Math.sin(phi));
    jj = jj + 1;
  }
  ii = ii + 1;
}
const he = hullFromMesh(mesh(esf), 8);
check(he.ok, "a casca da esfera e valida");
check(he.planeCount() <= HULL_MAX_PLANES ? 1 : 0,
      "respeita o teto de " + HULL_MAX_PLANES + " planos (era " + he.planeCount() + ")");
check(he.simplified === 1 ? 1 : 0, "e marca que SIMPLIFICOU");
// O raio: o suporte em qualquer direção tem de ser >= 0.5 (contém a esfera) e,
// como a simplificação engorda, não muito mais. O teto superior é o raio do
// canto de um poliedro de 32 faces circunscrito — folga de ~15% é o esperado.
let piorMin: f64 = 99.0; let piorMax: f64 = 0.0;
let d = 0;
while (d < 26) {
  const a: f64 = d * 0.6;
  const nx = Math.sin(a) * Math.cos(a * 1.7);
  const ny = Math.cos(a);
  const nz = Math.sin(a) * Math.sin(a * 1.7);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const s = hullSupport(he, nx / l, ny / l, nz / l);
  if (s < piorMin) piorMin = s;
  if (s > piorMax) piorMax = s;
  d = d + 1;
}
io.print("  suporte medido em 26 direcoes: min=" + piorMin.toFixed(4) + " max=" + piorMax.toFixed(4));
check(piorMin > 0.49 ? 1 : 0, "o suporte nunca ENCOLHE abaixo do raio (min > 0.49)");
check(piorMax < 0.52 ? 1 : 0, "e nao engorda demais (max < 0.52)");
// QUANTO os 32 planos engordam, medido — e não deduzido do comentário que diz
// que engordam. `hullSupport` acima anda pelos VÉRTICES, então ele mede o casco
// exato e passaria mesmo se a simplificação estivesse errada. Aqui o raio sai da
// REGIÃO DOS PLANOS: para a direção n, o maior t com t·n dentro de todos eles.
function raioPelosPlanos(h: Hull, nx: f64, ny: f64, nz: f64): f64 {
  let t: f64 = 1e30;
  let i = 0;
  while (i < h.planeCount()) {
    const dot = h.pnx[i] * nx + h.pny[i] * ny + h.pnz[i] * nz;
    if (dot > 0.000001) {
      const lim = h.pd[i] / dot;
      if (lim < t) t = lim;
    }
    i = i + 1;
  }
  return t;
}
//
// NOTA sobre uma versão anterior deste teste, porque o erro é fácil de repetir:
// eu comparava `raioPelosPlanos(n)` com `hullSupport(n)` e exigia razão >= 1. A
// razão dava 0.9936 e parecia um furo na simplificação. Não era: SUPORTE é a
// distância ao plano de apoio PERPENDICULAR a n, e raio é a distância até a
// superfície AO LONGO de n. Para um poliedro os dois só coincidem quando n
// aponta para uma face de frente. A conta estava comparando coisas diferentes.
//
// A propriedade que realmente importa — a região dos planos CONTÉM o casco — é
// verificada logo abaixo, sobre os 408 vértices da malha, e é exata.
let raioMax: f64 = 0.0;
let raioMin: f64 = 99.0;
let dd = 0;
while (dd < 200) {
  const a: f64 = dd * 0.31;
  const b: f64 = dd * 0.97;
  const nx = Math.sin(a) * Math.cos(b);
  const ny = Math.cos(a);
  const nz = Math.sin(a) * Math.sin(b);
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const rp = raioPelosPlanos(he, nx / l, ny / l, nz / l);
  if (rp > raioMax) raioMax = rp;
  if (rp < raioMin) raioMin = rp;
  dd = dd + 1;
}
io.print("  raio da regiao dos 32 planos em 200 direcoes: min=" +
         raioMin.toFixed(4) + " max=" + raioMax.toFixed(4) + " (esfera real = 0.5)");
// A malha tesselada é INSCRITA na esfera de 0.5: entre dois vértices a
// superfície fica um pouco abaixo do raio. 0.49 é essa corda, não folga.
check(raioMin > 0.49 ? 1 : 0, "a regiao nunca corta abaixo da corda da malha (min > 0.49)");
check(raioMax < 0.65 ? 1 : 0, "e a folga radial fica abaixo de 30% (max=" + raioMax.toFixed(4) + ")");
check(hullContains(he, 0.0, 0.0, 0.0, 0.0), "o centro esta dentro");
check(hullContains(he, 0.0, 0.9, 0.0, 0.0) === 0 ? 1 : 0, "um ponto a 0.9 no eixo Y esta FORA");
// CONTENÇÃO: todo vértice da malha original tem de estar dentro da casca. É a
// propriedade que o colisor precisa — se um vértice ficasse de fora, aquela
// parte do modelo atravessaria.
let foraDaCasca = 0;
let vi = 0;
while (vi < esf.length) {
  if (hullContains(he, esf[vi], esf[vi + 1], esf[vi + 2], 0.0001) === 0) foraDaCasca = foraDaCasca + 1;
  vi = vi + 3;
}
check(foraDaCasca === 0 ? 1 : 0, "TODOS os " + ((esf.length / 3) | 0) + " vertices da malha estao contidos (fora=" + foraDaCasca + ")");

// ── DEGENERADOS: o caso que decide se o motor cai de pe ────────────────────
io.print("== DEGENERADOS ==");
const vazio = hullFromMesh([], 8);
check(vazio.ok === 0 ? 1 : 0, "malha vazia: nao e valida");
check(vazio.degenerateReason === 1 ? 1 : 0, "e o motivo e 'sem vertices'");

const umPonto = hullFromMesh(mesh([1.0, 2.0, 3.0]), 8);
check(umPonto.ok === 0 ? 1 : 0, "um vertice: nao e valida");
check(umPonto.degenerateReason === 2 ? 1 : 0, "motivo 'menos de 4 pontos'");
check(near(umPonto.minX, 1.0, 0.0001) !== 0 && near(umPonto.maxZ, 3.0, 0.0001) !== 0 ? 1 : 0,
      "mas o AABB fica preenchido (o fallback funciona)");
check(hullContains(umPonto, 1.0, 2.0, 3.0, 0.001), "e hullContains responde pelo AABB");

const linha = hullFromMesh(mesh([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0, 3.0, 0.0, 0.0]), 8);
check(linha.ok === 0 ? 1 : 0, "4 pontos COLINEARES: nao e valida");
check(linha.degenerateReason === 3 ? 1 : 0, "motivo 'colineares' (era " + linha.degenerateReason + ")");

const plano = hullFromMesh(mesh([
  0.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 1.0, 0.0,  0.0, 1.0, 0.0,  0.5, 0.5, 0.0,
]), 8);
check(plano.ok === 0 ? 1 : 0, "5 pontos COPLANARES: nao e valida");
check(plano.degenerateReason === 4 ? 1 : 0, "motivo 'coplanares' (era " + plano.degenerateReason + ")");
check(near(plano.maxX, 1.0, 0.0001), "e o AABB do plano esta certo");

// ── TETRAEDRO: o menor caso NÃO degenerado ─────────────────────────────────
io.print("== TETRAEDRO (o menor caso valido) ==");
const tet = hullFromMesh(mesh([
  0.0, 0.0, 0.0,  1.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 0.0, 1.0,
]), 8);
check(tet.ok, "4 pontos nao coplanares: valida");
check(tet.vertexCount() === 4 ? 1 : 0, "4 vertices");
check(tet.planeCount() === 4 ? 1 : 0, "4 planos (era " + tet.planeCount() + ")");
check(hullContains(tet, 0.1, 0.1, 0.1, 0.0), "ponto interior detectado dentro");
check(hullContains(tet, 0.5, 0.5, 0.5, 0.0) === 0 ? 1 : 0, "(0.5,0.5,0.5) esta FORA (a face inclinada)");
check(hullContains(tet, 0.0 - 0.1, 0.1, 0.1, 0.0) === 0 ? 1 : 0, "atras de uma face esta fora");

io.print("");
io.print("[resultado] " + ok + " ok, " + fail + " falhas");
if (fail === 0) io.print("[PASSOU]"); else io.print("[FALHOU]");

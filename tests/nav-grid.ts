import io from "@compat/io.ts";
import { NavGrid, NAV_PATH_STRIDE, NAV_RUNNING, NAV_FOUND, NAV_NO_PATH, navBegin, navStep, navFinish } from "@engine/core/nav_grid";

// Busca de caminho em grade. O motor tem rota por waypoint desenhado à mão
// (RoutePath), e isso cobre patrulha; não cobre "clique no chão e a unidade
// vai até lá desviando do que estiver no caminho", que é o verbo de um RTS.
//
// Este teste trava o contrato da camada PURA: sem cena, sem janela, sem
// relógio. O que vem da cena (quais células são bloqueadas) entra por fora.
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass = pass + 1; io.print("  ok   " + name); }
  else { fail = fail + 1; io.print("  FALHOU   " + name); }
}

/** Grade 10x10 de células de 1 unidade cobrindo (0,0)..(10,10). */
const GRID_BOUNDS = new Float64Array([0.0, 0.0, 10.0, 10.0]);
function emptyGrid(): NavGrid { return new NavGrid(GRID_BOUNDS, 1.0); }

const from = new Float64Array(2);
const to = new Float64Array(2);
const path = new Float64Array(256 * NAV_PATH_STRIDE);

function setPoint(p: Float64Array, x: f64, z: f64): void { p[0] = x; p[1] = z; }

// ── caminho reto numa grade vazia ─────────────────────────────────────────
{
  const g = emptyGrid();
  setPoint(from, 0.5, 0.5);
  setPoint(to, 5.5, 0.5);
  const n = g.findPath(from, to, path);
  ok("grade vazia: achou caminho", n > 0);
  // O último ponto é o destino, e a linha é reta: z não muda.
  ok("grade vazia: termina no destino", n > 0 && Math.abs(path[(n - 1) * NAV_PATH_STRIDE] - 5.5) < 0.001);
  let straight = true;
  let i = 0;
  while (i < n) { if (Math.abs(path[i * NAV_PATH_STRIDE + 1] - 0.5) > 0.001) straight = false; i = i + 1; }
  ok("grade vazia: linha reta sem desvio", straight);
}

// ── parede força o desvio ─────────────────────────────────────────────────
{
  const g = emptyGrid();
  // Parede vertical em x=5, de z=0 até z=7: sobra passagem em z=8,9.
  let z = 0;
  while (z <= 7) { g.block(5, z); z = z + 1; }
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 0.5);
  const n = g.findPath(from, to, path);
  ok("parede: achou caminho contornando", n > 0);
  // Nenhum ponto do caminho pode cair numa célula bloqueada.
  let insideWall = false;
  let i = 0;
  while (i < n) {
    const px = path[i * NAV_PATH_STRIDE];
    const pz = path[i * NAV_PATH_STRIDE + 1];
    if (g.isBlockedAt(px, pz)) insideWall = true;
    i = i + 1;
  }
  ok("parede: nenhum ponto dentro do obstáculo", !insideWall);
  // O desvio TEM de descer até a passagem.
  let maxZ = 0.0;
  i = 0;
  while (i < n) { const pz = path[i * NAV_PATH_STRIDE + 1]; if (pz > maxZ) maxZ = pz; i = i + 1; }
  ok("parede: o caminho desceu até a passagem (z max = " + maxZ.toFixed(1) + ")", maxZ >= 7.5);
}

// ── sem caminho ───────────────────────────────────────────────────────────
{
  const g = emptyGrid();
  let z = 0;
  while (z < 10) { g.block(5, z); z = z + 1; }   // parede inteira
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 0.5);
  ok("murado: devolve 0 em vez de um caminho torto", g.findPath(from, to, path) === 0);
}

// ── origem e destino degenerados ──────────────────────────────────────────
{
  const g = emptyGrid();
  setPoint(from, 3.5, 3.5);
  setPoint(to, 3.5, 3.5);
  const n = g.findPath(from, to, path);
  ok("origem = destino: um ponto só", n === 1);

  setPoint(to, 99.0, 99.0);
  ok("destino fora da grade: devolve 0", g.findPath(from, to, path) === 0);

  g.block(3, 3);
  setPoint(to, 6.5, 6.5);
  ok("origem bloqueada: devolve 0", g.findPath(from, to, path) === 0);

  const g2 = emptyGrid();
  g2.block(6, 6);
  setPoint(from, 3.5, 3.5);
  setPoint(to, 6.5, 6.5);
  ok("destino bloqueado: devolve 0", g2.findPath(from, to, path) === 0);
}

// ── diagonal não corta quina ──────────────────────────────────────────────
{
  // Duas células bloqueadas formando uma quina: ir de (0,1) para (1,0) na
  // diagonal passaria ENTRE elas, o que na prática é atravessar parede.
  const g = emptyGrid();
  g.block(1, 1);
  g.block(0, 0);
  setPoint(from, 0.5, 1.5);
  setPoint(to, 1.5, 0.5);
  const n = g.findPath(from, to, path);
  ok("quina: achou caminho", n > 0);
  // Se cortasse a quina, o caminho teria 2 pontos (origem e destino).
  ok("quina: contornou em vez de atravessar (" + n + " pontos)", n > 2);
}

// ── determinismo ──────────────────────────────────────────────────────────
{
  const g = emptyGrid();
  g.block(4, 4); g.block(4, 5); g.block(5, 4);
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 9.5);
  const a = new Float64Array(256 * NAV_PATH_STRIDE);
  const b = new Float64Array(256 * NAV_PATH_STRIDE);
  const na = g.findPath(from, to, a);
  const nb = g.findPath(from, to, b);
  ok("determinismo: mesmo número de pontos", na === nb && na > 0);
  let same = true;
  let i = 0;
  while (i < na * NAV_PATH_STRIDE) { if (a[i] !== b[i]) same = false; i = i + 1; }
  ok("determinismo: mesmos pontos na mesma ordem", same);
}

// ── o buffer de saída limita, e o limite é dito ───────────────────────────
{
  const g = emptyGrid();
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 9.5);
  const small = new Float64Array(3 * NAV_PATH_STRIDE);
  const n = g.findPath(from, to, small);
  ok("buffer pequeno: não escreve além do fim", n <= 3);
  ok("buffer pequeno: avisa que truncou", g.truncated);
}

// ── origem fora do centro da célula ───────────────────────────────────────
{
  const g = emptyGrid();
  setPoint(from, 0.1, 0.9);   // dentro da célula (0,0), longe do centro
  setPoint(to, 2.9, 2.1);
  const n = g.findPath(from, to, path);
  ok("ponto arbitrário dentro da célula: achou caminho", n > 0);
  ok("o último ponto é o destino pedido, não o centro da célula",
    n > 0 && Math.abs(path[(n - 1) * NAV_PATH_STRIDE] - 2.9) < 0.001 &&
    Math.abs(path[(n - 1) * NAV_PATH_STRIDE + 1] - 2.1) < 0.001);
}

// A área pedida define a grade, arredondando para cima.
{
  const g = new NavGrid(new Float64Array([0.0 - 5.0, 2.0, 5.5, 8.0]), 2.0);
  ok("bounds -> largura (" + g.width + ")", g.width === 6);   // 10,5 / 2 -> 6
  ok("bounds -> profundidade (" + g.depth + ")", g.depth === 3);
  ok("bounds -> origem", g.originX === 0.0 - 5.0 && g.originZ === 2.0);
}

// ── busca ORÇADA ──────────────────────────────────────────────────────────
// Uma busca completa numa grade 64x64 custa ~18 ms neste runtime, e isso não
// cabe num quadro. A saída não é micro-otimizar (medido: não rende) e sim
// gastar a busca em pedaços, como a carga de cena faz com `mountStep`.
//
// O que não pode mudar é o RESULTADO: orçada ou de uma vez, o caminho tem de
// ser o mesmo, senão o jogo fica dependendo da taxa de quadros.
{
  const g = new NavGrid(GRID_BOUNDS, 1.0);
  let z = 0;
  while (z <= 7) { g.block(5, z); z = z + 1; }
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 0.5);

  const oneShot = new Float64Array(256 * NAV_PATH_STRIDE);
  const nOne = g.findPath(from, to, oneShot);
  ok("orçada: a busca de referência achou caminho", nOne > 0);

  ok("orçada: começa pronta para rodar", navBegin(g, from, to) === NAV_RUNNING);
  let steps = 0;
  let state = NAV_RUNNING;
  while (state === NAV_RUNNING && steps < 10000) { state = navStep(g, 3); steps = steps + 1; }
  ok("orçada: terminou achando (" + steps + " passos de 3 expansões)", state === NAV_FOUND);
  ok("orçada: precisou de mais de um passo", steps > 1);

  const budgeted = new Float64Array(256 * NAV_PATH_STRIDE);
  const nBud = navFinish(g, budgeted);
  ok("orçada: mesmo número de pontos (" + nOne + " vs " + nBud + ")", nOne === nBud);
  let same = true;
  let i = 0;
  while (i < nOne * NAV_PATH_STRIDE) { if (oneShot[i] !== budgeted[i]) same = false; i = i + 1; }
  ok("orçada: exatamente o mesmo caminho da busca de uma vez", same);
}

// Sem caminho, orçada, também termina — e diz que não há.
{
  const g = new NavGrid(GRID_BOUNDS, 1.0);
  let z = 0;
  while (z < 10) { g.block(5, z); z = z + 1; }
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 0.5);
  navBegin(g, from, to);
  let state = NAV_RUNNING;
  let steps = 0;
  while (state === NAV_RUNNING && steps < 10000) { state = navStep(g, 2); steps = steps + 1; }
  ok("orçada sem caminho: termina dizendo que não há", state === NAV_NO_PATH);
  ok("orçada sem caminho: finish devolve 0", navFinish(g, path) === 0);
}

// Origem = destino resolve no começo, sem gastar passo.
{
  const g = new NavGrid(GRID_BOUNDS, 1.0);
  setPoint(from, 4.25, 4.75);
  setPoint(to, 4.25, 4.75);
  ok("orçada: origem = destino já começa achada", navBegin(g, from, to) === NAV_FOUND);
  const n = navFinish(g, path);
  ok("orçada: origem = destino devolve o ponto pedido",
    n === 1 && path[0] === 4.25 && path[1] === 4.75);
}

// Mexer na grade no meio de uma busca invalida o que já foi explorado.
{
  const g = new NavGrid(GRID_BOUNDS, 1.0);
  setPoint(from, 0.5, 0.5);
  setPoint(to, 9.5, 9.5);
  navBegin(g, from, to);
  navStep(g, 5);
  g.block(5, 5);
  ok("grade alterada no meio: a busca é abortada em vez de dar caminho velho",
    navStep(g, 5) === NAV_NO_PATH && navFinish(g, path) === 0);
}

io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

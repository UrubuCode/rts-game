// Busca de caminho em grade sobre o plano XZ.
//
// O motor já tinha rota por waypoint desenhado à mão (`RoutePath`), que cobre
// patrulha. Não cobria "clique no chão e a unidade vai até lá desviando do que
// estiver no caminho", que é o verbo de um RTS e o que todo agente que se move
// fora de trilho precisa.
//
// Esta camada é PURA: sem cena, sem janela, sem relógio. Quais células estão
// bloqueadas entra por fora (`block`/`clear`), e quem constrói isso a partir
// dos colisores da cena é outro módulo. Separar assim é o que torna a busca
// testável sem abrir janela e determinística por construção — mesma grade e
// mesmos pontos dão sempre o mesmo caminho, que é exigência do motor.
//
// Sem alocação por chamada: as tabelas de custo e a fila nascem com a grade e
// são reaproveitadas. A invalidação entre buscas é por CARIMBO, não por
// limpeza — zerar três tabelas do tamanho da grade a cada busca custaria mais
// que a busca numa grade grande. Medido: 3000 buscas, 0 coletas.
//
// ── QUANTO CUSTA, E O QUE ISSO IMPLICA ────────────────────────────────────
//
// Medido no binário de release, grade 64x64 (4096 células) com duas paredes,
// canto a canto — o pior caso, que expande quase tudo:
//
//   busca completa .................... 17,7 ms
//
// Isso NÃO dá para fazer por agente por quadro. E o teto não é do algoritmo:
// o piso deste runtime, medido no mesmo binário, é
//
//   laço trivial sobre 4096 células ....  0,31 ms  (75 ns por célula)
//   laço de 8 vizinhos sobre 4096 ......  3,64 ms
//
// ou seja, só visitar a grade inteira olhando os vizinhos já custa 3,6 ms, e
// o A* completo é ~5x isso. Passar a busca de método para função livre rendeu
// 26,7 -> 17,7 ms (-34%). Depois disso, MEDIDO e sem efeito nenhum: trocar os
// vetores de vizinhança por Int32Array e abrir a heurística e o `touchCell`
// dentro do laço deram 17,69 ms contra 17,66 ms. O que sobra é interpretação
// de cada instrução, não tipo de acesso nem despacho — micro-otimizar aqui é
// caminho fechado.
//
// A SAÍDA, então, é não pagar tudo de uma vez: `navBegin` + `navStep` gastam
// a busca em pedaços, como a carga de cena faz com `mountStep`. O orçamento
// só decide ONDE parar, nunca o que expandir primeiro, então o caminho sai
// idêntico ao da busca de uma vez — há teste para isso.
//
// Medido no mesmo caso de 64x64, canto a canto (2930 células expandidas):
//
//   de uma vez ......................... 18,3 ms, 1 quadro travado
//   orçado em 50 expansões por passo ... 59 passos, pior passo 0,66 ms
//   orçado em 200 ...................... 15 passos, pior passo ~1,9 ms
//
// O total não muda (17,6 a 18,6 ms somando os passos): orçar não é mais
// barato, é parcelado. E nenhum dos dois caminhos aloca — 0 coletas.
//
// O custo também escala com o NÚMERO DE CÉLULAS, então somam-se a isso:
//
//   1. grade grossa: 32x32 custa ~1/4 de 64x64;
//   2. um caminho por GRUPO em vez de um por unidade;
//   3. e, quando nada disso bastar, kernel nativo — foi o caminho das
//      partículas (`rts:particles`), que saíram de ~26 ms para ~0,1 ms.
//
// Nada disso muda a camada: ela continua sendo a busca correta, pura e
// determinística. É escolha de quem a usa.

/** Cada ponto do caminho ocupa duas casas do buffer de saída: x e z. */
export const NAV_PATH_STRIDE: number = 2;

/** Estados de uma busca orçada. */
export const NAV_RUNNING: number = 0;
export const NAV_FOUND: number = 1;
export const NAV_NO_PATH: number = 2;

/** Custo de um passo reto e de um passo na diagonal, em milésimos. */
const STEP_STRAIGHT: number = 1000;
const STEP_DIAGONAL: number = 1414;

/**
 * Oito vizinhos: os quatro retos primeiro, para empate preferir reto.
 *
 * `Int32Array` e não `number[]`: isto é lido 8 vezes por célula expandida, e
 * num array comum cada acesso passa pelo caminho genérico de propriedade.
 */
const NEIGHBOR_DX: Int32Array = new Int32Array([1, 0 - 1, 0, 0, 1, 1, 0 - 1, 0 - 1]);
const NEIGHBOR_DZ: Int32Array = new Int32Array([0, 0, 1, 0 - 1, 1, 0 - 1, 1, 0 - 1]);

export class NavGrid {
  /** Canto da célula (0,0) no mundo. */
  originX: f64;
  originZ: f64;
  cellSize: f64;
  width: number;
  depth: number;
  /** 1 = intransponível. */
  blocked: Uint8Array;
  /** O último caminho não coube no buffer de saída de quem chamou. */
  truncated: boolean = false;

  // Estado da busca, reaproveitado entre chamadas. Público porque quem lê é
  // `navFindPath`, que é função livre de propósito (ver `findPath`).
  gScore: Float64Array;
  fScore: Float64Array;
  cameFrom: Int32Array;
  /** Carimbo da busca em que a célula foi tocada; dispensa limpar as tabelas. */
  seen: Int32Array;
  closed: Uint8Array;
  search: number = 0;
  /** Fila de abertos: índices de célula, mantida como heap binário. */
  open: Int32Array;
  /** Posição de cada célula dentro do heap, -1 = fora. */
  heapAt: Int32Array;
  /** Caminho montado de trás para frente antes de sair na ordem certa. */
  reverse: Int32Array;

  // ── busca em andamento (orçada) ─────────────────────────────────────────
  // Uma busca pode durar vários quadros, então o que ela precisa lembrar mora
  // aqui e não em locais de uma função.
  state: number = NAV_NO_PATH;
  openCount: number = 0;
  startCell: number = 0 - 1;
  goalCell: number = 0 - 1;
  goalX: number = 0;
  goalZ: number = 0;
  /** Destino exato pedido, que é o último ponto do caminho. */
  goalWorldX: f64 = 0.0;
  goalWorldZ: f64 = 0.0;
  /**
   * Sobe a cada `block`/`clear`. Uma busca em andamento guarda o valor que
   * viu ao começar: se a grade mudar no meio, o que já foi explorado vale
   * para um mundo que não existe mais, e continuar daria um caminho que
   * atravessa o obstáculo novo. Abortar e refazer é o certo e é barato.
   */
  version: number = 0;
  searchVersion: number = 0;

  /**
   * `bounds` = [minX, minZ, maxX, maxZ] no mundo. A grade cobre essa área
   * inteira, arredondando para cima — pedir a ÁREA em vez da contagem de
   * células é como quem usa pensa ("a navegação vai deste canto àquele"), e
   * evita o erro de calcular largura e profundidade fora e errar por um.
   */
  constructor(bounds: Float64Array, cellSize: f64) {
    if (!(cellSize > 0.0)) throw new Error("NavGrid: cellSize precisa ser > 0");
    if (bounds.length < 4) throw new Error("NavGrid: bounds precisa de [minX, minZ, maxX, maxZ]");
    const spanX = bounds[2] - bounds[0];
    const spanZ = bounds[3] - bounds[1];
    if (!(spanX > 0.0) || !(spanZ > 0.0)) throw new Error("NavGrid: bounds precisa de area positiva");
    const width = Math.max(1, Math.ceil(spanX / cellSize)) | 0;
    const depth = Math.max(1, Math.ceil(spanZ / cellSize)) | 0;
    this.originX = bounds[0]; this.originZ = bounds[1]; this.cellSize = cellSize;
    this.width = width; this.depth = depth;
    const n = width * depth;
    this.blocked = new Uint8Array(n);
    this.gScore = new Float64Array(n);
    this.fScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.closed = new Uint8Array(n);
    this.open = new Int32Array(n);
    this.heapAt = new Int32Array(n);
    this.reverse = new Int32Array(n);
  }

  /** Índice linear da célula, ou -1 fora da grade. */
  cellIndex(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.depth) return 0 - 1;
    return cz * this.width + cx;
  }
  cellX(x: f64): number { return Math.floor((x - this.originX) / this.cellSize) | 0; }
  cellZ(z: f64): number { return Math.floor((z - this.originZ) / this.cellSize) | 0; }
  /** Centro da célula no mundo. */
  centerX(cx: number): f64 { return this.originX + (cx + 0.5) * this.cellSize; }
  centerZ(cz: number): f64 { return this.originZ + (cz + 0.5) * this.cellSize; }

  block(cx: number, cz: number): void {
    const i = this.cellIndex(cx, cz);
    if (i >= 0 && this.blocked[i] !== 1) { this.blocked[i] = 1; this.version = this.version + 1; }
  }
  clear(cx: number, cz: number): void {
    const i = this.cellIndex(cx, cz);
    if (i >= 0 && this.blocked[i] !== 0) { this.blocked[i] = 0; this.version = this.version + 1; }
  }
  clearAll(): void { this.blocked.fill(0); this.version = this.version + 1; }

  /** Fora da grade conta como bloqueado: ninguém anda onde não há dado. */
  isBlockedAt(x: f64, z: f64): boolean {
    const i = this.cellIndex(this.cellX(x), this.cellZ(z));
    return i < 0 || this.blocked[i] !== 0;
  }

  /** Primeira vez que a célula aparece NESTA busca: zera o que ela guardava. */
  touchCell(cell: number, stamp: number): void {
    this.seen[cell] = stamp;
    this.gScore[cell] = 0.0;
    this.fScore[cell] = 0.0;
    this.cameFrom[cell] = 0 - 1;
    this.closed[cell] = 0;
    this.heapAt[cell] = 0 - 1;
  }

  /**
   * Caminho de `from` para `to`, escrito em `out` como pares (x,z).
   *
   * Devolve quantos pontos foram escritos; 0 = não há caminho. O último ponto
   * é o destino PEDIDO, não o centro da célula dele — senão a unidade pararia
   * a até meia célula de onde se clicou.
   *
   * `out` cheio não é erro: escreve o que cabe, marca `truncated` e quem chama
   * pede de novo a partir do último ponto. Travar a busca por causa do buffer
   * seria pior que um caminho parcial.
   *
   * O trabalho mora em `navFindPath`, que é função LIVRE. Dentro de um método
   * deste runtime cada `this.x` é leitura dinâmica de propriedade; o motor já
   * mediu 3,3x nesse mesmo padrão (ver `computeWorldInto` em scene.ts).
   */
  findPath(from: Float64Array, to: Float64Array, out: Float64Array): number {
    return navFindPath(this, from, to, out);
  }
}

/** Octile: o custo exato de andar em grade de 8 direções sem obstáculo. */
function navHeuristic(dx: number, dz: number): f64 {
  const ax = dx < 0 ? 0 - dx : dx;
  const az = dz < 0 ? 0 - dz : dz;
  const lo = ax < az ? ax : az;
  const hi = ax < az ? az : ax;
  return STEP_DIAGONAL * lo + STEP_STRAIGHT * (hi - lo);
}

/**
 * A busca propriamente dita.
 *
 * Tudo que o laço toca sai do objeto UMA vez, em locais: dentro do laço,
 * `grid.blocked[i]` seria uma leitura dinâmica de propriedade por acesso. O
 * heap binário está aberto aqui dentro pelo mesmo motivo — como métodos,
 * empurrar e tirar eram três despachos por célula expandida.
 */
export function navFindPath(grid: NavGrid, from: Float64Array, to: Float64Array, out: Float64Array): number {
  const begun = navBegin(grid, from, to);
  if (begun === NAV_NO_PATH) return 0;
  // 0 = sem teto: a chamada de uma vez roda ate acabar.
  if (begun === NAV_RUNNING && navStep(grid, 0) !== NAV_FOUND) return 0;
  return navFinish(grid, out);
}

/**
 * Prepara uma busca. Devolve NAV_FOUND quando origem e destino caem na mesma
 * celula (nada a procurar), NAV_NO_PATH quando nem vale comecar (fora da
 * grade ou em cima de obstaculo), e NAV_RUNNING quando ha o que expandir.
 */
export function navBegin(grid: NavGrid, from: Float64Array, to: Float64Array): number {
  grid.truncated = false;
  grid.openCount = 0;
  grid.startCell = 0 - 1;
  grid.goalCell = 0 - 1;
  grid.searchVersion = grid.version;
  const width = grid.width;
  const depth = grid.depth;
  const startX = grid.cellX(from[0]);
  const startZ = grid.cellZ(from[1]);
  const goalX = grid.cellX(to[0]);
  const goalZ = grid.cellZ(to[1]);
  if (startX < 0 || startZ < 0 || startX >= width || startZ >= depth) { grid.state = NAV_NO_PATH; return NAV_NO_PATH; }
  if (goalX < 0 || goalZ < 0 || goalX >= width || goalZ >= depth) { grid.state = NAV_NO_PATH; return NAV_NO_PATH; }
  const start = startZ * width + startX;
  const goal = goalZ * width + goalX;
  if (grid.blocked[start] !== 0 || grid.blocked[goal] !== 0) { grid.state = NAV_NO_PATH; return NAV_NO_PATH; }

  grid.startCell = start;
  grid.goalCell = goal;
  grid.goalX = goalX;
  grid.goalZ = goalZ;
  grid.goalWorldX = to[0];
  grid.goalWorldZ = to[1];
  if (start === goal) { grid.state = NAV_FOUND; return NAV_FOUND; }

  grid.search = grid.search + 1;
  grid.touchCell(start, grid.search);
  grid.gScore[start] = 0.0;
  grid.fScore[start] = navHeuristic(startX - goalX, startZ - goalZ);
  grid.open[0] = start;
  grid.heapAt[start] = 0;
  grid.openCount = 1;
  grid.state = NAV_RUNNING;
  return NAV_RUNNING;
}

/**
 * Expande no maximo `maxExpansions` celulas; 0 = sem teto.
 *
 * Devolve NAV_RUNNING (ainda ha o que fazer), NAV_FOUND ou NAV_NO_PATH. E por
 * aqui que um agente paga a busca ao longo de varios quadros em vez de travar
 * um: o resultado e identico ao da busca de uma vez, porque o orcamento so
 * decide ONDE parar, nunca o que expandir primeiro.
 *
 * Tudo que o laco toca sai do objeto UMA vez, em locais: dentro do laco,
 * `grid.blocked[i]` seria leitura dinamica de propriedade por acesso. O heap
 * binario esta aberto aqui dentro pelo mesmo motivo.
 */
export function navStep(grid: NavGrid, maxExpansions: number): number {
  if (grid.state !== NAV_RUNNING) return grid.state;
  // A grade mudou desde que esta busca comecou: o que ja foi explorado vale
  // para um mundo que nao existe mais.
  if (grid.searchVersion !== grid.version) { grid.state = NAV_NO_PATH; grid.openCount = 0; return NAV_NO_PATH; }

  const width = grid.width;
  const depth = grid.depth;
  const blocked = grid.blocked;
  const gScore = grid.gScore;
  const fScore = grid.fScore;
  const cameFrom = grid.cameFrom;
  const seen = grid.seen;
  const closed = grid.closed;
  const open = grid.open;
  const heapAt = grid.heapAt;
  const goal = grid.goalCell;
  const goalX = grid.goalX;
  const goalZ = grid.goalZ;
  const stamp = grid.search;
  const unlimited = maxExpansions <= 0;
  let budget = maxExpansions;
  let openCount = grid.openCount;

  while (openCount > 0) {
    if (!unlimited && budget <= 0) break;
    budget = budget - 1;
    // -- tira o menor --
    const current = open[0];
    openCount = openCount - 1;
    heapAt[current] = 0 - 1;
    if (openCount > 0) {
      const moved = open[openCount];
      open[0] = moved; heapAt[moved] = 0;
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= openCount) break;
        let best = left;
        const right = left + 1;
        if (right < openCount) {
          const fl = fScore[open[left]];
          const fr = fScore[open[right]];
          if (fr < fl || (fr === fl && open[right] < open[left])) best = right;
        }
        const fi = fScore[open[i]];
        const fb = fScore[open[best]];
        if (!(fb < fi || (fb === fi && open[best] < open[i]))) break;
        const a = open[i]; const b = open[best];
        open[i] = b; open[best] = a; heapAt[b] = i; heapAt[a] = best;
        i = best;
      }
    }
    if (current === goal) { grid.openCount = openCount; grid.state = NAV_FOUND; return NAV_FOUND; }
    closed[current] = 1;

    const cx = current % width;
    const cz = (current / width) | 0;
    const gCur = gScore[current];
    let k = 0;
    while (k < 8) {
      const nx = cx + NEIGHBOR_DX[k];
      const nz = cz + NEIGHBOR_DZ[k];
      k = k + 1;
      if (nx < 0 || nz < 0 || nx >= width || nz >= depth) continue;
      const next = nz * width + nx;
      if (blocked[next] !== 0) continue;
      const diagonal = nx !== cx && nz !== cz;
      // Diagonal so passa se os DOIS lados da quina estiverem livres. Sem
      // isto a unidade atravessa o encontro de duas paredes.
      if (diagonal && (blocked[cz * width + nx] !== 0 || blocked[nz * width + cx] !== 0)) continue;
      // "Nunca vista nesta busca" tem de ser perguntado ANTES de inicializar:
      // `touchCell` zera o gScore, e comparar com esse zero faria toda celula
      // nova parecer que ja tem um caminho melhor.
      const first = seen[next] !== stamp;
      if (first) grid.touchCell(next, stamp);
      if (closed[next] !== 0) continue;
      const tentative = gCur + (diagonal ? STEP_DIAGONAL : STEP_STRAIGHT);
      if (!first && tentative >= gScore[next]) continue;
      cameFrom[next] = current;
      gScore[next] = tentative;
      fScore[next] = tentative + navHeuristic(nx - goalX, nz - goalZ);
      // -- poe no heap, ou sobe o que ja estava la --
      let at = heapAt[next];
      if (at < 0) { at = openCount; open[at] = next; heapAt[next] = at; openCount = openCount + 1; }
      while (at > 0) {
        const parent = ((at - 1) / 2) | 0;
        const fa = fScore[open[at]];
        const fp = fScore[open[parent]];
        if (!(fa < fp || (fa === fp && open[at] < open[parent]))) break;
        const a = open[at]; const b = open[parent];
        open[at] = b; open[parent] = a; heapAt[b] = at; heapAt[a] = parent;
        at = parent;
      }
    }
  }
  grid.openCount = openCount;
  if (openCount === 0) { grid.state = NAV_NO_PATH; return NAV_NO_PATH; }
  return NAV_RUNNING;
}

/**
 * Escreve em `out` o caminho da busca que terminou achando; 0 caso contrario.
 *
 * `out` cheio nao e erro: escreve o que cabe, marca `truncated` e quem chama
 * pede o resto a partir do ultimo ponto. Travar por causa do buffer seria
 * pior que um caminho parcial.
 */
export function navFinish(grid: NavGrid, out: Float64Array): number {
  grid.truncated = false;
  if (grid.state !== NAV_FOUND) return 0;
  const capacity = (out.length / NAV_PATH_STRIDE) | 0;
  if (capacity < 1) { grid.truncated = true; return 0; }
  const start = grid.startCell;
  const goal = grid.goalCell;
  if (start === goal) { out[0] = grid.goalWorldX; out[1] = grid.goalWorldZ; return 1; }

  const width = grid.width;
  const cameFrom = grid.cameFrom;
  const reverse = grid.reverse;
  // Desenrola de tras para frente e depois inverte: a lista sai na ordem de
  // andar, que e como quem segue o caminho quer ler.
  let count = 0;
  let node = goal;
  while (node !== start) { reverse[count] = node; count = count + 1; node = cameFrom[node]; }

  const ox = grid.originX;
  const oz = grid.originZ;
  const cell = grid.cellSize;
  let written = 0;
  let i = count - 1;
  while (i >= 0 && written < capacity) {
    const c = reverse[i];
    out[written * NAV_PATH_STRIDE] = ox + (c % width + 0.5) * cell;
    out[written * NAV_PATH_STRIDE + 1] = oz + (((c / width) | 0) + 0.5) * cell;
    written = written + 1;
    i = i - 1;
  }
  if (i >= 0) { grid.truncated = true; return written; }
  // O ponto final e o destino pedido, nao o centro da celula.
  out[(written - 1) * NAV_PATH_STRIDE] = grid.goalWorldX;
  out[(written - 1) * NAV_PATH_STRIDE + 1] = grid.goalWorldZ;
  return written;
}

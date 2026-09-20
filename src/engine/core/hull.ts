// CASCA CONVEXA (convex hull) de uma malha — a geometria do colisor.
//
// Hoje o colisor sai da ESCALA do transform: um `.obj` carregado colide como a
// caixa da escala dele, que não tem relação com a forma. Isto gera a forma real,
// convexificada.
//
// ── POR QUE CASCA E NÃO A MALHA EXATA ──────────────────────────────────────
// Colisão triângulo-a-triângulo entre corpos DINÂMICOS é proibitiva e mal
// definida: duas malhas côncavas em contato não têm uma normal de contato única,
// então o solver oscila entre respostas. É por isso que a Unity recusa um
// `MeshCollider` côncavo com `Rigidbody` (exige `convex = true`) e o PhysX usa
// casca para dinâmicos. A casca é a mesma escolha, pelo mesmo motivo.
//
// ── POR QUE ESTE ALGORITMO ─────────────────────────────────────────────────
// Casco INCREMENTAL exato (a família do quickhull: mesma construção, sem a
// contabilidade dos conjuntos externos). Escolhido contra a alternativa que
// estava na mesa, o k-DOP de 14 planos, por uma razão que não é elegância:
//
//   **um k-DOP dá os PLANOS mas não dá os VÉRTICES.** O teste SAT precisa dos
//   dois — os planos são os eixos candidatos, e a projeção em cada eixo é feita
//   sobre os vértices. Tirar os vértices de um k-DOP significa interseccionar
//   ternos de planos e descartar os que caem fora dos demais, que é mais
//   trabalho e mais casos degenerados do que o casco inteiro. O casco entrega os
//   dois de uma vez, porque é assim que ele é construído.
//
// O segundo motivo é aderência: o k-DOP mede a malha em 14 direções FIXAS, então
// uma peça diagonal fica dentro de uma caixa folgada — e folga no colisor é
// exatamente o "atravessa" e o "para no ar" que esta fase existe para corrigir.
//
// O custo do casco exato seria o argumento contra, e aqui ele não existe: as
// malhas do projeto têm 36 (cubo), 288 (torus) e 408 (esfera) vértices, e a
// geração acontece UMA vez por malha no carregamento. Medido em
// `tools/claude-test-hull.ts`.
//
// ── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
// Não testa colisão. Ele produz a geometria que a Fase 2 (SAT no CPU e no
// kernel) vai consumir. `hullContains` existe para os testes e para consultas
// pontuais, não é o caminho de colisão par-a-par.

/// Teto de planos por casca. 32 é o número que engines usam (PhysX trunca por
/// aí), e o motivo é o SAT: cada plano é um eixo candidato, e o custo do teste
/// é linear neles. Uma esfera tesselada tem ~800 faces — sem teto, um único
/// colisor esférico custaria mais que a cena inteira.
export const HULL_MAX_PLANES = 32;

/// Tolerância de "está no plano". Absoluta, e é uma escolha: as malhas deste
/// projeto vivem em coordenadas de ordem 1 (a esfera tem raio 0.5), então um
/// épsilon relativo ao tamanho da malha não compraria nada e esconderia o caso
/// em que a malha vem numa escala absurda — que é melhor falhar visivelmente.
const EPS: f64 = 0.000001;

/// A casca convexa de uma malha, em coordenadas LOCAIS da malha.
///
/// Os planos estão na forma `n·x <= d` com `n` unitário e apontando para FORA,
/// que é a convenção que o SAT espera: `d` é a projeção máxima do corpo no eixo
/// `n`, então o teste de um eixo é uma comparação de intervalos sem conversão.
export class Hull {
  /// 1 = casca utilizável. 0 = a malha é degenerada (vazia, um ponto, uma
  /// linha, ou toda coplanar) e o chamador deve usar o AABB, que vem preenchido
  /// mesmo assim. Ver `degenerateReason`.
  ok: number;
  /// Por que degenerou, para o chamador poder DIZER em vez de só cair: 0 = não
  /// degenerou, 1 = sem vértices, 2 = menos de 4 pontos distintos, 3 = todos
  /// colineares, 4 = todos coplanares.
  degenerateReason: number;

  /// Vértices da casca (subconjunto exato dos da malha, sem repetição).
  vx: f64[]; vy: f64[]; vz: f64[];
  /// Planos `n·x <= d`, normais unitárias apontando para fora.
  pnx: f64[]; pny: f64[]; pnz: f64[]; pd: f64[];

  /// AABB local. Sempre preenchido — inclusive no caso degenerado, que é o que
  /// torna o fallback possível sem um segundo passe sobre a malha.
  minX: f64; minY: f64; minZ: f64;
  maxX: f64; maxY: f64; maxZ: f64;

  /// 1 = a malha pedia mais de HULL_MAX_PLANES e os planos foram reduzidos.
  /// A redução é CONSERVADORA (ver `simplifyPlanes`): a região descrita cresce,
  /// nunca encolhe. O chamador que quiser precisão exata precisa saber disso, e
  /// é por isso que a flag existe em vez de a simplificação ser silenciosa.
  simplified: number;

  constructor() {
    this.ok = 0;
    this.degenerateReason = 1;
    this.vx = []; this.vy = []; this.vz = [];
    this.pnx = []; this.pny = []; this.pnz = []; this.pd = [];
    this.minX = 0.0; this.minY = 0.0; this.minZ = 0.0;
    this.maxX = 0.0; this.maxY = 0.0; this.maxZ = 0.0;
    this.simplified = 0;
  }

  planeCount(): number { return this.pd.length; }
  vertexCount(): number { return this.vx.length; }
}

// ── as faces em construção ────────────────────────────────────────────────
//
// Arrays paralelos e não uma classe por face pelo mesmo motivo que `scene.ts`
// mantém `trs` paralelo a `objects`: o laço quente aqui percorre TODAS as faces
// por ponto inserido, e um objeto por face poria uma alocação e um acesso
// dinâmico de propriedade em cada volta.
//
// E eles são LOCAIS passados por PARÂMETRO, não variáveis de módulo. Isto foi
// medido, não presumido, e é a terceira vez que o mesmo custo aparece neste
// repositório: uma leitura de escopo de módulo dentro de um laço quente não é um
// imediato, é uma leitura. Com os arrays no módulo a esfera de 408 vértices
// levava 295 ms; passados por parâmetro, ver `tools/claude-bench-hull.ts`.
// (Os outros dois: `CGRID_MASK` em `scene.ts` e o frustum em `scenedraw.ts`.)

/// Acrescenta a face a,b,c com a normal apontando para LONGE de `inx,iny,inz`
/// (um ponto sabidamente interior) e devolve o novo número de faces.
///
/// Orientar pela referência interior, em vez de confiar no winding da malha, é o
/// que faz isto funcionar com `.obj` de origem duvidosa — e o winding não é
/// confiável nem no `loadObj` daqui, que aceita índices negativos e n-gons.
function addFaceInto(px: f64[], py: f64[], pz: f64[],
                     fa: number[], fb: number[], fc: number[],
                     fnx: f64[], fny: f64[], fnz: f64[], fd: f64[], fn: number,
                     a: number, b: number, c: number,
                     inx: f64, iny: f64, inz: f64): number {
  const ux = px[b] - px[a]; const uy = py[b] - py[a]; const uz = pz[b] - pz[a];
  const vx = px[c] - px[a]; const vy = py[c] - py[a]; const vz = pz[c] - pz[a];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < EPS) return fn;   // triângulo degenerado: não vira face
  nx = nx / len; ny = ny / len; nz = nz / len;
  let d = nx * px[a] + ny * py[a] + nz * pz[a];
  // se a normal aponta para dentro, inverte ELA e o winding junto, senão os
  // dois passam a discordar
  let va = a; let vb = b; let vc = c;
  if (nx * inx + ny * iny + nz * inz > d) {
    nx = 0.0 - nx; ny = 0.0 - ny; nz = 0.0 - nz; d = 0.0 - d;
    vb = c; vc = b;
  }
  // Escreve na POSIÇÃO fn, crescendo o array só quando ele é curto: as faces
  // removidas deixam espaço reutilizável (a remoção é por troca com a última),
  // então empurrar sempre faria o array crescer com o total histórico.
  if (fn < fd.length) {
    fa[fn] = va; fb[fn] = vb; fc[fn] = vc;
    fnx[fn] = nx; fny[fn] = ny; fnz[fn] = nz; fd[fn] = d;
  } else {
    fa.push(va); fb.push(vb); fc.push(vc);
    fnx.push(nx); fny.push(ny); fnz.push(nz); fd.push(d);
  }
  return fn + 1;
}

/// O crescimento incremental inteiro, como FUNÇÃO LIVRE de parâmetros tipados.
///
/// Para cada ponto: as faces que o VEEM saem, e o buraco que elas deixam (o
/// horizonte) é costurado até ele. O horizonte é o conjunto de arestas que
/// pertencem a exatamente UMA face visível — uma aresta entre duas faces
/// visíveis é interna ao buraco e não faz borda.
///
/// Devolve o número final de faces.
function growHull(px: f64[], py: f64[], pz: f64[], n: number,
                  fa: number[], fb: number[], fc: number[],
                  fnx: f64[], fny: f64[], fnz: f64[], fd: f64[], fn0: number,
                  ba: number[], bb: number[], eh: number[], en: number[],
                  usados: number[], inx: f64, iny: f64, inz: f64): number {
  let fn = fn0;
  let pi = 0;
  while (pi < n) {
    if (usados[pi] !== 0) { pi = pi + 1; continue; }
    const x: f64 = px[pi]; const y: f64 = py[pi]; const z: f64 = pz[pi];

    // Quais faces veem o ponto, e as arestas delas, num passe só.
    let ne = 0;
    let nvis = 0;
    let f = fn - 1;
    while (f >= 0) {
      if (fnx[f] * x + fny[f] * y + fnz[f] * z - fd[f] > EPS) {
        if (ne + 3 > ba.length) {
          ba.push(0); ba.push(0); ba.push(0);
          bb.push(0); bb.push(0); bb.push(0);
        }
        ba[ne] = fa[f]; bb[ne] = fb[f];
        ba[ne + 1] = fb[f]; bb[ne + 1] = fc[f];
        ba[ne + 2] = fc[f]; bb[ne + 2] = fa[f];
        ne = ne + 3;
        nvis = nvis + 1;
        // Remoção por TROCA com a última face — por isso o laço anda de trás
        // para frente: a face que vem para cá já foi examinada.
        const last = fn - 1;
        if (f !== last) {
          fa[f] = fa[last]; fb[f] = fb[last]; fc[f] = fc[last];
          fnx[f] = fnx[last]; fny[f] = fny[last]; fnz[f] = fnz[last]; fd[f] = fd[last];
        }
        fn = fn - 1;
      }
      f = f - 1;
    }
    // ponto dentro do casco atual: não acrescenta nada
    if (nvis === 0) { pi = pi + 1; continue; }

    // Uma aresta é de HORIZONTE quando o par oposto (b,a) não aparece em outra
    // face visível — as internas ao buraco aparecem duas vezes, uma por sentido.
    // A busca é indexada pelo vértice de ORIGEM (`eh`/`en`, lista encadeada em
    // arrays), então cada aresta só olha as que saem do seu destino.
    let e = 0;
    while (e < ne) {
      const a = ba[e];
      while (eh.length <= a) eh.push(0 - 1);
      while (en.length <= e) en.push(0 - 1);
      en[e] = eh[a];
      eh[a] = e;
      e = e + 1;
    }
    e = 0;
    while (e < ne) {
      const a = ba[e]; const b = bb[e];
      let interna = 0;
      let g = b < eh.length ? eh[b] : 0 - 1;
      while (g >= 0) {
        if (bb[g] === a) { interna = 1; g = 0 - 1; }
        else g = en[g];
      }
      if (interna === 0) {
        fn = addFaceInto(px, py, pz, fa, fb, fc, fnx, fny, fnz, fd, fn, a, b, pi, inx, iny, inz);
      }
      e = e + 1;
    }
    // restaura só as posições tocadas — limpar o índice inteiro por ponto
    // traria de volta um custo quadrático por outro caminho
    e = 0;
    while (e < ne) { eh[ba[e]] = 0 - 1; e = e + 1; }

    usados[pi] = 1;
    pi = pi + 1;
  }
  return fn;
}

/// Extrai os pontos distintos do array de vértices intercalado.
///
/// A deduplicação não é higiene, é necessidade: `buildFlat` emite cada canto do
/// cubo UMA VEZ POR FACE (36 vértices para 8 cantos) porque as normais são da
/// face. Sem dedup, o tetraedro inicial pode ser escolhido entre três cópias do
/// mesmo canto e o casco nasce degenerado.
function distinctPoints(verts: f64[], stride: number,
                        px: f64[], py: f64[], pz: f64[]): void {
  const n = (verts.length / stride) | 0;
  let i = 0;
  while (i < n) {
    const x = verts[i * stride];
    const y = verts[i * stride + 1];
    const z = verts[i * stride + 2];
    let dup = 0;
    let j = 0;
    // O(n²) e assumido: n é o número de vértices de UMA malha (≤ ~500 aqui) e
    // isto roda uma vez no carregamento. Uma tabela de hash espacial economizaria
    // microssegundos e traria a escolha do tamanho da célula junto.
    while (j < px.length) {
      const dx = px[j] - x; const dy = py[j] - y; const dz = pz[j] - z;
      if (dx * dx + dy * dy + dz * dz < EPS) { dup = 1; j = px.length; }
      else j = j + 1;
    }
    if (dup === 0) { px.push(x); py.push(y); pz.push(z); }
    i = i + 1;
  }
}

/// A casca convexa da malha. `stride` é quantos floats por vértice — 8 no
/// layout que `gpu3d.upload()` monta (pos, normal, uv), com a posição nos três
/// primeiros.
export function hullFromMesh(verts: f64[], stride: number): Hull {
  const h = new Hull();
  if (verts.length < stride) { h.degenerateReason = 1; return h; }

  const px: f64[] = []; const py: f64[] = []; const pz: f64[] = [];
  distinctPoints(verts, stride, px, py, pz);
  const n = px.length;
  if (n === 0) { h.degenerateReason = 1; return h; }

  // AABB primeiro: ele é o fallback de todo caminho degenerado abaixo, e sai
  // de graça na mesma varredura.
  h.minX = px[0]; h.maxX = px[0];
  h.minY = py[0]; h.maxY = py[0];
  h.minZ = pz[0]; h.maxZ = pz[0];
  let i = 1;
  while (i < n) {
    if (px[i] < h.minX) h.minX = px[i]; if (px[i] > h.maxX) h.maxX = px[i];
    if (py[i] < h.minY) h.minY = py[i]; if (py[i] > h.maxY) h.maxY = py[i];
    if (pz[i] < h.minZ) h.minZ = pz[i]; if (pz[i] > h.maxZ) h.maxZ = pz[i];
    i = i + 1;
  }
  if (n < 4) { h.degenerateReason = 2; return h; }

  // ── tetraedro inicial ────────────────────────────────────────────────────
  // i0/i1 = o par mais distante entre os extremos dos eixos; i2 = o mais longe
  // dessa reta; i3 = o mais longe desse plano. Se qualquer etapa não alcançar a
  // tolerância, a nuvem é degenerada e o motivo é NOMEADO — cair para AABB sem
  // dizer por quê é o que faz um colisor errado parecer um bug de física.
  let i0 = 0; let i1 = 0;
  let best: f64 = 0.0 - 1.0;
  i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n) {
      const dx = px[i] - px[j]; const dy = py[i] - py[j]; const dz = pz[i] - pz[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > best) { best = d2; i0 = i; i1 = j; }
      j = j + 1;
    }
    i = i + 1;
  }
  if (best < EPS) { h.degenerateReason = 2; return h; }

  const ex = px[i1] - px[i0]; const ey = py[i1] - py[i0]; const ez = pz[i1] - pz[i0];
  let i2 = 0 - 1;
  best = EPS;
  i = 0;
  while (i < n) {
    const wx = px[i] - px[i0]; const wy = py[i] - py[i0]; const wz = pz[i] - pz[i0];
    const cx = ey * wz - ez * wy;
    const cy = ez * wx - ex * wz;
    const cz = ex * wy - ey * wx;
    const a2 = cx * cx + cy * cy + cz * cz;   // (área do paralelogramo)²
    if (a2 > best) { best = a2; i2 = i; }
    i = i + 1;
  }
  if (i2 < 0) { h.degenerateReason = 3; return h; }   // todos colineares

  const ux = px[i2] - px[i0]; const uy = py[i2] - py[i0]; const uz = pz[i2] - pz[i0];
  let nx0 = ey * uz - ez * uy;
  let ny0 = ez * ux - ex * uz;
  let nz0 = ex * uy - ey * ux;
  const nl = Math.sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0);
  nx0 = nx0 / nl; ny0 = ny0 / nl; nz0 = nz0 / nl;
  const d0 = nx0 * px[i0] + ny0 * py[i0] + nz0 * pz[i0];
  let i3 = 0 - 1;
  best = EPS;
  i = 0;
  while (i < n) {
    let dist = nx0 * px[i] + ny0 * py[i] + nz0 * pz[i] - d0;
    if (dist < 0.0) dist = 0.0 - dist;
    if (dist > best) { best = dist; i3 = i; }
    i = i + 1;
  }
  if (i3 < 0) { h.degenerateReason = 4; return h; }   // todos coplanares

  // Centro do tetraedro: o ponto interior de referência que orienta TODA face
  // criada daqui em diante, inclusive as do crescimento. Ele permanece interior
  // porque o casco só cresce.
  const inx = (px[i0] + px[i1] + px[i2] + px[i3]) * 0.25;
  const iny = (py[i0] + py[i1] + py[i2] + py[i3]) * 0.25;
  const inz = (pz[i0] + pz[i1] + pz[i2] + pz[i3]) * 0.25;

  // Os arrays das faces vivem AQUI, locais, e viajam por parâmetro (ver a nota
  // no topo do bloco de faces).
  const fa: number[] = []; const fb: number[] = []; const fc: number[] = [];
  const fnx: f64[] = []; const fny: f64[] = []; const fnz: f64[] = [];
  const fd: f64[] = [];
  const ba: number[] = []; const bb: number[] = [];
  const eh: number[] = []; const en: number[] = [];

  let fn = 0;
  fn = addFaceInto(px, py, pz, fa, fb, fc, fnx, fny, fnz, fd, fn, i0, i1, i2, inx, iny, inz);
  fn = addFaceInto(px, py, pz, fa, fb, fc, fnx, fny, fnz, fd, fn, i0, i1, i3, inx, iny, inz);
  fn = addFaceInto(px, py, pz, fa, fb, fc, fnx, fny, fnz, fd, fn, i0, i2, i3, inx, iny, inz);
  fn = addFaceInto(px, py, pz, fa, fb, fc, fnx, fny, fnz, fd, fn, i1, i2, i3, inx, iny, inz);

  const usados: number[] = [];
  let u = 0;
  while (u < n) { usados.push(0); u = u + 1; }
  usados[i0] = 1; usados[i1] = 1; usados[i2] = 1; usados[i3] = 1;

  fn = growHull(px, py, pz, n, fa, fb, fc, fnx, fny, fnz, fd, fn,
                ba, bb, eh, en, usados, inx, iny, inz);

  // ── colheita: vértices e planos ──────────────────────────────────────────
  const usadoNaCasca: number[] = [];
  u = 0;
  while (u < n) { usadoNaCasca.push(0); u = u + 1; }
  let f2 = 0;
  const nf2 = fn;
  while (f2 < nf2) {
    usadoNaCasca[fa[f2]] = 1; usadoNaCasca[fb[f2]] = 1; usadoNaCasca[fc[f2]] = 1;
    f2 = f2 + 1;
  }
  u = 0;
  while (u < n) {
    if (usadoNaCasca[u] !== 0) { h.vx.push(px[u]); h.vy.push(py[u]); h.vz.push(pz[u]); }
    u = u + 1;
  }

  // Planos DEDUPLICADOS: a face de um cubo são dois triângulos com o mesmo
  // plano, e sem isto um cubo devolveria 12 planos em vez de 6 — o teto de 32
  // seria gasto pela metade com repetição.
  f2 = 0;
  while (f2 < nf2) {
    {
      let rep = 0;
      let k = 0;
      while (k < h.pd.length) {
        if (Math.abs(h.pnx[k] - fnx[f2]) < 0.0001 &&
            Math.abs(h.pny[k] - fny[f2]) < 0.0001 &&
            Math.abs(h.pnz[k] - fnz[f2]) < 0.0001 &&
            Math.abs(h.pd[k] - fd[f2]) < 0.0001) { rep = 1; k = h.pd.length; }
        else k = k + 1;
      }
      if (rep === 0) {
        h.pnx.push(fnx[f2]); h.pny.push(fny[f2]); h.pnz.push(fnz[f2]); h.pd.push(fd[f2]);
      }
    }
    f2 = f2 + 1;
  }

  if (h.pd.length > HULL_MAX_PLANES) simplifyPlanes(h);
  h.ok = 1;
  h.degenerateReason = 0;
  return h;
}

/// Reduz os planos ao teto, CONSERVADORAMENTE.
///
/// A escolha aqui é entre encolher e engordar, e as duas erram em direções
/// opostas: um casco menor que o corpo deixa passar contato (atravessa), um
/// maior inventa contato (para no ar). Nenhuma é boa, mas só uma é SEGURA — a
/// que engorda, porque o erro aparece como uma folga visível e não como um
/// objeto caindo pelo chão.
///
/// Então: mantém os planos mais espalhados em direção (o primeiro, e depois
/// sempre o mais distante dos já mantidos — é o mesmo critério de um
/// "farthest point sampling" na esfera de direções) e EMPURRA cada um para fora
/// até conter todos os vértices da casca. O resultado contém o casco exato.
///
/// A alternativa — recusar a malha e cair para AABB — foi rejeitada porque o
/// AABB é justamente a folga que esta fase existe para eliminar: um casco de 32
/// planos empurrado ainda tem a FORMA da malha, e uma caixa não tem nenhuma.
function simplifyPlanes(h: Hull): void {
  const m = h.pd.length;
  const escolhidos: number[] = [];
  const usado: number[] = [];
  let i = 0;
  while (i < m) { usado.push(0); i = i + 1; }
  escolhidos.push(0); usado[0] = 1;
  while (escolhidos.length < HULL_MAX_PLANES) {
    let melhor = 0 - 1;
    let melhorDist: f64 = 0.0 - 1.0;
    i = 0;
    while (i < m) {
      if (usado[i] === 0) {
        // distância angular ao mais PRÓXIMO dos já escolhidos, via produto
        // interno (1 = mesma direção, -1 = oposta). Maximiza o mínimo.
        let pior: f64 = 2.0;
        let k = 0;
        while (k < escolhidos.length) {
          const e = escolhidos[k];
          const dot = h.pnx[i] * h.pnx[e] + h.pny[i] * h.pny[e] + h.pnz[i] * h.pnz[e];
          const dist = 1.0 - dot;
          if (dist < pior) pior = dist;
          k = k + 1;
        }
        if (pior > melhorDist) { melhorDist = pior; melhor = i; }
      }
      i = i + 1;
    }
    if (melhor < 0) break;
    escolhidos.push(melhor); usado[melhor] = 1;
  }

  const nnx: f64[] = []; const nny: f64[] = []; const nnz: f64[] = []; const nd: f64[] = [];
  let k = 0;
  while (k < escolhidos.length) {
    const e = escolhidos[k];
    const nx = h.pnx[e]; const ny = h.pny[e]; const nz = h.pnz[e];
    // EMPURRA: d = projeção MÁXIMA dos vértices neste eixo. Isso é o que
    // garante conter o casco exato, e não só as faces que sobraram.
    let dmax: f64 = nx * h.vx[0] + ny * h.vy[0] + nz * h.vz[0];
    let v = 1;
    while (v < h.vx.length) {
      const p = nx * h.vx[v] + ny * h.vy[v] + nz * h.vz[v];
      if (p > dmax) dmax = p;
      v = v + 1;
    }
    nnx.push(nx); nny.push(ny); nnz.push(nz); nd.push(dmax);
    k = k + 1;
  }
  h.pnx = nnx; h.pny = nny; h.pnz = nnz; h.pd = nd;
  h.simplified = 1;
}

/// O ponto está dentro da casca (com folga `margin`)?
///
/// É a consulta pontual — um raio, um clique, um teste. NÃO é o caminho de
/// colisão par-a-par, que é SAT sobre os planos e os vértices dos dois corpos e
/// mora na Fase 2.
export function hullContains(h: Hull, x: f64, y: f64, z: f64, margin: f64): number {
  if (h.ok === 0) {
    // degenerada: responde pelo AABB, que é o fallback declarado
    if (x < h.minX - margin || x > h.maxX + margin) return 0;
    if (y < h.minY - margin || y > h.maxY + margin) return 0;
    if (z < h.minZ - margin || z > h.maxZ + margin) return 0;
    return 1;
  }
  let i = 0;
  const m = h.pd.length;
  while (i < m) {
    if (h.pnx[i] * x + h.pny[i] * y + h.pnz[i] * z > h.pd[i] + margin) return 0;
    i = i + 1;
  }
  return 1;
}

/// Suporte: a projeção máxima do casco no eixo `(nx,ny,nz)`.
///
/// É o que o SAT da Fase 2 chama por eixo candidato, e está aqui porque a
/// resposta depende dos VÉRTICES — o dado que o k-DOP não teria dado.
export function hullSupport(h: Hull, nx: f64, ny: f64, nz: f64): f64 {
  if (h.ok === 0 || h.vx.length === 0) {
    // AABB: o suporte é o canto que o eixo escolhe, componente a componente
    const sx = nx >= 0.0 ? h.maxX : h.minX;
    const sy = ny >= 0.0 ? h.maxY : h.minY;
    const sz = nz >= 0.0 ? h.maxZ : h.minZ;
    return nx * sx + ny * sy + nz * sz;
  }
  let dmax: f64 = nx * h.vx[0] + ny * h.vy[0] + nz * h.vz[0];
  let i = 1;
  while (i < h.vx.length) {
    const p = nx * h.vx[i] + ny * h.vy[i] + nz * h.vz[i];
    if (p > dmax) dmax = p;
    i = i + 1;
  }
  return dmax;
}

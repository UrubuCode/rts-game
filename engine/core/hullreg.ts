// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE CASCAS — o elo que faltava entre `hullCollider(id, …)` e o solver.
//
// `hull.ts` gera uma casca convexa de uma malha. `hullpack.ts` sabe testar uma
// esfera contra ela (`hullContactLocal`) e empacotá-la para a GPU. `collider.ts`
// deixa um objeto DIZER "minha forma é a casca número N".
//
// As três peças existiam e não se tocavam: `hullContactLocal` tinha ZERO
// chamadores, e um `hullCollider(...)` colidia como caixa — o componente
// declarava uma forma que nenhum solver sabia ler. Este arquivo é a tabela que
// liga o número à casca, que é a única coisa que faltava.
//
// ── POR QUE UM ID E NÃO A CASCA NO COMPONENTE ──────────────────────────────
//
// A casca é da MALHA, não do corpo. Mil instâncias de um mesmo modelo têm a
// mesma casca e diferem só na transformação; guardar a casca no `Collider`
// subiria mil cópias dela para a GPU e faria mil percursos de planos onde um
// basta. É a mesma razão pela qual `MeshRenderer` guarda um id de malha e não
// os vértices.
//
// ── O ÍNDICE 0 É "NENHUMA CASCA", E ISSO É CONTRATO ────────────────────────
//
// `hullpack.ts` já codifica assim (`hullShapeCode` soma 2 ao id, `hullIdOfShape`
// devolve 0 para forma primitiva), e o `Collider` nasce com `hullId = 0`. Então
// a posição 0 desta tabela é ocupada por uma casca vazia que nunca é lida —
// desperdiçar um slot é mais barato que ter dois significados para o zero.
// ═══════════════════════════════════════════════════════════════════════════

import { Hull } from "./hullpack";
import { Hull as HullGeo } from "./hull";

/// Todas as cascas registradas. Índice = `hullId`.
const cascas: Hull[] = [];

/// Quantas cascas existem, contando a sentinela do índice 0.
export function hullCount(): number { return cascas.length; }

/// Registra uma casca e devolve o `hullId` para pôr num `hullCollider`.
///
/// Devolve 0 — "nenhuma casca" — quando a casca não tem plano nenhum. Um id
/// válido para uma casca vazia faria o solver percorrer zero planos e concluir
/// "sem contato" para todo par, que é um objeto que atravessa tudo em silêncio;
/// devolver 0 faz o colisor cair para a caixa, que está errada mas é visível.
export function hullRegister(h: Hull): number {
  if (cascas.length === 0) cascas.push(new Hull());   // a sentinela do índice 0
  if (h.planeCount() === 0) return 0;
  cascas.push(h);
  return cascas.length - 1;
}

/// A casca de um id, ou `null` quando o id é 0 ou desconhecido.
///
/// `null` e não uma casca vazia: quem chama tem de DECIDIR o que fazer sem
/// casca — cair para a caixa —, e uma casca vazia tomaria essa decisão por ele
/// respondendo "sem contato", que é a resposta errada e silenciosa.
export function hullAt(id: number): Hull | null {
  if (id <= 0 || id >= cascas.length) return null;
  return cascas[id];
}

/// Converte a casca geométrica de `hull.ts` na forma que o solver consome.
///
/// As duas classes se chamam `Hull` e são coisas diferentes de propósito: a de
/// `hull.ts` é o RESULTADO da geração (vértices, planos separados, AABB, o
/// motivo de ter degenerado), e a de `hullpack.ts` é o que o teste de contato
/// precisa — planos achatados num array e o raio envolvente. Achatar aqui, uma
/// vez no registro, é o que evita achatar por par.
///
/// Devolve 0 quando a geração degenerou (`ok = 0`): uma malha que é um ponto,
/// uma linha ou um plano não tem interior, e testar contra ela daria contato
/// com profundidade zero em toda parte. O chamador cai para a caixa, e o AABB
/// que `hull.ts` preenche mesmo no caso degenerado é o que torna essa queda
/// possível sem um segundo passe sobre a malha.
export function hullRegisterGeo(g: HullGeo): number {
  if (g.ok === 0) return 0;
  const h = new Hull();
  const m = g.pd.length;
  let i = 0;
  while (i < m) { h.add(g.pnx[i], g.pny[i], g.pnz[i], g.pd[i]); i = i + 1; }
  // O raio envolvente é a camada BARATA do teste (docs/colisores.md §3): um
  // `dot` e uma comparação descartam o par antes de qualquer plano ser lido.
  // Vem do AABB e não dos vértices porque o AABB está sempre preenchido e é
  // conservador — nunca menor que o real, então nunca descarta um par que toca.
  let r2: f64 = 0.0;
  const cantos: f64[] = [
    g.minX, g.minY, g.minZ, g.maxX, g.minY, g.minZ, g.minX, g.maxY, g.minZ,
    g.maxX, g.maxY, g.minZ, g.minX, g.minY, g.maxZ, g.maxX, g.minY, g.maxZ,
    g.minX, g.maxY, g.maxZ, g.maxX, g.maxY, g.maxZ,
  ];
  let k = 0;
  while (k < 8) {
    const x = cantos[k * 3]; const y = cantos[k * 3 + 1]; const z = cantos[k * 3 + 2];
    const d2 = x * x + y * y + z * z;
    if (d2 > r2) r2 = d2;
    k = k + 1;
  }
  h.radius = Math.sqrt(r2);
  return hullRegister(h);
}

/// Esquece todas as cascas. Para um teste que precisa de ids previsíveis — sem
/// isto, dois testes no mesmo processo veriam ids diferentes conforme a ordem.
export function hullResetRegistry(): void { cascas.length = 0; }

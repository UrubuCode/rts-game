// ═══════════════════════════════════════════════════════════════════════════
// HULLPACK — o LAYOUT da tabela de cascas na GPU, e a única definição do teste.
//
// Ver `docs/colisores.md` para o desenho e os números que o sustentam. Este
// arquivo é a parte executável dele, e existe porque duas pessoas precisam
// concordar sobre a mesma coisa e nenhuma das duas é dona dela:
//
//   quem GERA as cascas       (engine/core/hull.ts) produz planos
//   quem as TESTA no kernel   (engine/rigid/gpurigid.ts) lê planos
//
// O empacotamento fica entre os dois. Se morasse num deles, o outro teria de
// saber os offsets de cor — e um offset sabido em dois lugares é um offset que
// vai divergir, que é a mesma razão que pôs o hash do grid num só lugar.
//
// ── POR QUE A CAUDA DO `world` E NÃO UM BUFFER ─────────────────────────────
//
// Com uma JANELA aberta o device nasce com máximo de 4 storage buffers por
// estágio, e o kernel de colisão já liga os quatro (pos, vel, ext, world). O
// quinto compila headless e falha no jogo. Medido e registrado duas vezes neste
// repositório: `gpufluid.ts:53` e `gpurigid.ts:73`. A cauda do `world` já
// hospeda o grid pela mesma razão; a tabela de cascas entra ao lado.
//
// ── O QUE É UM PLANO AQUI ──────────────────────────────────────────────────
//
// `(nx, ny, nz, d)` com a normal UNITÁRIA apontando para FORA e `d` tal que um
// ponto p está dentro quando `dot(n, p) <= d` para todos os planos. Em espaço
// LOCAL da malha — nunca de mundo, porque a casca é da malha e mil instâncias
// compartilham uma (ver `collider.ts::hullId`).
// ═══════════════════════════════════════════════════════════════════════════

/// Onde o diretório de cascas começa, em índice de `vec4` do `world`.
///
/// Depois dos params (1) e dos estáticos (RB_MAX_STATICS * 2 = 512). O número
/// está escrito aqui e não derivado de `gpurigid.ts` para não criar dependência
/// circular entre o layout e o kernel; a linha de teste
/// `hullpackLayoutAgreesWithKernel` é quem impede os dois de divergirem.
export const HULL_DIR_VEC4 = 513;

/// Quantas cascas o diretório comporta. Uma por MALHA distinta, não por corpo —
/// é essa a razão de 256 bastar onde 256 corpos não bastariam.
export const HULL_MAX = 256;

/// Onde os planos começam, em índice de `vec4`.
export const HULL_PLANES_VEC4 = HULL_DIR_VEC4 + HULL_MAX;

/// Teto de planos somados de todas as cascas.
///
/// 4096 planos = 64 KB. Com cascas típicas de 12 a 32 planos isso são 128 a 340
/// malhas distintas, acima do HULL_MAX de qualquer forma — então quem estoura
/// primeiro é o diretório, que dá uma mensagem melhor que um offset inválido.
export const HULL_PLANES_MAX = 4096;

/// Onde a orientação por corpo começa, em índice de `vec4`: um quaternion cada.
///
/// SOMENTE LEITURA no kernel de colisão, e isso é a decisão, não um detalhe:
/// a rotação é ENTRADA e não estado — não há velocidade angular nem torque de
/// contato, porque os 16 floats de pos/vel/ext estão todos ocupados e não há
/// buffer gravável sobrando. Ver `docs/colisores.md` §4.
export const HULL_ORI_VEC4 = HULL_PLANES_VEC4 + HULL_PLANES_MAX;

/// O valor de `vel.w` que significa "casca de id `h`".
///
/// `vel.w < 2` continua sendo forma primitiva (0 esfera, 1 caixa), exatamente
/// como antes desta extensão. Um `f32` guarda inteiros exatos até 2^24, ou seja
/// 16 777 216 ids — o encaixe é seguro pelo número, e não por otimismo.
export function hullShapeCode(hullId: number): f64 {
  return (hullId + 2) * 1.0;
}

/// O `hullId` de um `vel.w`, ou 0 quando o corpo é primitivo.
export function hullIdOfShape(code: f64): number {
  return code >= 2.0 ? ((code - 2.0) | 0) : 0;
}

/// Uma casca em construção, do lado da CPU.
///
/// Os planos ficam num array plano de 4 em 4 pela mesma razão que a malha vai
/// para `meshUpload` como `Float32Array`: o que atravessa a fronteira se paga
/// por upload e não por item, e um array de objetos custaria uma alocação por
/// plano — 486 ns por campo novo, medido neste motor.
export class Hull {
  /// `nx, ny, nz, d` repetidos. `length / 4` é a contagem de planos.
  planes: f64[];
  /// Raio da esfera que envolve a casca, em espaço local, a partir da origem
  /// da malha. É a camada BARATA do teste: um `dot` e uma comparação descartam
  /// o par antes de qualquer plano ser lido (ver `docs/colisores.md` §3).
  radius: f64;

  constructor() {
    this.planes = [];
    this.radius = 0.0;
  }

  /// Acrescenta um plano. A normal precisa chegar UNITÁRIA — isto não normaliza,
  /// porque normalizar aqui esconderia um gerador de cascas com bug, e o efeito
  /// de uma normal não unitária é uma profundidade de penetração escalada, que
  /// aparece como física "mole" e não como erro.
  add(nx: f64, ny: f64, nz: f64, d: f64): void {
    this.planes.push(nx);
    this.planes.push(ny);
    this.planes.push(nz);
    this.planes.push(d);
  }

  planeCount(): number {
    return (this.planes.length / 4) | 0;
  }
}

/// O resultado de um contato: normal (mundo) e profundidade.
///
/// Uma classe e não um objeto literal porque isto nasce por PAR e por sub-passo,
/// e um literal de 4 campos custa ~4 x 486 ns neste motor — medido. Quem chama
/// reusa uma instância, que é o padrão que cai de ~4,97 para ~0,91 us.
export class Contact {
  nx: f64; ny: f64; nz: f64; depth: f64;
  constructor() {
    this.nx = 0.0; this.ny = 0.0; this.nz = 0.0; this.depth = 0.0;
  }
}

/// ESFERA contra CASCA, em espaço LOCAL da casca. A ÚNICA definição.
///
/// O WGSL do kernel é a tradução desta função, na mesma ordem de operações — o
/// mesmo contrato que `contato()` já tem com `solvePair`, e pela mesma razão:
/// dois backends que terminam em lugares diferentes é o defeito que este arranjo
/// existe para tornar detectável.
///
/// # Por que o teste é feito no espaço local e não no mundo
///
/// Porque uma esfera é INVARIANTE A ROTAÇÃO: no espaço da casca ela continua
/// sendo uma esfera do mesmo raio, então nada nela precisa ser girado — só o
/// centro. Transformar os N planos para o mundo custaria N rotações por par
/// (12 x ~30 flops = 360) contra 2 rotações aqui (~60): seis vezes mais em
/// M=12, e a razão cresce linear com M. Ver `docs/colisores.md` §4.
///
/// `cx,cy,cz` é o centro da esfera JÁ no espaço local da casca, e `r` o raio.
/// A normal sai em espaço LOCAL; quem chama a gira de volta para o mundo, uma
/// vez, porque o solver aplica impulso em mundo e a regra de herança de apoio
/// testa `|ny| > 0.5`, que só significa algo lá.
///
/// Devolve 1 quando há contato (e preenche `out`), 0 quando não há.
///
/// # A regra do plano de MENOR penetração, e por que é a mesma de sempre
///
/// Dentro da casca, o empurrão sai pela face de menor folga — que é
/// exatamente o "eixo de menor penetração" do caixa-caixa e o "face de menor
/// folga" do esfera-caixa que o `solvePair` já usa. Não é uma regra nova: é a
/// mesma, num conjunto de planos em vez de três eixos. Se fosse outra, um
/// cubo (que é uma casca de 6 planos) colidiria diferente de uma caixa.
export function hullContactLocal(
  hull: Hull, cx: f64, cy: f64, cz: f64, r: f64, out: Contact,
): number {
  const p: f64[] = hull.planes;
  const m = (p.length / 4) | 0;
  if (m === 0) return 0;

  // Menor folga vista. Começa acima de qualquer valor possível; o primeiro
  // plano a ser lido a substitui.
  let bestGap: f64 = 1.0e30;
  let bx: f64 = 0.0; let by: f64 = 0.0; let bz: f64 = 0.0;

  let k = 0;
  while (k < m) {
    const i = k * 4;
    const nx = p[i]; const ny = p[i + 1]; const nz = p[i + 2]; const d = p[i + 3];
    // Distância ASSINADA do centro ao plano: positiva = fora daquele semiespaço.
    const dist = nx * cx + ny * cy + nz * cz - d;
    // Fora por mais que o raio em QUALQUER plano = separado. Sai na primeira,
    // que é o que torna o caso comum (a maioria dos pares não toca) barato.
    if (dist > r) return 0;
    // `r - dist` é o quanto a esfera penetra ESTE plano. O menor de todos é a
    // profundidade, e o plano que o deu é a normal.
    const gap = r - dist;
    if (gap < bestGap) { bestGap = gap; bx = nx; by = ny; bz = nz; }
    k = k + 1;
  }

  if (bestGap <= 0.0) return 0;
  out.nx = bx; out.ny = by; out.nz = bz; out.depth = bestGap;
  return 1;
}

/// Empacota as cascas no espelho do `world`, e devolve quantos planos usou.
///
/// Uma travessia, no carregamento da cena — não por frame e não por corpo. As
/// cascas não mudam: a casca é da malha e a malha não muda de forma.
///
/// `hulls[0]` é ignorada de propósito: `hullId = 0` significa "nenhuma casca" no
/// componente `Collider`, então o diretório é indexado a partir de 1 e um corpo
/// sem casca nunca lê a casca de outro por engano.
///
/// Devolve -1 se não coube — e recusar é o certo: um offset inválido no kernel
/// vira leitura de lixo, que aparece como física errada e não como erro.
export function hullPack(mirror: i64, hulls: Hull[], writeF32: (buf: i64, off: number, v: f64) => void): number {
  let planeCursor = 0;
  let h = 1;
  const n = hulls.length;
  if (n > HULL_MAX) return 0 - 1;
  while (h < n) {
    const hull: Hull = hulls[h];
    const count = hull.planeCount();
    if (planeCursor + count > HULL_PLANES_MAX) return 0 - 1;

    // Diretório: (offset em planos, quantos, raio local, -)
    const dir = (HULL_DIR_VEC4 + h) * 4;
    writeF32(mirror, dir * 4, planeCursor * 1.0);
    writeF32(mirror, (dir + 1) * 4, count * 1.0);
    writeF32(mirror, (dir + 2) * 4, hull.radius);
    writeF32(mirror, (dir + 3) * 4, 0.0);

    // Os planos, contíguos.
    let k = 0;
    while (k < count * 4) {
      const at = (HULL_PLANES_VEC4 + planeCursor) * 4 + k;
      writeF32(mirror, at * 4, hull.planes[k]);
      k = k + 1;
    }
    planeCursor = planeCursor + count;
    h = h + 1;
  }
  return planeCursor;
}

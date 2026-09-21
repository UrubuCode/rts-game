// ═══════════════════════════════════════════════════════════════════════════
// O PERFIL MEDIDO — qual backend de rígidos vence, por (n, threads).
//
// Substitui o modelo de custo que vivia em `physics_backend.ts`. Aquele media
// uma SONDA O(n²) escrita à mão e previa com ela um KERNEL que tem grid de 8192
// células — algoritmos diferentes. O coeficiente n² media ZERO porque o termo
// não existia no que estava sendo medido, e o joelho oscilava ±40% entre
// execuções do mesmo binário. Um decisor cuja resposta muda sem nada mudar não
// está medindo a máquina.
//
// Aqui não há coeficiente: há uma TABELA de medições reais, interpolada dentro
// da faixa e RECUSANDO fora dela.
//
// ── A MEDIÇÃO ──────────────────────────────────────────────────────────────
//
// 2026-09-20, release, RTX 2080 Ti, pool de rayon forçado por RAYON_NUM_THREADS.
// `bench/claude-bench-denso-gpu-rust.ts`, contato denso (espaçamento 0,6 sobre
// meia-extensão 0,5 — todo vizinho é contato), ms por PASSO SIMULADO.
//
// ── POR QUE A TABELA PARA EM 8000 ──────────────────────────────────────────
//
// Acima disso o bench mede um backend QUEBRADO: em 16000 e 32000 o corpo 0
// termina com `y` POSITIVO na GPU — ela não assentou, foi ejetada. O rodapé do
// próprio bench avisa que um backend que não simula é sempre o mais rápido.
// Suspeito nomeado: o grid da GPU tem 8192 buckets de 32 vagas
// (`gpurigid.ts`), e o que passa de 32 num bucket é contado e NÃO guardado —
// fica invisível para os vizinhos. Enquanto isso não for investigado, a faixa
// para onde a medição para.
// ═══════════════════════════════════════════════════════════════════════════

/// As respostas possíveis. `PROF_DESCONHECIDO` não é erro: é a recusa.
export const PROF_GPU = 1;
export const PROF_RUST = 2;
export const PROF_DESCONHECIDO = 0 - 1;

/// Os n medidos, em ordem crescente.
const PROF_NS: number[] = [250, 1000, 2000, 4000, 8000];
/// ms/passo da GPU em cada n de `PROF_NS`.
const PROF_GPU_MS: f64[] = [0.52, 0.73, 0.97, 1.63, 3.43];
/// As contagens de thread medidas, em ordem crescente.
const PROF_TS: number[] = [1, 2, 4, 16];
/// ms/passo do Rust: uma linha por contagem de thread, na ordem de `PROF_NS`.
const PROF_RUST_MS: f64[][] = [
  [0.142, 0.767, 1.867, 4.550, 10.383],   // 1 thread
  [0.100, 0.425, 0.975, 2.333, 5.300],    // 2 threads
  [0.067, 0.258, 0.550, 1.250, 2.750],    // 4 threads
  [0.042, 0.183, 0.308, 0.625, 1.417],    // 16 threads
];

/// A faixa de `n` em que há medição: `[nMin, nMax]`.
export function profRange(): number[] {
  return [PROF_NS[0], PROF_NS[PROF_NS.length - 1]];
}

/// O índice da linha de threads mais próxima (por baixo) de `threads`.
///
/// Por baixo e não a mais próxima: entre 4 e 16 medidos, uma máquina de 8
/// threads é tratada como 4. Subestimar o Rust erra para o lado seguro — no
/// máximo escolhe a GPU onde o Rust já serviria, e nunca o contrário.
function profLinha(threads: number): number {
  let k = 0;
  let i = 0;
  while (i < PROF_TS.length) {
    if (PROF_TS[i] <= threads) k = i;
    i = i + 1;
  }
  return k;
}

/// Interpola `vals` (alinhada a `PROF_NS`) no ponto `n`. `-1` acima da faixa;
/// abaixo dela, GRAMPEIA no primeiro ponto — ver o doc de `profBest`.
function profEm(vals: f64[], n: number): f64 {
  const ultimo = PROF_NS.length - 1;
  if (n > PROF_NS[ultimo]) return 0.0 - 1.0;
  if (n <= PROF_NS[0]) return vals[0];
  let i = 0;
  while (i < ultimo) {
    if (n <= PROF_NS[i + 1]) {
      const a: f64 = PROF_NS[i] * 1.0;
      const b: f64 = PROF_NS[i + 1] * 1.0;
      const t: f64 = (n * 1.0 - a) / (b - a);
      return vals[i] + (vals[i + 1] - vals[i]) * t;
    }
    i = i + 1;
  }
  return vals[ultimo];
}

/// ms por passo simulado da GPU a `n` corpos. `-1` = fora da faixa medida.
export function profGpuMs(n: number): f64 {
  return profEm(PROF_GPU_MS, n);
}

/// ms por passo simulado do Rust a `n` corpos com `threads` threads.
/// `-1` = fora da faixa medida.
export function profRustMs(n: number, threads: number): f64 {
  return profEm(PROF_RUST_MS[profLinha(threads)], n);
}

/// Quem vence em `(n, threads)`: `PROF_GPU`, `PROF_RUST` ou `PROF_DESCONHECIDO`.
///
/// ACIMA da faixa recusa, porque lá a medição mede um backend quebrado (ver o
/// cabeçalho). ABAIXO dela grampeia no menor n medido, e isso não é
/// extrapolação disfarçada: em 250 corpos o Rust vence com QUALQUER contagem de
/// thread, a curva é monótona, e cenas menores só aumentam essa vantagem.
///
/// No empate o RUST ganha — ele é determinístico bit a bit e não custa um frame
/// de latência, então empate de desempenho não é empate de propriedades.
export function profBest(n: number, threads: number): number {
  const g = profGpuMs(n);
  const r = profRustMs(n, threads);
  if (g < 0.0 || r < 0.0) return PROF_DESCONHECIDO;
  return r <= g ? PROF_RUST : PROF_GPU;
}

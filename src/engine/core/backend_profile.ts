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

/// Níveis de simulação da física (Fase 1, §7.1.1).
export const PHYSICS_LEVEL_SIMPLES = 0;
export const PHYSICS_LEVEL_ORIENTADA = 1;
export const PHYSICS_LEVEL_COMPLETA = 2;

/// Dispositivo da medição de fábrica (padrão de referência).
export const PROF_FACTORY_DEVICE = "NVIDIA GeForce RTX 2080 Ti";

/// Os n medidos de fábrica, em ordem crescente.
const FACTORY_NS: number[] = [250, 1000, 2000, 4000, 8000];
/// ms/passo da GPU em cada n de `FACTORY_NS`.
const FACTORY_GPU_MS: f64[] = [0.52, 0.73, 0.97, 1.63, 3.43];
/// As contagens de thread medidas de fábrica, em ordem crescente.
const FACTORY_TS: number[] = [1, 2, 4, 16];
/// ms/passo do Rust: uma linha por contagem de thread, na ordem de `FACTORY_NS`.
const FACTORY_RUST_MS: f64[][] = [
  [0.142, 0.767, 1.867, 4.550, 10.383],   // 1 thread
  [0.100, 0.425, 0.975, 2.333, 5.300],    // 2 threads
  [0.067, 0.258, 0.550, 1.250, 2.750],    // 4 threads
  [0.042, 0.183, 0.308, 0.625, 1.417],    // 16 threads
];

let profNs: number[] = [250, 1000, 2000, 4000, 8000];
let profGpuMsArr: f64[] = [0.52, 0.73, 0.97, 1.63, 3.43];
let profTs: number[] = [1, 2, 4, 16];
let profRustMsArr: f64[][] = [
  [0.142, 0.767, 1.867, 4.550, 10.383],
  [0.100, 0.425, 0.975, 2.333, 5.300],
  [0.067, 0.258, 0.550, 1.250, 2.750],
  [0.042, 0.183, 0.308, 0.625, 1.417],
];

/// Dispositivo em uso pela calibração atual.
export function profDevice(): string {
  return PROF_FACTORY_DEVICE;
}

/// Restaura a tabela de fábrica medida na RTX 2080 Ti.
export function profResetFactoryDefaults(): void {
  profNs = FACTORY_NS.slice();
  profGpuMsArr = FACTORY_GPU_MS.slice();
  profTs = FACTORY_TS.slice();
  profRustMsArr = [
    FACTORY_RUST_MS[0].slice(),
    FACTORY_RUST_MS[1].slice(),
    FACTORY_RUST_MS[2].slice(),
    FACTORY_RUST_MS[3].slice(),
  ];
}

/// Permite injetar uma nova tabela medida em tempo de execução.
export function profSetTable(ns: number[], gpuMs: f64[], ts: number[], rustMs: f64[][]): void {
  profNs = ns.slice();
  profGpuMsArr = gpuMs.slice();
  profTs = ts.slice();
  profRustMsArr = [];
  let i = 0;
  while (i < rustMs.length) {
    profRustMsArr.push(rustMs[i].slice());
    i = i + 1;
  }
}

/// A faixa de `n` em que há medição: `[nMin, nMax]`.
export function profRange(): number[] {
  return [profNs[0], profNs[profNs.length - 1]];
}

/// O índice da linha de threads mais próxima (por baixo) de `threads`.
function profLinha(threads: number): number {
  let k = 0;
  let i = 0;
  while (i < profTs.length) {
    if (profTs[i] <= threads) k = i;
    i = i + 1;
  }
  return k;
}

/// Interpola `vals` (alinhada a `profNs`) no ponto `n`. `-1` acima da faixa;
/// abaixo dela, GRAMPEIA no primeiro ponto — ver o doc de `profBest`.
function profEm(vals: f64[], n: number): f64 {
  const ultimo = profNs.length - 1;
  if (n > profNs[ultimo]) return 0.0 - 1.0;
  if (n <= profNs[0]) return vals[0];
  let i = 0;
  while (i < ultimo) {
    if (n <= profNs[i + 1]) {
      const a: f64 = profNs[i] * 1.0;
      const b: f64 = profNs[i + 1] * 1.0;
      const t: f64 = (n * 1.0 - a) / (b - a);
      return vals[i] + (vals[i + 1] - vals[i]) * t;
    }
    i = i + 1;
  }
  return vals[ultimo];
}

/// ms por passo simulado da GPU a `n` corpos. `-1` = fora da faixa medida ou nível não suportado.
/// Apenas `PHYSICS_LEVEL_SIMPLES` é implementado hoje na GPU.
export function profGpuMs(n: number, nivel: number = PHYSICS_LEVEL_SIMPLES): f64 {
  if (nivel !== PHYSICS_LEVEL_SIMPLES) return 0.0 - 1.0;
  return profEm(profGpuMsArr, n);
}

/// ms por passo simulado do Rust a `n` corpos com `threads` threads.
/// `-1` = fora da faixa medida ou nível não suportado.
/// Apenas `PHYSICS_LEVEL_SIMPLES` é implementado hoje no Rust.
export function profRustMs(n: number, threads: number, nivel: number = PHYSICS_LEVEL_SIMPLES): f64 {
  if (nivel !== PHYSICS_LEVEL_SIMPLES) return 0.0 - 1.0;
  return profEm(profRustMsArr[profLinha(threads)], n);
}

/// Quem vence em `(n, threads)`: `PROF_GPU`, `PROF_RUST` ou `PROF_DESCONHECIDO`.
///
/// Nível diferente de `PHYSICS_LEVEL_SIMPLES` recusa (`PROF_DESCONHECIDO`),
/// pois níveis mais complexos (Orientada/Completa) ainda não foram implementados.
///
/// ACIMA da faixa recusa, porque lá a medição mede um backend quebrado (ver o
/// cabeçalho). ABAIXO dela grampeia no menor n medido, e isso não é
/// extrapolação disfarçada: em 250 corpos o Rust vence com QUALQUER contagem de
/// thread, a curva é monótona, e cenas menores só aumentam essa vantagem.
///
/// No empate o RUST ganha — ele é determinístico bit a bit e não custa um frame
/// de latência, então empate de desempenho não é empate de propriedades.
export function profBest(n: number, threads: number, nivel: number = PHYSICS_LEVEL_SIMPLES): number {
  if (nivel !== PHYSICS_LEVEL_SIMPLES) return PROF_DESCONHECIDO;
  const g = profGpuMs(n, nivel);
  const r = profRustMs(n, threads, nivel);
  if (g < 0.0 || r < 0.0) return PROF_DESCONHECIDO;
  return r <= g ? PROF_RUST : PROF_GPU;
}

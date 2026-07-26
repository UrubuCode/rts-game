// ═══════════════════════════════════════════════════════════════════════════
// DECISOR CPU × GPU — mede a MÁQUINA e escolhe onde a física de fluido roda.
//
// A regra "perto/gameplay = CPU, massa = GPU" precisa de um número: A PARTIR
// DE QUANTAS partículas a GPU compensa? A resposta muda por hardware (uma
// integrada decide diferente de uma 2080 Ti; sem GPU nem há escolha), então
// medir uma vez na inicialização (~100 ms) vale mais que qualquer constante.
//
// Modelo de custo por FRAME (2 sub-passos, como os módulos usam). Os DOIS
// backends são força-bruta O(n²) hoje (o CPU não tem grid espacial):
//   cpu(n) = n² × custoInteraçãoCPU × 4           (2 passes × 2 sub-passos)
//   gpu(n) = OVERHEAD_RT + n²/paralelismo × 2     (kernel O(n²) + round-trip)
// Apertar 4096 partículas no backend CPU custa SEGUNDOS por frame — o modelo
// antigo assumia vizinhança de grid e estimava 35 ms; o travamento na demo
// veio daí. Modelo honesto = decisão honesta.
// Os dois coeficientes vêm de SONDAS reais: um laço TS representativo da
// matemática SPH, e um dispatch+read de verdade no kernel-sonda.
//
// Uso:
//   const backend = fluidBackend(n);   // 0 = CPU, 1 = GPU
//   fluidReport();                     // imprime a calibração (debug)
// ═══════════════════════════════════════════════════════════════════════════
import gpu from "rts:gpu";
import buffer from "rts:buffer";
import io from "rts:io";


let dcCpuPerInter: f64 = 0.0;   // ms por interação de par na CPU
let dcGpuPerN2: f64 = 0.0;      // ms por (n²/1e6) na GPU
let dcGpuOverhead: f64 = 0.0;   // ms fixos de submit+read (round-trip)
let dcCalibrado = 0;
let dcTemGpu = 0;

/// Laço representativo da matemática SPH (distância² + kernel + acumulação),
/// em função livre com params anotados — o mesmo regime dos módulos reais.
function dcSondaCpu(px: f64[], py: f64[], n: number): f64 {
  let acc: f64 = 0.0;
  let i = 0;
  while (i < n) {
    const ax = px[i]; const ay = py[i];
    let j = 0;
    while (j < n) {
      const dx = ax - px[j]; const dy = ay - py[j];
      const r2 = dx * dx + dy * dy;
      if (r2 < 0.04) { const w = 0.04 - r2; acc = acc + w * w * w; }
      j = j + 1;
    }
    i = i + 1;
  }
  return acc;
}

/// Mede os coeficientes UMA vez. Idempotente; ~100 ms na primeira chamada.
export function fluidCalibrate(): void {
  if (dcCalibrado !== 0) return;
  dcCalibrado = 1;
  dcTemGpu = gpu.available();

  // ── CPU: n=1024 → 1M interações; média de 3 rodadas ───────────────────────
  const CN = 1024;
  const px: f64[] = [];
  const py: f64[] = [];
  let s = 77;
  let i = 0;
  while (i < CN) {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    px.push((s % 1000) * 0.001);
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    py.push((s % 1000) * 0.001);
    i = i + 1;
  }
  dcSondaCpu(px, py, CN);                      // aquecimento (JIT/cache)
  const t0 = performance.now();
  let r = 0;
  while (r < 3) { dcSondaCpu(px, py, CN); r = r + 1; }
  const cpuMs = (performance.now() - t0) / 3.0;
  dcCpuPerInter = cpuMs / (CN * 1.0 * CN);

  if (dcTemGpu === 0) return;

  // ── GPU: kernel-sonda O(n²) com n=4096; overhead = rodada com n=64 ────────
  const pipe = gpu.shader(`
@group(0) @binding(0) var<storage, read_write> d: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let n = arrayLength(&d);
  if (id.x >= n) { return; }
  var a: f32 = 0.0;
  for (var j: u32 = 0u; j < n; j = j + 1u) {
    let dv = d[id.x] - d[j];
    let r2 = dv * dv;
    if (r2 < 0.04) { let w = 0.04 - r2; a = a + w * w * w; }
  }
  d[id.x] = a;
}
`);
  if (pipe === 0) { dcTemGpu = 0; return; }
  const GN = 4096;
  const cbuf = buffer.alloc(GN * 4);
  i = 0;
  while (i < GN) { buffer.write_f32(cbuf, i * 4, (i % 97) * 0.01); i = i + 1; }
  const g = gpu.buffer(GN * 4);
  gpu.write(g, cbuf, GN * 4);
  gpu.bind_buffer(pipe, 0, g);
  // overhead: dispatch mínimo (64 threads) + read — praticamente só round-trip
  gpu.dispatch(pipe, 1, 1, 1);
  gpu.read(g, cbuf, 64 * 4);                   // aquecimento
  let t1 = performance.now();
  r = 0;
  while (r < 5) { gpu.dispatch(pipe, 1, 1, 1); gpu.read(g, cbuf, 64 * 4); r = r + 1; }
  dcGpuOverhead = (performance.now() - t1) / 5.0;
  // custo O(n²): rodada cheia com n=4096 (16,7M interações)
  t1 = performance.now();
  r = 0;
  while (r < 5) { gpu.dispatch(pipe, GN / 64, 1, 1); gpu.read(g, cbuf, GN * 4); r = r + 1; }
  const cheio = (performance.now() - t1) / 5.0;
  let porN2 = (cheio - dcGpuOverhead) / ((GN * 1.0 * GN) / 1000000.0);
  if (porN2 < 0.0) porN2 = 0.0;
  dcGpuPerN2 = porN2;
  gpu.buffer_free(g);
}

/// Custo de FRAME estimado na CPU para `n` partículas (2 passes × 2 sub-passos,
/// força-bruta O(n²) — o backend CPU não tem grid espacial).
export function fluidCpuCostMs(n: number): f64 {
  fluidCalibrate();
  return n * 1.0 * n * dcCpuPerInter * 4.0;
}

/// Custo de FRAME estimado na GPU para `n` partículas (2 sub-passos + 1 read).
export function fluidGpuCostMs(n: number): f64 {
  fluidCalibrate();
  if (dcTemGpu === 0) return 999999.0;
  return dcGpuOverhead + (n * 1.0 * n / 1000000.0) * dcGpuPerN2 * 2.0;
}

/// A decisão: 0 = CPU, 1 = GPU. Sem GPU é sempre 0; no empate a CPU ganha
/// (zero latência de frame e libera a GPU para o render).
export function fluidBackend(n: number): number {
  fluidCalibrate();
  if (dcTemGpu === 0) return 0;
  return fluidGpuCostMs(n) < fluidCpuCostMs(n) ? 1 : 0;
}

/// O ponto de cruzamento medido NESTA máquina (menor n em que a GPU ganha).
export function fluidCrossover(): number {
  fluidCalibrate();
  if (dcTemGpu === 0) return 999999;
  let n = 16;
  while (n < 100000) {
    if (fluidBackend(n) === 1) return n;
    n = n + 16;
  }
  return 999999;
}

/// Imprime a calibração (debug/telemetria).
export function fluidReport(): void {
  fluidCalibrate();
  io.print("[decide] cpu=" + dcCpuPerInter * 1000000.0 + "ns/interacao  gpu=" +
           dcGpuPerN2 + "ms/M-inter + " + dcGpuOverhead + "ms overhead  temGpu=" + dcTemGpu);
  io.print("[decide] cruzamento nesta maquina: n >= " + fluidCrossover() + " => GPU");
  io.print("[decide] exemplos: n=168 " + (fluidBackend(168) === 0 ? "CPU" : "GPU") +
           " (" + fluidCpuCostMs(168) + " vs " + fluidGpuCostMs(168) + " ms) | n=4096 " +
           (fluidBackend(4096) === 0 ? "CPU" : "GPU") +
           " (" + fluidCpuCostMs(4096) + " vs " + fluidGpuCostMs(4096) + " ms)");
}

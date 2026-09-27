// ═══════════════════════════════════════════════════════════════════════════
// BENCH DE QUADRO — medição reproduzível do custo do frame (editor e jogo).
//
// Ligado só pelo ambiente; desligado, cada chamada é um `if` e um retorno.
//
//   RTS_BENCH=5000         quadros medidos (0/ausente = desligado)
//   RTS_BENCH_WARMUP=600   quadros descartados antes (JIT, cache, heap)
//   RTS_BENCH_OUT=arquivo  acrescenta uma linha com o resumo
//   RTS_BENCH_TAG=texto    rótulo da linha (cenário)
//
// Marcadores no stdout: "[bench] inicio", "[bench] mil <k>" e "[bench] fim".
// Com `RTS_GC_DEBUG=1` e stdout+stderr no MESMO arquivo (`> log 2>&1`), as
// linhas `rts-gc` entre "inicio" e "fim" são as coletas da janela medida; a
// soma de `freed` dividida pelos quadros é o lixo por quadro. O runner é
// `bench/claude-frame-bench.mjs`.
//
// Parede = intervalo entre dois `benchFrameEnd` (inclui present/vsync).
// CPU = de `benchFrameBegin` a `benchCpuEnd` (o trabalho do TS antes do
// `endFrame`, sem a espera da GPU/present).
// ═══════════════════════════════════════════════════════════════════════════
import process from "@compat/process.ts";
import fs from "@compat/fs.ts";

/// Limite de "pico" (ms de parede) contado no resumo.
const PICO_MS: f64 = 10.0;

let alvo = 0;
let aquecer = 600;
let saida = "";
let rotulo = "";
let n = 0 - 1;          // quadros medidos (-1 = ainda aquecendo)
let aquecidos = 0;
let tAnterior: f64 = 0.0;
let tCpu: f64 = 0.0;
let parede = new Float64Array(1);
let cpu = new Float64Array(1);

/// Lê o ambiente. Devolve 1 se o bench está ligado.
export function benchInit(): number {
  const pedido = process.env("RTS_BENCH");
  if (pedido === "" || pedido === "0") return 0;
  alvo = parseInt(pedido);
  const w = process.env("RTS_BENCH_WARMUP");
  if (w !== "") aquecer = parseInt(w);
  saida = process.env("RTS_BENCH_OUT");
  rotulo = process.env("RTS_BENCH_TAG");
  parede = new Float64Array(alvo);
  cpu = new Float64Array(alvo);
  return 1;
}

export function benchAtivo(): number { return alvo > 0 ? 1 : 0; }

/// Início do trabalho de CPU do quadro.
export function benchFrameBegin(): void {
  if (alvo === 0) return;
  tCpu = performance.now();
}

/// Fim do trabalho de CPU (logo antes do `endFrame`).
export function benchCpuEnd(): void {
  if (alvo === 0 || n < 0) return;
  if (n < alvo) cpu[n] = performance.now() - tCpu;
}

/// Depois do `endFrame`. Devolve 1 quando a medição acabou (o chamador sai do laço).
export function benchFrameEnd(): number {
  if (alvo === 0) return 0;
  const agora = performance.now();
  if (n < 0) {
    aquecidos = aquecidos + 1;
    if (aquecidos >= aquecer) { n = 0; println("[bench] inicio"); }
    tAnterior = agora;
    return 0;
  }
  parede[n] = agora - tAnterior;
  tAnterior = agora;
  n = n + 1;
  if (n % 1000 === 0 && n < alvo) println("[bench] mil " + n);
  if (n < alvo) return 0;
  println("[bench] fim");
  resumir();
  return 1;
}

function ordenar(v: Float64Array): void {
  // inserção: roda uma vez, no fim, sobre alguns milhares de números
  let i = 1;
  while (i < v.length) {
    const x = v[i];
    let j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j = j - 1; }
    v[j + 1] = x;
    i = i + 1;
  }
}

function fmt(x: f64): string { return x.toFixed(3); }

function resumir(): void {
  let soma: f64 = 0.0; let somaCpu: f64 = 0.0; let max: f64 = 0.0; let maxCpu: f64 = 0.0; let picos = 0;
  let i = 0;
  while (i < alvo) {
    soma = soma + parede[i]; somaCpu = somaCpu + cpu[i];
    if (parede[i] > max) max = parede[i];
    if (cpu[i] > maxCpu) maxCpu = cpu[i];
    if (parede[i] > PICO_MS) picos = picos + 1;
    i = i + 1;
  }
  ordenar(parede); ordenar(cpu);
  const med = parede[(alvo / 2) | 0];
  const p99 = parede[((alvo * 99) / 100) | 0];
  const medCpu = cpu[(alvo / 2) | 0];
  const linha = "[bench] resumo tag=" + rotulo + " quadros=" + alvo +
    " parede_media=" + fmt(soma / alvo) + " parede_mediana=" + fmt(med) + " parede_p99=" + fmt(p99) +
    " parede_max=" + fmt(max) + " picos_10ms=" + picos +
    " cpu_media=" + fmt(somaCpu / alvo) + " cpu_mediana=" + fmt(medCpu) + " cpu_max=" + fmt(maxCpu);
  println(linha);
  if (saida !== "") {
    const antes = fs.exists(saida) ? fs.read_text(saida) : "";
    fs.write(saida, antes + linha + String.fromCharCode(10));
  }
}

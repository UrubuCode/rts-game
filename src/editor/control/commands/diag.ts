import { resourceStatistics } from "@engine/core/resources";
// DIAGNÓSTICO pela porta de controle: `errors` (última exceção com a pilha e
// os ganchos de editor desligados por falha), `prof frames [n]` (distribuição
// do tempo de quadro), `gc` e `assets errors`. Só consultas: nada muda a cena.
import nodeProcess from "node:process";
import { scene } from "@editor/control/session";
import { erroUso } from "@editor/control/builtin_commands";
import { argInt } from "@editor/control/args";
import { FALHA_GIZMO, FALHA_GUI } from "@engine/core/behavior";
import { ultimaExcecao, totalDeExcecoes, falhasDeAsset, limparExcecoes, limparFalhasDeAsset } from "@engine/core/falhas";
import { profEnabled, profQuadrosGuardados, profCopiarQuadros, PROF_JANELA_QUADROS } from "@engine/core/profiler";

const NL: string = "\n";
/// Quadro acima deste tempo conta como pico em `prof frames` (orçamento de
/// ~100 fps; o CLAUDE.md mede o editor contra ele).
export const PROF_PICO_MS: f64 = 10.0;
const BYTES_POR_MB: f64 = 1048576.0;

/// errors — a última exceção capturada (com a pilha) e os componentes cujo
/// gizmo/onInspectorGUI lançou e foi desligado (Behavior.falhasEditor).
export function cmdErrors(parts: string[]): string {
  if (parts.length > 1 && parts[1] === "clear") { limparExcecoes(); return "[ok] errors limpo (excecoes; assets errors clear zera os assets)"; }
  if (parts.length > 1) return erroUso("errors");
  const e = ultimaExcecao();
  let s = "[falhas] excecoes=" + totalDeExcecoes() + " assets_com_falha=" + falhasDeAsset().length;
  if (e === null) s = s + NL + "ultima: nenhuma";
  else {
    s = s + NL + "ultima: [" + e.origem + "] ha " + ((Date.now() - e.quandoMs) / 1000.0).toFixed(1) + "s: " + e.mensagem;
    s = s + NL + "pilha: " + (e.pilha.length > 0 ? NL + e.pilha : "(o runtime nao deu a pilha desta excecao)");
  }
  let n = 0;
  let linhas = "";
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    let c = 0;
    while (c < o.behaviors.length) {
      const b = o.behaviors[c];
      if (b.falhasEditor !== 0) {
        const quais = ((b.falhasEditor & FALHA_GIZMO) !== 0 ? "gizmo " : "") + ((b.falhasEditor & FALHA_GUI) !== 0 ? "onInspectorGUI" : "");
        linhas = linhas + NL + "  #" + i + " " + o.name + " [" + c + "] " + b.typeName() + ": " + quais.trim() + " desligado";
        n = n + 1;
      }
      c = c + 1;
    }
    i = i + 1;
  }
  s = s + NL + "ganchos do editor desligados por falha: " + n + linhas;
  return s;
}

/// Estatística de uma amostra já ordenada.
function percentil(v: Float64Array, n: number, p: f64): f64 {
  if (n === 0) return 0.0;
  let k = Math.ceil(p * n) - 1;
  if (k < 0) k = 0;
  if (k >= n) k = n - 1;
  return v[k];
}
function ordenar(v: Float64Array, n: number): void {
  // inserção: n <= PROF_JANELA_QUADROS e só roda no comando
  let i = 1;
  while (i < n) {
    const x = v[i]; let j = i - 1;
    while (j >= 0 && v[j] > x) { v[j + 1] = v[j]; j = j - 1; }
    v[j + 1] = x;
    i = i + 1;
  }
}
function resumo(nome: string, v: Float64Array, n: number): string {
  let picos = 0;
  let k = 0;
  while (k < n) { if (v[k] > PROF_PICO_MS) picos = picos + 1; k = k + 1; }
  ordenar(v, n);
  return nome + ": min=" + v[0].toFixed(2) + " mediana=" + percentil(v, n, 0.5).toFixed(2) + " p99=" +
    percentil(v, n, 0.99).toFixed(2) + " max=" + v[n - 1].toFixed(2) + " ms, >" + PROF_PICO_MS + "ms=" + picos;
}

/// prof frames [n] — distribuição dos n últimos quadros (padrão: todos os guardados).
export function cmdProfFrames(parts: string[]): string {
  if (parts.length > 3) return erroUso("prof");
  if (profEnabled() === 0) return "[prof] desligado — use `prof on`";
  let n = PROF_JANELA_QUADROS;
  if (parts.length === 3) {
    n = argInt(parts, 2);
    if (!(n >= 1 && n <= PROF_JANELA_QUADROS)) return erroUso("prof") + " (frames n inteiro 1.." + PROF_JANELA_QUADROS + ")";
  }
  const trabalho = new Float64Array(n);
  const k = profCopiarQuadros(trabalho, n, 0);
  if (k === 0) return "[prof] nenhum quadro medido ainda";
  const intervalo = new Float64Array(n);
  profCopiarQuadros(intervalo, n, 1);
  return "[prof] quadros=" + k + " (de " + profQuadrosGuardados() + " guardados)" + NL +
    "  " + resumo("trabalho (begin->end)", trabalho, k) + NL +
    "  " + resumo("intervalo (inicio a inicio)", intervalo, k);
}

/// gc — o runtime não expõe a contagem de coletas ao TS; a memória do processo sim.
export function cmdGc(parts: string[]): string {
  if (parts.length > 1) return erroUso("gc");
  return "[gc] coletas: indisponivel pelo TS (o runtime so as relata com RTS_GC_DEBUG=1: uma linha 'rts-gc' por coleta no stderr do editor)" +
    memoria();
}
function memoria(): string {
  try {
    const m = nodeProcess.memoryUsage();
    return " | rss=" + (m.rss / BYTES_POR_MB).toFixed(1) + "MB heapUsed=" + (m.heapUsed / BYTES_POR_MB).toFixed(1) + "MB";
  } catch (e) { return ""; }
}

/// assets errors [clear] — texturas, modelos, céu e esqueletos que não carregaram.
export function cmdAssets(parts: string[]): string {
  if(parts.length===2&&parts[1]==="resources")return "[resources] "+JSON.stringify(resourceStatistics());
  if (parts.length < 2 || parts[1] !== "errors" || parts.length > 3) return erroUso("assets");
  if (parts.length === 3) {
    if (parts[2] !== "clear") return erroUso("assets");
    limparFalhasDeAsset();
    return "[ok] assets errors limpo";
  }
  const f = falhasDeAsset();
  let s = "[assets] falhas=" + f.length;
  let i = 0;
  while (i < f.length) {
    s = s + NL + "  " + f[i].tipo + " " + f[i].caminho + " (x" + f[i].vezes + "): " + f[i].motivo;
    i = i + 1;
  }
  return s;
}

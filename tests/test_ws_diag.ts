// Teste SEM JANELA dos comandos de DIAGNÓSTICO: `log tail`, `errors` (última
// exceção com a pilha + ganchos de editor desligados), `prof frames` (min,
// mediana, p99, max, picos > 10 ms), `gc` e `assets errors`.
//
//   rts.exe run tests/test_ws_diag.ts
import io from "@compat/io.ts";
import { registerCommand } from "@editor/api";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { logInfo, logClear, setLogEcho } from "@engine/core/logger";
import { FALHA_GIZMO } from "@engine/core/behavior";
import { profEnable, profReset, profFrameBegin, profFrameEnd } from "@engine/core/profiler";
import { loadModel } from "@engine/render/model";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(c: string): string { return execCommand(800, 600, c); }
instalarEditorReal();
setLogEcho(0);

// ── log tail ────────────────────────────────────────────────────────────────
logClear();
let i = 0;
while (i < 6) { logInfo("mensagem " + i); i = i + 1; }
const tail = cmd("log tail 3");
check(tail.indexOf("mensagem 5") > 0 && tail.indexOf("mensagem 3") > 0 && tail.indexOf("mensagem 2") < 0, "tail 3: " + tail);
check(cmd("log tail").indexOf("mensagem 0") > 0, "tail sem n = 20");
check(cmd("log tail x").indexOf("[erro]") === 0 && cmd("log tail 0").indexOf("[erro]") === 0, "tail invalido");
check(cmd("log clear") === "[log] limpo", "clear");

// ── errors ─────────────────────────────────────────────────────────────────
check(cmd("errors clear").indexOf("[ok] errors limpo") === 0, "errors clear");
const vazio = cmd("errors");
check(vazio.indexOf("[falhas] excecoes=0") === 0 && vazio.indexOf("ultima: nenhuma") > 0 && vazio.indexOf("desligados por falha: 0") > 0, "vazio: " + vazio);
registerCommand("teste_diag_lanca", "teste_diag_lanca :: lanca", false, (p: string[]) => { throw new Error("falhou de proposito"); });
check(cmd("teste_diag_lanca").indexOf("[erro] teste_diag_lanca: falhou de proposito") === 0, "comando lanca");
scene.clear();
cmd("spawn Alvo 0 0 0");
cmd("addcomp Alvo Spinner");
scene.objects[0].behaviors[0].falhasEditor = FALHA_GIZMO;
const e = cmd("errors");
check(e.indexOf("[falhas] excecoes=1") === 0, "conta: " + e);
check(e.indexOf("ultima: [comando teste_diag_lanca]") > 0 && e.indexOf("falhou de proposito") > 0, "origem e mensagem: " + e);
check(e.indexOf("pilha:") > 0 && e.indexOf("    at ") > 0, "pilha do runtime: " + e);
check(e.indexOf("desligados por falha: 1") > 0 && e.indexOf("#0 Alvo [0] Spinner: gizmo desligado") > 0, "gancho desligado: " + e);
check(cmd("errors x").indexOf("[erro] uso") === 0, "errors uso");

// ── prof frames ────────────────────────────────────────────────────────────
profEnable(1); profReset();
check(cmd("prof frames").indexOf("[prof] nenhum quadro") === 0, "sem quadros");
i = 0;
while (i < 100) {
  profFrameBegin();
  if (i === 50) { const t0 = performance.now(); while (performance.now() - t0 < 12.0) {} }   // um pico
  profFrameEnd();
  i = i + 1;
}
const pf = cmd("prof frames");
check(pf.indexOf("[prof] quadros=100 (de 100 guardados)") === 0, "todos: " + pf);
check(pf.indexOf("trabalho (begin->end): min=") > 0 && pf.indexOf("mediana=") > 0 && pf.indexOf("p99=") > 0, "campos: " + pf);
check(pf.indexOf(">10ms=1") > 0, "um pico no trabalho: " + pf);
const pf10 = cmd("prof frames 10");
check(pf10.indexOf("[prof] quadros=10") === 0 && pf10.indexOf("trabalho (begin->end): min=") > 0 && pf10.split(">10ms=0").length === 3, "os 10 ultimos, sem o pico: " + pf10);
check(cmd("prof frames 0").indexOf("[erro]") === 0 && cmd("prof frames x").indexOf("[erro]") === 0 && cmd("prof frames 5000").indexOf("[erro]") === 0, "invalidos");
profEnable(0);
check(cmd("prof frames").indexOf("desligado") > 0, "desligado");
profEnable(1);

// ── gc ─────────────────────────────────────────────────────────────────────
const gc = cmd("gc");
check(gc.indexOf("[gc] coletas:") === 0 && gc.indexOf("RTS_GC_DEBUG=1") > 0, "gc: " + gc);
check(cmd("gc x").indexOf("[erro]") === 0, "gc uso");

// ── assets errors ──────────────────────────────────────────────────────────
check(cmd("assets errors clear") === "[ok] assets errors limpo", "limpa");
check(cmd("assets errors") === "[assets] falhas=0", "vazio");
loadModel(0, "assets/claude_nao_existe.obj");
loadModel(0, "assets/claude_nao_existe.obj");
const ae = cmd("assets errors");
check(ae.indexOf("[assets] falhas=1") === 0 && ae.indexOf("modelo assets/claude_nao_existe.obj (x2)") > 0, "modelo que falhou: " + ae);
check(cmd("errors").indexOf("assets_com_falha=1") > 0, "errors conta os assets");
check(cmd("errors clear").indexOf("[ok]") === 0 && cmd("assets errors").indexOf("[assets] falhas=1") === 0, "errors clear nao apaga os assets");
check(cmd("assets").indexOf("[erro] uso") === 0 && cmd("assets x").indexOf("[erro] uso") === 0, "assets uso");
io.print("[PASSOU] ws diag: log tail, errors (excecao, pilha, ganchos), prof frames (picos), gc, assets errors");

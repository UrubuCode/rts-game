// Teste SEM JANELA de `build` e `run tests`/`testes` pela porta de controle:
// o build espera o EditorBuild terminar (aqui com um status falso, sem
// compilar), recusa no Play e informa pasta/exe/log; os testes rodam no
// runtime, um processo por arquivo, e a resposta diz passou/falhou por
// arquivo (com um teste que falha de propósito).
//
//   rts.exe run tests/test_ws_build.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { S } from "@editor/control/session";
import { RESPOSTA_ADIADA, tomarAdiado, avancarAdiado, Adiado } from "@editor/control/adiado";
import { editorBuild } from "@editor/editor_build";
import { casaCuringa, testesQueCasam, runtimeDosTestes, testesEmAndamento } from "@editor/control/commands/build";
import { rodarTarefasDeFundo, haTarefasDeFundo } from "@editor/control/processos";
import { setLogEcho } from "@engine/core/logger";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(c: string): string { return execCommand(800, 600, c); }
function adiado(c: string): Adiado {
  const out = cmd(c);
  check(out === RESPOSTA_ADIADA, c + " deveria adiar: " + out);
  const a = tomarAdiado();
  check(a !== null, c + ": espera");
  return a;
}
function esperar(a: Adiado): string {
  while (!avancarAdiado(a)) pumpEvents();
  return a.texto;
}
instalarEditorReal();
setLogEcho(0);

// ── padrões ────────────────────────────────────────────────────────────────
check(casaCuringa("test_ws_lote.ts", "test_ws_*") && casaCuringa("abc", "a*c") && casaCuringa("abc", "*") &&
  !casaCuringa("abc", "a*d") && casaCuringa("ab", "ab*") && !casaCuringa("xab", "ab*"), "curinga");
const q = testesQueCasam("test_quat");
check(q.length === 1 && q[0] === "test_quat.ts", "trecho: " + q.join(","));
const ws = testesQueCasam("test_ws_*");
check(ws.indexOf("test_ws_build.ts") >= 0 && ws.indexOf("test_ws_lote.ts") >= 0 && ws.indexOf("test_quat.ts") < 0, "curinga: " + ws.join(","));
check(runtimeDosTestes().length > 0, "acha o runtime ao lado do processo");

// ── run tests / testes ─────────────────────────────────────────────────────
check(cmd("run").indexOf("[erro] uso") === 0 && cmd("run x").indexOf("[erro] uso") === 0 && cmd("run tests a b").indexOf("[erro] uso") === 0, "uso");
check(cmd("testes claude_nao_existe_*").indexOf("[erro] testes: nenhum arquivo") === 0, "nenhum arquivo");
function apagar(p: string): void { if (fs.exists(p)) fs.remove_file(p); }
const OK = "tests/claude_tmp_run_ok.ts";
const FALHA = "tests/claude_tmp_run_falha.ts";
fs.write(OK, "import io from \"@compat/io.ts\";\nio.print(\"[PASSOU] tmp\");\n");
fs.write(FALHA, "import io from \"@compat/io.ts\";\nio.print(\"antes\");\nthrow new Error(\"quebrou de proposito\");\n");
let r = "";
// os arquivos temporários saem mesmo se uma checagem falhar
try {
  const t = adiado("testes claude_tmp_run_*");
  check(cmd("run tests claude_tmp_run_ok").indexOf("[erro] run: ja ha testes rodando") === 0, "um de cada vez");
  r = esperar(t);
} finally { apagar(OK); apagar(FALHA); }
check(r.indexOf("[erro] testes: 1 de 2 falharam em ") === 0, "resumo: " + r);
check(r.indexOf("  ok claude_tmp_run_ok.ts (") > 0, "o que passou: " + r);
check(r.indexOf("  FALHOU claude_tmp_run_falha.ts (codigo ") > 0 && r.indexOf("quebrou de proposito") > 0, "o que falhou, com a saida: " + r);
// resposta abandonada (o cliente caiu): o processo morre e a vaga libera
const ab = adiado("run tests test_quat");
check(testesEmAndamento() && haTarefasDeFundo(), "rodando, com vigia");
ab.abandonado = true;
rodarTarefasDeFundo();
check(!testesEmAndamento() && !haTarefasDeFundo(), "abandonada: processo morto, atual livre");
const r2 = esperar(adiado("run tests test_quat"));
check(r2.indexOf("[ok] testes: 1/1 passaram") === 0 && r2.indexOf("ok test_quat.ts") > 0, "run tests: " + r2);

// ── build (status falso: o mesmo arquivo que tools/editor-build.mjs escreve) ─
check(cmd("build status") === "[build] nenhum build nesta sessao", "sem build");
check(cmd("build x").indexOf("[erro] uso") === 0, "uso build");
S.simulating = 1;
check(cmd("build").indexOf("[erro] build: indisponivel durante o Play") === 0, "Play bloqueia");
S.simulating = 0;
const dir = "build/claude-build-ws-" + Date.now();
fs.create_dir_all(dir);
try {
fs.write(dir + "/status.json", JSON.stringify({ state: "running", message: "Compilando jogo..." }));
editorBuild.directory = dir; editorBuild.started = Date.now(); editorBuild.running = true; editorBuild.lastPoll = 0; editorBuild.estado = "";
const b = adiado("build");   // já em andamento: espera o mesmo build
editorBuild.lastPoll = 0;
check(!avancarAdiado(b), "ainda compilando");
check(cmd("build status").indexOf("[build] em andamento | dir=" + dir) === 0, "status em andamento");
fs.write(dir + "/output.log", "saida do compilador\n");
fs.write(dir + "/status.json", JSON.stringify({ state: "ok", message: "Build concluido: " + dir + "/RTSGame.exe" }));
editorBuild.lastPoll = 0;
const rb = esperar(b);
check(rb.indexOf("[ok] build ok | dir=" + dir + " | exe=" + dir + "/RTSGame.exe") === 0, "build ok: " + rb);
check(cmd("build status").indexOf("[build] ultimo: [ok] build ok") === 0, "status do ultimo");
// falha
fs.write(dir + "/status.json", JSON.stringify({ state: "error", message: "Compilacao falhou. Consulte o Console." }));
editorBuild.running = true; editorBuild.started = Date.now(); editorBuild.lastPoll = 0;
const rf = esperar(adiado("build"));
check(rf.indexOf("[erro] build error: Compilacao falhou") === 0 && rf.indexOf("log=" + dir + "/output.log") > 0, "build falhou: " + rf);
} finally { if (fs.exists(dir)) fs.remove_dir_all(dir); }
io.print("[PASSOU] ws build/testes: padroes, testes por processo (passou/falhou com a saida), build espera o EditorBuild, Play bloqueia");

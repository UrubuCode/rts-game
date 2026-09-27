// BUILD e TESTES pela porta de controle, como um CI: `build` dispara o mesmo
// EditorBuild do botão e responde quando ele termina; `run tests [padrão]`
// (alias `testes`) roda tests/*.ts no runtime, um processo por arquivo, com
// prazo, e responde passou/falhou por arquivo. Nenhum dos dois muda a cena: o
// build grava um snapshot na própria pasta, e os testes rodam em outro processo.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import nodeProcess from "node:process";
import fs from "@compat/fs.ts";
import { S } from "@editor/control/session";
import { erroUso } from "@editor/control/builtin_commands";
import { novoAdiado, RESPOSTA_ADIADA, Adiado } from "@editor/control/adiado";
import { editorBuild, BUILD_FINISH_TIMEOUT_MS } from "@editor/editor_build";

/// Folga sobre o prazo do próprio build para a resposta.
const BUILD_FOLGA_MS: number = 30000;
export const TESTES_PASTA: string = "tests";
/// Padrão sem argumento: os testes nomeados (as sondas claude-* ficam de fora).
export const TESTES_PADRAO: string = "test_*";
/// Prazo de UM arquivo de teste (compila e roda); estourou, o processo é morto.
export const TESTE_PRAZO_MS: number = 180000;
/// Linhas finais da saída guardadas de um teste que falhou.
const TESTE_LINHAS_FALHA: number = 3;
const NL: string = "\n";

function respostaBuild(): string {
  const dir = " | dir=" + editorBuild.directory;
  if (editorBuild.estado === "ok") return "[ok] build ok" + dir + " | exe=" + editorBuild.directory + "/RTSGame.exe | " + editorBuild.status;
  return "[erro] build " + (editorBuild.estado.length > 0 ? editorBuild.estado : "falhou") + ": " + editorBuild.status + dir +
    " | log=" + editorBuild.directory + "/output.log";
}

/// build [status] — o build do botão; a resposta vem quando ele termina.
export function cmdBuild(parts: string[]): string {
  if (parts.length > 2 || (parts.length === 2 && parts[1] !== "status")) return erroUso("build");
  if (parts.length === 2) {
    if (editorBuild.running) return "[build] em andamento | dir=" + editorBuild.directory + " | " + editorBuild.status;
    if (editorBuild.directory.length === 0) return "[build] nenhum build nesta sessao";
    return "[build] ultimo: " + respostaBuild();
  }
  if (S.simulating !== 0) return "[erro] build: indisponivel durante o Play (use stop)";
  const jaRodando = editorBuild.running;
  if (!jaRodando) {
    editorBuild.start();
    if (!editorBuild.running) return "[erro] build: " + editorBuild.status;
  }
  const espera = novoAdiado("build", BUILD_FINISH_TIMEOUT_MS + BUILD_FOLGA_MS);
  espera.verificar = () => {
    editorBuild.poll();   // o laço do editor já faz isto; sem janela (testes), é aqui
    if (!editorBuild.running) espera.concluir(respostaBuild());
  };
  return RESPOSTA_ADIADA;
}

// ── run tests ───────────────────────────────────────────────────────────────

/// Arquivos de tests/ (.ts) que casam com o padrão: com `*` é curinga do nome
/// inteiro; sem, é trecho do nome. Em ordem alfabética.
export function testesQueCasam(padrao: string): string[] {
  const out: string[] = [];
  const nomes = fs.readdir(TESTES_PASTA);
  const curinga = padrao.indexOf("*") >= 0;
  let i = 0;
  while (i < nomes.length) {
    const n = nomes[i];
    if (n.length > 3 && n.substring(n.length - 3) === ".ts") {
      const semExt = n.substring(0, n.length - 3);
      if (curinga ? (casaCuringa(n, padrao) || casaCuringa(semExt, padrao)) : n.indexOf(padrao) >= 0) out.push(n);
    }
    i = i + 1;
  }
  out.sort();
  return out;
}

/// `nome` casa com `padrao`, em que `*` vale qualquer trecho (inclusive vazio).
export function casaCuringa(nome: string, padrao: string): boolean {
  let i = 0; let j = 0; let estrela = 0 - 1; let marca = 0;
  while (i < nome.length) {
    if (j < padrao.length && padrao.charCodeAt(j) !== 42 && padrao.charCodeAt(j) === nome.charCodeAt(i)) { i = i + 1; j = j + 1; }
    else if (j < padrao.length && padrao.charCodeAt(j) === 42) { estrela = j; marca = i; j = j + 1; }
    else if (estrela >= 0) { j = estrela + 1; marca = marca + 1; i = marca; }
    else return false;
  }
  while (j < padrao.length && padrao.charCodeAt(j) === 42) j = j + 1;
  return j === padrao.length;
}

/// O runtime que roda os testes: RTS_COMPILER, ou o rts.exe ao lado do
/// processo atual (o editor é target/release/examples/ui_fixture.exe; um
/// teste é target/release/rts.exe). "" = deixa tools/rts-run.mjs procurar.
export function runtimeDosTestes(): string {
  const env = nodeProcess.env.RTS_COMPILER;
  if (typeof env === "string" && env.length > 0 && fs.exists(env)) return env;
  const exe = nodeProcess.execPath;
  if (typeof exe === "string" && exe.length > 0) {
    const irmao = join(dirname(exe), "rts.exe");
    if (fs.exists(irmao)) return irmao;
    const acima = join(dirname(dirname(exe)), "rts.exe");
    if (fs.exists(acima)) return acima;
  }
  return "";
}

class Execucao {
  arquivos: string[] = [];
  indice: number = 0;
  runtime: string = "";
  filho: any = null;
  inicioArquivo: number = 0;
  inicio: number = 0;
  saida: string = "";
  passaram: number = 0;
  linhas: string[] = [];
  espera: Adiado | null = null;
}
let atual: Execucao | null = null;

function ultimasLinhas(s: string): string {
  const ls = s.split("\n");
  const boas: string[] = [];
  let i = ls.length - 1;
  while (i >= 0 && boas.length < TESTE_LINHAS_FALHA) {
    const l = ls[i].split("\r").join("").trim();
    if (l.length > 0) boas.unshift(l);
    i = i - 1;
  }
  return boas.join(" / ");
}

function segundos(ms: number): string { return (ms / 1000.0).toFixed(1) + "s"; }

function terminarArquivo(e: Execucao, codigo: any, estourou: boolean): void {
  const nome = e.arquivos[e.indice];
  const ms = Date.now() - e.inicioArquivo;
  if (!estourou && codigo === 0) { e.passaram = e.passaram + 1; e.linhas.push("  ok " + nome + " (" + segundos(ms) + ")"); }
  else {
    const motivo = estourou ? "prazo de " + segundos(TESTE_PRAZO_MS) + " estourado" : "codigo " + codigo;
    e.linhas.push("  FALHOU " + nome + " (" + motivo + ", " + segundos(ms) + "): " + ultimasLinhas(e.saida));
  }
  e.filho = null;
  e.indice = e.indice + 1;
  iniciarProximo(e);
}

function concluir(e: Execucao): void {
  const n = e.arquivos.length;
  const cab = e.passaram === n ? "[ok] testes: " + n + "/" + n + " passaram" : "[erro] testes: " + (n - e.passaram) + " de " + n + " falharam";
  atual = null;
  if (e.espera !== null) e.espera.concluir(cab + " em " + segundos(Date.now() - e.inicio) + NL + e.linhas.join(NL));
}

function iniciarProximo(e: Execucao): void {
  if (e.indice >= e.arquivos.length || (e.espera !== null && e.espera.abandonado)) { concluir(e); return; }
  const arquivo = TESTES_PASTA + "/" + e.arquivos[e.indice];
  e.saida = ""; e.inicioArquivo = Date.now();
  const erro = dispararTeste(e, arquivo);
  if (erro.length > 0) { e.saida = erro; terminarArquivo(e, 0 - 1, false); }
}

/// Um processo por arquivo (numa função própria por causa do `try`).
function dispararTeste(e: Execucao, arquivo: string): string {
  try {
    const prog = e.runtime.length > 0 ? e.runtime : "node";
    const args: string[] = e.runtime.length > 0 ? ["run", arquivo] : ["tools/rts-run.mjs", arquivo];
    const c = spawn(prog, args, { windowsHide: true });
    e.filho = c;   // referenciado enquanto os eventos chegam
    c.on("error", (x: any) => { if (e.filho === c) { e.saida = "nao iniciou: " + String(x); terminarArquivo(e, 0 - 1, false); } });
    if (c.stdout !== null && c.stdout !== undefined) c.stdout.on("data", (d: any) => { e.saida = e.saida + d.toString(); });
    if (c.stderr !== null && c.stderr !== undefined) c.stderr.on("data", (d: any) => { e.saida = e.saida + d.toString(); });
    c.on("exit", (codigo: any) => { if (e.filho === c) terminarArquivo(e, codigo, false); });
    return "";
  } catch (x) { return "nao iniciou: " + String(x); }
}

/// run tests [padrão] | testes [padrão]
export function cmdRunTests(parts: string[]): string {
  const nome = parts[0];
  const de = nome === "run" ? 2 : 1;
  if (nome === "run" && (parts.length < 2 || parts[1] !== "tests")) return erroUso("run");
  if (parts.length > de + 1) return erroUso(nome);
  if (atual !== null) return "[erro] " + nome + ": ja ha testes rodando (" + atual.indice + " de " + atual.arquivos.length + ")";
  const padrao = parts.length > de ? parts[de] : TESTES_PADRAO;
  const arquivos = testesQueCasam(padrao);
  if (arquivos.length === 0) return "[erro] " + nome + ": nenhum arquivo em " + TESTES_PASTA + "/ casa com '" + padrao + "'";
  const e = new Execucao();
  e.arquivos = arquivos; e.runtime = runtimeDosTestes(); e.inicio = Date.now();
  e.espera = novoAdiado(nome, arquivos.length * TESTE_PRAZO_MS + BUILD_FOLGA_MS);
  e.espera.verificar = () => {
    // prazo por arquivo: mata o processo; o `exit` segue para o próximo
    if (e.filho !== null && Date.now() - e.inicioArquivo >= TESTE_PRAZO_MS) {
      const c = e.filho;
      e.filho = null;
      c.kill();
      terminarArquivo(e, 0 - 1, true);
    }
  };
  atual = e;
  iniciarProximo(e);
  return RESPOSTA_ADIADA;
}

// Processos filhos da porta de controle (captura, testes) e as TAREFAS DE
// FUNDO que os vigiam. Uma tarefa roda 1x por quadro pelo `ctrlPoll` enquanto
// existir — independentemente de haver uma conexão esperando a resposta — e
// sai da lista quando devolve true. Sem tarefa, o custo por quadro é um
// `length > 0`.
import { spawnSync } from "node:child_process";
import nodeProcess from "node:process";

const tarefas: any[] = [];

/// Registra `f(): boolean` (true = acabou, sai da lista).
export function tarefaDeFundo(f: any): void { tarefas.push(f); }
export function haTarefasDeFundo(): boolean { return tarefas.length > 0; }
/// Um passo de todas as tarefas (chamado pelo ctrlPoll quando há alguma).
export function rodarTarefasDeFundo(): void {
  let i = 0;
  while (i < tarefas.length) {
    if (tarefas[i]()) tarefas.splice(i, 1);
    else i = i + 1;
  }
}

/// Mata o processo `c` E os filhos dele. No Windows, `kill()` mata só o
/// processo direto: `node tools/rts-run.mjs` deixaria o rts.exe neto vivo, e o
/// PowerShell da captura segue até terminar. `taskkill /T /F` leva a árvore.
export function matarArvore(c: any): void {
  if (c === null || c === undefined) return;
  const pid = c.pid;
  if (nodeProcess.platform === "win32" && typeof pid === "number") matarNoWindows(pid);
  else matarDireto(c);
}
function matarNoWindows(pid: number): void {
  try { spawnSync("taskkill", ["/T", "/F", "/PID", "" + pid], { windowsHide: true }); } catch (e) { }
}
function matarDireto(c: any): void {
  try { c.kill(); } catch (e) { }
}

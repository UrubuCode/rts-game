// LOTE (transação) da porta de controle: `batch begin` … `batch end` (alias
// `txn`). Todos os comandos de dentro viram UMA entrada de Desfazer; no
// primeiro `[erro]` o lote inteiro é desfeito (pelo caminho do Desfazer,
// `History.aplicar`) e a resposta diz qual linha falhou. As linhas seguintes,
// até o `batch end`, são recusadas sem rodar.
//
// O estado é do editor (um lote por vez), não da conexão: comandos de outro
// cliente no meio de um lote entram nele.
import { history, HISTORY_CAP } from "@editor/undo";
import { sceneToJSON } from "@editor/sceneio";
import { COMANDOS_ASSINCRONOS } from "@editor/control/builtin_commands";

/// Não cabem num lote: mexem no próprio histórico, trocam a cena do Play ou
/// respondem depois (a transação não pode ficar aberta esperando).
const FORA_DO_LOTE: string[] = ["undo", "redo", "play", "stop", "resume", "step", "batch", "txn",
  "build", "run", "testes"];

class EstadoLote {
  ativo: boolean = false;
  abortado: boolean = false;
  linhas: number = 0;
  linhaFalha: number = 0;
  comandoFalha: string = "";
  cenaAntes: string = "";
  undoAntes: string[] = [];
  redoAntes: string[] = [];
}
const lote = new EstadoLote();

export function loteAtivo(): boolean { return lote.ativo; }
export function loteAbortado(): boolean { return lote.abortado; }

function voltarAoInicio(): void {
  if (lote.cenaAntes !== sceneToJSON()) history.aplicar(lote.cenaAntes);
  history.u = lote.undoAntes; history.r = lote.redoAntes;
  history.versao = history.versao + 1;
}

function fechar(): void {
  lote.ativo = false; lote.abortado = false; lote.cenaAntes = "";
  lote.undoAntes = []; lote.redoAntes = [];
}

/// batch|txn begin|end|cancel
export function cmdLote(parts: string[]): string {
  const nome = parts[0];
  const sub = parts.length === 2 ? parts[1] : "";
  if (sub === "begin") {
    if (lote.ativo) return "[erro] " + nome + ": ja ha um lote aberto (" + lote.linhas + " linhas); feche com '" + nome + " end' ou '" + nome + " cancel'";
    lote.ativo = true; lote.abortado = false; lote.linhas = 0; lote.linhaFalha = 0; lote.comandoFalha = "";
    lote.cenaAntes = sceneToJSON(); lote.undoAntes = history.u.slice(); lote.redoAntes = history.r;
    return "[ok] " + nome + " aberto: os comandos seguintes viram 1 entrada de Desfazer ate '" + nome + " end'";
  }
  if (sub === "end" || sub === "cancel") {
    if (!lote.ativo) return "[erro] " + nome + ": nenhum lote aberto";
    const n = lote.linhas;
    if (lote.abortado) {
      const msg = "[erro] " + nome + ": abortado na linha " + lote.linhaFalha + " (" + lote.comandoFalha + "); nada foi aplicado";
      fechar();
      return msg;
    }
    if (sub === "cancel") { voltarAoInicio(); fechar(); return "[ok] " + nome + " cancelado: " + n + " comandos desfeitos"; }
    const antes = lote.cenaAntes;
    if (antes === sceneToJSON()) {
      history.u = lote.undoAntes; history.r = lote.redoAntes; history.versao = history.versao + 1;
      fechar();
      return "[ok] " + nome + ": " + n + " comandos, cena sem mudanca (nada no Desfazer)";
    }
    // uma entrada: a cena de antes do lote, sobre a pilha de antes do lote
    const u = lote.undoAntes;
    u.push(antes);
    while (u.length > HISTORY_CAP) u.shift();
    history.u = u; history.r = []; history.versao = history.versao + 1;
    fechar();
    return "[ok] " + nome + ": " + n + " comandos, 1 entrada de Desfazer";
  }
  return "[erro] uso: " + nome + " begin | " + nome + " end | " + nome + " cancel";
}

/// Antes de um comando dentro do lote: "" = pode rodar; senão a resposta.
export function antesNoLote(line: string): string {
  const c = line.split(" ")[0];
  if (lote.abortado) return "[erro] batch abortado na linha " + lote.linhaFalha + "; ignorado ate 'batch end': " + line;
  lote.linhas = lote.linhas + 1;
  if (FORA_DO_LOTE.indexOf(c) >= 0 || COMANDOS_ASSINCRONOS.indexOf(c) >= 0) return "[erro] " + c + ": nao cabe num lote";
  return "";
}

/// Depois de um comando dentro do lote: um `[erro]` desfaz o lote inteiro.
export function depoisNoLote(line: string, out: string): string {
  if (out.indexOf("[erro]") !== 0) return out;
  voltarAoInicio();
  lote.abortado = true; lote.linhaFalha = lote.linhas; lote.comandoFalha = line;
  return "[erro] batch linha " + lote.linhas + " (" + line + "): " + out + " | lote desfeito";
}

// LOTE (transação) da porta de controle: `batch begin` … `batch end` (alias
// `txn`). Todos os comandos de dentro viram UMA entrada de Desfazer; no
// primeiro `[erro]` o lote inteiro é desfeito (pelo caminho do Desfazer,
// `History.aplicar`) e a resposta diz qual linha falhou. As linhas seguintes,
// até o `batch end`, são recusadas sem rodar.
//
// O lote tem DONO: a conexão que o abriu (conexao.ts). Comandos de outra
// conexão são recusados enquanto ele está aberto, e se o dono fechar a
// conexão o lote é cancelado (desfeito) — um cliente que caiu não deixa uma
// transação aberta engolindo o que vier depois.
//
// Edições de FORA da porta durante o lote (o humano mexendo na UI tira
// snapshots próprios) não são apagadas: o lote percebe pela `history.versao`
// e, nesse caso, não agrupa o Desfazer nem restaura a cena inteira numa falha.
import { history, HISTORY_CAP } from "@editor/undo";
import { sceneToJSON } from "@editor/sceneio";
import { COMANDOS_ASSINCRONOS } from "@editor/control/builtin_commands";
import { conexaoAtual, aoFecharConexao } from "@editor/control/conexao";
import { logWarn } from "@engine/core/logger";

/// Não cabem num lote: mexem no próprio histórico, trocam a cena do Play ou
/// respondem depois (a transação não pode ficar aberta esperando).
const FORA_DO_LOTE: string[] = ["undo", "redo", "play", "stop", "resume", "step", "batch", "txn",
  "build", "run", "testes"];

class EstadoLote {
  ativo: boolean = false;
  abortado: boolean = false;
  dono: number = 0;
  linhas: number = 0;
  linhaFalha: number = 0;
  comandoFalha: string = "";
  cenaAntes: string = "";
  undoAntes: string[] = [];
  redoAntes: string[] = [];
  /// `history.versao` na abertura e quanto dela subiu pelos comandos do lote.
  versaoInicio: number = 0;
  versaoPropria: number = 0;
}
const lote = new EstadoLote();

export function loteAtivo(): boolean { return lote.ativo; }
export function loteAbortado(): boolean { return lote.abortado; }
/// Há um lote aberto por OUTRA conexão que não a do comando atual?
export function loteDeOutraConexao(): boolean { return lote.ativo && conexaoAtual() !== lote.dono; }
export const ERRO_LOTE_DE_OUTRA: string = "[erro] lote aberto por outra conexão; espere o 'batch end' dela";

/// Houve snapshots de fora da porta (a UI) desde a abertura?
function houveEdicaoDeFora(): boolean {
  return history.versao - lote.versaoInicio - lote.versaoPropria > 0;
}

function voltarAoInicio(): void {
  if (lote.cenaAntes !== sceneToJSON()) history.aplicar(lote.cenaAntes);
  history.u = lote.undoAntes; history.r = lote.redoAntes;
  history.versao = history.versao + 1;
}

function fechar(): void {
  lote.ativo = false; lote.abortado = false; lote.cenaAntes = "";
  lote.undoAntes = []; lote.redoAntes = []; lote.dono = 0;
}

// O dono caiu: cancela (desfaz o que o lote aplicou, se nada de fora mudou).
aoFecharConexao((id: number) => {
  if (!lote.ativo || id !== lote.dono) return;
  const n = lote.linhas;
  if (!lote.abortado && !houveEdicaoDeFora()) voltarAoInicio();
  fechar();
  logWarn("Lote da porta de controle cancelado: a conexao dona fechou sem 'batch end' (" + n + " comandos desfeitos).");
});

/// batch|txn begin|end|cancel
export function cmdLote(parts: string[]): string {
  const nome = parts[0];
  const sub = parts.length === 2 ? parts[1] : "";
  if (sub === "begin") {
    if (lote.ativo) return "[erro] " + nome + ": ja ha um lote aberto (" + lote.linhas + " linhas); feche com '" + nome + " end' ou '" + nome + " cancel'";
    lote.ativo = true; lote.abortado = false; lote.linhas = 0; lote.linhaFalha = 0; lote.comandoFalha = "";
    lote.dono = conexaoAtual();
    lote.cenaAntes = sceneToJSON(); lote.undoAntes = history.u.slice(); lote.redoAntes = history.r;
    lote.versaoInicio = history.versao; lote.versaoPropria = 0;
    return "[ok] " + nome + " aberto: os comandos seguintes viram 1 entrada de Desfazer ate '" + nome + " end'";
  }
  if (sub === "end" || sub === "cancel") {
    if (!lote.ativo) return "[erro] " + nome + ": nenhum lote aberto";
    const n = lote.linhas;
    if (lote.abortado) {
      const msg = "[erro] " + nome + ": abortado na linha " + lote.linhaFalha + " (" + lote.comandoFalha + ")";
      fechar();
      return msg;
    }
    if (houveEdicaoDeFora()) {
      // o humano editou no meio: agrupar ou restaurar apagaria o trabalho dele
      fechar();
      return "[ok] " + nome + ": " + n + " comandos; houve edicoes fora do lote, entao o Desfazer NAO foi agrupado" +
        (sub === "cancel" ? " e nada foi desfeito (use undo)" : "");
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

/// Quanto `history.versao` subiu por um comando do lote (para separar das edições de fora).
export function contarVersaoDoLote(delta: number): void { lote.versaoPropria = lote.versaoPropria + delta; }

/// Depois de um comando dentro do lote: um `[erro]` desfaz o lote inteiro.
export function depoisNoLote(line: string, out: string): string {
  if (out.indexOf("[erro]") !== 0) return out;
  lote.abortado = true; lote.linhaFalha = lote.linhas; lote.comandoFalha = line;
  if (houveEdicaoDeFora()) {
    return "[erro] batch linha " + lote.linhas + " (" + line + "): " + out +
      " | lote NAO desfeito: houve edicoes fora do lote (use undo para voltar o que o lote aplicou)";
  }
  voltarAoInicio();
  return "[erro] batch linha " + lote.linhas + " (" + line + "): " + out + " | lote desfeito";
}

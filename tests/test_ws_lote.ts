// Teste SEM JANELA do LOTE (`batch begin` … `batch end`, alias `txn`): os
// comandos de dentro viram UMA entrada de Desfazer; no primeiro [erro] o lote
// inteiro volta (cena e pilhas de Desfazer/Refazer como antes) e a resposta
// diz a linha; as linhas seguintes são recusadas até o `end`; comandos que
// mexem no histórico ou respondem depois não cabem num lote.
//
//   rts.exe run tests/test_ws_lote.ts
import io from "@compat/io.ts";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { scene } from "@editor/control/session";
import { sceneToJSON } from "@editor/sceneio";
import { loteAtivo } from "@editor/control/lote";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(c: string): string { return execCommand(800, 600, c); }
function cena(): string {
  const d = JSON.parse(sceneToJSON());
  let k = 0;
  while (k < d.objects.length) { d.objects[k].id = 0; k = k + 1; }
  return JSON.stringify(d);
}
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
check(cmd("spawn A 0 0 0").indexOf("[ok]") === 0, "spawn A");
check(cmd("move A 1 1 1").indexOf("[ok]") === 0 && cmd("undo").indexOf("[ok]") === 0, "Refazer nao vazio");
const u0 = history.undoDepth(); const r0 = history.redoDepth();
const cena0 = cena();

// ── sucesso: 4 comandos = 1 entrada de Desfazer ───────────────────────────
check(cmd("batch begin").indexOf("[ok] batch aberto") === 0 && loteAtivo(), "abre");
check(cmd("batch begin").indexOf("[erro]") === 0, "lote aninhado recusado");
check(cmd("spawn B 1 0 0").indexOf("[ok]") === 0, "spawn B");
check(cmd("move B 2 3 4").indexOf("[ok]") === 0, "move B");
check(cmd("rename B Bravo").indexOf("[ok]") === 0, "rename");
check(cmd("state").indexOf("[state]") === 0, "consulta no lote");
const fim = cmd("batch end");
check(fim === "[ok] batch: 4 comandos, 1 entrada de Desfazer" && !loteAtivo(), "fecha: " + fim);
check(history.undoDepth() === u0 + 1 && history.redoDepth() === 0, "uma entrada: " + history.undoDepth() + "/" + history.redoDepth());
check(scene.objects.length === 2 && scene.objects[1].name === "Bravo" && scene.objects[1].transform.px === 2, "aplicado");
check(cmd("undo").indexOf("[ok]") === 0 && cena() === cena0, "um undo desfaz o lote inteiro");
check(cmd("redo").indexOf("[ok]") === 0 && scene.objects.length === 2 && scene.objects[1].name === "Bravo", "redo refaz o lote inteiro");
check(cmd("undo").indexOf("[ok]") === 0, "volta");

// ── falha: desfaz tudo, diz a linha, recusa o resto ───────────────────────
const uA = history.undoDepth(); const rA = history.redoDepth(); const cenaA = cena();
cmd("txn begin");
check(cmd("spawn C 5 0 0").indexOf("[ok]") === 0, "spawn C no lote");
check(cmd("move C 9 9 9").indexOf("[ok]") === 0, "move C");
const falha = cmd("move NaoExiste 1 2 3");
check(falha.indexOf("[erro] batch linha 3 (move NaoExiste 1 2 3): [erro]") === 0 && falha.indexOf("lote desfeito") > 0, "falha: " + falha);
check(cena() === cenaA && history.undoDepth() === uA && history.redoDepth() === rA, "cena e pilhas como antes do lote");
const depois = cmd("spawn D 0 0 0");
check(depois.indexOf("[erro] batch abortado na linha 3") === 0 && scene.objects.length === 1, "linha depois da falha nao roda: " + depois);
const fimFalha = cmd("txn end");
check(fimFalha.indexOf("[erro] txn: abortado na linha 3 (move NaoExiste 1 2 3)") === 0 && !loteAtivo(), "end do lote abortado: " + fimFalha);
check(cena() === cenaA && history.undoDepth() === uA && history.redoDepth() === rA, "nada aplicado");

// ── comandos que não cabem no lote abortam ─────────────────────────────────
const proibidos: string[] = ["undo", "redo", "play", "step", "shot", "input click 1 1"];
let i = 0;
while (i < proibidos.length) {
  cmd("batch begin");
  cmd("spawn E 0 0 0");
  const out = cmd(proibidos[i]);
  check(out.indexOf("[erro] batch linha 2") === 0 && out.indexOf("nao cabe num lote") > 0, proibidos[i] + ": " + out);
  cmd("batch end");
  check(cena() === cenaA && history.undoDepth() === uA, proibidos[i] + " desfez o lote");
  i = i + 1;
}

// ── cancel e lote sem mudança ─────────────────────────────────────────────
cmd("batch begin"); cmd("spawn F 0 0 0");
check(cmd("batch cancel") === "[ok] batch cancelado: 1 comandos desfeitos" && cena() === cenaA && history.undoDepth() === uA, "cancel");
cmd("batch begin"); cmd("state");
check(cmd("batch end").indexOf("cena sem mudanca") > 0 && history.undoDepth() === uA && history.redoDepth() === rA, "lote so de consulta");
check(cmd("batch end").indexOf("[erro] batch: nenhum lote aberto") === 0, "end sem lote");
check(cmd("batch").indexOf("[erro] uso") === 0 && cmd("batch x").indexOf("[erro] uso") === 0, "uso");
io.print("[PASSOU] ws lote: 1 entrada de Desfazer, rollback com a linha, resto recusado, proibidos, cancel");

// Sonda de ALOCAÇÃO da checagem por quadro da soltura do Explorer (item 3 do
// brief de arquivos universais): `input.droppedCount(win)` e
// `input.hoveredFiles(win)` — a checagem barata que `main.ts` roda TODO
// quadro, mesmo sem nada solto/pairando. O caminho lento (import + try/catch)
// só entra quando `droppedCount() > 0`, fora desta sonda (regra do CLAUDE.md:
// "ponha o caminho lento numa função própria" — não faz parte do custo por
// quadro medido aqui). Rodar com RTS_GC_DEBUG=1 e contar "rts-gc" DEPOIS do
// marcador "FASE": 0 coletas com 200 000 quadros ociosos (nada solto/pairando).
//
//   RTS_GC_DEBUG=1 GC_N=200000 rts.exe run tests/claude-test-explorer-drop-gc.ts 2>&1 | awk '/^FASE/{f=1} f&&/rts-gc/{c++} END{print "rts-gc:", c+0}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import input from "@compat/input";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const WIN = 0;

io.print("FASE explorer-drop-idle " + n);
let total = 0;
let i = 0;
while (i < n) {
  // exatamente a checagem por quadro de main.ts: barata, sem alocar, mesmo
  // com o binário atual (que TEM os nativos) e sem nada solto/pairando.
  const dropped = input.droppedCount(WIN);
  const hovering = input.hoveredFiles(WIN) > 0;
  total = total + dropped + (hovering ? 1 : 0);
  i = i + 1;
}
io.print("FASE fim");
if (total !== 0) throw new Error("esperava 0 arquivos soltos/pairando na sonda ociosa, achei total=" + total);
io.print("[PASSOU] Sonda de GC: droppedCount/hoveredFiles ociosos, " + n + " quadros, total=" + total);

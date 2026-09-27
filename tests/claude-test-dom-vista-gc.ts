// Sonda de ALOCAÇÃO da DomVista (Task 3 do DomCanvas): 200k chamadas por fase,
// sem mudança e mudando todo quadro. Portão: 0 coletas por fase, exceto
// setClass-muda (remontar a lista de classes aloca por troca; documentado).
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-dom-vista-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { DomVista } from "@engine/ui/dom_vista";
import { domHostRegistrar, domHostRaiz, domHostDoc, domHostConteudo } from "@engine/ui/dom_host";
import { Behavior } from "@engine/core/behavior";
const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const b = new Behavior();
const hd = domHostRegistrar(b);
domHostConteudo(hd, "<p id=\"a\">0</p><div id=\"b\">x</div>");
const v = new DomVista(); v.ligar(domHostDoc(), domHostRaiz(hd));
const a = v.querySelector("#a"); const bb = v.querySelector("#b");
const T1 = "um"; const T2 = "dois";
v.setText(a, T1); v.setNumero(bb, 5, 0); v.setStyle(a, "color", "red"); v.setStyleNumero(bb, "width", 42, "%"); v.setClass(a, "x", true); v.setAttr(a, "title", "t");
io.print("FASE sem-mudanca");
let i = 0;
while (i < n) { v.setText(a, T1); v.setNumero(bb, 5.2, 0); v.setStyle(a, "color", "red"); v.setStyleNumero(bb, "width", 42.3, "%"); v.setClass(a, "x", true); v.setAttr(a, "title", "t"); i = i + 1; }
io.print("FASE setNumero-muda");
i = 0; while (i < n) { v.setNumero(bb, i & 1023, 0); i = i + 1; }
io.print("FASE setNumero1casa-muda");
i = 0; while (i < n) { v.setNumero(bb, (i & 1023) / 10, 1); i = i + 1; }
io.print("FASE setText-muda");
i = 0; while (i < n) { v.setText(a, (i & 1) === 0 ? T1 : T2); i = i + 1; }
io.print("FASE setStyleNumero-muda");
i = 0; while (i < n) { v.setStyleNumero(bb, "width", i & 1023, "%"); i = i + 1; }
io.print("FASE setStyle-muda");
i = 0; while (i < n) { v.setStyle(a, "color", (i & 1) === 0 ? T1 : T2); i = i + 1; }
io.print("FASE setClass-muda");
i = 0; while (i < n) { v.setClass(a, "x", (i & 1) === 0); i = i + 1; }
io.print("FASE fim " + v.escritas);

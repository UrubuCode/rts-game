// Sonda de ALOCAÇÃO do DomHost por quadro (Task 2 do DomCanvas). Rodar com
// RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE" (as
// coletas antes do primeiro marcador são do setup):
//
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-dom-host-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em render+pump e sobreUI com o documento parado (nada
// mudou: nenhuma string de estilo nasce). A fase "controle" aloca de propósito
// (um objeto por iteração) e deve dar coletas: prova que a sonda enxerga lixo.
// Sem janela: render(0, h) não pinta, mas a marshalling do TS é a mesma.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { domHostRegistrar, domHostConteudo, domHostLayout, domHostRender, domHostPump, domHostSobreUI,
         domHostRemover, DOM_LAYOUT_FLOATS, DL_LARGURA, DL_BLOQUEIA } from "@engine/ui/dom_host";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));

class Dono extends Behavior {
  cliques: number;
  constructor() { super(); this.cliques = 0; }
  onUIClick(nome: string): void { this.cliques = this.cliques + 1; }
}
class Lixo { v: number; constructor(v: number) { this.v = v; } }

const sc = new Scene("dom-gc");
function dono(nome: string): Dono {
  const o = new GameObject(nome); const b = new Dono(); o.addBehavior(b); sc.add(o); return b;
}
const a = dono("A"); const b = dono("B");
const sa = domHostRegistrar(a); const sb = domHostRegistrar(b);
domHostConteudo(sa, "<div class=\"hud\"><p id=\"vida\">100</p><button data-acao=\"pausa\">II</button></div>");
domHostConteudo(sb, "<p>placar</p>");
const cfg = new Float64Array(DOM_LAYOUT_FLOATS);
cfg[DL_LARGURA] = 240; cfg[DL_BLOQUEIA] = 1;
domHostLayout(sa, cfg); domHostLayout(sb, cfg);
const area = new Float64Array(4); area[0] = 0; area[1] = 0; area[2] = 800; area[3] = 600;
// aquece fora das fases (aplica layout, região e visibilidade uma vez)
domHostRender(0, area); domHostPump(); domHostSobreUI();

io.print("FASE renderPump " + n);
let f = 0;
while (f < n) { domHostRender(0, area); domHostPump(); f = f + 1; }
io.print("FASE sobreUI " + n);
let sobre = 0;
f = 0;
while (f < n) { if (domHostSobreUI()) sobre = sobre + 1; f = f + 1; }
io.print("FASE controle " + n);
let soma = 0;
f = 0;
while (f < n) { const l = new Lixo(f); soma = soma + l.v; f = f + 1; }
io.print("FASE fim " + sobre + " " + soma);
domHostRemover(sa); domHostRemover(sb);

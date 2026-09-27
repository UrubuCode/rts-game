// Sonda de ALOCAÇÃO do DomCanvas por quadro. Rodar com RTS_GC_DEBUG=1 e contar
// as linhas "rts-gc" ENTRE os marcadores FASE (as de antes do primeiro são do setup):
//   RTS_GC_DEBUG=1 rts.exe run tests/claude-test-dom-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
// Portão: 0 coletas em cada fase (GC_N padrão 200000).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { DomCanvas } from "@engine/core/dom_canvas";
import { drawGameUI } from "@engine/ui/game_ui";
import { domHostPump, domHostSobreUI } from "@engine/ui/dom_host";
import { mouseApertadoNoMundo } from "@engine/core/entrada";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const sc = new Scene("gc-dom");
const o = new GameObject("HUD"); const c = new DomCanvas(); c.html = "assets/ui/claude-bench-hud.html"; o.addBehavior(c); sc.add(o);
const v = c.documento;
const t = v.querySelector("#l0");
const barra = v.querySelector("#b0");
const A = "rótulo A"; const B = "rótulo B";
// aquece: tabela de números, estilos e o primeiro layout
let k = 0;
while (k < 1000) { v.setNumero(t, k, 0); k = k + 1; }
v.setClass(t, "alerta", false); v.setStyleNumero(barra, "width", 70, "%");
drawGameUI(sc, 0, 1280, 720); domHostPump();
let soma = 0;

io.print("FASE render-pump " + n);
let i = 0;
while (i < n) { drawGameUI(sc, 0, 1280, 720); domHostPump(); i = i + 1; }
io.print("FASE settext-igual " + n);
i = 0; while (i < n) { v.setText(t, A); i = i + 1; }
io.print("FASE settext-novo " + n);
i = 0; while (i < n) { v.setText(t, (i & 1) === 0 ? A : B); i = i + 1; }
io.print("FASE setnumero-igual " + n);
i = 0; while (i < n) { v.setNumero(t, 57.0, 0); i = i + 1; }
io.print("FASE setnumero-novo " + n);
i = 0; while (i < n) { v.setNumero(t, i % 1000, 0); i = i + 1; }
io.print("FASE estilo-classe-igual " + n);
i = 0; while (i < n) { v.setClass(t, "alerta", false); v.setStyleNumero(barra, "width", 70.2, "%"); i = i + 1; }
io.print("FASE sobre-ui " + n);
i = 0; while (i < n) { if (domHostSobreUI() || mouseApertadoNoMundo(0)) soma = soma + 1; i = i + 1; }
io.print("FASE fim " + soma);

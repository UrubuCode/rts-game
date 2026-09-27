// Teste SEM JANELA da ENTRADA SIMULADA (`input ...`): os eventos injetados
// chegam por `@compat/input` — o mesmo ponto em que o editor lê a entrada
// real — quadro a quadro, com bordas de um quadro, estado que persiste (down
// fica até o up), clique x arrasto, teclas, texto e roda. No fim, um campo
// numérico do Inspector (widgets.numField) recebe o texto digitado e o Enter.
// Sem janela, `entradaQuadro()` faz o papel do `beginFrame` do app.
//
//   rts.exe run tests/test_ws_input.ts
import io from "@compat/io.ts";
import input from "@compat/input";
import { entradaQuadro, simAtiva } from "@compat/input_sim";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { RESPOSTA_ADIADA, tomarAdiado, avancarAdiado, Adiado } from "@editor/control/adiado";
import { numField, widgetRect, widgetMouse, CampoCache } from "@editor/widgets";
import { codigoTecla } from "@editor/control/commands/input";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const W = 1200; const H = 720;
instalarEditorReal();

/// Envia o comando e devolve a espera (a resposta é adiada).
function injeta(cmd: string): Adiado {
  const out = execCommand(W, H, cmd);
  check(out === RESPOSTA_ADIADA, cmd + " deveria adiar: " + out);
  const a = tomarAdiado();
  check(a !== null, cmd + ": espera");
  return a;
}
/// Um quadro do app: aplica os eventos; a espera só conclui no quadro seguinte.
function quadro(a: Adiado | null): boolean {
  entradaQuadro();
  return a !== null && avancarAdiado(a);
}

check(!simAtiva(), "comeca desligada");
check(execCommand(W, H, "input").indexOf("[input] simulada=nao") === 0, "estado");

// ── clique: move | aperta | solta, um quadro cada ──────────────────────────
let a = injeta("input click 100 50");
check(simAtiva(), "ligou");
check(!quadro(a) && input.mouseX(0) === 100 && input.mouseY(0) === 50 && !input.mouseDown(0, 0), "q1: moveu, sem botao");
check(!quadro(a) && input.mouseDown(0, 0) && input.mousePressed(0, 0) && !input.mouseClicked(0, 0), "q2: apertou (borda)");
check(!quadro(a) && !input.mouseDown(0, 0) && input.mouseReleased(0, 0) && input.mouseClicked(0, 0) && !input.mousePressed(0, 0), "q3: soltou = clique");
check(quadro(a), "q4: a resposta sai depois que o ultimo quadro terminou");
check(a.texto.indexOf("[ok] input click 100 50") === 0 && a.texto.indexOf("quadros=4") > 0, "resposta: " + a.texto);
check(!input.mouseReleased(0, 0) && !input.mouseClicked(0, 0), "bordas valem um quadro");

// ── down persiste até o up; botão direito ─────────────────────────────────
a = injeta("input mouse 300 200 down right");
while (!quadro(a)) {}
check(input.mouseDown(0, 1) && !input.mouseDown(0, 0), "direito segue apertado");
quadro(null); quadro(null);
check(input.mouseDown(0, 1) && !input.mousePressed(0, 1), "segue apertado sem borda");
a = injeta("input mouse 310 200 up right");
check(!quadro(a) && input.mouseDown(0, 1) && input.mouseDeltaX(0) === 10, "move antes de soltar (delta 10)");
check(!quadro(a) && !input.mouseDown(0, 1) && input.mouseReleased(0, 1), "soltou");
while (!quadro(a)) {}

// ── arrasto: não é clique; deltas somam o caminho ─────────────────────────
a = injeta("input drag 100 100 200 150 5");
let q = 0; let somaDx: f64 = 0.0; let arrastou = false; let clicou = false; let soltou = false;
while (!quadro(a)) {
  somaDx = somaDx + input.mouseDeltaX(0);
  if (input.dragging(0)) arrastou = true;
  if (input.mouseClicked(0, 0)) clicou = true;
  if (input.mouseReleased(0, 0)) soltou = true;
  q = q + 1;
}
check(input.mouseX(0) === 200 && input.mouseY(0) === 150, "terminou no destino");
check(arrastou && soltou && !clicou, "arrasto solta sem clique (arrastou=" + arrastou + " soltou=" + soltou + " clicou=" + clicou + ")");
check(somaDx === 100 + (100 - 310), "deltas: " + somaDx);   // de 310 a 100 (quadro 1) e de 100 a 200 (5 quadros)
check(a.texto.indexOf("quadros=9") > 0, "drag em 5 quadros + mover + apertar + soltar + fim: " + a.texto);

// ── teclas: down/pressed/released; modificadores ──────────────────────────
check(codigoTecla("w") === 122 && codigoTecla("A") === 100 && codigoTecla("0") === 130 && codigoTecla("f5") === 144 &&
  codigoTecla("enter") === 1 && codigoTecla("esc") === 2 && codigoTecla("left") === 7 && codigoTecla("x1") === 0 - 1, "nomes de tecla");
a = injeta("input key w down");
check(!quadro(a) && input.key(0, 122, 0) && input.key(0, 122, 1), "w desceu");
while (!quadro(a)) {}
check(input.key(0, 122, 0) && !input.key(0, 122, 1), "w segurada sem borda");
a = injeta("input key w up");
check(!quadro(a) && !input.key(0, 122, 0) && input.key(0, 122, 2), "w subiu");
while (!quadro(a)) {}
a = injeta("input key ctrl down");
while (!quadro(a)) {}
check(input.modCtrl(0) && !input.modShift(0), "ctrl segurado");
a = injeta("input key ctrl up");
while (!quadro(a)) {}
check(!input.modCtrl(0), "ctrl solto");

// ── texto e roda: um quadro ────────────────────────────────────────────────
a = injeta("input text #FF0000 e  espacos");
check(!quadro(a) && input.textInput(0) === "#FF0000 e  espacos", "texto com espacos: '" + input.textInput(0) + "'");
check(quadro(a) && input.textInput(0) === "", "texto vale um quadro");
a = injeta("input wheel -3");
check(!quadro(a) && input.wheel(0) === 0 - 3, "roda");
check(quadro(a) && input.wheel(0) === 0, "roda vale um quadro");

// ── argumentos inválidos (resposta imediata, nada enfileirado) ────────────
const ruins: string[] = ["input x", "input click", "input click 10", "input click -1 5", "input click 5 9999", "input click a b",
  "input click 1 1 meio2", "input mouse 1 1 hold", "input mouse 1 1 down left x", "input drag 1 1 2", "input drag 1 1 2 2 0",
  "input drag 1 1 2 2 9999", "input key", "input key tecla", "input key w segura", "input text", "input wheel", "input wheel x"];
let i = 0;
while (i < ruins.length) {
  const out = execCommand(W, H, ruins[i]);
  check(out.indexOf("[erro]") === 0, ruins[i] + " deveria ser [erro]: " + out);
  i = i + 1;
}

// ── um widget de verdade: o campo numérico do Inspector recebe o texto ────
// Como no editor: o main.ts passa o mouse (lido de @compat/input) ao widget.
const campo = new CampoCache(); campo.id = 77;
let valor: f64 = 1.0;
function quadroCampo(a2: Adiado | null): boolean {
  const fim = quadro(a2);
  widgetRect(10.0, 10.0, 200.0, 20.0);
  widgetMouse(input.mouseX(0), input.mouseY(0), input.mouseDown(0, 0) ? 1 : 0, input.mousePressed(0, 0) ? 1 : 0);
  valor = numField(campo, "X", 0, valor);
  return fim;
}
a = injeta("input click 150 20");       // área do VALOR (depois da aba X): entra em edição
while (!quadroCampo(a)) {}
a = injeta("input text 42.5");
while (!quadroCampo(a)) {}
check(valor === 1.0, "enquanto digita o valor nao muda: " + valor);
a = injeta("input key enter press");
while (!quadroCampo(a)) {}
check(valor === 42.5, "Enter confirma o texto digitado: " + valor);

check(execCommand(W, H, "input off") === "[ok] input off (entrada real)" && !simAtiva(), "off");
io.print("[PASSOU] ws input: clique, down/up persistente, arrasto, teclas, texto, roda, argumentos e campo numerico real");

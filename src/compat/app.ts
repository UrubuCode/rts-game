import { flushResourceDisposals } from "../engine/core/resources";
// `createAppAt` — o objeto `app` do motor antigo, sobre `rts:egui` + `rts:input`.
//
// `createAppAt` era um GLOBAL do motor antigo: abria a janela e devolvia um
// objeto que era, ao mesmo tempo, a janela (`_win`), o relógio (`delta`/`fps`),
// o teclado (`keyDown`) e uma camada de widgets POSICIONADOS (`clickable`,
// `button`, `textField`, `checkbox`, foco). No motor novo essas quatro coisas
// não moram no mesmo lugar — a janela é `rts:egui`, o input é `rts:input`, e o
// relógio e os widgets posicionados não existem em lugar nenhum.
//
// Este arquivo é a costura, e segue a regra do `compat/README.md`: nenhum corpo
// de função do editor muda, só a origem do `createAppAt`.
//
// # A divisão que importa: o que é tradução e o que é implementação
//
// `box`/`text`/`line`/`beginFrame`/`endFrame`/`close`/`running`/`keyDown` são
// TRADUÇÃO — a operação existe do lado novo com outro nome e outra ordem de
// argumentos.
//
// `clickable`/`button`/`checkbox`/`setFocus`/`isFocused` são IMPLEMENTAÇÃO, e
// isso merece ser dito alto: o `button` de `rts:egui` é
// `button(win, label)` — um widget de LAYOUT do egui, que se posiciona sozinho
// na coluna corrente (`rts-ui/src/draw.rs`). O editor não quer isso: ele passa
// x/y/w/h e desenha o retângulo por conta própria. Mas um botão posicionado é
// hit-test puro — comparar o cursor com um retângulo — e hit-test não precisa de
// motor. Então em vez de lançar, isto CALCULA, com `input.mouseX/mouseY/
// mousePressed/mouseDown/mouseReleased`. A alternativa (lançar como
// `render.image` faz) seria honesta mas errada aqui: lá faltava uma capacidade
// do motor, aqui falta apenas aritmética.
//
// `delta`/`fps` idem: são `Date.now()` e uma média, não uma capacidade.
import { drawRect, drawText, openWindow, setNextWindowPos, isOpen, pump, beginFrame, endFrame, close } from "rts:egui";
// A entrada passa por `@compat/input` (rts:input + a simulação da porta de
// controle): um clique injetado chega aos widgets daqui como um clique real.
import input from "./input.ts";
import { entradaQuadro } from "./input_sim.ts";
import { dcReset } from "./drawcount.ts";
import { janela2D } from "./draw2d.ts";

// Fases de `input.key(win, code, phase)`, do trait `InputSource`:
// 0 = segurada agora, 1 = disparou neste frame (borda). Escritas como constante
// porque `key(win, c, 1)` no meio do código não diz qual das duas é.
const PHASE_DOWN = 0;
const PHASE_PRESSED = 1;

// Estado do frame corrente, lido uma vez em `beginFrame` e reusado pelos
// widgets. Ler o mouse a cada `clickable` daria respostas diferentes dentro do
// MESMO frame se algo mudasse no meio — e com 19 `clickable` por frame no
// editor, isso é um bug de UI que só aparece de vez em quando.
let curMx = 0.0;
let curMy = 0.0;
let curDown = 0;      // botão esquerdo segurado
let curPressed = 0;   // borda de descida neste frame
let curReleased = 0;  // borda de subida neste frame
// Clique COMPLETO neste frame, direto do egui.
//
// A primeira versão deduzia isto de `released` mais a posição onde a pressão
// começou. A dedução não estava errada, mas era uma reimplementação de algo que
// a fonte de input já responde — e medido com uma sonda, `mouseClicked` marca
// exatamente o frame do clique, com a mesma borda de um frame que `pressed` e
// `released` têm. Duas respostas para "houve clique?" é o tipo de coisa que
// diverge quando o frame rate cai, que é justamente quando um clique é mais
// difícil de acertar.
let curClicked = 0;

// De onde partiu a pressão atual. Um clique só CONTA para o retângulo em que
// começou: sem isto, apertar num botão, arrastar para outro e soltar dispararia
// o segundo — que não é o que qualquer UI faz.
let pressX = 0.0 - 1.0;
let pressY = 0.0 - 1.0;

// Foco dos campos de texto. É um id só porque só um campo pode ter foco; o
// editor usa `setFocus(950)` e `setFocus(-1)` exatamente assim.
let focusId = 0 - 1;
let focusSelectAll = 0;

// Relógio. O motor antigo entregava `delta()` em MILISSEGUNDOS (main.ts corta em
// 100 e divide por 1000), então é isso que sai daqui.
let lastMs = 0.0;
let deltaMs = 16.0;
// FPS suavizado: o instantâneo (1000/delta) pula entre 40 e 300 e nenhum humano
// lê isso. Média exponencial sobre o próprio delta, que é o mesmo efeito por
// menos estado que uma janela de amostras.
let avgMs = 16.0;

// ── OS OBJETOS DE OPÇÕES, REUSADOS ─────────────────────────────────────────
//
// A superfície nova recebe um objeto (`drawRect(win, { x, y, … })`) porque a
// convenção de chamada carrega quatro argumentos e um retângulo tem oito campos
// — está explicado em `rts-ui/src/value.rs`. O que ela NÃO pede é um objeto
// NOVO por chamada, e era isso que este shim fazia.
//
// MEDIDO (release, `tools/claude-bench-2d2.ts`, 2000 chamadas por frame):
//
//     drawRect(win, { …8 campos })   4,505 us   ← literal por chamada
//     drawRect(win, fixo)            0,667 us   ← o MESMO objeto, mutado
//     winWidth(win)                  0,085 us   ← nativo sem objeto nenhum
//
// Ou seja: dos 4,5 us de um retângulo, 3,8 são o objeto e 0,58 é a travessia.
// O custo que parecia ser "atravessar a fronteira" é ALOCAR — o literal escapa
// para dentro da chamada, então o coletor tem de criá-lo de verdade, ao
// contrário de um literal que fica no quadro e a análise de escape achata.
//
// Reusar é seguro porque o nativo COPIA: `options()` lê os oito campos para
// `f64` e devolve antes que a próxima chamada possa mexer no objeto. Não há
// chamada aninhada que interleave — cada `drawRect` termina antes do próximo
// começar, numa thread só.
//
// Rejeitado: um `drawRectBatch(win, Float32Array)`. Ele resolveria a mesma
// coisa e custaria um membro novo no motor, uma segunda convenção na superfície
// e, o pior, a ORDEM: retângulo e texto se intercalam no editor (uma caixa,
// depois o rótulo dentro dela), então um lote de retângulos separado do de
// textos pinta os rótulos por baixo. Um lote que preservasse a ordem teria de
// ser uma display list com opcodes — que é outro projeto, e este aqui já pega
// 85% do custo sem tocar no motor.
const oRect = { x: 0.0, y: 0.0, w: 0.0, h: 0.0, fill: 0, strokeW: 0, stroke: 0, radius: 0 };
const oText = { x: 0.0, y: 0.0, text: "", color: 0, size: 12, flags: 0 };

// Retângulo pendente de `at(x, y, w, h)`, lido pelo `button`/`textField` seguinte.
let atX = 0.0; let atY = 0.0; let atW = 0.0; let atH = 0.0;

function inRect(x: number, y: number, w: number, h: number): boolean {
  return curMx >= x && curMx < x + w && curMy >= y && curMy < y + h;
}

/// 0 nada, 1 hover, 2 pressionado, 3 clicado (ver `clickable`).
function clicavel(cx: number, cy: number, cw: number, ch: number): number {
  const over = inRect(cx, cy, cw, ch);
  if (!over) return 0;
  // "clicado" é o egui dizer que houve clique E a pressão ter começado AQUI.
  // A segunda metade é o que faz um arrasto iniciado noutro botão não
  // disparar este; a primeira deixou de ser deduzida de `released`.
  if (curClicked !== 0 && pressX >= cx && pressX < cx + cw && pressY >= cy && pressY < cy + ch) return 3;
  if (curDown !== 0) return 2;
  return 1;
}

/// `createAppAt(titulo, w, h, x, y)` — abre a janela NA POSIÇÃO pedida.
///
/// `setNextWindowPos` antes do `openWindow`, e não `moveWindow` depois: as duas
/// existem (`rts-ui/src/window.rs`), mas mover depois faz a janela aparecer no
/// lugar padrão e saltar para o certo — visível, e pior num editor que abre
/// numa posição fixa de propósito. A própria doc de `setNextWindowPos` diz isso.
///
/// x/y são pixels FÍSICOS da área de trabalho, enquanto w/h são pontos lógicos
/// — é a convenção do `rts-egui`, não uma escolha daqui; num monitor com escala
/// diferente de 100% as duas não são a mesma unidade.
export function createAppAt(titulo: string, w: number, h: number, x: number, y: number): any {
  setNextWindowPos(x, y);
  const win = openWindow(titulo, w, h, 0);
  janela2D(win);
  lastMs = Date.now();

  return {
    // O editor lê `app._win` e passa esse handle para gpu3d/widgets/assets. É o
    // handle do `openWindow` sem envelope: qualquer tradução aqui exigiria
    // traduzir de volta em todos os módulos que já falam `rts:egui` direto.
    _win: win,

    // ── ciclo de frame ────────────────────────────────────────────────────
    running(): boolean {
      return isOpen(win);
    },

    beginFrame(): boolean {
      // `pump` responde `true` enquanto o programa deve continuar (o motor novo
      // inverteu a convenção antiga de "0 = continuar"; ver window.rs).
      const alive = pump(win);
      beginFrame(win);

      const now = Date.now();
      deltaMs = now - lastMs;
      if (deltaMs < 0.0) deltaMs = 0.0;
      lastMs = now;
      avgMs = avgMs * 0.9 + deltaMs * 0.1;

      dcReset();   // as travessias contam por FRAME (ver compat/drawcount.ts)

      entradaQuadro();   // aplica os eventos simulados deste quadro (input_sim.ts)
      curMx = input.mouseX(win);
      curMy = input.mouseY(win);
      curDown = input.mouseDown(win, 0) ? 1 : 0;
      curPressed = input.mousePressed(win, 0) ? 1 : 0;
      curReleased = input.mouseReleased(win, 0) ? 1 : 0;
      curClicked = input.mouseClicked(win, 0) ? 1 : 0;
      if (curPressed !== 0) { pressX = curMx; pressY = curMy; }

      return alive;
    },

    endFrame(): void { endFrame(win); flushResourceDisposals(win); },
    close(): void { close(win); },

    delta(): number { return deltaMs; },
    fps(): number { return avgMs > 0.0 ? 1000.0 / avgMs : 0.0; },

    // ── desenho ───────────────────────────────────────────────────────────
    // `box`/`text`/`line` saíram (Task 10.5): com 5+ parâmetros eles alocavam
    // por chamada. O desenho 2D é `@compat/draw2d.ts` (pincel/caixa, texto/
    // estiloTexto, traco/linha), que desenha nesta janela (`janela2D` acima).

    // ── widgets posicionados (hit-test em TS, ver o cabeçalho) ────────────
    /// `clickable(x, y, w, h)` → 0 nada, 1 hover, 2 pressionado, 3 clicado.
    ///
    /// Sem `id`: ele existia no motor antigo porque a camada de widgets guardava
    /// estado por id; aqui o estado do clique é do MOUSE. Saiu na Task 10.5 para
    /// a chamada ter 4 parâmetros (5+ alocam por chamada no RTS).
    clickable(cx: number, cy: number, cw: number, ch: number): number { return clicavel(cx, cy, cw, ch); },
    /// `clickable` no retângulo do último `at`. O `id` é do controle (EditorControl)
    /// e só serve aos testes sem janela, que respondem cliques por controle.
    clickableAt(_id: number): number { return clicavel(atX, atY, atW, atH); },

    /// Retângulo do próximo `button`/`textField` (altura ignorada pelo campo).
    at(x: number, y: number, w: number, h: number): void { atX = x; atY = y; atW = w; atH = h; },

    /// `button(label)` no retângulo do último `at` — desenha e responde se foi clicado.
    ///
    /// NÃO é o `button` de `rts:egui`: aquele se posiciona sozinho na coluna do
    /// egui e ignoraria x/y/w/h. Este é o retângulo do editor.
    button(label: string): boolean {
      const bx = atX; const by = atY; const bw = atW; const bh = atH;
      const over = inRect(bx, by, bw, bh);
      let fill = 0x2D2D2DFF;
      if (over && curDown !== 0) fill = 0x252525FF;
      else if (over) fill = 0x454545FF;
      oRect.x = bx; oRect.y = by; oRect.w = bw; oRect.h = bh;
      oRect.fill = fill; oRect.strokeW = 1; oRect.stroke = 0x232323FF; oRect.radius = 3;
      drawRect(win, oRect);
      oText.x = bx + 8; oText.y = by + (bh - 13) * 0.5; oText.text = label;
      oText.color = 0xC8C8C8FF; oText.size = 12;
      drawText(win, oText);
      return over && curClicked !== 0 &&
        pressX >= bx && pressX < bx + bw && pressY >= by && pressY < by + bh;
    },

    /// `checkbox(x, y, valor, label)` → o valor novo (0/1).
    checkbox(kx: number, ky: number, value: number, label: string): number {
      const box = 14;
      const over = inRect(kx, ky, box, box);
      const hit = over && curClicked !== 0 && pressX >= kx && pressX < kx + box && pressY >= ky && pressY < ky + box;
      const next = hit ? (value !== 0 ? 0 : 1) : value;
      oRect.x = kx; oRect.y = ky; oRect.w = box; oRect.h = box;
      oRect.fill = next !== 0 ? 0x5A7FB0FF : 0x2A2A2AFF; oRect.strokeW = 1; oRect.stroke = 0x232323FF; oRect.radius = 2;
      drawRect(win, oRect);
      oText.x = kx + box + 6; oText.y = ky; oText.text = label; oText.color = 0xC8C8C8FF; oText.size = 12;
      drawText(win, oText);
      return next;
    },

    setFocus(id: number): void { focusId = id; focusSelectAll = 0; },
    focusAll(id: number): void { focusId = id; focusSelectAll = 1; },
    isFocused(id: number): boolean { return focusId === id; },
    hasTextFocus(): boolean { return focusId >= 0; },

    /// `textField(id, texto, habilitado)` no retângulo do último `at` → o texto,
    /// possivelmente digitado.
    ///
    /// Campo posicionado para nome e buscas. Aceita texto, Backspace, Delete,
    /// Ctrl+A, Enter e Escape; ainda não tem cursor em posição arbitrária.
    textField(id: number, value: string, enabled: boolean): string {
      const tx = atX; const ty = atY; const tw = atW;
      const h2 = 20;
      const over = inRect(tx, ty, tw, h2);
      if (enabled && over && curPressed !== 0) { focusId = id; focusSelectAll = 0; }
      else if (curPressed !== 0 && focusId === id) { focusId = 0 - 1; focusSelectAll = 0; }
      const focused = enabled && focusId === id;
      let out = value;
      if (focused) {
        const ctrl = input.modCtrl(win);
        if (ctrl && input.key(win, 100, PHASE_PRESSED)) focusSelectAll = 1;
        const typed = ctrl ? "" : input.textInput(win);
        if (typed.length > 0) { out = focusSelectAll !== 0 ? typed : out + typed; focusSelectAll = 0; }
        if (input.key(win, 4, PHASE_PRESSED) || input.key(win, 10, PHASE_PRESSED)) {
          out = focusSelectAll !== 0 ? "" : out.substring(0, out.length - 1);
          focusSelectAll = 0;
        }
        if (input.key(win, 1, PHASE_PRESSED) || input.key(win, 2, PHASE_PRESSED)) { focusId = 0 - 1; focusSelectAll = 0; }
      }
      oRect.x = tx; oRect.y = ty; oRect.w = tw; oRect.h = h2;
      oRect.fill = 0x2A2A2AFF; oRect.strokeW = 1; oRect.stroke = focused ? 0x5A7FB0FF : 0x232323FF; oRect.radius = 3;
      drawRect(win, oRect);
      // O backend de desenho não recorta texto: mantenha nomes longos dentro do campo.
      const maxChars = Math.max(1, ((tw - 12) / 7) | 0);
      let shown = out;
      if (shown.length > maxChars) {
        shown = focused ? shown.substring(shown.length - maxChars) : shown.substring(0, maxChars - 1) + "…";
      }
      if (focused && focusSelectAll !== 0) {
        oRect.x = tx + 4; oRect.y = ty + 2; oRect.w = Math.min(tw - 8, shown.length * 7 + 3);
        oRect.h = 16; oRect.fill = 0x3A6C9FFF; oRect.strokeW = 0; oRect.stroke = 0; oRect.radius = 1;
        drawRect(win, oRect);
      }
      oText.x = tx + 5; oText.y = ty + 3; oText.text = focused ? shown + "|" : shown;
      oText.color = 0xD0D0D0FF; oText.size = 12;
      drawText(win, oText);
      return out;
    },

    // ── teclado ───────────────────────────────────────────────────────────
    // Os CÓDIGOS não mudam: o mapa vive em `rts-egui/render_backend.rs`, que é
    // o mesmo crate dos dois motores (o `rts-egui` nunca foi do motor antigo —
    // o que morreu foi a feature `old-engine` dele). Então `keyDown(122)`
    // continua sendo o mesmo W de antes.
    keyDown(code: number): number { return input.key(win, code, PHASE_DOWN) ? 1 : 0; },
    keyPressed(code: number): number { return input.key(win, code, PHASE_PRESSED) ? 1 : 0; },
  };
}

// ---------------------------------------------------------------------------
// O QUE ESTE ARQUIVO NÃO RESOLVE
// ---------------------------------------------------------------------------
//
// `app.image` / o framebuffer por software: não existe aqui porque não existe em
// `compat/render.ts` — mesma ausência, mesma razão (ver o comentário de
// `render.image`).
//
// O relógio é `Date.now()`, portanto milissegundos inteiros. O `delta()` antigo
// podia ter resolução melhor; num editor a 60 fps a diferença é ruído, mas quem
// for medir performance com isto precisa saber que a régua tem 1 ms de passo.
//
// SEM `export default { createAppAt }`, e não por estilo: essa forma exata —
// objeto literal com um identificador em atalho — faz o motor novo recusar o
// MÓDULO INTEIRO ("cannot resolve module … nothing registered that specifier"),
// ou responder `ReferenceError: @@default is not defined` quando há também um
// export nomeado. Reduzido a dois arquivos de três linhas e confirmado com
// `run_fixture`. `export default { f(){ … } }` com o método escrito inline
// funciona — é o que os outros shims deste diretório usam, e é por isso que
// eles não esbarraram nisto.

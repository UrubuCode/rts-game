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
import { drawRect, drawText, drawLine, openWindow, setNextWindowPos, isOpen, pump, beginFrame, endFrame, close } from "rts:egui";
import { mouseX, mouseY, mouseDown, mousePressed, mouseReleased, mouseClicked, key, textInput } from "rts:input";

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

// Relógio. O motor antigo entregava `delta()` em MILISSEGUNDOS (main.ts corta em
// 100 e divide por 1000), então é isso que sai daqui.
let lastMs = 0.0;
let deltaMs = 16.0;
// FPS suavizado: o instantâneo (1000/delta) pula entre 40 e 300 e nenhum humano
// lê isso. Média exponencial sobre o próprio delta, que é o mesmo efeito por
// menos estado que uma janela de amostras.
let avgMs = 16.0;

function inRect(x: number, y: number, w: number, h: number): boolean {
  return curMx >= x && curMx < x + w && curMy >= y && curMy < y + h;
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

      curMx = mouseX(win);
      curMy = mouseY(win);
      curDown = mouseDown(win, 0) ? 1 : 0;
      curPressed = mousePressed(win, 0) ? 1 : 0;
      curReleased = mouseReleased(win, 0) ? 1 : 0;
      curClicked = mouseClicked(win, 0) ? 1 : 0;
      if (curPressed !== 0) { pressX = curMx; pressY = curMy; }

      return alive;
    },

    endFrame(): void { endFrame(win); },
    close(): void { close(win); },

    delta(): number { return deltaMs; },
    fps(): number { return avgMs > 0.0 ? 1000.0 / avgMs : 0.0; },

    // ── desenho ───────────────────────────────────────────────────────────
    // Mesma tradução de `compat/render.ts` (lista de argumentos → objeto), com
    // o `win` já fechado por cima. Não reuso o `render.rect` de lá de propósito:
    // aquele shim traduz `rts:render`, este traduz `createAppAt`, e encadear um
    // no outro faria uma dívida depender da outra para ser paga.
    box(bx: number, by: number, bw: number, bh: number, fill: number,
        strokeW: number, stroke: number, radius: number): void {
      drawRect(win, { x: bx, y: by, w: bw, h: bh, fill: fill, strokeW: strokeW, stroke: stroke, radius: radius });
    },

    // O `app.text` antigo não tinha `flags` (o editor chama sempre com 5
    // argumentos); do lado novo `flags` é bitmask 1=negrito 2=itálico 4=mono.
    text(tx: number, ty: number, s: string, color: number, size: number): void {
      drawText(win, { x: tx, y: ty, text: s, color: color, size: size, flags: 0 });
    },

    line(x1: number, y1: number, x2: number, y2: number, lw: number, color: number): void {
      drawLine(win, { x1: x1, y1: y1, x2: x2, y2: y2, w: lw, color: color });
    },

    // ── widgets posicionados (hit-test em TS, ver o cabeçalho) ────────────
    /// `clickable(id, x, y, w, h)` → 0 nada, 1 hover, 2 pressionado, 3 clicado.
    ///
    /// O `id` não é usado: ele existia no motor antigo porque a camada de
    /// widgets guardava estado por id. Aqui o estado do clique é do MOUSE, não
    /// do widget, então o id não tem o que indexar. Mantido na assinatura
    /// porque os 19 chamadores o passam.
    clickable(_id: number, cx: number, cy: number, cw: number, ch: number): number {
      const over = inRect(cx, cy, cw, ch);
      if (!over) return 0;
      // "clicado" é o egui dizer que houve clique E a pressão ter começado AQUI.
      // A segunda metade é o que faz um arrasto iniciado noutro botão não
      // disparar este; a primeira deixou de ser deduzida de `released`.
      if (curClicked !== 0 && pressX >= cx && pressX < cx + cw && pressY >= cy && pressY < cy + ch) return 3;
      if (curDown !== 0) return 2;
      return 1;
    },

    /// `button(x, y, w, h, label)` — desenha e responde se foi clicado.
    ///
    /// NÃO é o `button` de `rts:egui`: aquele se posiciona sozinho na coluna do
    /// egui e ignoraria x/y/w/h. Este é o retângulo do editor.
    button(bx: number, by: number, bw: number, bh: number, label: string): boolean {
      const over = inRect(bx, by, bw, bh);
      let fill = 0x2D2D2DFF;
      if (over && curDown !== 0) fill = 0x252525FF;
      else if (over) fill = 0x454545FF;
      drawRect(win, { x: bx, y: by, w: bw, h: bh, fill: fill, strokeW: 1, stroke: 0x232323FF, radius: 3 });
      drawText(win, { x: bx + 8, y: by + (bh - 13) * 0.5, text: label, color: 0xC8C8C8FF, size: 12, flags: 0 });
      return over && curClicked !== 0 &&
        pressX >= bx && pressX < bx + bw && pressY >= by && pressY < by + bh;
    },

    /// `checkbox(x, y, valor, label)` → o valor novo (0/1).
    checkbox(kx: number, ky: number, value: number, label: string): number {
      const box = 14;
      const over = inRect(kx, ky, box, box);
      const hit = over && curClicked !== 0 && pressX >= kx && pressX < kx + box && pressY >= ky && pressY < ky + box;
      const next = hit ? (value !== 0 ? 0 : 1) : value;
      drawRect(win, { x: kx, y: ky, w: box, h: box, fill: next !== 0 ? 0x5A7FB0FF : 0x2A2A2AFF, strokeW: 1, stroke: 0x232323FF, radius: 2 });
      drawText(win, { x: kx + box + 6, y: ky, text: label, color: 0xC8C8C8FF, size: 12, flags: 0 });
      return next;
    },

    setFocus(id: number): void { focusId = id; },
    isFocused(id: number): boolean { return focusId === id; },

    /// `textField(id, x, y, w, texto)` → o texto, possivelmente digitado.
    ///
    /// APROXIMAÇÃO, e a mais fraca deste arquivo. `input.textInput(win)` entrega
    /// os caracteres digitados no frame, o que basta para digitar num campo
    /// focado; o que NÃO existe é cursor, seleção, setas, Home/End e
    /// clique-para-posicionar. O editor sobrevive porque só usa dois campos (o
    /// nome do objeto e a busca do Add Component) e já trata o Backspace por
    /// fora, via `keyPressed(4)`. Um campo de verdade é outra tarefa.
    textField(id: number, tx: number, ty: number, tw: number, value: string): string {
      const h2 = 20;
      const over = inRect(tx, ty, tw, h2);
      if (over && curPressed !== 0) focusId = id;
      const focused = focusId === id;
      let out = value;
      if (focused) {
        const typed = textInput(win);
        if (typed.length > 0) out = out + typed;
      }
      drawRect(win, { x: tx, y: ty, w: tw, h: h2, fill: 0x2A2A2AFF, strokeW: 1, stroke: focused ? 0x5A7FB0FF : 0x232323FF, radius: 3 });
      drawText(win, { x: tx + 5, y: ty + 3, text: focused ? out + "|" : out, color: 0xD0D0D0FF, size: 12, flags: 0 });
      return out;
    },

    // ── teclado ───────────────────────────────────────────────────────────
    // Os CÓDIGOS não mudam: o mapa vive em `rts-egui/render_backend.rs`, que é
    // o mesmo crate dos dois motores (o `rts-egui` nunca foi do motor antigo —
    // o que morreu foi a feature `old-engine` dele). Então `keyDown(122)`
    // continua sendo o mesmo W de antes.
    keyDown(code: number): number { return key(win, code, PHASE_DOWN) ? 1 : 0; },
    keyPressed(code: number): number { return key(win, code, PHASE_PRESSED) ? 1 : 0; },
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

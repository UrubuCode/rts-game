// `rts:render` sobre `rts:egui`.
//
// O rasterizador 2D por software foi aposentado: quem desenha agora é o egui.
// Para os quatro membros usados a tradução é EXATA e mecânica — os mesmos
// argumentos, na mesma ordem, na mesma codificação de cor — só que embrulhados
// num objeto em vez de listados soltos.
//
// `image` ERA a exceção e deixou de ser. Este arquivo dizia que o egui não tinha
// blit de framebuffer; estava errado por meia verdade. O `rts-egui` pinta imagem
// desde sempre (`RenderBackend::image`), mas como MÉTODO DE TRAIT, e a casca
// `rts-ui` não expunha o membro — então a superfície visível de fora realmente
// não tinha, e a conclusão "o motor não sabe" veio de olhar só para a casca.
// Hoje existem `rts_egui::draw_image` (função livre) e `egui.drawImage`, e o
// `image` daqui é a mesma tradução mecânica que `rect`/`text`/`line` são.
//
// A ÚNICA diferença de assinatura é a que o `compat/buffer.ts` já impõe a todo
// mundo: onde entrava um ENDEREÇO entra a view. Não é uma concessão ao shim, é a
// correção — um endereço guardado envelhece porque o coletor move células.
//
// ---------------------------------------------------------------------------
// SOBRE O `win`: ele JÁ ESTAVA LÁ. Não há `setWindow` aqui, e é de propósito.
// ---------------------------------------------------------------------------
//
// A tarefa supunha que as funções antigas não tinham o handle da janela e que
// o shim precisaria guardá-lo. Os 51 sítios de chamada dizem o contrário: todo
// um deles já passa a janela como PRIMEIRO argumento —
//
//   render.rect(win, mx + 12, my - 10, 128, 26, 0x1E1E22EE, 1, typeColor(t), 4)
//   render.text(win, px + 10, py + 5, "Project", TEXT, 13, 0)
//   render.line(win, sxA[a], syA[a], sxA[b], syA[b], 2, col)
//   render.image(WIN, 0, 0, 960, 600, fptr, RW, RH)
//
// — em `editor/assets.ts`, `editor/widgets.ts`, `engine/render/draw.ts`,
// `engine/ui/uipanel.ts`, `editor/thumbs.ts`, `main.ts` e `netharness.ts`.
//
// Então um `setWindow(win)` global seria uma segunda fonte para um valor que o
// chamador já tem em mãos, e a única coisa que ele poderia acrescentar é a
// possibilidade de as duas discordarem. Um estado global escondido para
// carregar um argumento que já é explícito é pior do que o argumento.
//
// ---------------------------------------------------------------------------
// CORES: nenhuma conversão, e isso foi VERIFICADO, não presumido.
// ---------------------------------------------------------------------------
//
// O doc comment de `drawRect` em `crates/rts-ui/src/draw.rs` diz "Cores são
// `0xRRGGBBAA`", que é exatamente o que o código do jogo já escreve
// (`0x1E1E22EE`, `0xFFFFFFAA`, `0x00000066`). Se fosse `0xAARRGGBB` cada cor
// precisaria de um giro de bits aqui — não precisa. `fill: 0` continua
// significando "não preenche", que é como `assets.ts:204` desenha a moldura.

import { drawRect, drawText, drawLine, drawImage } from "rts:egui";

export default {
  // `rect(win, x, y, w, h, fill, strokeW, stroke, radius)`.
  //
  // Os nove parâmetros antigos são os oito campos que `drawRect` lê, na mesma
  // ordem: a superfície nova trocou a lista por um objeto e não mudou mais nada.
  rect(
    win: number,
    x: number, y: number, w: number, h: number,
    fill: number, strokeW: number, stroke: number, radius: number,
  ): void {
    drawRect(win, { x, y, w, h, fill, strokeW, stroke, radius });
  },

  // `text(win, x, y, s, color, size, flags)`.
  //
  // `flags` é bitmask 1=negrito 2=itálico 4=mono do lado novo. Todos os 17
  // chamadores do jogo passam `0`, então nenhum depende de saber se o bitmask
  // antigo era o mesmo — o que é bom, porque eu NÃO sei o que os bits do
  // `rts:render` significavam. Se algum chamador passar não-zero um dia, esse é
  // o ponto a conferir.
  text(
    win: number,
    x: number, y: number, s: string,
    color: number, size: number, flags: number,
  ): void {
    drawText(win, { x, y, text: s, color, size, flags });
  },

  // `line(win, x1, y1, x2, y2, w, color)` — tradução direta.
  line(
    win: number,
    x1: number, y1: number, x2: number, y2: number,
    w: number, color: number,
  ): void {
    drawLine(win, { x1, y1, x2, y2, w, color });
  },

  // `image(win, x, y, w, h, pixels, iw, ih)` — blit de um framebuffer RGBA8.
  //
  // O sexto argumento chamava-se `ptr` e era um endereço; agora é a view
  // (`Uint8Array`) que o `compat/buffer.ts` devolve. Todo chamador que passava
  // `buffer.ptr(b)` passa `b`, que é a MESMA substituição que aquele arquivo já
  // documenta para os outros doze sítios — nenhuma regra nova.
  //
  // A textura é EFÊMERA do lado do egui: carregada por frame e descartada no
  // fim. Quem blita todo frame paga um upload por frame, o que é aceitável para
  // um framebuffer que muda todo frame (o viewport do editor) e é desperdício
  // para um que não muda (uma miniatura em cache). Trocar isso exige um id de
  // textura persistente, que é uma decisão do `rts-ui` e não deste shim.
  image(
    win: number,
    x: number, y: number, w: number, h: number,
    pixels: Uint8Array, iw: number, ih: number,
  ): void {
    drawImage(win, { x, y, w, h, pixels, imgWidth: iw, imgHeight: ih });
  },
};

// ---------------------------------------------------------------------------
// DELIBERADAMENTE AUSENTES
// ---------------------------------------------------------------------------
//
// Nenhum outro membro de `rts:render` foi implementado porque nenhum outro é
// chamado: a varredura devolve exatamente `rect` (24), `text` (17), `image` (7)
// e `line` (3), e nada mais. Se o rasterizador tinha `clear`, `pixel`, `circle`
// ou afins, eles não aparecem no jogo e não foram inventados aqui.
//
// `measureText` do egui NÃO foi exposto: não é um membro antigo, é uma
// capacidade nova. Quem quiser medir texto importa `rts:egui` direto — pôr uma
// função nova num shim de compatibilidade é a maneira de o shim virar permanente.
//
// O que eu NÃO sei sobre a superfície antiga, e portanto não reproduzi:
//   - o significado dos bits de `flags` em `render.text` (todos os chamadores
//     passam 0);
//   - se `render.rect` com `radius` maior que metade do lado saturava ou
//     desenhava sujeira. Aqui vale o que o egui fizer.
//
// ---------------------------------------------------------------------------
// O QUE PRECISA DE MUDANÇA MANUAL FORA DESTE ARQUIVO
// ---------------------------------------------------------------------------
//
// 1. As sete linhas de `import render from "rts:render"` →
//    `editor/assets.ts:7`, `editor/thumbs.ts:17`, `editor/widgets.ts:7`,
//    `engine/render/draw.ts:12`, `engine/ui/uipanel.ts:10`, `main.ts:9`,
//    `netharness.ts:19`.
//
// 2. Os três sítios de `render.image` precisam passar a VIEW no lugar de
//    `buffer.ptr(b)` — e só isso, agora que o membro existe:
//    - `editor/thumbs.ts:45` — FEITO no porte das miniaturas.
//    - `netharness.ts:348` — blit do framebuffer 960×600 do harness.
//    - `main.ts:43` — o viewport 3D do editor.
//    Os dois últimos continuam sem passar, porque quem PRODUZ os pixels deles
//    (`engine/render/raster.ts`) ainda não foi portado — o blit deixou de ser o
//    bloqueio, o rasterizador virou.
//
// 3. `engine/render/raster.ts` — o rasterizador por software em si. Ele não
//    importa `rts:render`, mas existe SÓ para alimentar `render.image`. A
//    decisão que restou é dele: portar os handles para views (o `thumbs.ts` já
//    mostra que dá) ou aposentá-lo em favor de malha.

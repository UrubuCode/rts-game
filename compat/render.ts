// `rts:render` sobre `rts:egui`.
//
// O rasterizador 2D por software foi aposentado: quem desenha agora é o egui.
// Para três dos quatro membros usados a tradução é EXATA e mecânica — os mesmos
// argumentos, na mesma ordem, na mesma codificação de cor — só que embrulhados
// num objeto em vez de listados soltos. O quarto (`image`) não tem equivalente
// e está tratado no fim do arquivo.
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

import { drawRect, drawText, drawLine } from "rts:egui";

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

  // ------------------------------------------------------------------------
  // `image` — SEM EQUIVALENTE. Lança, e lança na chamada.
  // ------------------------------------------------------------------------
  //
  // `render.image(win, x, y, w, h, ptr, iw, ih)` blitava um framebuffer RGBA
  // cru, apontado por um ENDEREÇO, na tela. O egui não tem essa operação: não
  // há upload de textura 2D na superfície de `rts-ui/src/draw.rs` (`drawRect`,
  // `drawText`, `drawLine`, `measureText`, widgets e `html` — e nada mais), e o
  // argumento `ptr` é a mesma coisa que `compat/buffer.ts` recusou a
  // implementar, pelo mesmo motivo: o coletor move células.
  //
  // Então há duas ausências empilhadas aqui, e nenhuma se resolve com tradução.
  // Um no-op silencioso faria o editor abrir com o viewport 3D em preto e
  // ninguém saberia por quê — o modo de falhar que este `compat/` evita duas
  // vezes já. Lançar coloca o erro no frame em que ele acontece, com o nome do
  // que falta.
  image(
    _win: number,
    _x: number, _y: number, _w: number, _h: number,
    _ptr: number, _iw: number, _ih: number,
  ): void {
    throw new Error(
      "render.image não existe no motor novo: o egui não tem blit de " +
      "framebuffer RGBA (rts-ui/src/draw.rs só expõe drawRect/drawText/" +
      "drawLine/measureText). O caminho novo para pixels é 3D — " +
      "egui.meshUpload + egui.drawMesh com textura — e o rasterizador por " +
      "software que produzia estes pixels foi aposentado junto com rts:render. " +
      "Chamadores: editor/thumbs.ts:45, netharness.ts:348, main.ts (framebuffer 3D).",
    );
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
// 2. Os três sítios de `render.image`, que agora LANÇAM em vez de desenhar:
//    - `editor/thumbs.ts:45` — miniaturas rasterizadas por software. Todo o
//      caminho de `thumbs.ts` (alloc + raster + blit) é o que o egui substitui
//      por malha, não por tradução.
//    - `netharness.ts:348` — blit do framebuffer 960×600 do harness.
//    - `main.ts:43` — o viewport 3D do editor, mesma história.
//    Os três também dependem de `buffer.ptr()`, que já não existe, então já
//    estavam quebrados na compilação antes deste arquivo.
//
// 3. `engine/render/raster.ts` — o rasterizador por software em si. Ele não
//    importa `rts:render`, mas existe SÓ para alimentar `render.image`. Sem
//    consumidor, é código morto à espera de decisão: portar para malha ou sair.

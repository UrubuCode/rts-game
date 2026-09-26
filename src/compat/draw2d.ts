// Desenho 2D imediato sobre `rts:egui` com NO MÁXIMO 4 parâmetros por chamada.
//
// # Por que existe (Task 10.5)
//
// `app.box` (8 parâmetros), `app.text` (5), `app.line` (6) e `render.rect`
// (9) ALOCAVAM a cada chamada: no compilador do RTS uma função com 5+
// parâmetros escalares aloca um bloco de spill por chamada (família do
// rts#2760). Medido na janela real (`scratch/claude-t105/formas.ts`, 200k
// chamadas por forma): `app.box`/`app.text`/`app.line` → 6–7 coletas; o mesmo
// desenho por uma função de 4 parâmetros sobre o objeto de opções de módulo →
// 0 coletas. O editor fazia ~200 dessas chamadas por quadro (~400 objetos de
// lixo por quadro, a maior parte das coletas que pausavam o frame 8–48 ms).
//
// O nativo NÃO é o problema: `drawRect(win, objetoReusado)` não aloca (o lado
// Rust lê os campos e devolve). Por isso não há nativo novo — só a forma da
// chamada no TS mudou.
//
// # A forma
//
//   pincel(preenchimento, larguraBorda, corBorda, raio); caixa(x, y, w, h);
//   texto(x, y, s, estiloTexto(cor, tamanho));
//   traco(largura, cor); linha(x1, y1, x2, y2);
//
// O estilo do retângulo e da linha é ESTADO do módulo (o próximo `caixa`/`linha`
// usa o último `pincel`/`traco`): quem desenha chama os dois em sequência. O do
// texto vai empacotado num número (cor 32 bits + tamanho × 2^32 — exato num
// f64), porque o texto tem 3 argumentos próprios e o estilo cabe no 4º.
//
// A janela é a do `createAppAt` (`janela2D` é chamado lá): o editor e o jogo
// desenham numa janela só. Cores são `0xRRGGBBAA`, como no `drawRect`.
import { drawRect, drawText, drawLine, drawImage } from "rts:egui";
import { dcRect, dcText, dcLine } from "./drawcount.ts";

let win2d = 0;
/// Janela em que `caixa`/`texto`/`linha` desenham.
export function janela2D(win: number): void { win2d = win; }
export function janelaAtual2D(): number { return win2d; }

// Objetos de opções reaproveitados (o nativo copia os campos e devolve).
const oRect = { x: 0.0, y: 0.0, w: 0.0, h: 0.0, fill: 0, strokeW: 0, stroke: 0, radius: 0 };
const oText = { x: 0.0, y: 0.0, text: "", color: 0, size: 12, flags: 0 };
const oLine = { x1: 0.0, y1: 0.0, x2: 0.0, y2: 0.0, w: 1, color: 0 };

/// Deslocamento do tamanho no estilo de texto empacotado (2^32: a cor ocupa os 32 bits de baixo).
const ESTILO_TEXTO_ESCALA: f64 = 4294967296.0;

/// Estilo do próximo `caixa`: preenchimento (0 = vazio), borda (largura e cor) e raio.
export function pincel(fill: number, strokeW: number, stroke: number, radius: number): void {
  oRect.fill = fill; oRect.strokeW = strokeW; oRect.stroke = stroke; oRect.radius = radius;
}

/// Retângulo com o estilo do último `pincel`.
export function caixa(x: number, y: number, w: number, h: number): void {
  dcRect();
  oRect.x = x; oRect.y = y; oRect.w = w; oRect.h = h;
  drawRect(win2d, oRect);
}

/// Cor 0xRRGGBBAA e tamanho num número só (argumento `estilo` de `texto`).
export function estiloTexto(color: number, size: number): number {
  const c: f64 = color < 0 ? color + ESTILO_TEXTO_ESCALA : color;
  return c + size * ESTILO_TEXTO_ESCALA;
}

/// Texto em (x, y) com o estilo de `estiloTexto(cor, tamanho)`.
export function texto(x: number, y: number, s: string, estilo: number): void {
  dcText();
  const size: f64 = Math.floor(estilo / ESTILO_TEXTO_ESCALA);
  oText.x = x; oText.y = y; oText.text = s;
  oText.color = estilo - size * ESTILO_TEXTO_ESCALA; oText.size = size;
  drawText(win2d, oText);
}

/// Largura e cor da próxima `linha`.
export function traco(w: number, color: number): void { oLine.w = w; oLine.color = color; }

/// Segmento com o estilo do último `traco`.
export function linha(x1: number, y1: number, x2: number, y2: number): void {
  dcLine();
  oLine.x1 = x1; oLine.y1 = y1; oLine.x2 = x2; oLine.y2 = y2;
  drawLine(win2d, oLine);
}

// Imagem RGBA8: `imagemEm(x, y, w, h)` e depois `imagem(pixels, largura, altura)`.
const SEM_PIXELS = new Uint8Array(4);
const oImg = { x: 0.0, y: 0.0, w: 0.0, h: 0.0, pixels: SEM_PIXELS, imgWidth: 0, imgHeight: 0 };
/// Retângulo da próxima `imagem`.
export function imagemEm(x: number, y: number, w: number, h: number): void {
  oImg.x = x; oImg.y = y; oImg.w = w; oImg.h = h;
}
/// Pixels RGBA8 (`iw` × `ih`) no retângulo do último `imagemEm`.
export function imagem(pixels: Uint8Array, iw: number, ih: number): void {
  oImg.pixels = pixels; oImg.imgWidth = iw; oImg.imgHeight = ih;
  drawImage(win2d, oImg);
  oImg.pixels = SEM_PIXELS;
}

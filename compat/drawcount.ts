// Contadores de PRIMITIVAS 2D por frame — quantas travessias TS→nativo a UI faz.
//
// Vive num módulo próprio porque os dois shims desenham: `compat/app.ts` (o que
// o editor chama como `app.box/text/line`) e `compat/render.ts` (o que os
// widgets, o Project e o UIPanel chamam como `render.rect/text/line`). Contar só
// num deles responderia metade e pareceria a resposta inteira.
//
// É contagem, não tempo, e essa é a razão de existir: "a UI custa 2,9 ms" mede o
// efeito; "a UI faz N travessias" mede a causa, e é o número que decide se vale
// batch ou se falta culling. O profiler responde a primeira pergunta e não a
// segunda.
let nRect = 0;
let nText = 0;
let nLine = 0;

export function dcRect(): void { nRect = nRect + 1; }
export function dcText(): void { nText = nText + 1; }
export function dcLine(): void { nLine = nLine + 1; }

export function dcReset(): void { nRect = 0; nText = 0; nLine = 0; }

/// `[retangulos, textos, linhas, total]` desde o último `dcReset`.
export function dcCounts(): number[] { return [nRect, nText, nLine, nRect + nText + nLine]; }

/// Uma linha pronta para o relatório do profiler.
export function dcReport(): string {
  return "[travessias 2D] rect=" + nRect + " text=" + nText + " line=" + nLine +
         " total=" + (nRect + nText + nLine);
}

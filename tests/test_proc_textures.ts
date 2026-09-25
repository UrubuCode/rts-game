// Texturas procedurais: tamanho, opacidade, determinismo, padrões distintos e
// custo de geração. Sem janela (o upload precisa de uma).
import io from "@compat/io.ts";
import { procTexturePixels, PROC_NOMES, PROC_TEX_SIZE } from "@engine/render/proc_textures";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assinatura(px: Uint8Array): number {
  let h = 0;
  let i = 0;
  while (i < px.length) { h = ((h * 31) + px[i]) | 0; i = i + 7; }
  return h;
}

const vistas: number[] = [];
let k = 0;
while (k < PROC_NOMES.length) {
  const nome = PROC_NOMES[k];
  const t0 = performance.now();
  const a = procTexturePixels(nome);
  const ms = performance.now() - t0;
  const b = procTexturePixels(nome);
  check(a.length === PROC_TEX_SIZE * PROC_TEX_SIZE * 4, nome + ": RGBA8 " + PROC_TEX_SIZE + "x" + PROC_TEX_SIZE);
  let opaco = 1;
  let min = 255; let max = 0;
  let i = 0;
  while (i < a.length) {
    if (a[i + 3] !== 255) opaco = 0;
    if (a[i] < min) min = a[i];
    if (a[i] > max) max = a[i];
    i = i + 4;
  }
  check(opaco === 1, nome + ": opaca");
  check(max - min > 30, nome + ": tem variacao (min " + min + ", max " + max + ")");
  const sa = assinatura(a);
  check(sa === assinatura(b), nome + ": deterministica");
  check(vistas.indexOf(sa) < 0, nome + ": diferente das anteriores");
  vistas.push(sa);
  io.print("  " + nome + ": " + ms.toFixed(1) + " ms, faixa " + min + ".." + max);
  k = k + 1;
}
io.print("[PASSOU] Texturas procedurais: " + PROC_NOMES.length + " padroes");

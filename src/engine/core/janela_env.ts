// Título e posição da janela sobrescrevíveis pelo ambiente, para bench e
// capturas (RTS_TITULO distingue a janela; RTS_JANELA_X/Y a posiciona).
// Sem as variáveis, valem os padrões de quem chama.
import process from "@compat/process.ts";

export function tituloJanela(padrao: string): string {
  const t = process.env("RTS_TITULO");
  return t !== "" ? t : padrao;
}
export function janelaX(padrao: number): number {
  const v = process.env("RTS_JANELA_X");
  return v !== "" ? parseInt(v) : padrao;
}
export function janelaY(padrao: number): number {
  const v = process.env("RTS_JANELA_Y");
  return v !== "" ? parseInt(v) : padrao;
}

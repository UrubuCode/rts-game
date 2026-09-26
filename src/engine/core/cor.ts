// Cor 0xRRGGBB ↔ texto "#RRGGBB" (Inspector, comandos do WebSocket).
const HEX: string = "0123456789ABCDEF";
export function corHex(rgb: number): string {
  let s = "#"; let d = 20;
  while (d >= 0) { const n = (rgb >> d) & 15; s = s + HEX.slice(n, n + 1); d = d - 4; }
  return s;
}
function digito(c: number): number {
  let v = 0 - 1;
  if (c >= 48 && c <= 57) v = c - 48;
  else if (c >= 65 && c <= 70) v = c - 55;
  else if (c >= 97 && c <= 102) v = c - 87;
  return v;
}
/// "#RRGGBB" ou "RRGGBB" → 0xRRGGBB; -1 se inválido.
export function lerCorHex(texto: string): number {
  let t = texto.trim();
  if (t.length > 0 && t.charCodeAt(0) === 35) t = t.slice(1);   // '#'
  let v = t.length === 6 ? 0 : 0 - 1;
  let i = 0;
  while (v >= 0 && i < 6) { const d = digito(t.charCodeAt(i)); v = d < 0 ? 0 - 1 : v * 16 + d; i = i + 1; }
  return v;
}

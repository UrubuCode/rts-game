// Leitura VALIDADA dos argumentos dos comandos da porta de controle.
//
// `parseFloat(parts[i]) | 0` aceitava tudo: argumento faltando virava 0 (o
// comando agia no objeto 0), "abc" virava 0, e um índice fora da faixa lançava
// dentro do comando. Aqui, argumento faltando ou inválido é NaN/-1, e o
// comando responde `[erro] <motivo>` em vez de adivinhar.
//
// Só roda quando um comando chega (nunca por quadro).
import { scene } from "@editor/control/session";

/// Número do texto inteiro ("3", "-1.5", "2e3"); NaN se faltar, sobrar texto
/// ("3abc") ou não for finito. `parseFloat` aceitaria "3abc" como 3.
export function numeroEstrito(s: string | undefined): f64 {
  if (s === undefined || s === null || s.length === 0) return NaN;
  const v = Number(s);
  if (v !== v || v === Infinity || v === 0 - Infinity) return NaN;
  return v;
}

/// Argumento `i` como número; NaN se faltar ou não for número.
export function argNum(parts: string[], i: number): f64 {
  return i < parts.length ? numeroEstrito(parts[i]) : NaN;
}

/// Argumento `i` como inteiro; NaN se faltar, não for número ou tiver fração.
export function argInt(parts: string[], i: number): f64 {
  const v = argNum(parts, i);
  return v === Math.floor(v) ? v : NaN;
}

/// Os `n` argumentos a partir de `de` são todos números?
export function argsNumericos(parts: string[], de: number, n: number): boolean {
  let k = 0;
  while (k < n) { const v = argNum(parts, de + k); if (v !== v) return false; k = k + 1; }
  return true;
}

/// Índice de objeto válido no argumento `i`, ou -1 (faltando, não inteiro ou
/// fora da cena). O nome/caminho já foi trocado pelo índice no despacho.
export function argObj(parts: string[], i: number): number {
  const v = argInt(parts, i);
  if (v !== v || v < 0 || v >= scene.objects.length) return 0 - 1;
  return v;
}

/// Mensagem de objeto inválido para o argumento `i`.
export function erroObj(parts: string[], i: number): string {
  const tok = i < parts.length ? parts[i] : "";
  if (tok.length === 0) return "[erro] falta o objeto (indice, nome ou caminho Pai/Filho; veja tree ou find)";
  return "[erro] objeto invalido: '" + tok + "' (a cena tem " + scene.objects.length + " objetos, indices 0.." + (scene.objects.length - 1) + ")";
}

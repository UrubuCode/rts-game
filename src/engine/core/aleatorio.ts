// Gerador ALEATÓRIO central do motor, com semente.
//
// Scripts e sistemas que precisam de sorteio usam `aleatorio()` em vez de
// `Math.random()`: com a mesma semente (`semearAleatorio`, comando `seed` da
// porta de controle), a mesma sequência de passos dá o mesmo resultado — o que
// torna um teste de simulação reproduzível.
//
// Park–Miller ("minimal standard", 16807 mod 2^31-1): só multiplicação e resto
// em f64 (16807 * 2^31 < 2^53, exato), sem operações de bit. Sem alocação.

const MODULO: f64 = 2147483647.0;
const MULTIPLICADOR: f64 = 16807.0;

let estado: f64 = 1.0;
let semente: f64 = 1.0;

/// Semente em 1..MODULO-1 (0 e múltiplos do módulo travariam o gerador).
function normalizar(n: f64): f64 {
  let s = Math.floor(Math.abs(n)) % (MODULO - 1.0);
  if (s < 1.0) s = s + 1.0;
  return s;
}

/// Reinicia a sequência. A mesma semente dá a mesma sequência.
export function semearAleatorio(n: f64): void {
  semente = normalizar(n);
  estado = semente;
}

/// A semente em uso (a normalizada).
export function sementeAleatorio(): f64 { return semente; }

/// Número em [0, 1).
export function aleatorio(): f64 {
  estado = (estado * MULTIPLICADOR) % MODULO;
  return (estado - 1.0) / (MODULO - 1.0);
}

/// Número em [a, b).
export function aleatorioEntre(a: f64, b: f64): f64 { return a + (b - a) * aleatorio(); }

// Sem `seed`, cada sessão começa de um ponto diferente (como o Random da Unity).
semearAleatorio(Date.now());

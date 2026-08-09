/// Áudio POSICIONAL: a matemática que transforma uma posição de mundo em dois
/// ganhos de canal. Nada aqui toca o dispositivo, aloca buffer ou conhece voz —
/// é função pura sobre números, e é por isso que dá para testar sem placa de
/// som e sem ouvir nada.
///
/// # O modelo, e o que foi rejeitado com número
///
/// **HRTF ficou de fora, e não foi perto.** Uma convolução de 128 taps por
/// orelha custa ~4,1 ms por voz por frame com o custo de acesso medido neste
/// motor (20 ns) — o dobro do orçamento inteiro de áudio para UMA fonte. O que
/// entrega a maior parte da sensação por uma fração disso é o par
/// atenuação + panorâmica de potência constante, e depois ITD e sombra de
/// cabeça (ainda não implementados; ver `docs` no fim do arquivo).
///
/// **Os parâmetros são por BLOCO, não por amostra.** Recalcular distância e pan
/// a cada amostra custaria ~350 ns/amostra/voz e caberia em 6 vozes — para
/// recalcular 800 vezes por frame a mesma função dos mesmos dados, já que
/// câmera e objetos só se movem uma vez por frame. Por bloco custa ~0,2 µs por
/// voz. O artefato dessa escolha (o salto de ganho na fronteira do bloco) está
/// anotado no fim.
import math from "rts:math";

// ── OUVINTE ─────────────────────────────────────────────────────────────────
// Estado de módulo, empurrado uma vez por frame por quem tem a câmera. O
// `engine/audio` NÃO importa o `session` do editor de propósito: a dependência
// é editor → engine, e invertê-la quebraria os testes headless, que montam cena
// sem editor nenhum.
let lx: f64 = 0.0; let ly: f64 = 0.0; let lz: f64 = 0.0;
let lYaw: f64 = 0.0; let lPitch: f64 = 0.0;
// Vetor LATERAL do ouvinte, derivado do yaw uma vez por `setListener` em vez de
// por voz. Mesma convenção do render (LH, yaw 0 = +Z).
let rx: f64 = 1.0; let rz: f64 = 0.0;

/// Onde está e para onde olha quem ouve. Chamar uma vez por frame, na mesma
/// linha do `pumpAudio()` — ganho e som saem do mesmo instante.
export function setListener(x: f64, y: f64, z: f64, yaw: f64, pitch: f64): void {
  lx = x; ly = y; lz = z; lYaw = yaw; lPitch = pitch;
  rx = math.cos(yaw);
  rz = 0.0 - math.sin(yaw);
}

export function listenerX(): f64 { return lx; }
export function listenerY(): f64 { return ly; }
export function listenerZ(): f64 { return lz; }
export function listenerYaw(): f64 { return lYaw; }
export function listenerPitch(): f64 { return lPitch; }

// ── CURVA DE DISTÂNCIA ──────────────────────────────────────────────────────
/// Raio de ganho cheio, e a distância em que a fonte cala.
let refDist: f64 = 1.0;
let maxDist: f64 = 60.0;

/// `ref` = raio em que o som ainda está em ganho cheio; além de `max` é zero.
export function setRolloff(ref: f64, max: f64): void {
  refDist = ref > 0.001 ? ref : 0.001;
  maxDist = max > refDist ? max : refDist + 0.001;
}

export function rolloffRef(): f64 { return refDist; }
export function rolloffMax(): f64 { return maxDist; }

/// Ganho pela distância: `ref/d`, cortado em `max`.
///
/// # Por que inversa e não inversa-quadrada
///
/// A pressão sonora cai com 1/r; a intensidade é que cai com 1/r². Um mixer
/// multiplica AMPLITUDE, ou seja, pressão. Usar 1/r² dá −12 dB por dobro de
/// distância e a fonte some em três metros — o jogador perde a noção de escala.
/// −6 dB por dobro é o que Unity, FMOD e Wwise usam por default, pelo mesmo
/// motivo.
///
/// O corte em `max` não é cosmético: sem ele a curva nunca chega a zero e não
/// existe critério honesto para parar de mixar uma voz distante.
export function attenuation(dist: f64): f64 {
  if (dist >= maxDist) return 0.0;
  if (dist <= refDist) return 1.0;
  return refDist / dist;
}

// ── PANORÂMICA ──────────────────────────────────────────────────────────────
/// Onde a fonte cai entre as caixas: −1 toda à esquerda, +1 toda à direita.
///
/// É o produto escalar da direção da fonte com o vetor lateral do ouvinte —
/// que já É o seno do azimute. Um `atan2` daria o ângulo e nenhum ouvido
/// distingue os dois, então ele não é pago.
///
/// Perto do ouvinte a panorâmica COLAPSA para o centro (`d < ref`): uma fonte
/// "na cabeça" com pan duro soa errado, e este é o pior artefato de fonte
/// próxima.
export function panOf(sx: f64, sy: f64, sz: f64): f64 {
  const dx: f64 = sx - lx;
  const dz: f64 = sz - lz;
  const dy: f64 = sy - ly;
  const d2: f64 = dx * dx + dy * dy + dz * dz;
  if (d2 < 0.000001) return 0.0;
  const d: f64 = math.sqrt(d2);
  let p: f64 = (dx * rx + dz * rz) / d;
  if (d < refDist) p = p * (d / refDist);
  if (p > 1.0) p = 1.0;
  if (p < 0.0 - 1.0) p = 0.0 - 1.0;
  return p;
}

/// Distância do ouvinte até a fonte.
export function distanceTo(sx: f64, sy: f64, sz: f64): f64 {
  const dx: f64 = sx - lx; const dy: f64 = sy - ly; const dz: f64 = sz - lz;
  return math.sqrt(dx * dx + dy * dy + dz * dz);
}

/// Ganhos de canal de uma fonte, já com a atenuação aplicada.
/// `out[0]` = esquerdo, `out[1]` = direito.
///
/// # Potência constante, não amplitude constante
///
/// `gL² + gR² = 1` em qualquer posição. A alternativa (`gL + gR = 1`) deixa cada
/// lado em 0,5 no centro, o que dá metade da POTÊNCIA das pontas: a fonte fica
/// audivelmente mais baixa ao passar pela frente do jogador. Duas caixas numa
/// sala somam potência, não amplitude — por isso esta é a lei certa aqui, e a
/// outra seria certa só se os canais somassem coerentemente (mono-fold).
///
/// Escreve num array de saída porque o motor não devolve tuplas.
export function panGains(sx: f64, sy: f64, sz: f64, out: f64[]): void {
  const d: f64 = distanceTo(sx, sy, sz);
  const att: f64 = attenuation(d);
  if (att <= 0.0) { out[0] = 0.0; out[1] = 0.0; return; }
  const p: f64 = panOf(sx, sy, sz);
  // θ vai de 0 (tudo à esquerda) a π/2 (tudo à direita)
  const th: f64 = (p + 1.0) * 0.78539816339744831;
  out[0] = math.cos(th) * att;
  out[1] = math.sin(th) * att;
}

// ── O QUE FALTA, dito aqui para não virar surpresa ──────────────────────────
//
// **Frente e trás soam igual.** Com panorâmica L/R pura a ambiguidade é do
// modelo, não um defeito: distinguir exige filtrar o traseiro, que é um filtro
// por voz. É a fase seguinte, junto de ITD (atraso interaural, ~31 amostras no
// extremo, custo zero por ser um deslocamento de índice) e do polo de sombra de
// cabeça — juntos, ~5 % do custo por amostra.
//
// **O ganho salta na fronteira do bloco.** Uma fonte que cruza rápido muda de
// ganho a cada frame, e um salto de amplitude é um degrau — cujo espectro é
// banda-larga. A 60 Hz isso vira um zumbido tonal. A correção é rampar o ganho
// por amostra (`g += (alvo − g)/frames`, ~2 ns), e ela entra quando o mixer
// tiver os ganhos-alvo separados dos correntes. Está anotado como dívida
// consciente: hoje as fontes do jogo se movem devagar perto do ouvinte.

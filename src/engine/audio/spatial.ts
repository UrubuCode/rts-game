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
import math from "@compat/math.ts";
import { V_X, V_Y, V_Z, V_BLEND, V_MIN, V_MAX, V_ROLLOFF, ROLLOFF_LINEAR, CORTE_ABERTO } from "./vozes";

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
// Velocidade do ouvinte (fase 1: só armazenada; Doppler fica para depois).
let lvx: f64 = 0.0; let lvy: f64 = 0.0; let lvz: f64 = 0.0;
// Vetor de FRENTE do ouvinte, com pitch — convenção do render:
// fwd = (sin yaw·cos p, sin p, cos yaw·cos p), pitch > 0 olha para cima.
let fx: f64 = 0.0; let fy: f64 = 0.0; let fz: f64 = 1.0;

/// Onde está e para onde olha quem ouve. Chamar uma vez por frame, na mesma
/// linha do `pumpAudio()` — ganho e som saem do mesmo instante.
/// `pose` = [x, y, z, yaw, pitch, vx, vy, vz] (com 5 floats a velocidade é 0).
export function setListener(pose: Float64Array): void {
  lx = pose[0]; ly = pose[1]; lz = pose[2]; lYaw = pose[3]; lPitch = pose[4];
  rx = math.cos(lYaw);
  rz = 0.0 - math.sin(lYaw);
  const cp: f64 = math.cos(lPitch);
  fx = math.sin(lYaw) * cp; fy = math.sin(lPitch); fz = math.cos(lYaw) * cp;
  if (pose.length >= 8) { lvx = pose[5]; lvy = pose[6]; lvz = pose[7]; }
  else { lvx = 0.0; lvy = 0.0; lvz = 0.0; }
}

export function listenerX(): f64 { return lx; }
export function listenerY(): f64 { return ly; }
export function listenerZ(): f64 { return lz; }
export function listenerYaw(): f64 { return lYaw; }
export function listenerPitch(): f64 { return lPitch; }
export function listenerVX(): f64 { return lvx; }
export function listenerVY(): f64 { return lvy; }
export function listenerVZ(): f64 { return lvz; }

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

// ── POR FONTE (fase 1 do spec §3.6/§3.8) ────────────────────────────────────
export const ESP_GL: number = 0;
export const ESP_GR: number = 1;
export const ESP_LP: number = 2;      // coeficiente do passa-baixa de um polo
export const ESP_DIST: number = 3;
export const ESP_CORTE: number = 4;   // corte em Hz (inspeção: `audio list`)
export const ESP_FLOATS: number = 5;
/// Corte de uma fonte bem atrás do ouvinte. À frente é `CORTE_ABERTO` (22 kHz);
/// entre os dois, interpolação geométrica pelo cosseno com o `fwd`.
export const ESP_CORTE_ATRAS: f64 = 5000.0;
/// Corte a partir do qual o filtro é desligado (coeficiente 1).
export const ESP_CORTE_DESLIGA: f64 = 20000.0;
/// Fração do corte que sobra no `maxDistance` (cai linearmente de min a max).
export const ESP_FATOR_CORTE_LONGE: f64 = 0.5;
const ESP_DIST_MIN: f64 = 0.001;

/// Atenuação de uma fonte: log = `min/d`, linear = `(max − d)/(max − min)`,
/// 1 dentro de `min` e 0 além de `max` (spec §3.6).
export function atenuacaoFonte(d: f64, min: f64, max: f64, modo: number): f64 {
  const mn: f64 = min > ESP_DIST_MIN ? min : ESP_DIST_MIN;
  const mx: f64 = max > mn ? max : mn + ESP_DIST_MIN;
  if (d >= mx) return 0.0;
  if (d <= mn) return 1.0;
  if (modo === ROLLOFF_LINEAR) return (mx - d) / (mx - mn);
  return mn / d;
}

/// Coeficiente `a` de `y += a(x − y)` para um corte em Hz; ≥ 20 kHz desliga (1).
export function corteParaCoef(corteHz: f64, taxa: f64): f64 {
  if (corteHz >= ESP_CORTE_DESLIGA || taxa <= 0.0) return 1.0;
  return 1.0 - math.exp(0.0 - 2.0 * Math.PI * corteHz / taxa);
}

/// Ganhos L/R, coeficiente do passa-baixa, distância e corte de UMA voz para o
/// próximo bloco, a partir do slot `b` da tabela de vozes. 2D (blend 0) é
/// (1, 1) sem filtro; 3D é atenuação por fonte × pan de potência constante,
/// com o corte caindo de 22 kHz (frente) a 5 kHz (atrás) e com a distância.
/// `L = (1 − b)·1 + b·L3D` (spec §3.6), e o mesmo para R e o coeficiente.
export function espGanhosVoz(vozes: Float64Array, b: number, taxa: f64, out: Float64Array): void {
  let blend: f64 = vozes[b + V_BLEND];
  if (!(blend > 0.0)) {
    out[ESP_GL] = 1.0; out[ESP_GR] = 1.0; out[ESP_LP] = 1.0; out[ESP_DIST] = 0.0; out[ESP_CORTE] = CORTE_ABERTO;
    return;
  }
  if (blend > 1.0) blend = 1.0;
  const dx: f64 = vozes[b + V_X] - lx; const dy: f64 = vozes[b + V_Y] - ly; const dz: f64 = vozes[b + V_Z] - lz;
  const d: f64 = math.sqrt(dx * dx + dy * dy + dz * dz);
  const mn: f64 = vozes[b + V_MIN] > ESP_DIST_MIN ? vozes[b + V_MIN] : ESP_DIST_MIN;
  const mx: f64 = vozes[b + V_MAX] > mn ? vozes[b + V_MAX] : mn + ESP_DIST_MIN;
  const att: f64 = atenuacaoFonte(d, mn, mx, vozes[b + V_ROLLOFF]);
  let gl3: f64 = 0.0; let gr3: f64 = 0.0; let corte: f64 = CORTE_ABERTO;
  if (att > 0.0) {
    let p: f64 = 0.0; let frente: f64 = 1.0;
    if (d > ESP_DIST_MIN) {
      p = (dx * rx + dz * rz) / d;
      frente = (dx * fx + dy * fy + dz * fz) / d;
      if (d < mn) p = p * (d / mn);
      if (p > 1.0) p = 1.0;
      if (p < 0.0 - 1.0) p = 0.0 - 1.0;
    }
    const th: f64 = (p + 1.0) * 0.78539816339744831;
    gl3 = math.cos(th) * att; gr3 = math.sin(th) * att;
    const t: f64 = (1.0 - frente) * 0.5;
    corte = CORTE_ABERTO * Math.pow(ESP_CORTE_ATRAS / CORTE_ABERTO, t);
    let longe: f64 = (d - mn) / (mx - mn);
    if (longe < 0.0) longe = 0.0;
    if (longe > 1.0) longe = 1.0;
    corte = corte * (1.0 - (1.0 - ESP_FATOR_CORTE_LONGE) * longe);
  }
  const coef3: f64 = corteParaCoef(corte, taxa);
  out[ESP_GL] = (1.0 - blend) + blend * gl3;
  out[ESP_GR] = (1.0 - blend) + blend * gr3;
  out[ESP_LP] = (1.0 - blend) + blend * coef3;
  out[ESP_DIST] = d;
  out[ESP_CORTE] = corte;
}

// ── O QUE FALTA, dito aqui para não virar surpresa ──────────────────────────
//
// **Frente e trás: resolvido na fase 1 pelo passa-baixa de `espGanhosVoz`
// (22 kHz → 5 kHz); ITD e sombra de cabeça seguem para depois.**
//
// **Resolvido: `mix_add` rampa o ganho por amostra do valor corrente ao alvo
// (Task 6).**

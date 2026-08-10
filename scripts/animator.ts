// Componente de ANIMAÇÃO: interpola propriedades do transform por keyframes.
//
// O motor já tinha scripts que MOVEM (Spinner gira, Bobber flutua), mas cada um
// com um movimento fixo em código. Animação de verdade é outra coisa: uma curva
// que o usuário desenha no tempo — "sobe até 3 em meio segundo, espera, desce".
//
// Um Animator guarda keyframes `(tempo, valor)` para UM canal do transform e os
// interpola. Vários Animators no mesmo objeto animam canais diferentes — é assim
// que se monta uma porta que abre girando enquanto sobe.
//
// Não há import de .anim ainda: os keyframes são montados por código ou pelo
// inspector. O que existe aqui é o RUNTIME de animação, que é a parte que o
// resto do motor não tinha.

import { Behavior } from "../engine/core/behavior";
import math from "../compat/math.ts";

/// Canais animáveis (índice do campo no transform).
export const CH_PX = 0;
export const CH_PY = 1;
export const CH_PZ = 2;
export const CH_RX = 3;
export const CH_RY = 4;
export const CH_SX = 5;
export const CH_SY = 6;
export const CH_SZ = 7;

/// Modos de interpolação entre dois keyframes.
export const EASE_LINEAR = 0;
/// Suaviza entrada e saída (smoothstep). É o que faz um movimento parecer
/// intencional em vez de mecânico — o olho percebe a aceleração constante do
/// linear como "de robô".
export const EASE_SMOOTH = 1;
/// Degrau: mantém o valor até o próximo key. Para animação de sprite/estado.
export const EASE_STEP = 2;

export class Animator extends Behavior {
  channel: f64;      // qual campo do transform (CH_*)
  ease: f64;         // EASE_*
  loop: f64;         // 0 = para no fim, 1 = repete, 2 = vai-e-volta (ping-pong)
  speed: f64;        // multiplicador de tempo (2 = o dobro da velocidade)
  playing: f64;      // 0 = pausado

  // keyframes em arrays paralelos, ordenados por tempo
  kt: f64[];
  kv: f64[];
  t: f64;            // tempo atual dentro da animação
  dir: f64;          // 1 ou -1 (ping-pong)

  constructor(channel: f64, ease: f64) {
    super();
    this.channel = channel;
    this.ease = ease;
    this.loop = 1.0;
    this.speed = 1.0;
    this.playing = 1.0;
    this.kt = [];
    this.kv = [];
    this.t = 0.0;
    this.dir = 1.0;
  }

  /// Acrescenta um keyframe. Mantém a lista ORDENADA por tempo: a interpolação
  /// varre em ordem, e um key fora de lugar faria o valor saltar.
  key(time: f64, value: f64): Animator {
    let i = this.kt.length;
    this.kt.push(time);
    this.kv.push(value);
    while (i > 0 && this.kt[i - 1] > this.kt[i]) {
      const tt = this.kt[i - 1]; this.kt[i - 1] = this.kt[i]; this.kt[i] = tt;
      const vv = this.kv[i - 1]; this.kv[i - 1] = this.kv[i]; this.kv[i] = vv;
      i = i - 1;
    }
    return this;
  }

  /// Duração total = tempo do último keyframe.
  duration(): f64 {
    const n = this.kt.length;
    if (n === 0) return 0.0;
    return this.kt[n - 1];
  }

  /// Volta ao início.
  rewind(): void { this.t = 0.0; this.dir = 1.0; }

  /// Valor amostrado no tempo `at`, já com a curva aplicada.
  sample(at: f64): f64 {
    const n = this.kt.length;
    if (n === 0) return 0.0;
    if (n === 1) return this.kv[0];
    if (at <= this.kt[0]) return this.kv[0];
    if (at >= this.kt[n - 1]) return this.kv[n - 1];
    // acha o par que contém `at`
    let i = 0;
    while (i < n - 1 && this.kt[i + 1] < at) i = i + 1;
    const t0 = this.kt[i]; const t1 = this.kt[i + 1];
    const v0 = this.kv[i]; const v1 = this.kv[i + 1];
    const span = t1 - t0;
    if (span <= 0.0) return v1;
    let u: f64 = (at - t0) / span;
    const e = this.ease | 0;
    if (e === EASE_STEP) return v0;
    if (e === EASE_SMOOTH) u = u * u * (3.0 - 2.0 * u);   // smoothstep
    return v0 + (v1 - v0) * u;
  }

  update(dt: f64): void {
    if (this.playing === 0.0) return;
    const dur = this.duration();
    if (dur <= 0.0) return;
    this.t = this.t + dt * this.speed * this.dir;
    const lp = this.loop | 0;
    if (this.t > dur) {
      if (lp === 1) this.t = this.t - dur;             // repete
      else if (lp === 2) { this.t = dur; this.dir = 0.0 - 1.0; }  // volta
      else { this.t = dur; this.playing = 0.0; }       // para no fim
    } else if (this.t < 0.0) {
      if (lp === 2) { this.t = 0.0; this.dir = 1.0; }
      else this.t = 0.0;
    }
    const v = this.sample(this.t);
    const c = this.channel | 0;
    const h = this.host;
    if (c === CH_PX) h.px = v;
    else if (c === CH_PY) h.py = v;
    else if (c === CH_PZ) h.pz = v;
    else if (c === CH_RX) h.rx = v;
    else if (c === CH_RY) h.ry = v;
    else if (c === CH_SX) h.sx = v;
    else if (c === CH_SY) h.sy = v;
    else if (c === CH_SZ) h.sz = v;
  }

  toData(): any {
    return { type: "animator", channel: this.channel, ease: this.ease,
             loop: this.loop, speed: this.speed, kt: this.kt, kv: this.kv };
  }

  typeName(): string { return "Animator"; }
  fieldCount(): number { return 4; }
  fieldLabel(i: number): string {
    if (i === 0) return "Canal";
    if (i === 1) return "Curva";
    if (i === 2) return "Loop";
    return "Veloc";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.channel;
    if (i === 1) return this.ease;
    if (i === 2) return this.loop;
    return this.speed;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.channel = v;
    else if (i === 1) this.ease = v;
    else if (i === 2) this.loop = v;
    else this.speed = v;
  }
}

// Componente de ÁUDIO: toca um som a partir de um GameObject.
//
// É o análogo do AudioSource da Unity, no que este motor comporta: escolhe o
// timbre, a nota e a duração, e dispara — ou por `play()` (chamado por outro
// script) ou sozinho em intervalo, que é o suficiente para ambiente e alarme.
//
// O SOM em si vem do mixer (`engine/audio/audio.ts`); este componente só decide
// QUANDO tocar. A separação importa: o mixer é um sistema global (uma saída de
// áudio, N vozes) e um componente por objeto não poderia mixar nada sozinho.

import { Behavior } from "../engine/core/behavior";
import { playTone, playSquare, playNoise } from "../engine/audio/audio";

export class AudioSource extends Behavior {
  kind: f64;      // 0 = seno, 1 = quadrada, 2 = ruído
  freq: f64;      // Hz (ignorado no ruído)
  dur: f64;       // segundos
  gain: f64;      // 0..1
  every: f64;     // 0 = só sob demanda; > 0 = repete a cada N segundos
  t: f64;         // acumulador do intervalo

  constructor(kind: f64, freq: f64, dur: f64, gain: f64) {
    super();
    this.kind = kind;
    this.freq = freq;
    this.dur = dur;
    this.gain = gain;
    this.every = 0.0;
    this.t = 0.0;
  }

  /// Dispara o som agora. É o que outro script chama ("tiro", "clique").
  play(): void {
    const k = this.kind | 0;
    if (k === 2) playNoise(this.dur, this.gain);
    else if (k === 1) playSquare(this.freq, this.dur, this.gain);
    else playTone(this.freq, this.dur, this.gain);
  }

  update(dt: f64): void {
    if (this.every <= 0.0) return;      // modo sob demanda
    this.t = this.t + dt;
    if (this.t >= this.every) {
      this.t = 0.0;
      this.play();
    }
  }

  toData(): any {
    return { type: "audiosource", kind: this.kind, freq: this.freq,
             dur: this.dur, gain: this.gain, every: this.every };
  }

  typeName(): string { return "AudioSource"; }
  fieldCount(): number { return 5; }
  fieldLabel(i: number): string {
    if (i === 0) return "Tipo";
    if (i === 1) return "Freq";
    if (i === 2) return "Dur";
    if (i === 3) return "Vol";
    return "Cada";
  }
  fieldGet(i: number): f64 {
    if (i === 0) return this.kind;
    if (i === 1) return this.freq;
    if (i === 2) return this.dur;
    if (i === 3) return this.gain;
    return this.every;
  }
  fieldSet(i: number, v: f64): void {
    if (i === 0) this.kind = v;
    else if (i === 1) this.freq = v;
    else if (i === 2) this.dur = v;
    else if (i === 3) this.gain = v;
    else this.every = v;
  }
}

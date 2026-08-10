// A APOSTA DO MIXER POSICIONAL, medida antes de escrever o mixer.
//
// O modelo assume: ler o estado da voz para LOCAIS uma vez por bloco e rodar o
// laço de amostras só sobre locais. Se o motor mantiver esses locais em
// registradores, o custo por amostra cai de ~185 ns (o laço de hoje, que relê
// os arrays a cada amostra) para a casa de 5-10 ns.
//
// Se NÃO cair, o desenho inteiro precisa mudar — então isto vem antes.
import io from "../../compat/io.ts";
import math from "../../compat/math.ts";
import buffer from "../../compat/buffer.ts";

const N_VOZES = 24;
const N_AMOSTRAS = 800;
const BLOCOS = 200;

const vFreq: f64[] = []; const vPhase: f64[] = []; const vGain: f64[] = [];
const vLeft: f64[] = []; const vTotal: f64[] = []; const vGL: f64[] = []; const vGR: f64[] = [];
let z = 0;
while (z < N_VOZES) {
  vFreq.push(220.0 + z * 30.0); vPhase.push(0.0); vGain.push(0.3);
  vLeft.push(9.0); vTotal.push(9.0); vGL.push(0.7); vGR.push(0.7);
  z = z + 1;
}
const acc = buffer.alloc(N_AMOSTRAS * 2 * 4);

/// O laço de HOJE: amostra fora, voz dentro, relendo os arrays por amostra.
function mixAtual(buf: i64, frames: number, dt: f64,
                  fr: f64[], ph: f64[], ga: f64[], le: f64[], to: f64[]): void {
  let f = 0;
  while (f < frames) {
    let s: f64 = 0.0;
    let v = 0;
    while (v < N_VOZES) {
      const t = le[v]; const env = t / to[v];
      const p = ph[v];
      s = s + math.sin(p) * ga[v] * env;
      let np = p + 6.28318530717959 * fr[v] * dt;
      while (np > 6.28318530717959) np = np - 6.28318530717959;
      ph[v] = np; le[v] = t - dt;
      v = v + 1;
    }
    buffer.write_f32(buf, (f * 2) * 4, s);
    buffer.write_f32(buf, (f * 2 + 1) * 4, s);
    f = f + 1;
  }
}

/// O laço PROPOSTO: voz fora, amostra dentro, estado em LOCAIS, acumulando.
function mixInvertido(buf: i64, frames: number, dt: f64,
                      fr: f64[], ph: f64[], ga: f64[], le: f64[], to: f64[],
                      gl: f64[], gr: f64[]): void {
  let v = 0;
  while (v < N_VOZES) {
    // uma leitura por voz por bloco — daqui em diante, só locais
    let p: f64 = ph[v];
    const passo: f64 = 6.28318530717959 * fr[v] * dt;
    const g: f64 = ga[v];
    let t: f64 = le[v];
    const tot: f64 = to[v];
    const gL: f64 = gl[v];
    const gR: f64 = gr[v];
    let f = 0;
    while (f < frames) {
      const env: f64 = t / tot;
      const smp: f64 = math.sin(p) * g * env;
      const iL = (f * 2) * 4;
      const iR = (f * 2 + 1) * 4;
      buffer.write_f32(buf, iL, buffer.read_f32(buf, iL) + smp * gL);
      buffer.write_f32(buf, iR, buffer.read_f32(buf, iR) + smp * gR);
      p = p + passo;
      if (p > 6.28318530717959) p = p - 6.28318530717959;
      t = t - dt;
      f = f + 1;
    }
    ph[v] = p; le[v] = t;
    v = v + 1;
  }
}

const dt: f64 = 1.0 / 48000.0;
mixAtual(acc, 64, dt, vFreq, vPhase, vGain, vLeft, vTotal);
mixInvertido(acc, 64, dt, vFreq, vPhase, vGain, vLeft, vTotal, vGL, vGR);

let b = 0;
const t0 = performance.now();
while (b < BLOCOS) { mixAtual(acc, N_AMOSTRAS, dt, vFreq, vPhase, vGain, vLeft, vTotal); b = b + 1; }
const t1 = performance.now();
let c = 0;
while (c < BLOCOS) { mixInvertido(acc, N_AMOSTRAS, dt, vFreq, vPhase, vGain, vLeft, vTotal, vGL, vGR); c = c + 1; }
const t2 = performance.now();

const atual = (t1 - t0) / BLOCOS;
const invertido = (t2 - t1) / BLOCOS;
io.print("[laco] ATUAL     (amostra-fora): " + math.floor(atual * 100.0) / 100.0 + " ms/bloco de " + N_AMOSTRAS + " amostras x " + N_VOZES + " vozes");
io.print("[laco] INVERTIDO (voz-fora)    : " + math.floor(invertido * 100.0) / 100.0 + " ms/bloco");
io.print("[laco] ganho: " + math.floor(atual / invertido * 100.0) / 100.0 + "x  | orcamento e 2 ms/frame");

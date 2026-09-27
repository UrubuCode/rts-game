// Kernel de REFERÊNCIA em TypeScript, com a semântica exata de `mix_add` e
// `mix_level` do runtime. Não é o caminho do jogo (o nativo é ~20× mais
// barato): é o "antes" do bench na mesma sessão e o oráculo da paridade.
import { D_POS, D_PASSO, D_CANAIS_SRC, D_CANAIS_DST, D_QUADROS, D_GL0, D_GR0, D_GL1, D_GR1, D_LP_COEF,
         D_LP_L, D_LP_R, D_LACO_INI, D_LACO_FIM, D_MIXADOS, D_FIM, DESC_FLOATS,
         N_CANAIS, N_QUADROS, N_PICO_L, N_PICO_R, N_RMS_L, N_RMS_R, N_CORTADAS, NIVEL_FLOATS } from "./mix_desc";

const MIXTS_CANAIS_MAX: number = 8;

function mixtsFinito(v: f64, padrao: f64): f64 { return v === v && v !== Infinity && v !== 0.0 - Infinity ? v : padrao; }

export function mixAddTs(dst: Float32Array, src: Float32Array, desc: Float64Array): number {
  if (desc.length < DESC_FLOATS) return 0;
  desc[D_MIXADOS] = 0.0; desc[D_FIM] = 0.0;
  const cs = mixtsFinito(desc[D_CANAIS_SRC], 0.0) | 0;
  const cd = mixtsFinito(desc[D_CANAIS_DST], 0.0) | 0;
  if (!(cs === 1 || cs === 2) || cd <= 0 || cd > MIXTS_CANAIS_MAX) return 0;
  const total = (src.length / cs) | 0;
  if (total === 0) { desc[D_FIM] = 1.0; return 0; }
  let n = Math.max(0.0, mixtsFinito(desc[D_QUADROS], 0.0)) | 0;
  const cabem = (dst.length / cd) | 0;
  if (n > cabem) n = cabem;
  if (n === 0) return 0;
  let passo = mixtsFinito(desc[D_PASSO], 1.0);
  if (!(passo > 0.0)) passo = 1.0;
  const li = mixtsFinito(desc[D_LACO_INI], 0.0 - 1.0);
  const lf = mixtsFinito(desc[D_LACO_FIM], 0.0 - 1.0);
  const laco = li >= 0.0 && lf > li && lf <= total;
  const limite = laco ? lf : total;
  let pos = Math.max(0.0, mixtsFinito(desc[D_POS], 0.0));
  let a = mixtsFinito(desc[D_LP_COEF], 1.0);
  if (!(a > 0.0 && a < 1.0)) a = 1.0;
  a = Math.fround(a);
  let yl = Math.fround(mixtsFinito(desc[D_LP_L], 0.0));
  let yr = Math.fround(mixtsFinito(desc[D_LP_R], 0.0));
  const gl0 = Math.fround(mixtsFinito(desc[D_GL0], 0.0));
  const gr0 = Math.fround(mixtsFinito(desc[D_GR0], 0.0));
  const dgl = Math.fround((Math.fround(mixtsFinito(desc[D_GL1], 0.0)) - gl0) / n);
  const dgr = Math.fround((Math.fround(mixtsFinito(desc[D_GR1], 0.0)) - gr0) / n);
  let i = 0;
  while (i < n) {
    if (pos >= limite) {
      if (laco) pos = li + (pos - lf) % (lf - li);
      else { desc[D_FIM] = 1.0; break; }
    }
    const i0 = Math.floor(pos) | 0;
    const frac = Math.fround(pos - i0);
    let i1 = i0 + 1;
    if (i1 >= limite) i1 = laco ? (li | 0) : i0;
    let xl: f64 = 0.0; let xr: f64 = 0.0;
    if (cs === 1) {
      const s0 = src[i0];
      xl = Math.fround(s0 + Math.fround((src[i1] - s0) * frac)); xr = xl;
    } else {
      const l0 = src[i0 * 2]; const r0 = src[i0 * 2 + 1];
      xl = Math.fround(l0 + Math.fround((src[i1 * 2] - l0) * frac));
      xr = Math.fround(r0 + Math.fround((src[i1 * 2 + 1] - r0) * frac));
    }
    yl = Math.fround(yl + Math.fround(a * Math.fround(xl - yl)));
    yr = Math.fround(yr + Math.fround(a * Math.fround(xr - yr)));
    const k = i + 1;
    const l = Math.fround(yl * Math.fround(gl0 + Math.fround(dgl * k)));
    const r = Math.fround(yr * Math.fround(gr0 + Math.fround(dgr * k)));
    const base = i * cd;
    if (cd === 1) dst[base] = dst[base] + Math.fround((l + r) * 0.5);
    else {
      dst[base] = dst[base] + l;
      dst[base + 1] = dst[base + 1] + r;
      let c = 2;
      while (c < cd) { dst[base + c] = dst[base + c] + Math.fround((l + r) * 0.5); c = c + 1; }
    }
    pos = pos + passo;
    i = i + 1;
  }
  if (!laco && pos >= limite) desc[D_FIM] = 1.0;
  desc[D_POS] = pos; desc[D_LP_L] = yl; desc[D_LP_R] = yr; desc[D_MIXADOS] = i;
  return i;
}

export function mixLevelTs(buf: Float32Array, nivel: Float64Array): number {
  if (nivel.length < NIVEL_FLOATS) return 0;
  const ch = mixtsFinito(nivel[N_CANAIS], 0.0) | 0;
  if (ch <= 0 || ch > MIXTS_CANAIS_MAX) return 0;
  let n = Math.max(0.0, mixtsFinito(nivel[N_QUADROS], 0.0)) | 0;
  if (n > ((buf.length / ch) | 0)) n = (buf.length / ch) | 0;
  let pl = 0.0; let pr = 0.0; let sl = 0.0; let sr = 0.0; let cortadas = 0;
  let q = 0;
  while (q < n) {
    let c = 0;
    while (c < ch) {
      const at = q * ch + c;
      let v = buf[at];
      if (v > 1.0) { v = 1.0; cortadas = cortadas + 1; } else if (v < 0.0 - 1.0) { v = 0.0 - 1.0; cortadas = cortadas + 1; }
      buf[at] = v;
      const av = Math.abs(v);
      if (c === 0) { if (av > pl) pl = av; sl = sl + av * av; }
      else if (c === 1) { if (av > pr) pr = av; sr = sr + av * av; }
      c = c + 1;
    }
    q = q + 1;
  }
  if (ch === 1) { pr = pl; sr = sl; }
  const div = n > 0 ? n : 1;
  nivel[N_PICO_L] = pl; nivel[N_PICO_R] = pr;
  nivel[N_RMS_L] = Math.sqrt(sl / div); nivel[N_RMS_R] = Math.sqrt(sr / div);
  nivel[N_CORTADAS] = cortadas;
  return n;
}

// rts:audio pelo @compat: dispositivo nulo, stats, paridade do kernel nativo com
// o de referência em TS, recusa de views sobrepostas e decodeOgg.
//   $RTS run tests/test_audio_nativo.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import time from "@compat/time.ts";
import audio, { AUDIO_NULO, STATS_FLOATS, decodeOgg, oggUltimoErro } from "@compat/audio.ts";
import { D_POS, D_PASSO, D_CANAIS_SRC, D_CANAIS_DST, D_QUADROS, D_GL0, D_GR0, D_GL1, D_GR1, D_LP_COEF,
         D_LP_L, D_LP_R, D_LACO_INI, D_LACO_FIM, D_MIXADOS, D_FIM, DESC_FLOATS,
         N_CANAIS, N_QUADROS, N_PICO_L, N_PICO_R, N_RMS_L, N_RMS_R, N_CORTADAS, NIVEL_FLOATS } from "@engine/audio/mix_desc";
import { mixAddTs, mixLevelTs } from "@engine/audio/mix_ts";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

// ── dispositivo nulo ────────────────────────────────────────────────────────
const dev = audio.open_output(48000, 2, AUDIO_NULO);
check(dev > 0 && audio.sample_rate(dev) === 48000 && audio.channels(dev) === 2, "nulo abre a 48 kHz estéreo");
const bloco = new Float32Array(4800);
check(audio.write(dev, bloco, 4800) === 4800, "escreve 2400 quadros");
check(audio.write(dev, bloco, 4801) === 4800, "só quadros inteiros");
time.sleep_ms(40);
const st = new Float64Array(STATS_FLOATS);
check(audio.stats(dev, st) === 1 && st[0] > 500 && st[5] === 1, "o nulo drena em tempo real e se diz nulo");
check(audio.queued_frames(dev) < 4800, "a fila baixou");
audio.close(dev);
check(audio.queued_frames(dev) === 0 - 1, "handle fechado responde -1");

// ── paridade nativo × TS ────────────────────────────────────────────────────
let semente = 12345;
function aleatorio(): number { semente = (semente * 1103515245 + 12345) & 0x7FFFFFFF; return (semente % 20000) / 10000.0 - 1.0; }
function cenario(canaisSrc: number, canaisDst: number, passo: number, laco: number, lp: number): void {
  const quadrosSrc = 1000;
  const src = new Float32Array(quadrosSrc * canaisSrc);
  let i = 0;
  while (i < src.length) { src[i] = aleatorio(); i = i + 1; }
  const a = new Float32Array(800 * canaisDst);
  const b = new Float32Array(800 * canaisDst);
  i = 0;
  while (i < a.length) { const v = aleatorio() * 0.1; a[i] = v; b[i] = v; i = i + 1; }
  const da = new Float64Array(DESC_FLOATS);
  da[D_POS] = 3.25; da[D_PASSO] = passo; da[D_CANAIS_SRC] = canaisSrc; da[D_CANAIS_DST] = canaisDst; da[D_QUADROS] = 800;
  da[D_GL0] = 0.2; da[D_GR0] = 0.9; da[D_GL1] = 0.7; da[D_GR1] = 0.1; da[D_LP_COEF] = lp; da[D_LP_L] = 0.05; da[D_LP_R] = 0.0 - 0.05;
  da[D_LACO_INI] = laco !== 0 ? 100.0 : 0.0; da[D_LACO_FIM] = laco !== 0 ? 900.0 : 0.0 - 1.0;
  const db = new Float64Array(DESC_FLOATS);
  i = 0;
  while (i < DESC_FLOATS) { db[i] = da[i]; i = i + 1; }
  const na = audio.mix_add(a, src, da);
  const nb = mixAddTs(b, src, db);
  check(na === nb && da[D_MIXADOS] === db[D_MIXADOS] && da[D_FIM] === db[D_FIM], "mesmos quadros e fim: " + na + " x " + nb);
  check(Math.abs(da[D_POS] - db[D_POS]) < 1e-9, "mesma posição final");
  check(Math.abs(da[D_LP_L] - db[D_LP_L]) < 1e-5 && Math.abs(da[D_LP_R] - db[D_LP_R]) < 1e-5, "mesmo estado do passa-baixa");
  let pior = 0.0;
  i = 0;
  while (i < a.length) { const d = Math.abs(a[i] - b[i]); if (d > pior) pior = d; i = i + 1; }
  check(pior < 1e-5, "mesmo bloco (pior diferença " + pior + ")");
}
cenario(1, 2, 1.0, 0, 1.0);
cenario(2, 2, 1.37, 0, 0.3);
cenario(1, 2, 0.61, 1, 0.8);
cenario(2, 1, 2.0, 1, 1.0);
cenario(2, 6, 1.0, 0, 0.5);
cenario(1, 2, 1.5, 0, 1.0);   // 1000 quadros a 1,5 a partir de 3,25: acaba no meio do bloco

// ── recusas ─────────────────────────────────────────────────────────────────
const um = new Float32Array(8);
const d = new Float64Array(DESC_FLOATS);
d[D_PASSO] = 1.0; d[D_CANAIS_SRC] = 1.0; d[D_CANAIS_DST] = 2.0; d[D_QUADROS] = 4.0;
check(audio.mix_add(um, um, d) === 0, "dst e src na mesma view: recusa");
const buf = new ArrayBuffer(64);
check(audio.mix_add(new Float32Array(buf, 0, 8), new Float32Array(buf, 16, 8), d) === 0, "duas views sobrepostas do mesmo ArrayBuffer: recusa");
check(audio.mix_add(um, new Float32Array(4), new Float64Array(4)) === 0, "desc curto: recusa");

// ── nível ───────────────────────────────────────────────────────────────────
const n1 = new Float32Array([2.0, 0.0 - 0.5, 0.0 - 3.0, 0.5]);
const n2 = new Float32Array([2.0, 0.0 - 0.5, 0.0 - 3.0, 0.5]);
const v1 = new Float64Array(NIVEL_FLOATS); v1[N_CANAIS] = 2; v1[N_QUADROS] = 2;
const v2 = new Float64Array(NIVEL_FLOATS); v2[N_CANAIS] = 2; v2[N_QUADROS] = 2;
check(audio.mix_level(n1, v1) === 2 && mixLevelTs(n2, v2) === 2, "nível mede 2 quadros");
check(v1[N_PICO_L] === 1.0 && v1[N_PICO_R] === 0.5 && v1[N_CORTADAS] === 2, "corta e conta");
check(v1[N_RMS_L] === v2[N_RMS_L] && v1[N_RMS_R] === v2[N_RMS_R] && n1[2] === n2[2], "TS igual ao nativo");

// ── OGG ─────────────────────────────────────────────────────────────────────
const ogg = decodeOgg(fs.read_all("tests/fixtures_seno440_mono_22050.ogg"));
check(ogg !== null && ogg.rate === 22050 && ogg.channels === 1, "OGG mono 22 050 Hz");
check(ogg !== null && ogg.samples.length > 4000 && ogg.samples.length < 8000, "0,25 s de amostras");
check(decodeOgg(new Uint8Array([82, 73, 70, 70])) === null && oggUltimoErro() === "não é OGG/Vorbis", "lixo recusado com mensagem");
io.print("[PASSOU] audio nativo: nulo drena, paridade mix_add nativo x TS em 6 cenários, recusas, nível, OGG");

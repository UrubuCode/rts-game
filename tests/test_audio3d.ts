/// Áudio posicional, asserido por NÚMERO — sem placa de som, sem janela, sem
/// ouvir nada.
///
/// É possível porque `engine/audio/spatial.ts` é função pura sobre posições: a
/// panorâmica e a atenuação não tocam o dispositivo. O que este arquivo NÃO
/// prova é que sai som da caixa; prova que os ganhos que o mixer vai aplicar
/// são os certos, que é a parte que quebra em silêncio.
///
///     ./rts.exe run tools/test_audio3d.ts     -> espera [PASSOU]
import io from "@compat/io.ts";
import math from "@compat/math.ts";
import { setListener, setRolloff, attenuation, panOf, panGains, distanceTo,
         rolloffRef, rolloffMax, atenuacaoFonte, corteParaCoef, espGanhosVoz, listenerVX, listenerVY, listenerVZ,
         ESP_GL, ESP_GR, ESP_LP, ESP_DIST, ESP_CORTE, ESP_FLOATS } from "@engine/audio/spatial";
import { VOZ_FLOATS, V_X, V_Y, V_Z, V_BLEND, V_MIN, V_MAX, V_ROLLOFF, ROLLOFF_LOG, ROLLOFF_LINEAR } from "@engine/audio/vozes";
import { mixAddTs } from "@engine/audio/mix_ts";
import { D_PASSO, D_CANAIS_SRC, D_CANAIS_DST, D_QUADROS, D_GL0, D_GR0, D_GL1, D_GR1, D_LP_COEF, D_LACO_FIM, DESC_FLOATS } from "@engine/audio/mix_desc";
const poseOuvinte = new Float64Array(5);
function ouvinte(x: number, y: number, z: number, yaw: number, pitch: number): void {
  poseOuvinte[0] = x; poseOuvinte[1] = y; poseOuvinte[2] = z; poseOuvinte[3] = yaw; poseOuvinte[4] = pitch; setListener(poseOuvinte);
}

let pass = 0;
let fail = 0;

function ok(nome: string, cond: number): void {
  if (cond !== 0) { pass = pass + 1; io.print("  ok     " + nome); }
  else { fail = fail + 1; io.print("  FALHOU " + nome); }
}
/// Igualdade de ponto flutuante com folga — nunca `===` em f64 derivado de trig.
function perto(a: f64, b: f64): number {
  const d = a - b;
  return (d < 0.0 ? 0.0 - d : d) < 0.000001 ? 1 : 0;
}

const g: f64[] = [0.0, 0.0];

io.print("[audio3d] ouvinte na origem, yaw 0 (frente = +Z, direita = +X)");
ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
setRolloff(1.0, 60.0);

// ── A. PANORÂMICA ───────────────────────────────────────────────────────────
panGains(5.0, 0.0, 0.0, g);
ok("fonte a 5 na DIREITA: canal esquerdo em zero", perto(g[0], 0.0));
ok("fonte a 5 na DIREITA: canal direito = atenuacao(5)", perto(g[1], attenuation(5.0)));

panGains(0.0 - 5.0, 0.0, 0.0, g);
ok("fonte a 5 na ESQUERDA: canal direito em zero", perto(g[1], 0.0));
ok("fonte a 5 na ESQUERDA: canal esquerdo = atenuacao(5)", perto(g[0], attenuation(5.0)));

panGains(0.0, 0.0, 5.0, g);
ok("fonte a FRENTE: os dois canais iguais", perto(g[0], g[1]));
ok("fonte a FRENTE: cada canal = att x 0,7071 (potencia constante)",
   perto(g[0], attenuation(5.0) * 0.70710678118654752));

// A asserção que pega uma normalizacao errada que os extremos deixariam passar:
// a ENERGIA e constante em qualquer angulo.
{
  let bons = 0;
  let k = 0;
  while (k < 16) {
    const a: f64 = k * 0.39269908169872414;      // 16 angulos no circulo
    const px: f64 = math.cos(a) * 8.0;
    const pz: f64 = math.sin(a) * 8.0;
    panGains(px, 0.0, pz, g);
    const att: f64 = attenuation(distanceTo(px, 0.0, pz));
    if (perto(g[0] * g[0] + g[1] * g[1], att * att) !== 0) bons = bons + 1;
    k = k + 1;
  }
  ok("energia constante (gL^2 + gR^2 = att^2) nos 16 angulos", bons === 16 ? 1 : 0);
}

// ── B. ATENUACAO ────────────────────────────────────────────────────────────
ok("no raio de referencia o ganho e cheio", perto(attenuation(rolloffRef()), 1.0));
ok("dentro do raio tambem", perto(attenuation(0.5), 1.0));
ok("ao dobro do raio, metade", perto(attenuation(2.0), 0.5));
ok("ao quadruplo, um quarto", perto(attenuation(4.0), 0.25));
ok("alem do maximo, silencio", perto(attenuation(rolloffMax() + 0.001), 0.0));
{
  let mono = 1;
  let ant: f64 = 2.0;
  let i = 0;
  while (i < 200) {
    const d: f64 = i * (rolloffMax() / 200.0);
    const a: f64 = attenuation(d);
    if (a > ant + 0.000001) mono = 0;
    ant = a;
    i = i + 1;
  }
  ok("a curva nunca sobe com a distancia", mono);
}

// ── C. O REFERENCIAL E O OUVINTE, NAO O MUNDO ───────────────────────────────
// Sem esta, uma panoramica com os eixos do mundo cravados passaria em A inteiro.
ouvinte(0.0, 0.0, 0.0, 1.5707963267948966, 0.0);   // yaw 90 graus: frente vira +X
panGains(5.0, 0.0, 0.0, g);
ok("com yaw 90, a fonte em +X passa a estar A FRENTE", perto(g[0], g[1]));

// e transladar os dois pelo mesmo vetor nao muda nada
ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
panGains(3.0, 0.0, 4.0, g);
const eL: f64 = g[0]; const eR: f64 = g[1];
ouvinte(100.0, 50.0, 0.0 - 20.0, 0.0, 0.0);
panGains(103.0, 50.0, 0.0 - 16.0, g);
ok("transladar ouvinte e fonte juntos nao muda o ganho",
   perto(g[0], eL) !== 0 && perto(g[1], eR) !== 0 ? 1 : 0);

// ── D. FONTE COLADA NO OUVINTE ──────────────────────────────────────────────
ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
panGains(0.0, 0.0, 0.0, g);
ok("fonte na cabeca nao estoura nem vira NaN",
   g[0] === g[0] && g[1] === g[1] && g[0] <= 1.0 && g[1] <= 1.0 ? 1 : 0);
panGains(0.2, 0.0, 0.0, g);
ok("fonte MUITO perto colapsa para o centro em vez de pan duro",
   g[0] > 0.5 && g[1] > 0.5 ? 1 : 0);

// ── E. SANIDADE ─────────────────────────────────────────────────────────────
{
  let semNaN = 1;
  let i = 0;
  while (i < 100) {
    const x: f64 = (i % 10) * 7.0 - 35.0;
    const z: f64 = ((i / 10) | 0) * 7.0 - 35.0;
    panGains(x, 1.0, z, g);
    if (g[0] !== g[0] || g[1] !== g[1]) semNaN = 0;
    if (g[0] < 0.0 || g[1] < 0.0) semNaN = 0;
    i = i + 1;
  }
  ok("100 posicoes: sem NaN e sem ganho negativo", semNaN);
}

// ── F. ROLLOFF POR FONTE ────────────────────────────────────────────────────
ok("log: min/d", perto(atenuacaoFonte(2.0, 1.0, 60.0, ROLLOFF_LOG), 0.5));
ok("log: dentro do min, cheio", perto(atenuacaoFonte(0.5, 1.0, 60.0, ROLLOFF_LOG), 1.0));
ok("log: além do max, zero", perto(atenuacaoFonte(61.0, 1.0, 60.0, ROLLOFF_LOG), 0.0));
ok("linear: no meio, 0,5", perto(atenuacaoFonte(6.0, 1.0, 11.0, ROLLOFF_LINEAR), 0.5));
ok("linear: no max, zero", perto(atenuacaoFonte(11.0, 1.0, 11.0, ROLLOFF_LINEAR), 0.0));
{
  const a = atenuacaoFonte(1.0, 0.0, 0.0, ROLLOFF_LOG);
  ok("min e max degenerados não viram NaN", a === a && a >= 0.0 && a <= 1.0 ? 1 : 0);
}

// ── G. MISTURA 2D/3D ────────────────────────────────────────────────────────
const vz = new Float64Array(VOZ_FLOATS);
const esp = new Float64Array(ESP_FLOATS);
ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
vz[V_X] = 5.0; vz[V_Y] = 0.0; vz[V_Z] = 0.0; vz[V_MIN] = 1.0; vz[V_MAX] = 60.0; vz[V_ROLLOFF] = ROLLOFF_LOG;
vz[V_BLEND] = 0.0; espGanhosVoz(vz, 0, 48000.0, esp);
ok("blend 0: 2D, (1, 1) e sem filtro", perto(esp[ESP_GL], 1.0) !== 0 && perto(esp[ESP_GR], 1.0) !== 0 && esp[ESP_LP] === 1.0 ? 1 : 0);
vz[V_BLEND] = 1.0; espGanhosVoz(vz, 0, 48000.0, esp);
ok("blend 1, fonte à direita a 5: (0, 0,2)", perto(esp[ESP_GL], 0.0) !== 0 && perto(esp[ESP_GR], 0.2) !== 0 && perto(esp[ESP_DIST], 5.0) !== 0 ? 1 : 0);
vz[V_BLEND] = 0.5; espGanhosVoz(vz, 0, 48000.0, esp);
ok("blend 0,5: L = 0,5·1 + 0,5·0 e R = 0,5·1 + 0,5·0,2", perto(esp[ESP_GL], 0.5) !== 0 && perto(esp[ESP_GR], 0.6) !== 0 ? 1 : 0);

// ── H. PASSA-BAIXA: ATRÁS SOA DIFERENTE DE FRENTE ───────────────────────────
vz[V_BLEND] = 1.0; vz[V_X] = 0.0; vz[V_Z] = 2.0;
espGanhosVoz(vz, 0, 48000.0, esp);
const lpFrente: f64 = esp[ESP_LP];
ok("frente e perto: filtro desligado", lpFrente === 1.0 && esp[ESP_CORTE] >= 20000.0 ? 1 : 0);
vz[V_Z] = 0.0 - 2.0;
espGanhosVoz(vz, 0, 48000.0, esp);
const lpAtras: f64 = esp[ESP_LP];
ok("atrás: corte perto de 5 kHz", esp[ESP_CORTE] < 6000.0 && esp[ESP_CORTE] > 4000.0 && lpAtras < 0.6 ? 1 : 0);
ok("corteParaCoef: 20 kHz ou mais desliga", corteParaCoef(20000.0, 48000.0) === 1.0 && corteParaCoef(1000.0, 48000.0) < 0.2 ? 1 : 0);
{
  // RMS de um seno de 10 kHz filtrado com o coeficiente de frente e o de trás
  const src = new Float32Array(4800);
  let i = 0;
  while (i < src.length) { src[i] = Math.sin(2.0 * Math.PI * 10000.0 * i / 48000.0); i = i + 1; }
  const d = new Float64Array(DESC_FLOATS);
  function rmsCom(coef: f64): f64 {
    const dst = new Float32Array(4800);
    let k = 0;
    while (k < DESC_FLOATS) { d[k] = 0.0; k = k + 1; }
    d[D_PASSO] = 1.0; d[D_CANAIS_SRC] = 1.0; d[D_CANAIS_DST] = 1.0; d[D_QUADROS] = 4800.0;
    d[D_GL0] = 1.0; d[D_GR0] = 1.0; d[D_GL1] = 1.0; d[D_GR1] = 1.0; d[D_LP_COEF] = coef; d[D_LACO_FIM] = 0.0 - 1.0;
    mixAddTs(dst, src, d);
    let s = 0.0; k = 480;
    while (k < 4800) { s = s + dst[k] * dst[k]; k = k + 1; }
    return Math.sqrt(s / 4320.0);
  }
  const rF = rmsCom(lpFrente); const rA = rmsCom(lpAtras);
  ok("10 kHz: RMS atrás < 0,7 × RMS à frente (" + rA + " x " + rF + ")", rA < 0.7 * rF ? 1 : 0);
}
{
  vz[V_Z] = 2.0; espGanhosVoz(vz, 0, 48000.0, esp);
  const perto2: f64 = esp[ESP_CORTE];
  vz[V_Z] = 50.0; espGanhosVoz(vz, 0, 48000.0, esp);
  ok("à frente, mais longe corta mais baixo", esp[ESP_CORTE] < perto2 ? 1 : 0);
}

// ── I. ELEVAÇÃO: O PITCH DO OUVINTE CONTA ───────────────────────────────────
vz[V_X] = 0.0; vz[V_Y] = 5.0; vz[V_Z] = 0.0;
ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
espGanhosVoz(vz, 0, 48000.0, esp);
const corteHorizontal: f64 = esp[ESP_CORTE];
ok("fonte acima, ouvinte olhando reto: centrada", perto(esp[ESP_GL], esp[ESP_GR]));
ouvinte(0.0, 0.0, 0.0, 0.0, 1.5707963267948966);
espGanhosVoz(vz, 0, 48000.0, esp);
ok("olhando para cima, a fonte acima está À FRENTE: corte maior e filtro desligado",
   esp[ESP_CORTE] > corteHorizontal && esp[ESP_LP] === 1.0 ? 1 : 0);

// ── J. VELOCIDADE DO OUVINTE ────────────────────────────────────────────────
{
  const p8 = new Float64Array(8);
  p8[5] = 1.0; p8[6] = 2.0; p8[7] = 3.0;
  setListener(p8);
  ok("pose de 8 floats traz a velocidade", listenerVX() === 1.0 && listenerVY() === 2.0 && listenerVZ() === 3.0 ? 1 : 0);
  ouvinte(0.0, 0.0, 0.0, 0.0, 0.0);
  ok("pose de 5 floats zera a velocidade", listenerVX() === 0.0 && listenerVZ() === 0.0 ? 1 : 0);
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

/// Áudio posicional, asserido por NÚMERO — sem placa de som, sem janela, sem
/// ouvir nada.
///
/// É possível porque `engine/audio/spatial.ts` é função pura sobre posições: a
/// panorâmica e a atenuação não tocam o dispositivo. O que este arquivo NÃO
/// prova é que sai som da caixa; prova que os ganhos que o mixer vai aplicar
/// são os certos, que é a parte que quebra em silêncio.
///
///     ./rts.exe run tools/test_audio3d.ts     -> espera [PASSOU]
import io from "../compat/io.ts";
import math from "../compat/math.ts";
import { setListener, setRolloff, attenuation, panOf, panGains, distanceTo,
         rolloffRef, rolloffMax } from "../engine/audio/spatial";

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
setListener(0.0, 0.0, 0.0, 0.0, 0.0);
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
setListener(0.0, 0.0, 0.0, 1.5707963267948966, 0.0);   // yaw 90 graus: frente vira +X
panGains(5.0, 0.0, 0.0, g);
ok("com yaw 90, a fonte em +X passa a estar A FRENTE", perto(g[0], g[1]));

// e transladar os dois pelo mesmo vetor nao muda nada
setListener(0.0, 0.0, 0.0, 0.0, 0.0);
panGains(3.0, 0.0, 4.0, g);
const eL: f64 = g[0]; const eR: f64 = g[1];
setListener(100.0, 50.0, 0.0 - 20.0, 0.0, 0.0);
panGains(103.0, 50.0, 0.0 - 16.0, g);
ok("transladar ouvinte e fonte juntos nao muda o ganho",
   perto(g[0], eL) !== 0 && perto(g[1], eR) !== 0 ? 1 : 0);

// ── D. FONTE COLADA NO OUVINTE ──────────────────────────────────────────────
setListener(0.0, 0.0, 0.0, 0.0, 0.0);
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

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

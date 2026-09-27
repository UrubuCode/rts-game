// `pumpAudio`: o alvo enfileirado é ADAPTATIVO (chiado — issue do usuário).
// Um quadro lento (contenção de CPU, GC, janela minimizada) drena o anel
// abaixo do alvo de 100 ms e falta no dispositivo (audível como chiado). Este
// teste prova, por número (`audio.stats` → faltas), que:
//   1. em regime idle não há falta nenhuma;
//   2. depois de UMA falta, `pumpAudio` cobre a lacuna INTEIRA na mesma
//      chamada (não fica preso no teto de `AU_MAX_BOMBA`, que levava vários
//      quadros pra reencher e arriscava faltar de novo antes de completar);
//   3. o alvo sobe ao faltar e ENCOLHE devagar depois de ficar estável;
//   4. o primeiro bloco depois de uma falta entra com fade-in (sem degrau
//      duro na volta do silêncio nativo).
//   $RTS run tests/test_audio_pump.ts
import io from "@compat/io.ts";
import time from "@compat/time.ts";
import { STATS_FLOATS } from "@compat/audio.ts";
import { initAudio, closeAudio, AUDIO_NULO, pumpAudio, tocarClipe, audioStats, audioAlvoQuadros,
         audioForcarRampaTeste, audioRampaRestanteTeste, audioUltimoBloco, audioCanais, pararTodas } from "@engine/audio/audio";
import { toneClip, FORMA_QUADRADA } from "@engine/audio/clip";
import { novoPedido, PEDIDO_VOLUME } from "@engine/audio/vozes";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

const st = new Float64Array(STATS_FLOATS);
function faltas(): number { audioStats(st); return st[1]; }
function enfileirados(): number { audioStats(st); return st[2]; }

function tocarClipeLongoBaixo(): void {
  const pedido = novoPedido();
  pedido[PEDIDO_VOLUME] = 0.05; // amplitude baixa (o comando pede volume audível baixo, mas isto é o dispositivo NULO: silencioso de qualquer forma)
  tocarClipe(toneClip(20.0, 5.0, FORMA_QUADRADA), pedido);
}

// ── 1. idle: nenhuma falta ao longo de 1s de pump a 60 fps ─────────────────
initAudio(AUDIO_NULO);
tocarClipeLongoBaixo();
let f0 = faltas();
let i = 0;
while (i < 60) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
check(faltas() === f0, "idle: nenhuma falta nova em 60 quadros @16 ms (achou " + (faltas() - f0) + ")");
check(audioAlvoQuadros() === 4800, "sem falta o alvo fica no mínimo (100 ms): " + audioAlvoQuadros());
closeAudio();

// ── 2. um quadro lento (stall real de 150 ms): o pump cobre a lacuna INTEIRA
//    na mesma chamada — a regressão do bug era ficar em ~2400 quadros (o
//    teto de UM bloco), não no alvo cheio.
initAudio(AUDIO_NULO);
tocarClipeLongoBaixo();
i = 0;
while (i < 10) { pumpAudio(); time.sleep_ms(16); i = i + 1; } // regime estável primeiro
f0 = faltas();
time.sleep_ms(150); // STALL: nada pumpa por 150 ms (CPU/GC/janela minimizada)
pumpAudio();
const faltouAgora = faltas() > f0;
check(faltouAgora, "o stall de 150 ms tem que gerar falta de verdade (senão o teste não testa nada)");
check(audioAlvoQuadros() > 4800, "uma falta sobe o alvo acima do mínimo: " + audioAlvoQuadros());
check(enfileirados() >= 8000, "o pump cobre a lacuna inteira até o alvo novo numa só chamada, não só " + "AU_MAX_BOMBA (2400): enfileirados=" + enfileirados());
closeAudio();

// ── 3. o alvo encolhe devagar depois de ficar estável (sem depender de
//    cronometrar 2 s de verdade — a contagem é por QUADRO de pump, não por
//    relógio).
initAudio(AUDIO_NULO);
tocarClipeLongoBaixo();
pumpAudio(); // regime inicial, sem falta
audioForcarRampaTeste(0);
// força uma falta sintética via 2 faltas seguidas não é necessário: já
// teríamos alvo 4800 aqui (fresh init). Simula a subida real com um stall.
i = 0;
while (i < 5) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
time.sleep_ms(150);
pumpAudio();
const alvoAposFalta = audioAlvoQuadros();
check(alvoAposFalta > 4800, "alvo subiu depois do stall (pré-condição do teste 3): " + alvoAposFalta);
i = 0;
while (i < 130) { pumpAudio(); i = i + 1; } // 130 > AU_ALVO_JANELA_ESTAVEL (120), sem sleep: não falta de novo
check(audioAlvoQuadros() < alvoAposFalta, "o alvo encolhe depois de ficar estável: " + alvoAposFalta + " -> " + audioAlvoQuadros());
closeAudio();

// ── 4. fade-in determinístico: força a rampa (sem esperar falta de verdade),
//    faz UM pump com lacuna pequena (uma só chamada de mixarBloco) e confere
//    que o bloco resultante entra quase mudo e sobe pro cheio — sem degrau.
initAudio(AUDIO_NULO);
const pedido = novoPedido();
pedido[PEDIDO_VOLUME] = 1.0; // aqui não soa (dispositivo NULO): só os NÚMEROS do buffer importam
// dur longa (60 s): o envelope embutido do `toneClip` (ataque+queda ao longo
// do clipe inteiro) fica achatado perto do início, então a posição já ter
// avançado ~4800+ quadros no `pumpAudio` de baixo não confunde com a rampa
// que este teste está medindo.
tocarClipe(toneClip(20.0, 60.0, FORMA_QUADRADA), pedido); // 20 Hz: meio período de 25 ms,>> a janela de 480 quadros (10 ms) comparada abaixo
pumpAudio(); // enche até o alvo (4800), sem rampa (nenhuma falta ainda)
time.sleep_ms(10); // o dispositivo nulo drena ~480 quadros
audioForcarRampaTeste(240); // 5 ms de fade-in, como depois de uma falta de verdade
pumpAudio(); // lacuna pequena (~480 < AU_MAX_BOMBA=2400): UMA só chamada de mixarBloco
check(audioRampaRestanteTeste() === 0, "a rampa de 240 quadros termina dentro do bloco escrito");
const bloco = audioUltimoBloco();
const canais = audioCanais();
const inicio = Math.abs(bloco[5 * canais]); // quadro 5: dentro da rampa, quase mudo (t=1-235/240≈0.02)
const depois = Math.abs(bloco[300 * canais]); // quadro 300: bem depois da rampa, cheio (±1.0)
check(depois > 0.9, "depois da rampa o bloco volta ao ganho cheio: |amostra|=" + depois);
check(inicio < depois * 0.15, "o começo do bloco entra abafado pela rampa, não de golpe: inicio=" + inicio + " depois=" + depois);
closeAudio();
pararTodas();

io.print("[PASSOU] audio pump: idle sem falta, stall cobre a lacuna inteira, alvo sobe e encolhe, fade-in sem degrau");

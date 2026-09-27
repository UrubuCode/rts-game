// Relógio DSP (ritmo) — spec deste brief: `Audio.tempoDsp()`/`amostrasDsp()`
// (posição AUDÍVEL, suavizada, monotônica — ao contrário de `AudioSource.time`/
// `vozSegundos`, que é a posição MIXADA, à frente), `Audio.agendarEm`
// (PlayScheduled sample-accurate) e a calibração de latência do usuário.
// Tudo sem janela, no dispositivo NULO (ele consome em tempo real — CLAUDE.md
// "Áudio").
//   $RTS run tests/test_audio_relogio.ts
import io from "@compat/io.ts";
import time from "@compat/time.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { initAudio, closeAudio, AUDIO_NULO, pumpAudio, mixarBloco, tocarClipe, pausarVoz, definirPitchVoz,
         tempoDsp, amostrasDsp, framesMixadosTotais, vozTempoAudivel, audioUltimoBloco, audioCanais,
         latenciaCalibradaMs } from "@engine/audio/audio";
import { Audio } from "@engine/audio/audio_system";
import { AudioClip, toneClip, FORMA_SENO } from "@engine/audio/clip";
import { novoPedido } from "@engine/audio/vozes";
import { editorPreferences } from "@editor/preferences";
import { offsetMaisProximo, medianaMs } from "@editor/calibrar_latencia_panel";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(l: string): string { return execCommand(800, 600, l); }

// ── 1. relógio monotônico e suave em quadros normais ────────────────────────
initAudio(AUDIO_NULO);
{
  let anterior = tempoDsp();
  check(anterior >= 0.0, "tempoDsp começa em 0 (ou perto — dispositivo recém-aberto)");
  let maiorPasso = 0.0;
  let i = 0;
  while (i < 40) {
    pumpAudio();
    time.sleep_ms(10);
    const agora = tempoDsp();
    check(agora >= anterior, "relógio nunca regride em quadro normal: " + anterior + " -> " + agora + " (i=" + i + ")");
    const passo = agora - anterior;
    if (i > 1 && passo > maiorPasso) maiorPasso = passo; // ignora os 2 primeiros: 1ª leitura ainda pega o degrau de abertura
    anterior = agora;
    i = i + 1;
  }
  check(maiorPasso < 0.05, "jitter de passo limitado em regime normal (10 ms/quadro): maior passo=" + maiorPasso);
}
closeAudio();

// ── 2. um stall real de 150 ms (CLAUDE.md: nada de simular sem o relógio de
//    verdade) não anda pra trás, e RETOMA a extrapolar quando o pump volta.
initAudio(AUDIO_NULO);
{
  let i = 0;
  while (i < 10) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
  const antes = tempoDsp();
  time.sleep_ms(150); // stall: ninguém chama pump/clock
  pumpAudio();
  const depois = tempoDsp();
  check(depois >= antes, "o relógio não anda pra trás depois de um stall de 150 ms: " + antes + " -> " + depois);
  check(depois - antes > 0.08, "o relógio RETOMA (extrapola o tempo real que passou), não fica preso: delta=" + (depois - antes));
}
closeAudio();

// ── 3. o alvo ADAPTATIVO (fase A8) muda durante o stall (sobe e depois
//    encolhe) — o relógio audível tem que continuar monotônico o tempo todo,
//    mesmo com `auAlvoQuadros` mudando por baixo.
initAudio(AUDIO_NULO);
{
  const pedido = novoPedido();
  tocarClipe(toneClip(20.0, 60.0, FORMA_SENO), pedido);
  let anterior = tempoDsp();
  let i = 0;
  while (i < 10) { pumpAudio(); time.sleep_ms(16); const a = tempoDsp(); check(a >= anterior, "monotônico (pré-falta)"); anterior = a; i = i + 1; }
  time.sleep_ms(150); // gera a falta real (o alvo sobe)
  pumpAudio();
  let a2 = tempoDsp();
  check(a2 >= anterior, "monotônico atravessando a falta (o alvo subiu): " + anterior + " -> " + a2);
  anterior = a2;
  i = 0;
  while (i < 130) { // > AU_ALVO_JANELA_ESTAVEL (120): o alvo encolhe de volta
    pumpAudio();
    const a = tempoDsp();
    check(a >= anterior, "monotônico enquanto o alvo encolhe de volta (i=" + i + "): " + anterior + " -> " + a);
    anterior = a;
    i = i + 1;
  }
}
closeAudio();

// ── 4. tempoAudivel: nasce em 0, avança com o tempo real, congela na pausa,
//    retoma ao despausar, e escala com o pitch — tolerância de UM bloco
//    (AU_MAX_BOMBA = 2400 quadros a 48 kHz = 50 ms), como o brief permite.
initAudio(AUDIO_NULO);
{
  const BLOCO_TOL = 0.06; // 50 ms do bloco + folga de agendamento do teste
  const pedido = novoPedido();
  const id = tocarClipe(toneClip(220.0, 30.0, FORMA_SENO), pedido);
  check(Math.abs(vozTempoAudivel(id)) < 1e-6, "tempoAudivel começa em 0 (a voz ainda não ficou audível)");

  const t0 = time.now_ms();
  let i = 0;
  while (i < 20) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
  const decorridoReal = (time.now_ms() - t0) / 1000.0;
  const audivel1 = vozTempoAudivel(id);
  check(Math.abs(audivel1 - decorridoReal) < BLOCO_TOL,
    "tempoAudivel acompanha o tempo real (pitch 1): audivel=" + audivel1 + " real=" + decorridoReal);

  pausarVoz(id, 1);
  const congelado = vozTempoAudivel(id);
  i = 0;
  while (i < 10) { pumpAudio(); time.sleep_ms(16); i = i + 1; } // o relógio audível segue andando...
  check(Math.abs(vozTempoAudivel(id) - congelado) < BLOCO_TOL,
    "tempoAudivel congela na pausa mesmo com o relógio audível avançando: " + congelado + " -> " + vozTempoAudivel(id));

  pausarVoz(id, 0);
  const t1 = time.now_ms();
  i = 0;
  while (i < 20) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
  const decorridoReal2 = (time.now_ms() - t1) / 1000.0;
  const audivel2 = vozTempoAudivel(id);
  check(Math.abs((audivel2 - congelado) - decorridoReal2) < BLOCO_TOL,
    "tempoAudivel retoma do ponto congelado ao despausar: ganho=" + (audivel2 - congelado) + " real=" + decorridoReal2);

  definirPitchVoz(id, 2.0);
  const t2 = time.now_ms();
  i = 0;
  while (i < 20) { pumpAudio(); time.sleep_ms(16); i = i + 1; }
  const decorridoReal3 = (time.now_ms() - t2) / 1000.0;
  const ganho3 = vozTempoAudivel(id) - audivel2;
  check(Math.abs(ganho3 - decorridoReal3 * 2.0) < BLOCO_TOL * 2.0,
    "tempoAudivel escala com o pitch (2x): ganho=" + ganho3 + " esperado~" + (decorridoReal3 * 2.0));
}
closeAudio();

// ── 5. agendarEm: sample-accurate DENTRO do bloco — inspeciona o buffer
//    mixado direto (mixarBloco/audioUltimoBloco), sem depender de `pump`.
initAudio(AUDIO_NULO);
{
  const canais = audioCanais();
  const amostrasDc = new Float32Array(9600); // 200 ms a 48 kHz: bem mais que o bloco de teste
  let i = 0;
  while (i < amostrasDc.length) { amostrasDc[i] = 1.0; i = i + 1; } // DC: qualquer amostra != 0 já denuncia o início
  const clip = AudioClip.fromSamples("dc-relogio", amostrasDc, 1);

  mixarBloco(64); // estabelece uma base != 0 em `framesMixadosTotais` (não depende de começar do zero)
  const totalAntes = framesMixadosTotais();
  const BLOCO = 256;
  const OFFSET = 100; // quadro exato onde a 1ª amostra deve aparecer
  const alvoQuadroMixado = totalAntes + OFFSET;
  // `agendarEm` recebe tempoDsp (segundos, régua AUDÍVEL) — sem pump ainda
  // nesta sessão, latência/calibração estão em 0 (initAudio zera): a régua
  // audível e a mixada coincidem, então basta converter por `auTaxa`.
  const ok = Audio.agendarEm(clip, alvoQuadroMixado / 48000.0);
  check(ok === 1, "agendarEm aceitou o agendamento");
  mixarBloco(BLOCO);
  const b = audioUltimoBloco();
  let k = 0;
  let primeiroNaoZero = -1;
  while (k < BLOCO) {
    if (Math.abs(b[k * canais]) > 1e-4) { primeiroNaoZero = k; break; }
    k = k + 1;
  }
  check(primeiroNaoZero === OFFSET, "agendarEm entra EXATAMENTE no quadro " + OFFSET + " do bloco (achou " + primeiroNaoZero + ")");
}
closeAudio();

// ── 6. matemática da calibração (mediana, robusta a um toque perdido) ──────
{
  check(Math.abs(offsetMaisProximo(10.03, 10.0, 0.5) - 0.03) < 1e-9, "offset contra o beat mais próximo (à frente)");
  check(Math.abs(offsetMaisProximo(10.48, 10.0, 0.5) - (0 - 0.02)) < 1e-9, "offset contra o beat mais próximo (atrás, cruzando a grade)");
  check(medianaMs([]) === 0.0, "mediana vazia é 0 (nenhuma medição)");
  check(Math.abs(medianaMs([0.01, 0.02, 0.03]) - 20.0) < 1e-9, "mediana ímpar: o do meio, em ms");
  check(Math.abs(medianaMs([0.01, 0.02, 0.03, 0.04]) - 25.0) < 1e-9, "mediana par: média dos dois do meio, em ms");
  check(Math.abs(medianaMs([0.5, 0.01, 0.02]) - 20.0) < 1e-9, "mediana robusta a um outlier (toque perdido/duplo)");
}

// ── 7. WS: `audio relogio` e `audio calibrar` ───────────────────────────────
instalarEditorReal();
initAudio(AUDIO_NULO);
{
  const antes = editorPreferences.audioLatenciaMs;
  const r1 = cmd("audio relogio");
  check(r1.indexOf("[audio] relogio dsp=") === 0, "formato da linha: " + r1);
  check(r1.indexOf(" amostras=") > 0 && r1.indexOf(" mixado=") > 0 && r1.indexOf(" fila=") > 0 &&
        r1.indexOf(" latencia=") > 0 && r1.indexOf(" calibracao=") > 0, "todos os campos presentes: " + r1);

  const r2 = cmd("audio calibrar 12.5");
  check(r2 === "[ok] calibracao=12.50 ms", "audio calibrar aplica e confirma: " + r2);
  check(Math.abs(latenciaCalibradaMs() - 12.5) < 1e-9, "audio calibrar aplicou de verdade no relógio");
  check(Math.abs(editorPreferences.audioLatenciaMs - 12.5) < 1e-9, "audio calibrar salvou na preferência local");

  const r3 = cmd("audio relogio");
  check(r3.indexOf("calibracao=12.50") > 0, "audio relogio reflete a calibração salva: " + r3);

  const r4 = cmd("audio calibrar");
  check(r4.indexOf("[audio] calibracao atual: 12.50 ms") === 0, "audio calibrar sem argumento só lê: " + r4);

  editorPreferences.saveAudioLatenciaMs(antes); // devolve a preferência local como estava
}
closeAudio();

io.print("[PASSOU] relógio DSP: monotônico/suave (normal, stall, alvo adaptativo), tempoAudivel (play/pausa/pitch), agendarEm sample-accurate, calibração e WS");

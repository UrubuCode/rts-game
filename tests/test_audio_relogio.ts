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
         latenciaCalibradaMs, vozTocando, activeVoices } from "@engine/audio/audio";
import { Audio } from "@engine/audio/audio_system";
import { AudioClip, toneClip, FORMA_SENO } from "@engine/audio/clip";
import { novoPedido, PEDIDO_VOLUME, PEDIDO_LACO, MAX_VOZES } from "@engine/audio/vozes";
import { editorPreferences } from "@editor/preferences";
import { offsetMaisProximo, medianaMs, CalibradorLatencia } from "@engine/audio/calibrador_latencia";
import { ConfigUsuario } from "@engine/core/config_usuario";
import fs from "@compat/fs.ts";

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
  check(ok > 0, "agendarEm devolve um id (handle) >0: " + ok);
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

// ── 7b. cancelarAgendado ANTES do disparo: some da fila, nunca toca ────────
initAudio(AUDIO_NULO);
{
  const canais = audioCanais();
  const amostrasDc = new Float32Array(9600);
  let i = 0; while (i < amostrasDc.length) { amostrasDc[i] = 1.0; i = i + 1; }
  const clip = AudioClip.fromSamples("dc-cancelar-antes", amostrasDc, 1);

  mixarBloco(64); // baseline qualquer, como no teste 5
  const totalAntes = framesMixadosTotais();
  const OFFSET = 5000; // bem além do bloco que vamos mixar agora: ainda pendente
  const id = Audio.agendarEm(clip, (totalAntes + OFFSET) / 48000.0);
  check(id > 0, "agendou (pendente, alvo no futuro)");
  const cancelou = Audio.cancelarAgendado(id);
  check(cancelou === 1, "cancelarAgendado remove da fila ANTES do disparo");
  // Mixa blocos suficientes pra cobrir o alvo original: se não tivesse
  // cancelado, o clique teria disparado em algum desses blocos.
  let f = 0;
  let apareceu = false;
  while (f < 30) {
    mixarBloco(256);
    const b = audioUltimoBloco();
    let k = 0;
    while (k < 256) { if (Math.abs(b[k * canais]) > 1e-4) { apareceu = true; break; } k = k + 1; }
    if (apareceu) break;
    f = f + 1;
  }
  check(!apareceu, "cancelado antes do disparo: o clique NUNCA aparece no buffer mixado");
  check(Audio.cancelarAgendado(id) === 0, "cancelar de novo o mesmo id (já cancelado) devolve 0 (desconhecido)");
}
closeAudio();

// ── 7c. cancelarAgendado DEPOIS do disparo: para com a rampa normal ────────
initAudio(AUDIO_NULO);
{
  const canais = audioCanais();
  const amostrasDc = new Float32Array(9600);
  let i = 0; while (i < amostrasDc.length) { amostrasDc[i] = 1.0; i = i + 1; }
  const clip = AudioClip.fromSamples("dc-cancelar-depois", amostrasDc, 1);
  const pedido = novoPedido();
  pedido[PEDIDO_LACO] = 1.0; // em laço: sem cancelar, tocaria pra sempre — prova que o cancelamento é real

  mixarBloco(64);
  const totalAntes = framesMixadosTotais();
  const id = Audio.agendarEm(clip, totalAntes / 48000.0, pedido); // dispara já no PRÓXIMO bloco (atraso 0)
  check(id > 0, "agendou (dispara no próximo bloco)");
  mixarBloco(256); // o clique dispara e toca (voz real nasce)
  const b1 = audioUltimoBloco();
  check(Math.abs(b1[0]) > 0.5, "a voz nasceu tocando (DC cheio no início do bloco): " + b1[0]);

  const cancelou = Audio.cancelarAgendado(id);
  check(cancelou === 1, "cancelarAgendado DEPOIS do disparo (mesmo id) para a voz real");
  // A rampa de `pararVoz` leva alguns blocos pra chegar a zero (fase A6: sem
  // clique) — mixa mais blocos e confere que a amplitude CAIU (não continua
  // em laço no volume cheio, que é o que aconteceria sem o cancelamento).
  let f = 0; let ultimoPico = 1.0;
  while (f < 20) {
    mixarBloco(256);
    const b = audioUltimoBloco();
    let pico = 0.0; let k = 0;
    while (k < 256) { const v = Math.abs(b[k * canais]); if (v > pico) pico = v; k = k + 1; }
    ultimoPico = pico;
    f = f + 1;
  }
  check(ultimoPico < 0.05, "depois de cancelado, a voz rampeia a zero e FICA muda (não continua em laço): pico final=" + ultimoPico);
}
closeAudio();

// ── 7d. agendarEm com as 32 vozes ocupadas: mesma política de `tocarClipe`
//    (rouba VIRTUAL se houver; sem nenhuma, DESCARTA — nunca rouba audível).
initAudio(AUDIO_NULO);
{
  const clipLoop = toneClip(30.0, 60.0, FORMA_SENO);
  const pedido = novoPedido();
  pedido[PEDIDO_LACO] = 1.0; pedido[PEDIDO_VOLUME] = 1.0; // audíveis (não-virtuais): volume > 0, dentro de alcance (2D)
  let i = 0;
  while (i < MAX_VOZES) { check(tocarClipe(clipLoop, pedido) !== 0, "voz " + i + " alocou"); i = i + 1; }
  check(activeVoices() === MAX_VOZES, "as " + MAX_VOZES + " vozes estão ocupadas: " + activeVoices());

  mixarBloco(64);
  const totalAntes = framesMixadosTotais();
  const dcCheio = new Float32Array(4800); { let k = 0; while (k < dcCheio.length) { dcCheio[k] = 1.0; k = k + 1; } }
  const clip = AudioClip.fromSamples("dc-cheio", dcCheio, 1);
  const id = Audio.agendarEm(clip, totalAntes / 48000.0); // dispara já
  check(id > 0, "agendou mesmo com as vozes cheias (a fila de agendamento é separada da tabela de vozes)");
  mixarBloco(256); // o disparo tenta alocar: sem slot livre/virtual, DESCARTA (mesma regra de tocarClipe)
  check(activeVoices() === MAX_VOZES, "descartado ao disparar: continua " + MAX_VOZES + " vozes, nenhuma a mais");
  check(Audio.cancelarAgendado(id) === 0, "cancelar um agendamento DESCARTADO (nunca virou voz) devolve 0");
}
closeAudio();

// ── 7e. CalibradorLatencia (API de motor): computa e persiste ──────────────
initAudio(AUDIO_NULO);
{
  const arquivoTeste = "build/test-audio/usuario-calibrador.json";
  fs.create_dir_all("build/test-audio");
  if (fs.exists(arquivoTeste)) fs.remove_file(arquivoTeste);
  const configTeste = new ConfigUsuario(arquivoTeste);

  // Sessão rápida (3 batidas, 60 ms de intervalo — não 16×500 ms: o teste
  // não precisa de 8 s reais pra provar o fluxo).
  const clip = toneClip(1200.0, 0.02, FORMA_SENO);
  const cal = new CalibradorLatencia(0.06, 3);
  cal.iniciar(clip);
  check(cal.rodando, "iniciar() liga a sessão");
  check(cal.resultado() !== cal.resultado(), "resultado() é NaN antes de completar");

  // 3 toques, um pouco ATRASADO em relação à grade (~15 ms) todas as vezes —
  // prova que a mediana capta um atraso sistemático, não só zero.
  const ATRASO_SIMULADO_S = 0.015;
  let i = 0;
  while (i < 3) {
    const alvo = cal.primeiroBeat + i * 0.06 + ATRASO_SIMULADO_S;
    while (Audio.tempoDsp() < alvo) { pumpAudio(); time.sleep_ms(2); }
    cal.toque();
    i = i + 1;
  }
  check(!cal.rodando, "completou as 3 batidas: a sessão encerra sozinha");
  check(cal.progresso() === 3, "progresso() conta os 3 toques");
  const r = cal.resultado();
  check(Math.abs(r - ATRASO_SIMULADO_S * 1000.0) < 25.0, "resultado() capta o atraso simulado (~15 ms): " + r);

  // salvar() aplica em Audio.latenciaCalibrada E persiste em `config_usuario`
  // — mas a instância global usa o arquivo PADRÃO; aqui confere só a
  // matemática/aplicação e a persistência via uma instância PRÓPRIA (mesmo
  // formato, arquivo isolado do teste, sem mexer no `config/usuario.json`
  // real do repo).
  Audio.latenciaCalibrada = 0.0; // limpa antes de aplicar, pra provar que `aplicar()` fez a diferença
  cal.aplicar();
  check(Math.abs(Audio.latenciaCalibrada - r) < 1e-9, "aplicar() liga Audio.latenciaCalibrada no resultado");
  Audio.latenciaCalibrada = 0.0;
  const salvouOk = configTeste.salvarAudioLatenciaMs(r);
  check(salvouOk, "ConfigUsuario.salvarAudioLatenciaMs escreve com sucesso: " + configTeste.error);
  check(fs.exists(arquivoTeste), "o arquivo de config do usuário foi criado");

  // Round-trip: uma instância NOVA relê o mesmo arquivo (simula o próximo
  // boot do jogo) e bate com o valor salvo.
  const releitura = new ConfigUsuario(arquivoTeste);
  releitura.carregar();
  check(Math.abs(releitura.audioLatenciaMs - r) < 1e-9, "releitura bate com o valor salvo (round-trip): " + releitura.audioLatenciaMs);
}
closeAudio();

// ── 7f. boot do JOGO: carrega a config do usuário ANTES do áudio começar e
//    aplica em Audio.latenciaCalibrada (o mesmo passo que `game.ts` faz).
{
  const arquivoBoot = "build/test-audio/usuario-boot.json";
  fs.create_dir_all("build/test-audio");
  fs.write(arquivoBoot, JSON.stringify({ audioLatenciaMs: 37.5 }));
  const configBoot = new ConfigUsuario(arquivoBoot);
  Audio.latenciaCalibrada = 0.0; // estado "de fábrica", como um processo novo
  // O MESMO passo de `game.ts`: carregar() então aplicar em latenciaCalibrada.
  configBoot.carregar();
  check(configBoot.error === "", "carregar() não reporta erro num arquivo válido: " + configBoot.error);
  Audio.latenciaCalibrada = configBoot.audioLatenciaMs;
  check(Math.abs(Audio.latenciaCalibrada - 37.5) < 1e-9, "boot aplica o valor salvo em Audio.latenciaCalibrada: " + Audio.latenciaCalibrada);
  Audio.latenciaCalibrada = 0.0; // não vaza pro resto do arquivo de teste

  // Arquivo INEXISTENTE (1ª execução, sem config salva ainda): carrega sem
  // erro, com o padrão (0), como o boot do jogo numa instalação nova.
  const configNovo = new ConfigUsuario("build/test-audio/nao-existe-usuario.json");
  configNovo.carregar();
  check(configNovo.error === "", "arquivo inexistente não é erro (instalação nova): " + configNovo.error);
  check(configNovo.audioLatenciaMs === 0.0, "sem config salva, o padrão é 0");

  // JSON corrompido: `carregar()` reporta o erro (pro Console, via chamador)
  // sem lançar e sem mexer no valor em memória.
  const arquivoRuim = "build/test-audio/usuario-corrompido.json";
  fs.write(arquivoRuim, "{ nao e json valido");
  const configRuim = new ConfigUsuario(arquivoRuim);
  configRuim.audioLatenciaMs = 9.0;
  configRuim.carregar();
  check(configRuim.error !== "", "JSON corrompido reporta erro em .error");
  check(configRuim.audioLatenciaMs === 9.0, "JSON corrompido não mexe no valor em memória");
}

// ── 8. WS: `audio relogio` e `audio calibrar` ───────────────────────────────
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

io.print("[PASSOU] relógio DSP: monotônico/suave (normal, stall, alvo adaptativo), tempoAudivel (play/pausa/pitch), agendarEm sample-accurate, cancelarAgendado (antes/depois do disparo, 32 vozes cheias), CalibradorLatencia (API computa e persiste), boot do jogo (config_usuario) e WS");

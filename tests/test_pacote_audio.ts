// Teste SEM JANELA do comando `audio` (pacote audio/): a IA confere o som por
// número — ganhos, corte, estado, nível e mixer — no dispositivo nulo, e a
// escuta por loopback (Ruling A7) por polling não bloqueante.
//   $RTS run tests/test_pacote_audio.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import time from "@compat/time.ts";
import "@engine/generated/editor_extensions";
import { instalarEditorReal } from "@editor/editor_host";
import { execCommand } from "@editor/control/dispatch";
import { scene } from "@editor/control/session";
import { history } from "@editor/undo";
import { AudioSource } from "@scripts/audiosource";
import { initAudio, closeAudio, AUDIO_NULO, AUDIO_REAL, mixarBloco, pumpAudio, pararTodas, activeVoices } from "@engine/audio/audio";
import { resolverOuvinte, definirPoseEditor, limparPosesAudio } from "@engine/audio/audio_system";
import { mixerPadrao, grupoMudo, grupoVolume, grupoIndex } from "@engine/audio/mixer_grupos";
import { escutaDisponivel } from "@compat/audio.ts";
import { EspecWav, escreverWav } from "./wav_escritor";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function cmd(l: string): string { return execCommand(800, 600, l); }
/// Chama `audio escuta resultado` até sair de "pendente" ou estourar o prazo
/// (a captura roda numa thread de guarda do rts.exe: o polling é o único jeito
/// certo de esperar, nunca um `escutar` bloqueante — spec Ruling A7).
function esperarEscuta(prazoMs: number): string {
  const fim = time.now_ms() + prazoMs;
  let r = cmd("audio escuta resultado");
  while (r === "[audio] escuta pendente" && time.now_ms() < fim) { time.sleep_ms(20); r = cmd("audio escuta resultado"); }
  return r;
}
/// A mesma espera, mas BOMBEANDO o dispositivo real a cada volta — sem isso
/// `playTone` só agenda a voz na tabela; ninguém escreve amostra nenhuma no
/// dispositivo de verdade (é `pumpAudio`, chamado uma vez por quadro pelo
/// editor/jogo, quem faz isso), e o loopback ouviria silêncio de qualquer jeito.
function esperarEscutaBombeando(prazoMs: number): string {
  const fim = time.now_ms() + prazoMs;
  let r = cmd("audio escuta resultado");
  while (r === "[audio] escuta pendente" && time.now_ms() < fim) { pumpAudio(); time.sleep_ms(20); r = cmd("audio escuta resultado"); }
  return r;
}

fs.create_dir_all("build/test-audio");
const e = new EspecWav(); e.taxa = 48000; e.quadros = 48000;
fs.write("build/test-audio/fonte.wav", escreverWav(e));
fs.write("build/test-audio/outro.wav", escreverWav(e));
initAudio(AUDIO_NULO);
mixerPadrao();
instalarEditorReal();
scene.clear(); history.u = []; history.r = [];
limparPosesAudio(); definirPoseEditor(new Float64Array(5));

const alto = scene.createGameObject("Alto");
alto.transform.setPosition(5.0, 0.0, 0.0);
const s = new AudioSource();
s.clip = "build/test-audio/fonte.wav"; s.spatialBlend = 1.0; s.maxDistance = 60.0; s.loop = true;
alto.addBehavior(s);
scene.computeWorld();
resolverOuvinte(scene, 0.016);

check(cmd("audio").indexOf("[erro] audio: uso") === 0, "sem subcomando: uso");
check(cmd("help").indexOf("audio play") >= 0, "no help");
const d0 = history.undoDepth();
const tocou = cmd("audio play Alto");
check(tocou.indexOf("[ok] #0 fonte=Alto clip=fonte.wav grupo=Master") === 0, "play: " + tocou);
check(tocou.indexOf("gL=0.000 gR=0.200") > 0 && tocou.indexOf("estado=tocando") > 0, "à direita a 5: gL 0, gR 0,2");
check(history.undoDepth() === d0, "play sem clipe não mexe na cena");
mixarBloco(2400);
const lista = cmd("audio list");
check(lista.indexOf("[audio] 1 vozes") === 0 && lista.indexOf("dist=5.00") > 0 && lista.indexOf("pos=0.05/1.00s") > 0, "list: " + lista);
const nv = cmd("audio nivel");
check(nv.indexOf("rmsL=0.000") > 0 && nv.indexOf("rmsR=0.000") < 0 && nv.indexOf("vozes=1") > 0, "nível: só o direito soa: " + nv);

check(cmd("audio mixer Master mudo").indexOf("[ok] Master") === 0 && grupoMudo(0) === 1, "mudo no Master");
mixarBloco(2400);
check(cmd("audio list").indexOf("estado=virtual") > 0, "grupo mudo: voz virtual");
const mx = cmd("audio mixer");
check(mx.indexOf("[audio] mixer 4 grupos (não salvo)") === 0 && mx.indexOf("Master vol=1.00 efetivo=0.000 mudo=1") > 0, "mixer: " + mx);
cmd("audio mixer Master mudo");
check(cmd("audio mixer Efeitos 0.5").indexOf("[ok]") === 0 && grupoVolume(grupoIndex("Efeitos")) === 0.5, "volume do grupo");
check(cmd("audio mixer Efeitos 2").indexOf("[erro]") === 0, "volume fora de 0..1");
check(cmd("audio mixer Trilha 0.5").indexOf("[erro]") === 0, "grupo inexistente");
check(cmd("audio mixer Música pausa").indexOf("pausa=1") > 0, "pausa");
cmd("audio mixer Música pausa");

const ouv = cmd("audio listener");
check(ouv.indexOf("[audio] ouvinte origem=editor") === 0 && ouv.indexOf("tipo=nulo taxa=48000 canais=2") > 0, "listener: " + ouv);
const cl = cmd("audio clip build/test-audio/fonte.wav");
check(cl.indexOf("[audio] clip fonte.wav: 48000 Hz, mono, 1,00 s, 187 KB pico=0.500") === 0, "clip: " + cl);
check(cmd("audio clip build/test-audio/nao.wav").indexOf("[erro]") === 0, "clip ausente");

check(cmd("audio play Alto build/test-audio/outro.wav").indexOf("[ok]") === 0 && s.clip === "build/test-audio/outro.wav" && history.undoDepth() === d0 + 1, "play com clipe troca o campo, com Desfazer");
check(cmd("audio play Ninguem").indexOf("[erro]") === 0, "objeto inexistente");
check(cmd("audio stop Alto").indexOf("[ok] parada a fonte de 'Alto'") === 0 && !s.isPlaying(), "stop <obj>");
s.play(); cmd("audio play Alto");
check(cmd("audio stop tudo").indexOf("[ok] paradas") === 0 && activeVoices() === 0, "stop tudo");
pararTodas();

// ── escuta (Ruling A7): a IA confere sozinha se o som saiu, por número ──────
if (!escutaDisponivel()) {
  io.print("[aviso] rts.exe sem escuta_iniciar/escuta_ler (binário antigo) — pulando os testes de 'audio escuta' (fallback dá 'indisponível').");
  check(cmd("audio escuta").indexOf("[erro] audio: escuta indisponível") === 0, "escuta indisponível: usa o fallback, não quebra");
  check(cmd("audio escuta resultado").indexOf("[audio] escuta indisponível") === 0, "resultado também avisa indisponível");
} else {
  // uso
  check(cmd("audio escuta abc").indexOf("[erro]") === 0, "escuta: ms inválido");
  check(cmd("audio escuta 100 sonda demais").indexOf("[erro] audio: uso") === 0, "escuta: excesso de argumentos");

  // nunca iniciada: pendente (não quebra, não afirma um resultado que não existe)
  check(cmd("audio escuta resultado") === "[audio] escuta pendente", "resultado sem escuta iniciada: pendente");

  // sem sonda, ms curto: só junta a estrutura da resposta (o conteúdo real
  // depende do que está saindo pelo alto-falante da máquina agora — não afirmado).
  check(cmd("audio escuta 60").indexOf("[ok] escuta iniciada ms=60 sonda=0") === 0, "escuta: inicia sem sonda");
  const semSonda = esperarEscuta(3000);
  check(semSonda.indexOf("[audio] escuta rms=") === 0 && semSonda.indexOf("sonda=-") > 0 &&
        (semSonda.indexOf("veredito=som") > 0 || semSonda.indexOf("veredito=silencio") > 0), "escuta sem sonda: " + semSonda);
  check(cmd("audio escuta resultado") === semSonda, "resultado repetido devolve o mesmo (não relê a nativa de novo)");

  // com sonda, mas o MOTOR está no dispositivo NULO (AUDIO_NULO acima): o tom
  // nunca sai pela placa de som de verdade, então o veredito é determinístico
  // — "sem-dispositivo" — mesmo que o loopback capture outra coisa qualquer.
  check(cmd("audio escuta 80 sonda").indexOf("[ok] escuta iniciada ms=80 sonda=1") === 0, "escuta: inicia com sonda");
  const comSonda = esperarEscuta(3000);
  check(comSonda.indexOf("veredito=sem-dispositivo") > 0, "sonda num device nulo: sem-dispositivo — " + comSonda);
  check(comSonda.indexOf("sonda=") > 0 && comSonda.indexOf("sonda=-") < 0, "com sonda: energia numérica, não '-' — " + comSonda);

  // Fim a fim de VERDADE (task-11, item 3): o dispositivo REAL desta máquina,
  // sonda tocando pela placa de som de verdade, ouvida pelo loopback do
  // sistema — sem perguntar ao humano. Pula com um aviso sem placa de som.
  closeAudio();
  if (initAudio(AUDIO_REAL) === 0) {
    io.print("[aviso] sem dispositivo de áudio real nesta máquina — pulando o fim a fim de 'audio escuta ... sonda'.");
  } else {
    const iniciouReal = cmd("audio escuta 400 sonda");
    check(iniciouReal.indexOf("[ok] escuta iniciada ms=400 sonda=1") === 0, "escuta real: inicia — " + iniciouReal);
    const real = esperarEscutaBombeando(4000);
    io.print("[audio escuta real] " + real);
    check(real.indexOf("veredito=sonda-ok") > 0, "escuta real com sonda: esperado veredito=sonda-ok — " + real);
  }
  closeAudio();
}

io.print("[PASSOU] pacote audio: play/stop/list/mixer/listener/clip/nivel/escuta por número, consultas sem Desfazer");

// Regressão do ciclo do Play com AudioSource (Task 10, revisão da Task 9):
// Play com fontes playOnAwake cria vozes; Parar cala tudo e não toca nos
// objetos ORIGINAIS da cena de autoria; destruir o ouvinte NO MEIO do Play
// não quebra nada — o próximo quadro cai no fallback (Camera.main/editor).
//   $RTS run tests/test_audio_source_play_cycle.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { history } from "@editor/undo";
import { AudioSource } from "@scripts/audiosource";
import { AudioListener } from "@engine/core/audio_listener";
import { initAudio, AUDIO_NULO, activeVoices, audioEmJogo, mixarBloco, audioUltimoBloco, audioSairJogo,
         tocarClipe } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido } from "@engine/audio/vozes";
import { definirPoseEditor, limparPosesAudio, resolverOuvinte, OUVINTE_NENHUM } from "@engine/audio/audio_system";
import { mixerPadrao } from "@engine/audio/mixer_grupos";
import { EspecWav, escreverWav } from "./wav_escritor";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
/// Depois de `pararTodasSuave` (Play→Stop, sem clique — Ruling A6/A8): a
/// rampa de saída não pode ter degrau. Só o canal esquerdo, como em
/// `test_audio_grupos.ts` (decaiSemDegrau) — sinal qualquer, magnitude segue
/// o ganho linear indo a zero.
function decaiSemDegrau(quadros: number): boolean {
  const b = audioUltimoBloco();
  let k = 1;
  while (k < quadros) { if (Math.abs(b[2 * k]) > Math.abs(b[2 * (k - 1)]) + 1e-6) return false; k = k + 1; }
  return true;
}

initAudio(AUDIO_NULO);
mixerPadrao();
fs.create_dir_all("build/test-audio");
const e = new EspecWav(); e.taxa = 48000; e.quadros = 48000;
fs.write("build/test-audio/ciclo.wav", escreverWav(e));
limparPosesAudio(); definirPoseEditor(new Float64Array(5));

// ── Play com playOnAwake cria vozes; Parar cala tudo e não toca no original ──
scene.clear(); history.u = []; history.r = [];
const ouv = scene.createGameObject("Ouvido");
ouv.addBehavior(new AudioListener());
const a = scene.createGameObject("Fonte A");
const srcA = new AudioSource();
srcA.clip = "build/test-audio/ciclo.wav"; srcA.loop = true; srcA.playOnAwake = true;
a.addBehavior(srcA);
const b = scene.createGameObject("Fonte B");
const srcB = new AudioSource();
srcB.forma = "quadrada"; srcB.dur = 1.0; srcB.loop = true; srcB.playOnAwake = true;
b.addBehavior(srcB);
const c = scene.createGameObject("Fonte C (manual)");
const srcC = new AudioSource();
srcC.clip = "build/test-audio/ciclo.wav"; srcC.playOnAwake = false;
c.addBehavior(srcC);

check(activeVoices() === 0 && audioEmJogo() === 0, "fora do Play, nada toca ainda");
check(srcA.vozPrincipal() === 0 && srcB.vozPrincipal() === 0, "os componentes ORIGINAIS não têm voz (mount não roda fora do Play)");

check(playMode.play(), "Play");
check(audioEmJogo() === 1, "flag de jogo ligada");
check(activeVoices() === 2, "as duas fontes playOnAwake tocam na CÓPIA do Play; a manual não");
// Os componentes originais continuam sem voz: quem tocou foi a cópia simulada.
check(srcA.vozPrincipal() === 0 && srcB.vozPrincipal() === 0 && srcC.vozPrincipal() === 0, "os originais da cena de autoria não foram tocados");

playMode.stop();
check(audioEmJogo() === 0 && S.simulating === 0, "Parar desliga o jogo e a simulação na hora");
mixarBloco(800); // pararTodasSuave rampa (sem clique — Ruling A6/A8): um bloco basta pra esvaziar
check(activeVoices() === 0, "Parar cala tudo (depois da rampa de saída)");
check(scene.objects[0] === ouv && scene.objects[1] === a && scene.objects[2] === b && scene.objects[3] === c, "os objetos originais voltam intactos");
check(srcA.vozPrincipal() === 0 && srcB.vozPrincipal() === 0, "os originais continuam sem voz depois de Parar");

// ── ouvinte destruído NO MEIO do Play não quebra nada ────────────────────────
check(playMode.play(), "Play de novo");
check(activeVoices() === 2, "toca de novo");
const runtimeOuvinte = scene.objects[0];
check(runtimeOuvinte.behaviors.some(bh => bh instanceof AudioListener), "a cópia do ouvinte existe");
scene.removeAt(0); // destrói o ouvinte NO MEIO do Play
const origem = resolverOuvinte(scene, 0.016); // não deve lançar
check(origem === OUVINTE_NENHUM || origem >= 0, "resolverOuvinte não quebra sem ouvinte (cai no fallback)");
playMode.stop();
check(S.simulating === 0, "Parar segue funcionando mesmo depois do ouvinte ter sido destruído no meio");
mixarBloco(800);
check(activeVoices() === 0, "e cala tudo depois da rampa, mesmo sem ouvinte");
check(scene.objects[0] === ouv, "o ouvinte ORIGINAL (fora da simulação) não foi afetado pela remoção na cópia");

// ── audioSairJogo (Play→Stop) não estala: pararTodasSuave rampa a zero ──────
// Sinal DC (como em test_audio_grupos.decaiSemDegrau): a magnitude do canal
// segue o ganho linear da rampa, então dá pra afirmar "sem degrau" por amostra.
const dcAmostras = new Float32Array(4800); dcAmostras.fill(0.5);
const dcClip = AudioClip.fromSamples("dc-stop", dcAmostras, 1);
const pedidoDc = novoPedido();
check(tocarClipe(dcClip, pedidoDc) > 0, "voz DC tocando antes do Stop");
check(activeVoices() === 1, "uma voz ativa");
audioSairJogo(); // == o que `playMode.stop()` chama pro áudio
check(activeVoices() === 1, "a rampa ainda não correu: a voz segue ocupando o slot até o próximo bloco mixado");
mixarBloco(800);
check(decaiSemDegrau(800), "audioSairJogo: rampa de saída sem degrau (sem clique)");
check(Math.abs(audioUltimoBloco()[2 * 799]) < 1e-4, "a última amostra do bloco de rampa já está perto de zero");
check(activeVoices() === 0, "depois do bloco de rampa a voz libera (Ruling A6/A8)");

io.print("[PASSOU] AudioSource: ciclo do Play (playOnAwake cria vozes, Parar cala tudo sem tocar no original, ouvinte destruído no meio não quebra, sem clique no Stop)");

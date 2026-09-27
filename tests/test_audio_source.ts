// AudioSource por número: carregar a cena no editor não toca, playOnAwake toca
// no Play e parar o Play cala tudo; formato antigo; play/pause/stop/time;
// ganhos 2D/3D pela fonte; mudo; grupo; playOneShot; playClipAtPoint; prévia.
//   $RTS run tests/test_audio_source.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { scene, S } from "@editor/control/session";
import { playMode } from "@editor/play_mode";
import { history } from "@editor/undo";
import { recreateBehavior, sceneToJSON, sceneFromJSON } from "@editor/sceneio";
import { componentToData } from "@engine/components";
import { AudioSource, audioSourceLegado } from "@scripts/audiosource";
import { AudioClip } from "@engine/audio/clip";
import { initAudio, AUDIO_NULO, activeVoices, mixarBloco, vozesTabela, vozIndice, audioEmJogo, previaTocando, pararTodas } from "@engine/audio/audio";
import { VOZ_FLOATS, V_ALVO_L, V_ALVO_R, V_GRUPO, V_FLAGS, V_X, FLAG_3D, FLAG_VIRTUAL } from "@engine/audio/vozes";
import { sincronizarFontes, resolverOuvinte, definirPoseEditor, limparPosesAudio, Audio } from "@engine/audio/audio_system";
import { mixerPadrao, grupoIndex } from "@engine/audio/mixer_grupos";
import { EspecWav, escreverWav } from "./wav_escritor";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
initAudio(AUDIO_NULO);
mixerPadrao();
fs.create_dir_all("build/test-audio");
const e = new EspecWav(); e.taxa = 48000; e.quadros = 48000;
fs.write("build/test-audio/fonte.wav", escreverWav(e));
const vz = vozesTabela();
function b(id: number): number { return vozIndice(id) * VOZ_FLOATS; }
const origem = new Float64Array(5);
limparPosesAudio(); definirPoseEditor(origem);

// ── carregar no editor não toca; o Play toca; parar cala ───────────────────
scene.clear(); history.u = []; history.r = [];
const go = scene.createGameObject("Fonte");
const src = new AudioSource();
src.clip = "build/test-audio/fonte.wav"; src.loop = true;
go.addBehavior(src);
check(src.playOnAwake && src.spatialBlend === 0.0 && src.minDistance === 1.0 && src.maxDistance === 500.0 && src.rolloff === "log", "padrões da Unity");
sceneFromJSON(sceneToJSON());
check(activeVoices() === 0 && audioEmJogo() === 0, "abrir a cena no editor não toca (mount fora do Play)");
check(playMode.play(), "Play");
check(audioEmJogo() === 1 && activeVoices() === 1, "playOnAwake toca no mount da cópia do Play");
playMode.stop();
check(audioEmJogo() === 0 && activeVoices() === 0 && S.simulating === 0, "parar o Play cala tudo");

// ── formato antigo ──────────────────────────────────────────────────────────
const antigo = recreateBehavior({ type: "audiosource", kind: 1, freq: 220.0, dur: 0.3, gain: 0.4, every: 2.0 }) as AudioSource;
check(antigo.typeName() === "AudioSource" && antigo.forma === "quadrada" && antigo.freq === 220.0 && antigo.dur === 0.3, "kind 1 vira forma quadrada");
check(antigo.volume === 0.4 && antigo.every === 2.0 && !antigo.playOnAwake && antigo.clip === "", "gain vira volume; o antigo não tocava sozinho");
const novo = recreateBehavior(componentToData(antigo)) as AudioSource;
check(novo.forma === "quadrada" && novo.volume === 0.4 && novo.every === 2.0, "salvo de novo no formato gerado, relido igual");
check(audioSourceLegado({ type: "audiosource", kind: 9 }).forma === "seno", "kind desconhecido cai em seno");

// ── API ─────────────────────────────────────────────────────────────────────
scene.clear();
const g2 = scene.createGameObject("Fonte 3D");
g2.transform.setPosition(5.0, 0.0, 0.0);
const s = new AudioSource();
s.clip = "build/test-audio/fonte.wav"; s.spatialBlend = 1.0; s.minDistance = 1.0; s.maxDistance = 60.0;
g2.addBehavior(s);
scene.computeWorld();
resolverOuvinte(scene, 0.016);
s.play();
check(s.isPlaying() && activeVoices() === 1, "play");
sincronizarFontes(scene);
mixarBloco(2400); mixarBloco(2400);
check(Math.abs(s.time - 0.1) < 1e-9, "time = 4800/48000 s (dois blocos: o teto por bloco é 2400)");
const bv = b(s.vozPrincipal());
check(((vz[bv + V_FLAGS] | 0) & FLAG_3D) !== 0 && vz[bv + V_ALVO_L] < 1e-9 && Math.abs(vz[bv + V_ALVO_R] - 0.2) < 1e-9, "3D à direita a 5: (0, 0,2)");
g2.transform.setPosition(0.0, 0.0, 3.0);
scene.computeWorld();
sincronizarFontes(scene);
mixarBloco(64);
check(vz[bv + V_X] === 0.0 && Math.abs(vz[bv + V_ALVO_L] - vz[bv + V_ALVO_R]) < 1e-9, "a fonte move a voz: à frente, centrada");
s.pause();
check(!s.isPlaying(), "pause");
s.unPause();
check(s.isPlaying(), "unPause");
s.spatialBlend = 0.0;
sincronizarFontes(scene); mixarBloco(64);
check(vz[bv + V_ALVO_L] === 1.0 && vz[bv + V_ALVO_R] === 1.0, "blend 0: 2D, (1, 1)");
s.mudo = true;
sincronizarFontes(scene); mixarBloco(64);
check(((vz[bv + V_FLAGS] | 0) & FLAG_VIRTUAL) !== 0, "mudo: voz virtual");
s.mudo = false; s.grupo = "Música";
sincronizarFontes(scene); mixarBloco(64);
check(vz[bv + V_GRUPO] === grupoIndex("Música"), "grupo resolvido por nome");
const clipTiro = AudioClip.load("build/test-audio/fonte.wav");
check(clipTiro !== null && s.playOneShot(clipTiro, 0.5) > 0 && s.isPlaying() && activeVoices() === 2, "playOneShot não interrompe a voz principal");
const ponto = new Float64Array(3); ponto[0] = 0.0 - 4.0;
const idPonto = clipTiro !== null ? AudioSource.playClipAtPoint(clipTiro, ponto, 1.0) : 0;
check(idPonto > 0 && vz[b(idPonto) + V_X] === 0.0 - 4.0 && activeVoices() === 3, "playClipAtPoint");
check(clipTiro !== null && Audio.playClipAtPoint(clipTiro, ponto, 1.0) > 0, "Audio.playClipAtPoint");
s.enabled = 0;
sincronizarFontes(scene);
check(!s.isPlaying(), "componente desligado para a voz");
s.enabled = 1;
s.stop();
pararTodas();

// ── validação ───────────────────────────────────────────────────────────────
s.minDistance = 10.0; s.maxDistance = 5.0; s.rolloff = "cubico"; s.forma = "serra"; s.volume = 3.0;
s.onValidate("");
check(s.maxDistance > s.minDistance && s.rolloff === "log" && s.forma === "seno" && s.volume === 1.0, "onValidate prende os campos");

// ── prévia fora do Play ─────────────────────────────────────────────────────
const d0 = history.undoDepth();
const json0 = sceneToJSON();
check(s.previa() > 0 && previaTocando() === 1, "prévia toca fora do Play");
check(history.undoDepth() === d0 && sceneToJSON() === json0, "prévia não mexe na cena nem no Desfazer");
io.print("[PASSOU] AudioSource: editor não toca, Play toca e parar cala, formato antigo, API, 2D/3D, mudo, grupo, one-shot, ponto, prévia");

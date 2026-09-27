// Sonda de ALOCAÇÃO do lado de EDITOR do pacote audio/ (revisão final da Task
// 11/12): os desenhadores de gizmo de AudioSource/AudioListener, o
// onInspectorGUI da janela Janela/Mixer e o ciclo Play→Stop
// (pararTodasSuave + mixarBloco). Rodar com RTS_GC_DEBUG=1 e contar as linhas
// "rts-gc" ENTRE os marcadores "FASE" (as coletas antes do 1º marcador são
// setup). Portão: 0 coletas em CADA fase com 200 000 iterações.
//
//   RTS_GC_DEBUG=1 GC_N=200000 rts.exe run tests/claude-test-audio-editor-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: gizmos (AudioSource 2D+3D e AudioListener, selecionado alternando),
// inspector (MixerInspector.onInspectorGUI com um InspectorUI de teste — a
// base já devolve os valores recebidos, sem janela nenhuma) e playstop
// (tocarClipe + pararTodasSuave + mixarBloco, o caminho de Play→Stop/`audio
// stop tudo` sem clique — Ruling A6/A8).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { InspectorUI } from "@engine/core/inspector_ui";
import { gizmosBegin } from "@engine/core/gizmos";
import { gizmosDoEditor, coletarGizmos } from "@editor/gizmo_pass";
import { AudioSource } from "@scripts/audiosource";
import { AudioListener } from "@engine/core/audio_listener";
import { MixerInspector } from "../assets/pacotes/audio/audio_editor";
import { mixerPadrao } from "@engine/audio/mixer_grupos";
import { initAudio, AUDIO_NULO, tocarClipe, pararTodasSuave, mixarBloco } from "@engine/audio/audio";
import { AudioClip } from "@engine/audio/clip";
import { novoPedido } from "@engine/audio/vozes";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));

// ── cena com fonte 2D, fonte 3D e ouvinte (os três gizmos do pacote) ────────
const sc = new Scene("gc-editor-audio");
const fonte2d = sc.createGameObject("Fonte2D");
fonte2d.transform.setPosition(0.0 - 3.0, 0.0, 10.0);
fonte2d.addBehavior(new AudioSource());
const fonte3dGO = sc.createGameObject("Fonte3D");
fonte3dGO.transform.setPosition(3.0, 0.0, 10.0);
const fonte3d = new AudioSource();
fonte3d.spatialBlend = 1.0;
fonte3dGO.addBehavior(fonte3d);
const ouvido = sc.createGameObject("Ouvido");
ouvido.transform.setPosition(0.0, 0.0, 0.0);
ouvido.addBehavior(new AudioListener());
sc.computeWorld();
const pose = new Float64Array(8);
pose[2] = 0.0 - 20.0; pose[5] = 1.05; pose[6] = 1280.0; pose[7] = 720.0;
const g = gizmosDoEditor;

// aquece fora da fase (buffers de Gizmos crescem uma vez)
gizmosBegin(g, pose); coletarGizmos(g, sc, 0 - 1);
io.print("FASE gizmos " + n);
let f = 0;
while (f < n) {
  pose[0] = (f % 100) * 0.001;
  gizmosBegin(g, pose);
  coletarGizmos(g, sc, f % 4); // alterna a seleção (esferas min/max só quando selecionada)
  f = f + 1;
}

// ── Janela/Mixer: onInspectorGUI com um InspectorUI de teste (sem janela) ───
mixerPadrao();
const mixerInsp = new MixerInspector();
const uiStub = new InspectorUI(); // reaproveitado entre chamadas, como o real
io.print("FASE inspector " + n);
f = 0;
while (f < n) { mixerInsp.onInspectorGUI(uiStub); f = f + 1; }

// ── Play→Stop / `audio stop tudo`: pararTodasSuave rampa sem clique ─────────
initAudio(AUDIO_NULO);
const clipStop = AudioClip.fromSamples("gc-playstop", new Float32Array(64).fill(0.3), 1);
const pedidoStop = novoPedido();
io.print("FASE playstop " + n);
f = 0;
while (f < n) {
  tocarClipe(clipStop, pedidoStop);
  pararTodasSuave();
  mixarBloco(64);
  f = f + 1;
}
io.print("FASE fim");

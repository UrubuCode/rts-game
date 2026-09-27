// O ouvinte da cena: cache KIND_AUDIO, ordem do fallback (componente →
// Camera.main → pose empurrada → editor), um ativo por cena com aviso único,
// desligado/pai inativo fora, velocidade pela derivada da pose.
//   $RTS run tests/test_audio_listener.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { setActiveScene } from "@engine/core/active_scene";
import { Camera } from "@engine/core/camera";
import { AudioListener } from "@engine/core/audio_listener";
import { KIND_AUDIO, AUDIO_PAPEL_OUVINTE } from "@engine/core/behavior";
import { resolverOuvinte, definirPoseEmpurrada, definirPoseEditor, limparPosesAudio, donoOuvinte,
         OUVINTE_NENHUM, OUVINTE_COMPONENTE, OUVINTE_CAMERA, OUVINTE_EMPURRADO, OUVINTE_EDITOR } from "@engine/audio/audio_system";
import { listenerX, listenerYaw, listenerVX } from "@engine/audio/spatial";
import { logEntries, LOG_WARN } from "@engine/core/logger";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
const DT: f64 = 0.016;
const sc = new Scene("ouvinte");
setActiveScene(sc);
limparPosesAudio();
check(resolverOuvinte(sc, DT) === OUVINTE_NENHUM, "cena vazia, sem pose: nenhum");

const empurrada = new Float64Array(5); empurrada[0] = 1.0; empurrada[3] = 0.5;
const editor = new Float64Array(5); editor[0] = 7.0;
definirPoseEditor(editor);
check(resolverOuvinte(sc, DT) === OUVINTE_EDITOR && listenerX() === 7.0, "só a pose do editor");
definirPoseEmpurrada(empurrada);
check(resolverOuvinte(sc, DT) === OUVINTE_EMPURRADO && listenerX() === 1.0 && listenerYaw() === 0.5, "a pose empurrada vence a do editor");

const oc = sc.createGameObject("Câmera");
oc.transform.setPosition(10.0, 0.0, 0.0);
oc.addBehavior(new Camera());
sc.computeWorld();
check(resolverOuvinte(sc, DT) === OUVINTE_CAMERA && listenerX() === 10.0, "Camera.main vence a pose empurrada");

const ol = sc.createGameObject("Ouvido");
ol.transform.setPosition(20.0, 0.0, 0.0); ol.transform.ry = 1.0;
const ouvido = new AudioListener();
ol.addBehavior(ouvido);
sc.computeWorld();
check(ouvido.kind() === KIND_AUDIO && ouvido.audioPapel() === AUDIO_PAPEL_OUVINTE, "AudioListener é KIND_AUDIO, papel ouvinte");
check(ol.audioIdx === 0 && sc.audioObjs.length === 1 && oc.audioIdx === 0 - 1, "cache: só o objeto com áudio");
check(resolverOuvinte(sc, DT) === OUVINTE_COMPONENTE && listenerX() === 20.0 && listenerYaw() === 1.0 && donoOuvinte() === ol, "o componente vence a câmera");

ol.transform.setPosition(21.0, 0.0, 0.0);
sc.computeWorld();
resolverOuvinte(sc, 0.5);
check(Math.abs(listenerVX() - 2.0) < 1e-9, "velocidade = Δpose/dt = 1/0,5");

const avisos0 = logEntries(LOG_WARN, "AudioListener").length;
const ol2 = sc.createGameObject("Ouvido 2");
ol2.transform.setPosition(30.0, 0.0, 0.0);
ol2.addBehavior(new AudioListener());
sc.computeWorld();
resolverOuvinte(sc, DT); resolverOuvinte(sc, DT);
check(logEntries(LOG_WARN, "AudioListener").length === avisos0 + 1 && listenerX() === 21.0, "dois ativos: vale o primeiro e o aviso sai uma vez");

ouvido.enabled = 0;
check(resolverOuvinte(sc, DT) === OUVINTE_COMPONENTE && listenerX() === 30.0, "o primeiro desligado: vale o segundo");
const pai = sc.createGameObject("Pai");
pai.active = 0;
ol2.parent = sc.objects.indexOf(pai);
sc.computeWorld();
check(resolverOuvinte(sc, DT) === OUVINTE_CAMERA, "ouvinte sob pai inativo não conta: volta à câmera");

sc.removeAt(sc.objects.indexOf(ol));
check(sc.audioObjs.length === 1 && sc.audioObjs[0] === ol2, "remover tira do cache");
ol2.removeBehavior(0);
check(sc.audioObjs.length === 0 && ol2.audioIdx === 0 - 1, "remover o componente tira do cache");
sc.clear();
check(sc.audioObjs.length === 0, "clear esvazia");
io.print("[PASSOU] ouvinte: cache KIND_AUDIO, fallback componente → câmera → empurrada → editor, um ativo com aviso único, velocidade");

// Teste HEADLESS do componente AnimationPlayer (engine/core/animation_player.ts):
// play/clipe inexistente, seek com/sem laço, custo e alocação, crossfade, e
// que um clipe tocando não mexe na pose MANUAL salva.
//
//   ./rts.exe run tests/test_animation_player.ts
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer, sampleClipInto } from "@engine/core/animation_player";
import { quatNlerpInto } from "@engine/render/quat";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

const g = new GameObject("p"); const sk = new Skeleton("assets/models/kenney/character-a.glb"); sk.ensureAsset(0);
const ap = new AnimationPlayer(); g.addBehavior(sk); g.addBehavior(ap);
check(ap.clipNames().length === 27, "27 clipes");
check(!ap.play("corrida"), "clipe inexistente devolve false");
check(ap.play("walk", true), "walk existe");
const leg = sk.boneIndex("leg-left");
ap.seek(0.0); const r0 = sk.poseR[leg * 4];
// NOTA: o brief original pedia seek(0.3333), mas no fixture real a duracao de
// "walk" e' 0.6666666865348816 e o canal de rotacao de leg-left e' UM seno
// completo no ciclo (zero em t=0, extremo em T/4, zero de novo em T/2=0.3333,
// extremo oposto em 3T/4, zero em T) — 0.3333 cai quase exatamente no
// zero-crossing do meio do ciclo (T/2), entao a perna volta perto do repouso
// e a checagem original falharia por coincidencia dos DADOS, nao por bug de
// implementacao (confirmado lendo os 20 keyframes do canal com um script de
// depuracao). Uso T/4 (0.1667), que cai no EXTREMO do balanco da perna, para
// manter o espirito do teste ("a perna muda entre t=0 e um instante do meio
// do ciclo") com um instante onde a mudanca e' de fato grande.
ap.seek(0.1667); const rMeio = sk.poseR[leg * 4];
check(Math.abs(r0 - rMeio) > 0.01, "a perna muda entre t=0 e t=0.1667 (T/4)");
ap.seek(0.6666 + 0.3333); check(Math.abs(ap.time - 0.3333) < 1e-3, "com laco, seek envolve: " + ap.time);
ap.seek(-1.0); check(ap.time >= 0.0 && ap.time === ap.time, "seek negativo nao da NaN nem negativo");
ap.play("die", false); ap.seek(99.0); check(Math.abs(ap.time - ap.duration()) < 1e-6, "sem laco, seek grampeia no fim");

// clipe inexistente em play(): clipe/tempo/pose atuais nao mudam
ap.seek(0.1234);
const clipeAntes = ap.clip; const tempoAntes = ap.time; const poseAntes = sk.poseR[leg * 4];
check(!ap.play("clipe-fantasma"), "play com clipe inexistente devolve false");
check(ap.clip === clipeAntes && Math.abs(ap.time - tempoAntes) < 1e-9 && sk.poseR[leg * 4] === poseAntes,
  "play falho nao muda clipe/tempo/pose");
check(!ap.crossFade("clipe-fantasma", 1.0), "crossFade com clipe inexistente devolve false");
check(ap.clip === clipeAntes && Math.abs(ap.time - tempoAntes) < 1e-9, "crossFade falho nao muda clipe/tempo");

// um clipe tocando nao mexe na pose MANUAL nem no overrideMask (so a pose de
// trabalho, que o clipe pisa por cima, e' escrita)
ap.play("walk", true); ap.seek(0.2);
check(sk.overrideMask[leg] === 0, "clipe tocando nao marca overrideMask");
const manualAntes = sk.manualR[leg * 4];
ap.seek(0.5);
check(sk.manualR[leg * 4] === manualAntes, "clipe tocando nao muda a pose manual");

// crossfade: metade do caminho = media das poses (nlerp) entre a pose do
// clipe ANTERIOR (idle, CONGELADO no tempo em que estava ao chamar crossFade,
// aqui t=0) e a do NOVO clipe (walk, avancando normalmente). Usa "arm-left":
// "leg-left" nao serve pra este teste porque "idle" nao tem canal de rotacao
// pra pernas (so torso/bracos/cabeca) — o braço tem canal nos DOIS clipes.
const arm = sk.boneIndex("arm-left");
ap.play("idle", true); ap.seek(0.0);
ap.crossFade("walk", 1.0);
ap.update(0.5);
const misto = new Float64Array(4);
misto[0] = sk.poseR[arm * 4]; misto[1] = sk.poseR[arm * 4 + 1]; misto[2] = sk.poseR[arm * 4 + 2]; misto[3] = sk.poseR[arm * 4 + 3];
check(misto[3] === misto[3] && Math.abs(misto[3]) <= 1.0, "pose mista valida");
// esperado: nlerp(idle amostrado em t=0 [congelado], walk amostrado em t=0.5) com w=0.5
const skAux = new Skeleton("assets/models/kenney/character-a.glb"); skAux.ensureAsset(0);
const idleClipIdx = skAux.asset!.clipIndex("idle"); const walkClipIdx = skAux.asset!.clipIndex("walk");
sampleClipInto(skAux, skAux.asset!.clips[idleClipIdx], 0.0, 1.0);
const idleAmostrado = new Float64Array(4);
idleAmostrado[0] = skAux.poseR[arm * 4]; idleAmostrado[1] = skAux.poseR[arm * 4 + 1]; idleAmostrado[2] = skAux.poseR[arm * 4 + 2]; idleAmostrado[3] = skAux.poseR[arm * 4 + 3];
sampleClipInto(skAux, skAux.asset!.clips[walkClipIdx], 0.5, 1.0);
const walkAmostrado = new Float64Array(4);
walkAmostrado[0] = skAux.poseR[arm * 4]; walkAmostrado[1] = skAux.poseR[arm * 4 + 1]; walkAmostrado[2] = skAux.poseR[arm * 4 + 2]; walkAmostrado[3] = skAux.poseR[arm * 4 + 3];
const esperado = new Float64Array(4);
quatNlerpInto(esperado, idleAmostrado, walkAmostrado, 0.5);
check(Math.abs(misto[0] - esperado[0]) < 1e-6 && Math.abs(misto[1] - esperado[1]) < 1e-6 &&
  Math.abs(misto[2] - esperado[2]) < 1e-6 && Math.abs(misto[3] - esperado[3]) < 1e-6,
  "crossfade em 50% = nlerp das duas poses amostradas: " + misto[0] + "," + misto[1] + "," + misto[2] + "," + misto[3] +
  " esperado " + esperado[0] + "," + esperado[1] + "," + esperado[2] + "," + esperado[3]);

// custo e alocacao: 17 players x 1000 frames
const gs: GameObject[] = []; let k = 0;
while (k < 17) { const o = new GameObject("b" + k); const s = new Skeleton("assets/models/kenney/character-a.glb"); s.ensureAsset(0); const p = new AnimationPlayer(); o.addBehavior(s); o.addBehavior(p); p.play("walk", true); gs.push(o); k = k + 1; }
const t0 = performance.now(); let f = 0;
while (f < 1000) { k = 0; while (k < 17) { gs[k].behaviors[1].update(1.0 / 60.0); (gs[k].behaviors[0] as Skeleton).compose(); k = k + 1; } f = f + 1; }
const ms = (performance.now() - t0) / 1000.0;
io.print("  17 personagens: " + ms.toFixed(3) + " ms/frame");
check(ms <= 0.3, "17 animados <= 0,3 ms/frame: " + ms);
io.print("[PASSOU] animation_player: play, seek, laco, grampo, crossfade, custo");

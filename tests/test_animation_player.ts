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
import { componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
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
// clipe ANTERIOR (idle, que TAMBEM avanca durante o fade — Unity/Godot: evita
// "slide" da pose de saida, ver AnimationPlayer.update) e a do NOVO clipe
// (walk, avancando normalmente). Usa "arm-left": "leg-left" nao serve pra
// este teste porque "idle" nao tem canal de rotacao pra pernas (so
// torso/bracos/cabeca) — o braço tem canal nos DOIS clipes.
const arm = sk.boneIndex("arm-left");
ap.play("idle", true); ap.seek(0.0);
ap.crossFade("walk", 1.0);
ap.update(0.5);
const misto = new Float64Array(4);
misto[0] = sk.poseR[arm * 4]; misto[1] = sk.poseR[arm * 4 + 1]; misto[2] = sk.poseR[arm * 4 + 2]; misto[3] = sk.poseR[arm * 4 + 3];
check(misto[3] === misto[3] && Math.abs(misto[3]) <= 1.0, "pose mista valida");
// esperado: nlerp(idle amostrado em t=0.5 [avancou junto], walk amostrado em t=0.5) com w=0.5
const skAux = new Skeleton("assets/models/kenney/character-a.glb"); skAux.ensureAsset(0);
const idleClipIdx = skAux.asset!.clipIndex("idle"); const walkClipIdx = skAux.asset!.clipIndex("walk");
sampleClipInto(skAux, skAux.asset!.clips[idleClipIdx], 0.5, 1.0);
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

// update(): laco envolve por si so (sem chamar seek)
{
  const g2 = new GameObject("u1"); const sk2 = new Skeleton("assets/models/kenney/character-a.glb"); sk2.ensureAsset(0);
  const ap2 = new AnimationPlayer(); g2.addBehavior(sk2); g2.addBehavior(ap2);
  ap2.play("die", true);   // "die" tem laco aqui so pra testar o wrap; duracao 0.3333333432674408
  const dur = ap2.duration();
  ap2.update(dur * 0.75); ap2.update(dur * 0.75);   // total 1.5x a duracao
  check(ap2.time >= 0.0 && ap2.time < dur, "update() com laco envolve dentro de [0,duracao): " + ap2.time);
  check(Math.abs(ap2.time - dur * 0.5) < 1e-6, "update() envolve no valor esperado: " + ap2.time);
}

// update(): sem laco, ao terminar o clipe playing vira false e o tempo grampeia na duracao
{
  const g3 = new GameObject("u2"); const sk3 = new Skeleton("assets/models/kenney/character-a.glb"); sk3.ensureAsset(0);
  const ap3 = new AnimationPlayer(); g3.addBehavior(sk3); g3.addBehavior(ap3);
  ap3.play("die", false);
  const dur3 = ap3.duration();
  check(ap3.playing, "playing=true logo apos play()");
  ap3.update(dur3 * 2.0);
  check(!ap3.playing, "sem laco, terminar o clipe poe playing=false");
  check(Math.abs(ap3.time - dur3) < 1e-9, "sem laco, o tempo fica grampeado na duracao apos terminar");
}

// update(): speed escala o avanco do tempo
{
  const g4 = new GameObject("u3"); const sk4 = new Skeleton("assets/models/kenney/character-a.glb"); sk4.ensureAsset(0);
  const ap4 = new AnimationPlayer(); g4.addBehavior(sk4); g4.addBehavior(ap4);
  ap4.play("idle", false); ap4.speed = 2.0;
  ap4.update(0.1);
  check(Math.abs(ap4.time - 0.2) < 1e-9, "speed=2 avanca o dobro do dt: " + ap4.time);
}

// pause()/resume(): pausado, update() nao avanca o tempo; resume() volta a avancar
{
  const g5 = new GameObject("u4"); const sk5 = new Skeleton("assets/models/kenney/character-a.glb"); sk5.ensureAsset(0);
  const ap5 = new AnimationPlayer(); g5.addBehavior(sk5); g5.addBehavior(ap5);
  ap5.play("idle", false);
  ap5.update(0.1);
  const tAntesPausa = ap5.time;
  ap5.pause();
  ap5.update(0.5);
  check(Math.abs(ap5.time - tAntesPausa) < 1e-12, "pause() congela o tempo em update()");
  ap5.resume();
  ap5.update(0.1);
  check(Math.abs(ap5.time - (tAntesPausa + 0.1)) < 1e-9, "resume() volta a avancar o tempo");
}

// restaurado (componentToData -> recreateBehavior) e' anexado com addBehavior
// e toca sem precisar chamar play() de novo: mount()/update() resolvem o
// clipe por nome (this.clip) lazily.
{
  const g6 = new GameObject("restaurado"); const sk6 = new Skeleton("assets/models/kenney/character-a.glb"); sk6.ensureAsset(0);
  const apOriginal = new AnimationPlayer(); apOriginal.clip = "walk"; apOriginal.loop = true; apOriginal.speed = 1.0; apOriginal.playing = true;
  const dados = componentToData(apOriginal);
  const apRestaurado = recreateBehavior(dados) as AnimationPlayer;
  g6.addBehavior(sk6); g6.addBehavior(apRestaurado);   // addBehavior chama mount() na cena real; aqui simula so o attach+mount manual
  apRestaurado.mount();
  const legR = sk6.boneIndex("leg-left");
  const antesR = sk6.poseR[legR * 4];
  apRestaurado.update(1.0 / 60.0);
  const depoisR = sk6.poseR[legR * 4];
  check(apRestaurado.duration() > 0.0, "restaurado resolve a duracao do clipe sem chamar play()");
  check(antesR !== depoisR || sk6.poseR[legR * 4 + 3] !== 1.0, "restaurado muda a pose no update() sem chamar play() de novo");
}

// cache do Skeleton fica invalido se ele for removido do objeto (owner=null),
// sem precisar de busca — resolveSkeleton() re-varre so quando necessario.
{
  const g7 = new GameObject("stale"); const sk7a = new Skeleton("assets/models/kenney/character-a.glb"); sk7a.ensureAsset(0);
  const ap7 = new AnimationPlayer(); g7.addBehavior(sk7a); g7.addBehavior(ap7);
  ap7.play("walk", true); ap7.update(1.0 / 60.0);   // cacheia sk7a
  const idxSk7a = g7.behaviors.indexOf(sk7a);
  g7.removeBehavior(idxSk7a);
  check(sk7a.owner === null, "removeBehavior zera o owner do componente removido");
  const sk7b = new Skeleton("assets/models/kenney/character-a.glb"); sk7b.ensureAsset(0);
  g7.addBehavior(sk7b);
  ap7.play("walk", true);   // play() forca resolveSkeleton() de novo
  check((ap7 as any)["skeleton"] === sk7b, "cache do Skeleton se atualiza depois de removido/substituido");
}

// custo e alocacao: 17 players x 1000 frames
const gs: GameObject[] = []; let k = 0;
while (k < 17) { const o = new GameObject("b" + k); const s = new Skeleton("assets/models/kenney/character-a.glb"); s.ensureAsset(0); const p = new AnimationPlayer(); o.addBehavior(s); o.addBehavior(p); p.play("walk", true); gs.push(o); k = k + 1; }
const t0 = performance.now(); let f = 0;
while (f < 1000) { k = 0; while (k < 17) { gs[k].behaviors[1].update(1.0 / 60.0); (gs[k].behaviors[0] as Skeleton).compose(); k = k + 1; } f = f + 1; }
const ms = (performance.now() - t0) / 1000.0;
io.print("  17 personagens: " + ms.toFixed(3) + " ms/frame");
check(ms <= 0.3, "17 animados <= 0,3 ms/frame: " + ms);
io.print("[PASSOU] animation_player: play, seek, laco, grampo, crossfade, custo");

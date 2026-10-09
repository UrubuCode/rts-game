// O clipe original é amostrado pelo AnimationPlayer real, sem renderer falso.
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer } from "@engine/core/animation_player";

function check(value: boolean, message: string): void { if (!value) throw new Error(message); }
const actor = new GameObject("WaveDemo");
const skeleton = new Skeleton("assets/models/kenney/character-wave-demo.glb");
actor.addBehavior(skeleton);
skeleton.ensureAsset(0);
const player = new AnimationPlayer();
actor.addBehavior(player); player.mount();
check(skeleton.boneCount() === 8, "modelo tem 8 ossos");
check(player.play("Wave", true), "clipe Wave disponível");
check(Math.abs(player.duration() - 3.8) < 1e-5, "duração 3,8 s");
const arm = skeleton.boneIndex("arm-right") * 4;
player.seek(0);
const manual = JSON.stringify(skeleton.toData());
check(Math.abs(skeleton.poseR[arm + 2]) < 1e-6, "braço começa em repouso");
player.seek(0.9);
check(Math.abs(skeleton.poseR[arm + 2] - Math.sin(-145 * Math.PI / 360)) < 1e-5, "braço levantado na chave de 0,9 s");
const raised = skeleton.poseR[arm + 2];
player.seek(1.2);
check(Math.abs(skeleton.poseR[arm + 2] - raised) > 0.05, "aceno muda a orientação");
player.pause();
const paused = player.time;
player.update(0.5);
check(player.time === paused, "pausa preserva tempo");
player.resume(); player.update(0.1);
check(Math.abs(player.time - paused - 0.1) < 1e-6, "retoma e avança");
player.seek(3.79); player.update(0.02);
check(player.time < 0.02 && player.playing, "laço volta ao início");
check(JSON.stringify(skeleton.toData()) === manual, "reproduzir não altera a pose salva");
io.print("[PASSOU] Wave: 8 ossos, 3,8 s, chave, aceno, pausa, retomada, laço e pose salva");

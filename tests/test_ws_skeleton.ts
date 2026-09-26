import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { cmdAddSkel, cmdBones, cmdPose, cmdResetPose, cmdAnims, cmdAnim } from "@editor/control/commands/skeleton";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
scene.clear(); scene.add(new GameObject("heroi"));
check(cmdAddSkel(["addskel", "0", "assets/models/kenney/character-a.glb"]).indexOf("[ok]") === 0, "addskel");
const b = cmdBones(["bones", "0"]); check(b.indexOf("arm-right") > 0 && b.indexOf("(pai") > 0, "bones lista com pais: " + b);
check(cmdPose(["pose", "0", "torso", "rot", "90", "0", "0"]).indexOf("[ok]") === 0, "pose por nome");
check(cmdPose(["pose", "0", "99", "rot", "0", "0", "0"]).indexOf("[erro]") === 0, "osso invalido = erro");
check(cmdResetPose(["resetpose", "0"]).indexOf("[ok]") === 0, "resetpose");
check(cmdAnims(["anims", "0"]).indexOf("walk") > 0, "anims lista walk");
check(cmdAnim(["anim", "0", "play", "walk", "loop"]).indexOf("[ok]") === 0, "anim play");
check(cmdAnim(["anim", "0", "play", "corrida"]).indexOf("[erro]") === 0, "clipe inexistente = erro legivel");
check(cmdAnim(["anim", "0", "seek", "0.3"]).indexOf("[ok]") === 0, "seek");
const st = cmdAnim(["anim", "0", "state"]); check(st.indexOf("walk") > 0 && st.indexOf("0.3") > 0, "state: " + st);
check(cmdAnim(["anim", "5", "state"]).indexOf("[erro]") === 0, "objeto invalido = erro");
io.print("[PASSOU] ws skeleton: addskel, bones, pose, resetpose, anims, anim");

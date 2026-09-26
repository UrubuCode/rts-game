import io from "@compat/io.ts";
import { scene } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { cmdAddSkel, cmdBones, cmdPose, cmdResetPose, cmdAnims, cmdAnim } from "@editor/control/commands/skeleton";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
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

// fade e speed: [ok] + o state reflete o clipe/velocidade novos
check(cmdAnim(["anim", "0", "fade", "idle", "0.2"]).indexOf("[ok]") === 0, "fade");
const stFade = cmdAnim(["anim", "0", "state"]);
check(stFade.indexOf("clip=idle") > 0, "state depois do fade mostra o clipe novo: " + stFade);
check(cmdAnim(["anim", "0", "speed", "2.5"]).indexOf("[ok]") === 0, "speed");
const stSpeed = cmdAnim(["anim", "0", "state"]);
check(stSpeed.indexOf("speed=2.50") > 0, "state mostra a velocidade nova: " + stSpeed);

// pose sem modo: erro nomeia o argumento que falta, nao "undefined"
const poseSemModo = cmdPose(["pose", "0", "torso"]);
check(poseSemModo.indexOf("[erro]") === 0 && poseSemModo.indexOf("undefined") < 0, "pose sem modo nomeia o que falta: " + poseSemModo);

// undo/redo: `anim ... state` é CONSULTA (não pode empilhar snapshot nem
// zerar o redo); `anim ... play` é mutação de verdade (deve empilhar).
history.u = []; history.r = [];
history.snapshot();   // estado com redo != vazio, pra provar que "state" nao zera
history.undo();
const undoDepthAntes = history.undoDepth();
const redoDepthAntes = history.redoDepth();
check(redoDepthAntes > 0, "setup: precisa ter algo no redo antes do teste");
execCommand(800, 600, "anim 0 state");
check(history.undoDepth() === undoDepthAntes && history.redoDepth() === redoDepthAntes,
  "anim ... state nao muda undo/redo (undo=" + history.undoDepth() + " redo=" + history.redoDepth() + ")");
execCommand(800, 600, "anim 0 play walk");
check(history.undoDepth() === undoDepthAntes + 1 && history.redoDepth() === 0,
  "anim ... play empilha snapshot e zera o redo (undo=" + history.undoDepth() + " redo=" + history.redoDepth() + ")");

io.print("[PASSOU] ws skeleton: addskel, bones, pose, resetpose, anims, anim, fade, speed, undo/redo de anim state vs play");

import io from "@compat/io.ts";
import { scene, S } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { cmdAddSkel, cmdBones, cmdPose, cmdResetPose, cmdSelBone, cmdAnims, cmdAnim } from "@editor/control/commands/skeleton";
import { execCommand } from "@editor/control/dispatch";
import { history } from "@editor/undo";
import { previewIsPlaying, previewTick } from "@editor/skeleton_preview";
import { AnimationPlayer } from "@engine/core/animation_player";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
scene.clear(); scene.add(new GameObject("heroi"));
check(cmdAddSkel(["addskel", "0", "assets/models/kenney/character-a.glb"]).indexOf("[ok]") === 0, "addskel");
const b = cmdBones(["bones", "0"]); check(b.indexOf("arm-right") > 0 && b.indexOf("(pai") > 0, "bones lista com pais: " + b);
check(cmdPose(["pose", "0", "torso", "rot", "90", "0", "0"]).indexOf("[ok]") === 0, "pose por nome");
check(cmdPose(["pose", "0", "99", "rot", "0", "0", "0"]).indexOf("[erro]") === 0, "osso invalido = erro");
check(cmdResetPose(["resetpose", "0"]).indexOf("[ok]") === 0, "resetpose");
// turn/shift: o mesmo caminho do gizmo (eixo e deslocamento de MUNDO)
check(cmdPose(["pose", "0", "arm-right", "turn", "y", "30"]).indexOf("[ok]") === 0, "pose turn");
check(cmdPose(["pose", "0", "arm-right", "turn", "w", "30"]).indexOf("[erro]") === 0, "turn com eixo invalido = erro");
check(cmdPose(["pose", "0", "arm-right", "shift", "0", "0.1", "0"]).indexOf("[ok]") === 0, "pose shift");
check(cmdPose(["pose", "0", "arm-right", "shift", "0", "x", "0"]).indexOf("[erro]") === 0, "shift nao numerico = erro");
check(cmdResetPose(["resetpose", "0"]).indexOf("[ok]") === 0, "resetpose depois de turn/shift");
// selbone: exige o objeto selecionado; -1 devolve o gizmo ao objeto
S.selected = 5;
check(cmdSelBone(["selbone", "0", "arm-right"]).indexOf("[erro]") === 0, "selbone sem o objeto selecionado = erro");
S.selected = 0;
const selMsg = cmdSelBone(["selbone", "0", "arm-right"]);
check(selMsg.indexOf("[ok]") === 0 && selMsg.indexOf("arm-right") > 0 && S.selectedBone > 0, "selbone por nome: " + selMsg);
check(cmdSelBone(["selbone", "0", "nada"]).indexOf("[erro]") === 0, "selbone osso invalido = erro");
check(cmdSelBone(["selbone", "0", "-1"]).indexOf("[ok]") === 0 && S.selectedBone === 0 - 1, "selbone -1 volta ao objeto");
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

// prévia do Inspector: `anim ... preview` não empilha undo (só trocar o clipe) e
// não liga o campo salvo `playing`.
const apPrev = scene.objects[0].behaviors[scene.objects[0].behaviors.length - 1] as AnimationPlayer;
apPrev.pause(); apPrev.playing = false;
history.u = []; history.r = [];
const undoPrev = history.undoDepth();
check(execCommand(800, 600, "anim 0 preview play").indexOf("[ok]") === 0, "preview play do clipe atual");
check(history.undoDepth() === undoPrev, "preview play sem troca de clipe nao cria undo");
check(execCommand(800, 600, "anim 0 state").indexOf("previa=tocando") > 0, "state mostra a previa tocando");
previewTick(0.1);
check(apPrev.playing === false, "a previa nao liga o campo salvo playing");
const outroClipe = apPrev.clip === "walk" ? "idle" : "walk";
check(execCommand(800, 600, "anim 0 preview play " + outroClipe).indexOf("[ok]") === 0 && apPrev.clip === outroClipe, "preview play troca o clipe");
check(history.undoDepth() === undoPrev + 1, "trocar o clipe pela previa empilha 1 undo");
check(execCommand(800, 600, "anim 0 preview seek 0.2").indexOf("[ok]") === 0, "preview seek");
check(execCommand(800, 600, "anim 0 preview stop").indexOf("[ok]") === 0 && !previewIsPlaying(apPrev), "preview stop");
check(history.undoDepth() === undoPrev + 1, "seek/stop da previa nao criam undo");
check(execCommand(800, 600, "anim 0 preview play nada").indexOf("[erro]") === 0, "clipe inexistente = erro");
S.simulating = 1;
check(execCommand(800, 600, "anim 0 preview play").indexOf("[erro] a previa so existe fora do Play") === 0, "preview no Play = erro legivel");
S.simulating = 0;
io.print("[PASSOU] ws skeleton: addskel, bones, pose, resetpose, anims, anim, fade, speed, undo/redo de anim state vs play, preview");

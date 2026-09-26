// Teste SEM JANELA do nível 2 do editor de ossos: posicionar ossos pelo gizmo
// (matemática em bone_gizmo.ts) e pelos campos numéricos do Inspector, com
// Desfazer/Refazer, salvar → carregar e Rodar (cópia sem compartilhar arrays).
//
//   rts.exe run tests/test_skeleton_pose_undo.ts
import io from "@compat/io.ts";
import fs from "@compat/fs.ts";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { playMode } from "@editor/play_mode";
import { saveScene, loadSceneFrom } from "@editor/sceneio";
import { previewStart, previewTick, previewIsTouched, previewIsPlaying } from "@editor/skeleton_preview";
import { rotateBoneWorldAxis, moveBoneWorld, boneWorldOriginInto, boneRotationFromDegreesInto,
  boneDegreesInto, boneEditTarget, beginBoneEdit } from "@editor/bone_gizmo";
import { quatMulInto } from "@engine/render/quat";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer } from "@engine/core/animation_player";
import { EditorControl } from "@editor/ui_controls";
import { cmdPose } from "@editor/control/commands/skeleton";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function near(a: f64, b: f64, eps: f64): boolean { return Math.abs(a - b) <= eps; }
/// Mesma rotação (q e -q representam a mesma).
function sameRot(a: Float64Array, ao: number, b: Float64Array, bo: number): boolean {
  const dot = a[ao] * b[bo] + a[ao + 1] * b[bo + 1] + a[ao + 2] * b[bo + 2] + a[ao + 3] * b[bo + 3];
  return Math.abs(Math.abs(dot) - 1.0) < 1e-9;
}

class TestApp {
  _win: number = 0;
  focus: number = -1;
  clickId: number = -1;
  setFocus(id: number): void { this.focus = id; }
  isFocused(id: number): boolean { return this.focus === id; }
  textField(id: number, x: number, y: number, width: number, value: string, enabled: boolean): string { return value; }
  clickable(id: number, x: number, y: number, width: number, height: number): number { return id === this.clickId ? 3 : 0; }
  checkbox(x: number, y: number, value: number, label: string): number { return value; }
  box(x: number, y: number, width: number, height: number, fill: number, border: number, stroke: number, radius: number): void {}
  text(x: number, y: number, value: string, color: number, font: number): void {}
  line(x0: number, y0: number, x1: number, y1: number, w: number, c: number): void {}
}

const PANEL_H = 4000;
const SAVE_PATH = "build/test-skeleton-pose-undo.json";
scene.clear();
history.u = []; history.r = [];
const object = scene.createGameObject("Heroi");
const sk = new Skeleton("assets/models/kenney/character-a.glb");
object.addBehavior(sk);
const player = new AnimationPlayer();
object.addBehavior(player);
player.mount();
sk.ensureAsset(0);
check(sk.asset !== null, "modelo carregado");
const arm = sk.boneIndex("arm-right");
check(arm >= 0, "osso arm-right existe");
const torso = sk.asset!.boneParent[arm];
check(torso >= 0, "arm-right tem pai");

// ── 1) conversão graus ↔ quaternion (mesma convenção do `pose rot` do WS) ──
const q = new Float64Array(4);
const deg = new Float64Array(3);
boneRotationFromDegreesInto(q, 30.0, 20.0, 0.0 - 40.0);
boneDegreesInto(deg, q, 0);
check(near(deg[0], 30.0, 1e-9) && near(deg[1], 20.0, 1e-9) && near(deg[2], 0.0 - 40.0, 1e-9),
  "graus → quaternion → graus volta igual (veio " + deg[0] + " " + deg[1] + " " + deg[2] + ")");
check(cmdPose(["pose", "0", "arm-right", "rot", "30", "20", "-40"]).indexOf("[ok]") === 0, "pose rot pelo WS");
check(sameRot(sk.manualR, arm * 4, q, 0), "WS `pose rot` e o helper do Inspector dão o mesmo quaternion");
sk.resetPose();

// ── 2) girar em torno do Y de MUNDO com o pai girado 90° em X ──
// Deixa a rotação de MUNDO do pai exatamente Rx(90°): local do pai =
// conj(mundo do avô) · Rx(90°).
sk.compose();
const gp = sk.asset!.boneParent[torso];
const grand = new Float64Array(4);
if (gp >= 0) { grand[0] = sk.worldR[gp * 4]; grand[1] = sk.worldR[gp * 4 + 1]; grand[2] = sk.worldR[gp * 4 + 2]; grand[3] = sk.worldR[gp * 4 + 3]; }
else { grand[0] = 0.0; grand[1] = 0.0; grand[2] = 0.0; grand[3] = 1.0; }   // host sem yaw
grand[0] = 0.0 - grand[0]; grand[1] = 0.0 - grand[1]; grand[2] = 0.0 - grand[2];
const rx90 = new Float64Array(4);
rx90[0] = Math.sin(Math.PI / 4.0); rx90[1] = 0.0; rx90[2] = 0.0; rx90[3] = Math.cos(Math.PI / 4.0);
const torsoLocal = new Float64Array(4);
quatMulInto(torsoLocal, grand, rx90);
sk.setBoneRotation(torso, torsoLocal);
sk.compose();
check(sameRot(sk.worldR, torso * 4, rx90, 0), "setup: mundo do pai = Rx(90°)");
const l0 = new Float64Array(4);
l0[0] = sk.manualR[arm * 4]; l0[1] = sk.manualR[arm * 4 + 1]; l0[2] = sk.manualR[arm * 4 + 2]; l0[3] = sk.manualR[arm * 4 + 3];
const worldBefore = new Float64Array(4);
worldBefore[0] = sk.worldR[arm * 4]; worldBefore[1] = sk.worldR[arm * 4 + 1]; worldBefore[2] = sk.worldR[arm * 4 + 2]; worldBefore[3] = sk.worldR[arm * 4 + 3];
const angle: f64 = 0.5;
rotateBoneWorldAxis(sk, arm, 0.0, 1.0, 0.0, angle);
// Y de mundo no espaço do pai Rx(90°) = conj(Rx90)·Y = -Z → local = Rz(-0.5)·l0
const expectedDelta = new Float64Array(4);
expectedDelta[0] = 0.0; expectedDelta[1] = 0.0; expectedDelta[2] = 0.0 - Math.sin(angle / 2.0); expectedDelta[3] = Math.cos(angle / 2.0);
const expectedLocal = new Float64Array(4);
quatMulInto(expectedLocal, expectedDelta, l0);
check(sameRot(sk.manualR, arm * 4, expectedLocal, 0),
  "girar no Y de mundo com o pai Rx(90°) = girar em -Z local do pai (veio " +
  sk.manualR[arm * 4] + " " + sk.manualR[arm * 4 + 1] + " " + sk.manualR[arm * 4 + 2] + " " + sk.manualR[arm * 4 + 3] + ")");
check(sameRot(sk.poseR, arm * 4, expectedLocal, 0), "a pose de trabalho acompanha a manual");
check(sk.overrideMask[arm] !== 0, "o osso girado entra na pose manual");
sk.compose();
const ry = new Float64Array(4);
ry[0] = 0.0; ry[1] = Math.sin(angle / 2.0); ry[2] = 0.0; ry[3] = Math.cos(angle / 2.0);
const expectedWorld = new Float64Array(4);
quatMulInto(expectedWorld, ry, worldBefore);
check(sameRot(sk.worldR, arm * 4, expectedWorld, 0), "no mundo, o osso girou em torno do Y de mundo");

// ── 3) mover no mundo com o pai girado: delta de mundo exato ──
const origin = new Float64Array(3);
check(boneWorldOriginInto(origin, sk, arm) !== 0, "origem do gizmo = posição de mundo do osso");
const ox = origin[0]; const oy = origin[1]; const oz = origin[2];
check(near(ox, sk.worldT[arm * 3], 1e-12) && near(oy, sk.worldT[arm * 3 + 1], 1e-12), "origem = worldT");
object.transform.sx = 2.0; object.transform.sy = 2.0; object.transform.sz = 2.0;   // escala do host divide o delta
boneWorldOriginInto(origin, sk, arm);
const sx0 = origin[0]; const sy0 = origin[1]; const sz0 = origin[2];
moveBoneWorld(sk, arm, 0.1, 0.2, 0.0 - 0.3);
boneWorldOriginInto(origin, sk, arm);
check(near(origin[0] - sx0, 0.1, 1e-9) && near(origin[1] - sy0, 0.2, 1e-9) && near(origin[2] - sz0, 0.0 - 0.3, 1e-9),
  "mover no mundo desloca o osso exatamente o delta (veio " + (origin[0] - sx0) + " " + (origin[1] - sy0) + " " + (origin[2] - sz0) + ")");
object.transform.sx = 1.0; object.transform.sy = 1.0; object.transform.sz = 1.0;
sk.resetPose();

// ── 4) editar um osso com a prévia tocando: a prévia para (pose manual aparece) ──
check(player.clipNames().indexOf("walk") >= 0, "o modelo tem walk");
player.clip = "walk"; player.onValidate("clip");
previewStart(player);
previewTick(0.2);
check(previewIsPlaying(player), "setup: prévia tocando");
check(boneEditTarget(object, arm) === sk, "alvo de edição = Skeleton do objeto");
check(boneEditTarget(object, 999) === null && boneEditTarget(object, 0 - 1) === null, "osso inválido não é alvo");
beginBoneEdit(sk);
check(!previewIsPlaying(player) && !previewIsTouched(player), "editar o osso encerra a prévia daquele objeto");

// ── 5) Inspector: campos numéricos do osso → 1 snapshot → desfazer/refazer ──
S.selected = 0; S.selection = [0];
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;
function render(mx: number, my: number, down: number, pressed: number): void {
  inspector.render(app, 0, 0, 290, PANEL_H, mx, my, down, pressed, false, 0, 0);
}
function control(name: string): EditorControl {
  const index = inspector.ui.names.indexOf(name);
  check(index >= 0, "controle ausente: " + name);
  return inspector.ui.controls[index];
}
render(-1, -1, 0, 0);
app.clickId = control("Skeleton/Bone/" + arm).id; render(-1, -1, 0, 0); app.clickId = -1;
check(S.selectedBone === arm, "clique no osso seleciona arm-right");
render(-1, -1, 0, 0);
const pitchField = control("Skeleton/BoneRotation/P");
const px = pitchField.host.px + 2; const py = pitchField.host.py + 2;
history.u = []; history.r = [];
const rotBefore = new Float64Array(4);
rotBefore[0] = sk.manualR[arm * 4]; rotBefore[1] = sk.manualR[arm * 4 + 1]; rotBefore[2] = sk.manualR[arm * 4 + 2]; rotBefore[3] = sk.manualR[arm * 4 + 3];
boneDegreesInto(deg, sk.manualR, arm * 4);
const pitch0 = deg[1];
// arrasta a aba do campo Pitch 1000 px → +20° (0,02°/px, o scrub dos campos numéricos)
render(px, py, 1, 1);
render(px + 1000, py, 1, 0);
render(px + 1000, py, 0, 0);
boneDegreesInto(deg, sk.manualR, arm * 4);
check(near(deg[1], pitch0 + 20.0, 1e-6), "o campo Pitch gira o osso (+20°, veio " + (deg[1] - pitch0) + ")");
check(sk.overrideMask[arm] !== 0, "a edição do Inspector entra na pose manual");
check(history.undoDepth() === 1, "a edição do Inspector empilha 1 snapshot (veio " + history.undoDepth() + ")");
const rotEdited = new Float64Array(4);
rotEdited[0] = sk.manualR[arm * 4]; rotEdited[1] = sk.manualR[arm * 4 + 1]; rotEdited[2] = sk.manualR[arm * 4 + 2]; rotEdited[3] = sk.manualR[arm * 4 + 3];
// posição pelo campo X
const posField = control("Skeleton/BonePosition/X");
const tx0 = sk.manualT[arm * 3];
render(posField.host.px + 2, posField.host.py + 2, 1, 1);
render(posField.host.px + 52, posField.host.py + 2, 1, 0);
render(posField.host.px + 52, posField.host.py + 2, 0, 0);
check(near(sk.manualT[arm * 3], tx0 + 1.0, 1e-6), "o campo X move o osso (veio " + (sk.manualT[arm * 3] - tx0) + ")");
check(history.undoDepth() === 2, "a edição de posição empilha outro snapshot");
check(history.undo() === 1, "desfaz a posição");
check(history.undo() === 1, "desfaz a rotação");
let skU = boneEditTarget(scene.objects[0], arm);
check(skU !== null, "o objeto desfeito tem Skeleton");
skU!.ensureAsset(0);
check(sameRot(skU!.manualR, arm * 4, rotBefore, 0), "desfazer volta a rotação de antes");
check(near(skU!.manualT[arm * 3], tx0, 1e-12), "desfazer volta a posição de antes");
check(history.redo() === 1, "refaz a rotação");
skU = boneEditTarget(scene.objects[0], arm);
skU!.ensureAsset(0);
check(sameRot(skU!.manualR, arm * 4, rotEdited, 0), "refazer devolve a rotação editada");
check(skU!.overrideMask[arm] !== 0, "refazer devolve o override");

// ── 6) gizmo: um arrasto = 1 snapshot, desfazer volta ──
history.u = []; history.r = [];
const skG = skU!;
const gBefore = new Float64Array(4);
gBefore[0] = skG.manualR[arm * 4]; gBefore[1] = skG.manualR[arm * 4 + 1]; gBefore[2] = skG.manualR[arm * 4 + 2]; gBefore[3] = skG.manualR[arm * 4 + 3];
history.snapshot();   // o main tira 1 snapshot no começo do arrasto, não por frame
beginBoneEdit(skG);
let frame = 0;
while (frame < 10) { rotateBoneWorldAxis(skG, arm, 1.0, 0.0, 0.0, 0.05); frame = frame + 1; }
check(!sameRot(skG.manualR, arm * 4, gBefore, 0), "o arrasto girou o osso");
check(history.undoDepth() === 1, "10 frames de arrasto = 1 snapshot");
history.undo();
const skG2 = boneEditTarget(scene.objects[0], arm)!;
skG2.ensureAsset(0);
check(sameRot(skG2.manualR, arm * 4, gBefore, 0), "desfazer o arrasto volta a pose de antes");

// ── 7) salvar → carregar preserva a pose manual ──
rotateBoneWorldAxis(skG2, arm, 0.0, 0.0, 1.0, 0.7);
skG2.setBonePosition(arm, 0.25, 0.5, 0.75);
const savedR = new Float64Array(4);
savedR[0] = skG2.manualR[arm * 4]; savedR[1] = skG2.manualR[arm * 4 + 1]; savedR[2] = skG2.manualR[arm * 4 + 2]; savedR[3] = skG2.manualR[arm * 4 + 3];
check(saveScene(SAVE_PATH) > 0, "salvou a cena temporária");
scene.clear();
loadSceneFrom(SAVE_PATH);
const skL = boneEditTarget(scene.objects[0], arm);
check(skL !== null || scene.objects.length > 0, "carregou");
const loadedSk = scene.objects[0].behaviors[0] instanceof Skeleton ? scene.objects[0].behaviors[0] as Skeleton : null;
check(loadedSk !== null, "o objeto carregado tem Skeleton");
loadedSk!.ensureAsset(0);
check(sameRot(loadedSk!.manualR, arm * 4, savedR, 0), "carregar preserva a rotação manual");
check(near(loadedSk!.manualT[arm * 3], 0.25, 1e-12) && near(loadedSk!.manualT[arm * 3 + 2], 0.75, 1e-12), "carregar preserva a posição manual");
check(loadedSk!.overrideMask[arm] !== 0, "carregar preserva o override");
check(sameRot(loadedSk!.poseR, arm * 4, savedR, 0), "carregar aplica a pose manual na pose de trabalho");
fs.remove_file(SAVE_PATH);

// ── 8) Rodar copia a pose sem compartilhar arrays ──
history.u = []; history.r = [];
S.selected = 0; S.selection = [0];
check(playMode.play(), "Rodar funciona com Skeleton posado");
const runtimeSk = scene.objects[0].behaviors[0] as Skeleton;
check(runtimeSk !== loadedSk, "a simulação tem outro Skeleton");
runtimeSk.ensureAsset(0);
check(runtimeSk.manualR !== loadedSk!.manualR && runtimeSk.poseR !== loadedSk!.poseR &&
  runtimeSk.manualT !== loadedSk!.manualT && runtimeSk.overrideMask !== loadedSk!.overrideMask, "arrays da pose não são compartilhados");
check(sameRot(runtimeSk.manualR, arm * 4, savedR, 0), "a cópia tem a pose posada");
rotateBoneWorldAxis(runtimeSk, arm, 0.0, 1.0, 0.0, 1.0);
check(sameRot(loadedSk!.manualR, arm * 4, savedR, 0), "mexer na cópia não mexe no original");
playMode.stop();
check(scene.objects[0].behaviors[0] === loadedSk, "Parar devolve o original");
check(sameRot(loadedSk!.manualR, arm * 4, savedR, 0), "o original continua com a pose de antes");

// ── 9) Resetar pose no Inspector: repouso e fim da prévia daquele player ──
S.selected = 0; S.selection = [0];
const player2 = scene.objects[0].behaviors[1] as AnimationPlayer;
const inspector2 = new Inspector(app);
inspector2.transformOpen = false;
inspector2.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0);
previewStart(player2);
previewTick(0.1);
check(previewIsTouched(player2), "setup: prévia mexendo no player");
const resetIndex = inspector2.ui.names.indexOf("Skeleton/Reset");
check(resetIndex >= 0, "botão Resetar pose");
app.clickId = inspector2.ui.controls[resetIndex].id;
inspector2.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0);
app.clickId = -1;
check(loadedSk!.overrideMask[arm] === 0, "Resetar pose esquece a pose manual");
check(!previewIsTouched(player2) && !previewIsPlaying(player2), "Resetar pose tira o player da prévia");
check(sameRot(loadedSk!.poseR, arm * 4, loadedSk!.asset!.restR, arm * 4), "Resetar pose deixa a pose de trabalho em repouso");

io.print("[PASSOU] pose de ossos: graus<->quaternion, gizmo no espaço do pai, prévia encerrada, Inspector, desfazer/refazer, salvar/carregar, Rodar");

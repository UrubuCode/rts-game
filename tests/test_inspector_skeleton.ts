// Teste SEM JANELA da seção "Esqueleto" do Inspector: monta a seção com a
// UIScene do Inspector e simula cliques (clipe, osso, tocar/pausar, parar,
// arrastar o tempo, resetar pose). Mesmo padrão de test_inspector_text.ts.
//
//   rts.exe run tests/test_inspector_skeleton.ts
import io from "@compat/io.ts";
import { Inspector } from "@editor/inspector";
import { scene, S } from "@editor/control/session";
import { history } from "@editor/undo";
import { previewIsPlaying, previewStart, previewTick } from "@editor/skeleton_preview";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer } from "@engine/core/animation_player";
import { EditorControl } from "@editor/ui_controls";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

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
}

const PANEL_H = 4000;   // alto o bastante para a seção inteira caber sem rolagem
scene.clear();
history.u = []; history.r = [];
const object = scene.createGameObject("Heroi");
const sk = new Skeleton("assets/models/kenney/character-a.glb");
object.addBehavior(sk);
const player = new AnimationPlayer();
object.addBehavior(player);
player.mount();
S.selected = 0; S.selection = [0];
const app = new TestApp();
const inspector = new Inspector(app);
inspector.transformOpen = false;

function render(): void { inspector.render(app, 0, 0, 290, PANEL_H, -1, -1, 0, 0, false, 0, 0); }
function control(name: string): EditorControl {
  const index = inspector.ui.names.indexOf(name);
  check(index >= 0, "controle ausente: " + name);
  return inspector.ui.controls[index];
}
function click(name: string): void { app.clickId = control(name).id; render(); app.clickId = -1; render(); }

render();
check(sk.asset !== null, "o Inspector carrega o modelo do Skeleton");
const clips = player.clipNames();
check(clips.length > 0, "o modelo tem clipes");
const walk = clips.indexOf("walk");
check(walk >= 0, "o modelo tem o clipe walk");

// 1) clicar num clipe troca AnimationPlayer.clip e empilha 1 undo
const undoBefore = history.undoDepth();
click("Skeleton/Clip/" + walk);
check(player.clip === "walk", "clique no clipe troca AnimationPlayer.clip (veio '" + player.clip + "')");
check(history.undoDepth() === undoBefore + 1, "escolher o clipe empilha exatamente 1 undo");
check(player.playing === false, "escolher o clipe não liga o campo salvo `playing`");

// 2) clicar num osso seleciona S.selectedBone
const head = sk.boneIndex("head");
click("Skeleton/Bone/" + head);
check(S.selectedBone === head, "clique no osso seleciona S.selectedBone (veio " + S.selectedBone + ")");

// 3) tocar/pausar: prévia do editor, sem undo e sem mexer no campo salvo
const undoPlay = history.undoDepth();
click("Skeleton/Play");
check(previewIsPlaying(player), "Tocar liga a prévia");
check(player.playing === false, "a prévia não liga o campo salvo `playing`");
previewTick(0.1);
check(player.time > 0.0, "a prévia avança o tempo (veio " + player.time + ")");
check(player.playing === false, "o tick da prévia não deixa `playing` ligado");
click("Skeleton/Play");
check(!previewIsPlaying(player), "Pausar desliga a prévia");
const pausedAt = player.time;
previewTick(0.1);
check(player.time === pausedAt, "pausado, o tempo não anda");
check(history.undoDepth() === undoPlay, "tocar/pausar não cria undo");

// 4) arrastar o tempo = seek (sem undo)
const bar = control("Skeleton/Time");
const barX = bar.host.px; const barY = bar.host.py; const barW = bar.host.sx; const barH = bar.host.sy;
const dur = player.duration();
check(dur > 0.0, "clipe walk tem duração");
inspector.render(app, 0, 0, 290, PANEL_H, barX + barW * 0.5, barY + barH * 0.5, 1, 1, false, 0, 0);
inspector.render(app, 0, 0, 290, PANEL_H, barX + barW * 0.25, barY + barH * 0.5, 1, 0, false, 0, 0);
check(Math.abs(player.time - dur * 0.25) < dur * 0.02, "arrastar o tempo faz seek (esperado " + dur * 0.25 + ", veio " + player.time + ")");
inspector.render(app, 0, 0, 290, PANEL_H, barX + barW * 0.25, barY + barH * 0.5, 0, 0, false, 0, 0);
check(history.undoDepth() === undoPlay, "arrastar o tempo não cria undo");

// 5) Parar volta a pose de trabalho à pose manual
const rot = new Float64Array(4); rot[1] = Math.sin(0.4); rot[3] = Math.cos(0.4);
sk.setBoneRotation(head, rot);
previewStart(player); previewTick(0.2);
click("Skeleton/Stop");
check(!previewIsPlaying(player), "Parar desliga a prévia");
check(Math.abs(sk.poseR[head * 4 + 1] - rot[1]) < 1e-9, "Parar restaura a pose manual na pose de trabalho");

// 6) Resetar pose: pose manual limpa + 1 undo
const undoReset = history.undoDepth();
click("Skeleton/Reset");
check(sk.overrideMask[head] === 0, "Resetar pose limpa a pose manual");
check(history.undoDepth() === undoReset + 1, "Resetar pose empilha 1 undo");

// 7) trocar a seleção zera o osso selecionado e para a prévia
previewStart(player);
const other = scene.createGameObject("Outro");
S.selected = scene.objects.indexOf(other); S.selection = [S.selected];
render();
check(S.selectedBone === 0 - 1, "trocar a seleção zera S.selectedBone");
check(!previewIsPlaying(player), "trocar a seleção para a prévia");
// 8) raio de culling do Skeleton: cobre o personagem a partir dos pés (a
// cabeça fica em y 1.9 no repouso) e some quando o Skeleton sai do objeto.
check(object.boundRadius >= 1.9, "boundRadius cobre o personagem (veio " + object.boundRadius + ")");
object.removeBehavior(object.behaviors.indexOf(sk));
check(object.boundRadius === 0.0, "sem Skeleton, o objeto volta ao raio da malha");
io.print("[PASSOU] Inspector: esqueleto (clipe, osso, tocar/pausar, tempo, parar, resetar pose, raio de culling)");

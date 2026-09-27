// Teste HEADLESS dos comandos WS `animator <obj> load|set|trigger|state|params`
// (src/editor/control/commands/animator.ts) e da prévia do Animator fora do
// Play (skeleton_preview.ts): undo só no `load`, cena salva intocada pela
// prévia, `previewStopAll` restaurando parâmetros e pose manual.
//
//   rts.exe run tests/test_ws_animator.ts
import io from "@compat/io.ts";
import { scene, S } from "@editor/control/session";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { Animator } from "@engine/core/animator";
import { execCommand } from "@editor/control/dispatch";
import fs from "@compat/fs.ts";
import { history } from "@editor/undo";
import { sceneToJSON } from "@editor/sceneio";
import { animatorOfObject, animatorPreviewIsActive, previewTick, previewStopAll, previewFrame } from "@editor/skeleton_preview";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function ws(line: string): string { return execCommand(800, 600, line); }

const CTRL = "assets/animators/personagem.controller.json";
const DT: f64 = 1.0 / 60.0;
scene.clear();
history.u = []; history.r = [];
const o = new GameObject("heroi"); scene.add(o);
let sk = new Skeleton("assets/models/kenney/character-a.glb"); sk.ensureAsset(0);
let an = new Animator(); an.controller = CTRL;
o.addBehavior(sk); o.addBehavior(an); an.mount();
scene.add(new GameObject("vazio"));

// 1) consultas
const st0 = ws("animator 0 state");
check(st0.indexOf("[animator] #0") === 0 && st0.indexOf("Base: Locomocao") > 0 && st0.indexOf("Braco: Segurando") > 0, "state inicial: " + st0);
check(st0.indexOf("previa=nao") > 0, "sem previa antes de mexer: " + st0);
const pr0 = ws("animator 0 params");
check(pr0.indexOf("[params] #0 3") === 0 && pr0.indexOf("velocidade float 0.00") > 0 &&
  pr0.indexOf("morto bool false") > 0 && pr0.indexOf("tiro trigger desarmado") > 0, "params: " + pr0);
check(ws("animator 1 state").indexOf("[erro] objeto sem Animator") === 0, "objeto sem Animator = erro");
check(ws("animator 9 state").indexOf("[erro] objeto invalido") === 0, "objeto invalido = erro");
check(ws("animator 0 voar").indexOf("[erro] subcomando") === 0, "subcomando invalido = erro");

// 2) set/trigger + validação; nada disso empilha undo nem zera o redo
history.u = []; history.r = [];
history.snapshot(); history.undo();
const u0 = history.undoDepth(); const r0 = history.redoDepth();
check(r0 > 0, "setup: redo nao vazio");
// o undo recriou os objetos da cena: pega o Animator/Skeleton restaurados
an = animatorOfObject(scene.objects[0])!;
sk = scene.objects[0].behaviors[0] as Skeleton;
check(an.controller === CTRL && an.errorText() === "", "Animator restaurado pelo undo funciona: " + an.errorText());
const salvaAntes = sceneToJSON();
check(ws("animator 0 set velocidade 2").indexOf("[ok] animator set velocidade 2.00") === 0, "set float");
check(an.getFloat("velocidade") === 2.0, "set float aplicou");
check(animatorPreviewIsActive(an), "set fora do Play inicia a previa");
check(ws("animator 0 set velocidade rapido").indexOf("[erro]") === 0, "float nao numerico = erro");
check(ws("animator 0 set morto talvez").indexOf("[erro]") === 0, "bool invalido = erro");
check(ws("animator 0 set tiro 1").indexOf("[erro]") === 0, "set em trigger = erro (use trigger)");
check(ws("animator 0 set nada 1").indexOf("[erro] parametro inexistente") === 0, "parametro inexistente = erro");
check(ws("animator 0 trigger velocidade").indexOf("[erro]") === 0, "trigger em float = erro");
check(ws("animator 0 trigger tiro").indexOf("[ok]") === 0 && an.getBool("tiro"), "trigger arma");
ws("animator 0 state"); ws("animator 0 params");
check(history.undoDepth() === u0 && history.redoDepth() === r0,
  "set/trigger/state/params nao mexem no undo/redo (undo=" + history.undoDepth() + " redo=" + history.redoDepth() + ")");

// 3) a prévia avança o Animator a cada frame (fora do Play) sem mudar a cena salva
previewTick(DT);
check(an.stateName(1) === "Atirando" && !an.getBool("tiro"), "previa avancou: trigger consumido, Braco em Atirando");
const t1 = an.stateTime(0);
previewFrame(DT);
check(an.stateTime(0) > t1, "previewFrame avanca o tempo do Animator fora do Play");
check(ws("animator 0 set morto true").indexOf("[ok] animator set morto true") === 0, "set bool");
previewTick(DT);
const stFade = ws("animator 0 state");
check(stFade.indexOf("Base: Morto") > 0 && stFade.indexOf("fade de Locomocao") > 0 && stFade.indexOf("previa=sim") > 0, "state mostra transicao e fade: " + stFade);
let k = 0; while (k < 30) { previewTick(DT); k = k + 1; }
check(sceneToJSON() === salvaAntes, "a previa nao muda a cena salva");
// a pose de trabalho foi mexida pela prévia (difere da manual)
let dif: f64 = 0.0; let i = 0;
while (i < sk.poseR.length) { dif = dif + Math.abs(sk.poseR[i] - sk.manualR[i]); i = i + 1; }
check(dif > 1e-3, "a previa escreve a pose de trabalho");

// 4) previewStopAll: parâmetros/estados de volta ao início, pose = manual
previewStopAll();
check(!animatorPreviewIsActive(an), "previa encerrada");
check(an.getFloat("velocidade") === 0.0 && !an.getBool("morto") && an.stateName(0) === "Locomocao" && an.stateTime(0) === 0.0,
  "encerrar a previa volta parametros e estados ao inicio");
dif = 0.0; i = 0;
while (i < sk.poseR.length) { dif = dif + Math.abs(sk.poseR[i] - sk.manualR[i]); i = i + 1; }
check(dif === 0.0, "encerrar a previa devolve a pose manual");

// 5) no Play, set não abre prévia (o scene.update roda o Animator)
S.simulating = 1;
check(ws("animator 0 set velocidade 1").indexOf("[ok]") === 0 && !animatorPreviewIsActive(an), "no Play set nao inicia previa");
S.simulating = 0;
previewStopAll();

// 6) load: muda o campo salvo -> 1 snapshot; undo volta o caminho; erro não troca
const u1 = history.undoDepth();
const loadErr = ws("animator 0 load assets/animators/nao-existe.controller.json");
check(loadErr.indexOf("[erro] controlador nao carregou") === 0 && loadErr.indexOf("nao-existe") > 0, "load inexistente = erro legivel: " + loadErr);
check(an.controller === CTRL && an.errorText() === "", "load com erro mantem o controlador anterior funcionando: " + an.errorText());
check(history.undoDepth() === u1, "load com erro nao empilha undo");
check(ws("animator 0 load " + CTRL).indexOf("[ok] animator load") === 0, "load ok");
check(history.undoDepth() === u1, "load do MESMO caminho (so relê o arquivo) nao empilha undo");
check(ws("animator 0 load").indexOf("[erro]") === 0, "load sem caminho = erro");
// outro controlador válido: 1 snapshot; undo volta ao primeiro caminho
const OUTRO = "assets/animators/_teste_ws_outro.controller.json";
fs.write(OUTRO, "{\"parametros\":[{\"nome\":\"rapidez\",\"tipo\":\"float\"}],\"camadas\":[{\"nome\":\"Base\",\"inicial\":\"Parado\"," +
  "\"estados\":[{\"nome\":\"Parado\",\"clipe\":\"idle\"}]}]}");
const okOutro = ws("animator 0 load " + OUTRO);
fs.remove_file(OUTRO);
check(okOutro.indexOf("[ok] animator load") === 0 && okOutro.indexOf("aviso") < 0, "load de outro controlador: " + okOutro);
check(history.undoDepth() === u1 + 1, "load que troca o caminho empilha 1 undo");
check(animatorOfObject(scene.objects[0])!.stateName(0) === "Parado", "o controlador novo esta em uso");
history.undo();
const anR = animatorOfObject(scene.objects[0]);
check(anR !== null && anR.controller === CTRL && anR.stateName(0) === "Locomocao", "undo restaura o primeiro controlador");

// controlador válido num objeto sem Skeleton: fica escolhido, com aviso
const semSk = ws("addcomp 1 Animator");
check(semSk.indexOf("[ok]") === 0, "addcomp Animator no objeto sem Skeleton: " + semSk);
const avisoSk = ws("animator 1 load " + CTRL);
check(avisoSk.indexOf("[ok]") === 0 && avisoSk.indexOf("Skeleton") > 0, "load sem Skeleton = ok com aviso: " + avisoSk);
check(animatorOfObject(scene.objects[1])!.controller === CTRL, "controlador fica escolhido");

// 7) help/doc citam os comandos
check(ws("help").indexOf("animator <obj> trigger") > 0, "help cita animator");
check(ws("doc animator").indexOf("animator <obj> params") >= 0, "doc animator");
io.print("[PASSOU] ws animator: state, params, set, trigger, load, undo so no load, previa fora do Play, previewStopAll");

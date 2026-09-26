// Teste HEADLESS do componente Animator (engine/core/animator.ts) e do leitor
// do controlador (engine/core/animator_controller.ts): carregar o exemplo,
// mistura 1D em fase normalizada, transição com fade, trigger + tempo de
// saída, máscara de ossos, erros legíveis, serialização/cópia, Animator
// vencendo o AnimationPlayer, custo por frame.
//
//   rts.exe run tests/test_animator.ts
import io from "@compat/io.ts";
import { GameObject } from "@engine/core/gameobject";
import { Skeleton } from "@engine/core/skeleton";
import { AnimationPlayer, sampleClipInto } from "@engine/core/animation_player";
import { Animator } from "@engine/core/animator";
import { loadAnimatorController, registerAnimatorController } from "@engine/core/animator_controller";
import { quatNlerpInto } from "@engine/render/quat";
import { componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

const MODELO = "assets/models/kenney/character-a.glb";
const CTRL = "assets/animators/personagem.controller.json";
const DT: f64 = 1.0 / 60.0;

function personagem(nome: string, ctrl: string): Animator {
  const g = new GameObject(nome);
  const sk = new Skeleton(MODELO); sk.ensureAsset(0);
  const an = new Animator(); an.controller = ctrl;
  g.addBehavior(sk); g.addBehavior(an); an.mount();
  return an;
}
function skOf(an: Animator): Skeleton { return an.owner!.behaviors[0] as Skeleton; }
function frac(x: f64): f64 { return x - Math.floor(x); }

// esqueleto auxiliar para as poses esperadas (amostradas "à mão")
const aux = new Skeleton(MODELO); aux.ensureAsset(0);
const clips = aux.asset!.clips;
function durOf(nome: string): f64 { return clips[aux.asset!.clipIndex(nome)].duration; }
function rotEsperada(nome: string, t: f64, bone: number, out: Float64Array): void {
  aux.applyManualPose();
  sampleClipInto(aux, clips[aux.asset!.clipIndex(nome)], t, 1.0);
  out[0] = aux.poseR[bone * 4]; out[1] = aux.poseR[bone * 4 + 1]; out[2] = aux.poseR[bone * 4 + 2]; out[3] = aux.poseR[bone * 4 + 3];
}
function rotIgual(sk: Skeleton, bone: number, q: Float64Array, msg: string): void {
  const o = bone * 4;
  const d = Math.abs(sk.poseR[o] - q[0]) + Math.abs(sk.poseR[o + 1] - q[1]) + Math.abs(sk.poseR[o + 2] - q[2]) + Math.abs(sk.poseR[o + 3] - q[3]);
  check(d < 1e-6, msg + " (dif " + d + ": " + sk.poseR[o] + "," + sk.poseR[o + 1] + "," + sk.poseR[o + 2] + "," + sk.poseR[o + 3] +
    " esperado " + q[0] + "," + q[1] + "," + q[2] + "," + q[3] + ")");
}
function rotDif(sk: Skeleton, bone: number, q: Float64Array): f64 {
  const o = bone * 4;
  return Math.abs(sk.poseR[o] - q[0]) + Math.abs(sk.poseR[o + 1] - q[1]) + Math.abs(sk.poseR[o + 2] - q[2]) + Math.abs(sk.poseR[o + 3] - q[3]);
}

const armL = aux.boneIndex("arm-left");
const armR = aux.boneIndex("arm-right");
const qA = new Float64Array(4); const qB = new Float64Array(4); const qM = new Float64Array(4);

// 1) carrega o exemplo: 3 parâmetros, 2 camadas, estados iniciais
{
  const c = loadAnimatorController(CTRL);
  check(c.error === "", "o exemplo carrega sem erro: " + c.error);
  check(c.paramNames.length === 3, "3 parametros");
  check(c.layerNames.length === 2, "2 camadas");
  check(loadAnimatorController(CTRL) === c, "controlador em cache por caminho (mesma instancia)");
  const an = personagem("p1", CTRL);
  check(an.errorText() === "", "animator sem erro: " + an.errorText());
  check(an.layerCount() === 2, "layerCount 2");
  check(an.stateName(0) === "Locomocao" && an.stateName(1) === "Segurando", "iniciais: " + an.stateName(0) + "/" + an.stateName(1));
  check(an.paramIndex("velocidade") === 0 && an.paramIndex("tiro") === 2 && an.paramIndex("nada") === 0 - 1, "paramIndex");
  check(an.getFloat("velocidade") === 0.0 && an.getBool("morto") === false, "padroes dos parametros");
}

// 2) mistura 1D: 0 = idle, 2 = walk, 1 = 50/50 (fase normalizada comum), 10 = grampeia em sprint
{
  const an = personagem("p2", CTRL); const sk = skOf(an);
  an.setFloat("velocidade", 0.0); an.update(0.1); an.update(0.13);
  check(an.stateTime(0) > 0.0, "o tempo normalizado avanca");
  let p = frac(an.stateTime(0));
  rotEsperada("idle", p * durOf("idle"), armL, qA);
  rotIgual(sk, armL, qA, "velocidade 0 = idle");

  an.setFloat("velocidade", 2.0); an.update(0.07);
  p = frac(an.stateTime(0));
  rotEsperada("walk", p * durOf("walk"), armL, qA);
  rotIgual(sk, armL, qA, "velocidade 2 = walk");

  an.setFloat("velocidade", 1.0); an.update(0.05);
  p = frac(an.stateTime(0));
  rotEsperada("idle", p * durOf("idle"), armL, qA);
  rotEsperada("walk", p * durOf("walk"), armL, qB);
  quatNlerpInto(qM, qA, qB, 0.5);
  rotIgual(sk, armL, qM, "velocidade 1 = nlerp 50/50 de idle e walk na mesma fase");

  // a fase avança pela duração misturada: lerp(dur idle, dur walk, 0.5)
  const antes = an.stateTime(0);
  an.update(0.1);
  const esperado = 0.1 / (durOf("idle") * 0.5 + durOf("walk") * 0.5);
  check(Math.abs(an.stateTime(0) - antes - esperado) < 1e-9, "fase avanca por dt / duracao misturada");

  an.setFloat("velocidade", 10.0); an.update(0.05);
  p = frac(an.stateTime(0));
  rotEsperada("sprint", p * durOf("sprint"), armL, qA);
  rotIgual(sk, armL, qA, "velocidade 10 grampeia em sprint");
}

// 3) bool morto -> Morto com fade 0,15: no meio, nlerp das duas; depois só Morto; não volta
{
  const an = personagem("p3", CTRL); const sk = skOf(an);
  an.setFloat("velocidade", 10.0); an.update(0.2);
  const s0 = an.stateTime(0);
  an.setBool("morto", true);
  check(an.getBool("morto"), "getBool depois de setBool");
  an.update(0.075);
  check(an.stateName(0) === "Morto", "transicao para Morto: " + an.stateName(0));
  an.update(0.075);   // metade do fade de 0,15
  // saída continua avançando (0,15 s desde s0) e ENVOLVE (sprint tem laço)
  rotEsperada("sprint", frac(s0 + 0.15 / durOf("sprint")) * durOf("sprint"), armL, qA);
  rotEsperada("die", 0.075, armL, qB);
  quatNlerpInto(qM, qA, qB, 0.5);
  rotIgual(sk, armL, qM, "meio do fade = nlerp(sprint avancando, die) em 0,5");
  check(rotDif(sk, armL, qA) > 1e-3 && rotDif(sk, armL, qB) > 1e-3, "no meio do fade a pose esta entre as duas");
  an.update(0.1);
  rotEsperada("die", 0.175, armL, qB);
  rotIgual(sk, armL, qB, "fade concluido: so die");
  an.setBool("morto", false);
  let k = 0; while (k < 60) { an.update(DT); k = k + 1; }
  check(an.stateName(0) === "Morto", "nao volta de Morto");
  rotEsperada("die", durOf("die"), armL, qB);
  rotIgual(sk, armL, qB, "clipe sem laco grampeia no ultimo quadro");
}

// 4) trigger tiro: Braco -> Atirando; no fim do clipe (saida 1.0) volta; trigger consumido
{
  const an = personagem("p4", CTRL);
  an.update(DT);
  an.setTrigger("tiro");
  check(an.getBool("tiro"), "trigger armado");
  an.update(DT);
  check(an.stateName(1) === "Atirando", "tiro -> Atirando: " + an.stateName(1));
  check(!an.getBool("tiro"), "trigger consumido pela transicao");
  let quadros = 0;
  while (an.stateName(1) === "Atirando" && quadros < 100) { an.update(DT); quadros = quadros + 1; }
  const durTiro = durOf("holding-right-shoot");
  check(an.stateName(1) === "Segurando", "volta a Segurando depois do fim do clipe");
  check(quadros * DT >= durTiro - DT - 1e-9 && quadros * DT <= durTiro + 2.0 * DT, "volta perto do fim do clipe (saida 1.0): " + (quadros * DT));
  // trigger armado fica armado ate ser consumido (como a Unity)
  const an2 = personagem("p4b", CTRL);
  an2.update(DT);
  an2.setTriggerAt(an2.paramIndex("tiro"));
  an2.resetTrigger("tiro");
  check(!an2.getBool("tiro"), "resetTrigger desarma");
  an2.update(DT);
  check(an2.stateName(1) === "Segurando", "trigger desarmado nao dispara a transicao");
}

// 5) máscara: Braco só mexe em arm-right; o resto igual a um controlador só com a Base
registerAnimatorController("mem:so-base.controller.json",
  "{\"parametros\":[{\"nome\":\"velocidade\",\"tipo\":\"float\",\"padrao\":0},{\"nome\":\"morto\",\"tipo\":\"bool\"},{\"nome\":\"tiro\",\"tipo\":\"trigger\"}]," +
  "\"camadas\":[{\"nome\":\"Base\",\"inicial\":\"Locomocao\",\"estados\":[{\"nome\":\"Locomocao\",\"mistura\":{\"param\":\"velocidade\"," +
  "\"clipes\":[[\"idle\",0],[\"walk\",2],[\"sprint\",5]]}},{\"nome\":\"Morto\",\"clipe\":\"die\",\"laco\":false}]," +
  "\"transicoes\":[{\"de\":\"*\",\"para\":\"Morto\",\"quando\":[[\"morto\",\"==\",true]],\"fade\":0.15}]}]}");
{
  const com = personagem("m1", CTRL); const so = personagem("m2", "mem:so-base.controller.json");
  check(so.errorText() === "", "controlador em memoria carrega: " + so.errorText());
  com.setFloat("velocidade", 1.3); so.setFloat("velocidade", 1.3);
  let k = 0; while (k < 20) { com.update(DT); so.update(DT); k = k + 1; }
  const a = skOf(com); const b = skOf(so);
  let bone = 0; let diffOutros: f64 = 0.0;
  while (bone < a.boneCount()) {
    if (bone !== armR) {
      let j = 0;
      while (j < 4) { diffOutros = diffOutros + Math.abs(a.poseR[bone * 4 + j] - b.poseR[bone * 4 + j]); j = j + 1; }
      j = 0;
      while (j < 3) { diffOutros = diffOutros + Math.abs(a.poseT[bone * 3 + j] - b.poseT[bone * 3 + j]) + Math.abs(a.poseS[bone * 3 + j] - b.poseS[bone * 3 + j]); j = j + 1; }
    }
    bone = bone + 1;
  }
  check(diffOutros < 1e-9, "Braco nao mexe em ossos fora da mascara: " + diffOutros);
  qA[0] = b.poseR[armR * 4]; qA[1] = b.poseR[armR * 4 + 1]; qA[2] = b.poseR[armR * 4 + 2]; qA[3] = b.poseR[armR * 4 + 3];
  check(rotDif(a, armR, qA) > 1e-3, "Braco muda arm-right");
  rotEsperada("holding-right", 20.0 * DT - Math.floor(20.0 * DT / durOf("holding-right")) * durOf("holding-right"), armR, qB);
  rotIgual(a, armR, qB, "arm-right = holding-right (peso 1)");
}

// 6) erros legíveis, componente inerte, sem exceção no update
function erroDe(nome: string, json: string, trecho: string): void {
  registerAnimatorController(nome, json);
  const an = personagem("e-" + nome, nome); const sk = skOf(an);
  sk.applyManualPose();
  const antes = sk.poseR[armL * 4];
  an.update(DT); an.update(DT);
  check(an.errorText().indexOf(trecho) >= 0, nome + ": erro legivel com '" + trecho + "': " + an.errorText());
  check(sk.poseR[armL * 4] === antes, nome + ": componente inerte (pose intocada)");
  check(an.stateName(0) === "" && an.layerCount() === 0, nome + ": sem estado");
  an.setFloat("velocidade", 1.0); an.setTrigger("tiro");   // nao quebra
}
erroDe("mem:clipe.json", "{\"parametros\":[],\"camadas\":[{\"nome\":\"B\",\"inicial\":\"X\",\"estados\":[{\"nome\":\"X\",\"clipe\":\"voar\"}]}]}", "voar");
erroDe("mem:json.json", "{ isto nao e json", "JSON");
erroDe("mem:estado.json", "{\"parametros\":[],\"camadas\":[{\"nome\":\"B\",\"inicial\":\"Y\",\"estados\":[{\"nome\":\"X\",\"clipe\":\"idle\"}]}]}", "Y");
erroDe("mem:trans.json", "{\"parametros\":[],\"camadas\":[{\"nome\":\"B\",\"inicial\":\"X\",\"estados\":[{\"nome\":\"X\",\"clipe\":\"idle\"}]," +
  "\"transicoes\":[{\"de\":\"X\",\"para\":\"Z\",\"saida\":1}]}]}", "Z");
erroDe("mem:param.json", "{\"parametros\":[],\"camadas\":[{\"nome\":\"B\",\"inicial\":\"X\",\"estados\":[{\"nome\":\"X\",\"mistura\":{\"param\":\"rapidez\",\"clipes\":[[\"idle\",0]]}}]}]}", "rapidez");
erroDe("mem:osso.json", "{\"parametros\":[],\"camadas\":[{\"nome\":\"B\",\"inicial\":\"X\",\"mascara\":[\"asa\"],\"estados\":[{\"nome\":\"X\",\"clipe\":\"idle\"}]}]}", "asa");
{
  const an = personagem("e-arquivo", "assets/animators/nao-existe.controller.json");
  an.update(DT);
  check(an.errorText().indexOf("nao-existe") >= 0, "arquivo inexistente: erro legivel: " + an.errorText());
}
{
  const g = new GameObject("sem-sk"); const an = new Animator(); an.controller = CTRL; g.addBehavior(an); an.mount();
  an.update(DT);
  check(an.errorText().indexOf("Skeleton") >= 0, "sem Skeleton: erro legivel: " + an.errorText());
}

// 7) serialização e cópia: componentToData -> recreateBehavior funciona; cópia não compartilha estado
{
  const orig = personagem("s1", CTRL);
  orig.setFloat("velocidade", 3.0); orig.update(DT);
  const dados = componentToData(orig);
  check(dados.fields.controller === CTRL, "controller vai para a cena");
  const copia = recreateBehavior(dados) as Animator;
  const g = new GameObject("s2"); const sk = new Skeleton(MODELO); sk.ensureAsset(0);
  g.addBehavior(sk); g.addBehavior(copia); copia.mount();
  copia.update(DT);
  check(copia.errorText() === "" && copia.stateName(0) === "Locomocao", "copia restaurada funciona");
  check(copia.getFloat("velocidade") === 0.0, "parametros sao estado de execucao (copia comeca do padrao)");
  copia.setFloat("velocidade", 7.0); copia.setBool("morto", true); copia.update(DT);
  check(orig.getFloat("velocidade") === 3.0 && !orig.getBool("morto") && orig.stateName(0) === "Locomocao",
    "copia nao compartilha parametros/estados com o original");
}

// 8) Animator vence o AnimationPlayer do mesmo objeto (player inerte); desligado, o player volta
{
  const g = new GameObject("ambos"); const sk = new Skeleton(MODELO); sk.ensureAsset(0);
  const ap = new AnimationPlayer(); const an = new Animator(); an.controller = CTRL;
  g.addBehavior(sk); g.addBehavior(ap); g.addBehavior(an); ap.mount(); an.mount();
  ap.play("walk", true);
  const ref = personagem("ref", CTRL);
  let k = 0;
  while (k < 10) { ap.update(DT); an.update(DT); ap.update(DT); ref.update(DT); k = k + 1; }
  const r = skOf(ref);
  qM[0] = r.poseR[armL * 4]; qM[1] = r.poseR[armL * 4 + 1]; qM[2] = r.poseR[armL * 4 + 2]; qM[3] = r.poseR[armL * 4 + 3];
  rotIgual(sk, armL, qM,
    "com Animator, o AnimationPlayer fica inerte (pose = so Animator)");
  an.enabled = 0;
  ap.seek(0.1667);
  rotEsperada("walk", 0.1667, armL, qA);
  rotIgual(sk, armL, qA, "Animator desligado: o player volta a escrever a pose");
}

// 9) custo: 17 personagens x 2 camadas (mistura de 3 clipes + braço), update + compose
const lista: Animator[] = []; const esqs: Skeleton[] = [];
let n = 0;
while (n < 17) { const an = personagem("c" + n, CTRL); an.setFloat("velocidade", 0.5 + n * 0.25); lista.push(an); esqs.push(skOf(an)); n = n + 1; }
let aq = 0; while (aq < 200) { n = 0; while (n < 17) { lista[n].update(DT); esqs[n].compose(); n = n + 1; } aq = aq + 1; }
const vi = lista[3].paramIndex("velocidade");
const t0 = performance.now(); let f = 0;
while (f < 1000) {
  n = 0;
  while (n < 17) { const an = lista[n]; an.setFloatAt(vi, 0.5 + ((f + n) % 20) * 0.25); an.update(DT); esqs[n].compose(); n = n + 1; }
  f = f + 1;
}
const ms = (performance.now() - t0) / 1000.0;
io.print("  17 personagens com Animator (2 camadas): " + ms.toFixed(3) + " ms/frame");
check(ms <= 0.35, "17 Animators <= 0,35 ms/frame: " + ms);
io.print("[PASSOU] animator: exemplo, mistura 1D, fade, trigger/saida, mascara, erros, copia, vence o player, custo");

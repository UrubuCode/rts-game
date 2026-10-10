import { SceneLoadOperation } from "@engine/core/scene_loading";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import fs from "@compat/fs.ts";
import time from "@compat/time.ts";

// A carga assíncrona monta os componentes na thread principal, e o orçamento
// por tick é o que mantém a janela viva. Este teste trava o contrato dessa
// montagem: ordem, divisão por componente, cessão explícita, cancelamento,
// erro e reentrância.
//
// Cada um desses casos veio de uma forma diferente de publicar cena pela
// metade ou de montar o mesmo componente duas vezes.
function check(ok: boolean, label: string): void { if (!ok) throw new Error(label); }

let order = "";
let slowCalls = 0;
let steps = 0;
let mode = "normal";
let current: SceneLoadOperation | null = null;

/** Componente legado: só `mount()`, e demora o bastante para estourar o tick. */
class SlowMount extends Behavior {
  label: string;
  constructor(label: string) { super(); this.label = label; }
  mount(): void {
    slowCalls++; order += this.label; time.sleep_ms(2);
    if (mode === "cancel" && current !== null) current.cancel();
    if (mode === "reenter" && current !== null) current.tick(1);
    if (mode === "fail") throw new Error("mount hook failure");
  }
}

/** Componente cooperativo: três passos, um por tick. */
class CooperativeMount extends Behavior {
  steps: number = 0;
  mount(): void { throw new Error("o hook cooperativo caiu no mount síncrono"); }
  mountStep(budgetMs: number): boolean {
    check(budgetMs > 0 && budgetMs <= 16, "orçamento restante inválido: " + budgetMs);
    this.steps++; steps++;
    // Uma mudança feita AQUI tem de aparecer nos transforms da cena publicada.
    this.host.py = this.steps;
    if (mode === "cooperative-fail" && this.steps === 2) throw new Error("cooperative hook failure");
    if (mode === "cooperative-cancel" && this.steps === 2 && current !== null) current.cancel();
    return this.steps === 3;
  }
}

fs.write("build/async-mount-test.json", JSON.stringify({
  objects: [{ name: "empty" }, { name: "a" }, { name: "b" }],
}));

function factory(data: any): GameObject {
  const o = new GameObject(data.name);
  if (data.name !== "empty") {
    o.addBehavior(new SlowMount(data.name + "1"));
    // Componente DESABILITADO também monta, como em GameObject.mount().
    const disabled = new SlowMount(data.name + "2"); disabled.enabled = 0; o.addBehavior(disabled);
    if (mode.indexOf("cooperative") === 0 || mode === "external-cancel") o.addBehavior(new CooperativeMount());
  }
  return o;
}

function run(m: string): SceneLoadOperation {
  mode = m; order = ""; slowCalls = 0; steps = 0;
  const op = new SceneLoadOperation("build/async-mount-test.json", factory);
  current = op;
  const deadline = Date.now() + 30000;
  let progress = 0;
  while (!op.done && Date.now() < deadline) {
    const callsBefore = slowCalls;
    const stepsBefore = steps;
    op.tick(0.25);
    check(slowCalls - callsBefore <= 1, "dois hooks lentos no mesmo tick orçado");
    check(steps - stepsBefore <= 1, "o hook cooperativo não cedeu a vez");
    check(op.progress >= progress, "o progresso andou para trás");
    progress = op.progress;
    if (!op.done) check(op.result === null, "cena publicada pela metade");
    if (m === "external-cancel" && steps === 1) op.cancel();
    time.sleep_ms(1);
  }
  check(op.done, "a operação não terminou no prazo");
  return op;
}

const normal = run("normal");
check(normal.state === "ready" && order === "a1a2b1b2", "ordem de montagem ou componente desabilitado: " + order);

const cooperative = run("cooperative");
check(cooperative.state === "ready" && steps === 6 && slowCalls === 4,
  "conclusão cooperativa ou mount exatamente-uma-vez (passos=" + steps + ", mounts=" + slowCalls + ")");
check(cooperative.result !== null && cooperative.result.objects[2].transform.wy === 3,
  "o que o hook cooperativo mudou não chegou nos transforms");

const insideCancel = run("cancel");
check(insideCancel.state === "cancelled" && insideCancel.result === null && slowCalls === 1,
  "cancelar de dentro do hook continuou montando ou publicou a cena");

const outsideCancel = run("external-cancel"); outsideCancel.tick(16);
check(outsideCancel.state === "cancelled" && outsideCancel.result === null && steps === 1,
  "cancelamento externo e o hook cooperativo voltou a trabalhar");

const failed = run("fail");
check(failed.state === "failed" && failed.result === null &&
  failed.error.indexOf("mount hook failure") >= 0 && slowCalls === 1,
  "erro no mount continuou o trabalho");

const reentrant = run("reenter");
check(reentrant.state === "ready" && order === "a1a2b1b2", "tick reentrante repetiu hooks: " + order);

const coopFailure = run("cooperative-fail");
check(coopFailure.state === "failed" && coopFailure.result === null &&
  coopFailure.error.indexOf("cooperative hook failure") >= 0 && steps === 2 && slowCalls === 2,
  "erro no hook cooperativo continuou o trabalho");

const coopCancel = run("cooperative-cancel");
check(coopCancel.state === "cancelled" && coopCancel.result === null && steps === 2 && slowCalls === 2,
  "cancelar de dentro do hook cooperativo continuou o trabalho");

println("PASS scene-mount: orçamento por componente, ordem, desabilitados, passos cooperativos, cancelamento, erro e reentrância");

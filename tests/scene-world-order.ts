// `computeWorld` com a hierarquia FORA DE ORDEM (filho antes do pai).
//
// A versão anterior repetia passadas sobre a cena inteira enquanto sobrasse
// algum pendente: com o filho sempre antes do pai isso é quadrático. O sintoma
// não é um erro de pose, é o editor engasgando numa cena grande reparenteada,
// e por isso nenhum teste de corretude o pegava.
//
// O limite de tempo abaixo é folgado de propósito: a separação entre linear e
// quadrático nesta contagem é de três ordens de grandeza, então ele acusa a
// regressão sem ficar sensível à carga da máquina.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass = pass + 1; io.print("  ok   " + name); }
  else { fail = fail + 1; io.print("  FALHOU   " + name); }
}

const CHAIN = 20000;
const BUDGET_MS = 2000.0;

// Cadeia de CHAIN objetos, cada um filho do SEGUINTE: o pai de todo objeto tem
// índice maior que o dele, que é o pior caso para o laço de passadas.
function buildReversedChain(): Scene {
  const sc = new Scene("cadeia invertida");
  let i = 0;
  while (i < CHAIN) {
    const go = new GameObject("no-" + i);
    go.transform.setPosition(0, 1, 0);
    sc.add(go, false);
    i = i + 1;
  }
  i = 0;
  while (i < CHAIN) { sc.objects[i].parent = i === CHAIN - 1 ? 0 - 1 : i + 1; i = i + 1; }
  return sc;
}

const reversed = buildReversedChain();
const t0 = performance.now();
reversed.computeWorld();
const firstMs = performance.now() - t0;
// O objeto 0 está no fim da cadeia: a altura dele é a soma de todos os pais.
ok("cadeia invertida: pose propagada ate a ponta (wy=" + reversed.objects[0].transform.wy + ")",
  reversed.objects[0].transform.wy === CHAIN);
ok("cadeia invertida: " + firstMs.toFixed(1) + " ms para " + CHAIN + " objetos (limite " + BUDGET_MS + " ms)",
  firstMs < BUDGET_MS);

// Segundo quadro: o carimbo tem de invalidar tudo de novo, senão a cadeia
// ficaria com a pose do quadro anterior.
reversed.objects[CHAIN - 1].transform.setPosition(0, 2, 0);
const t1 = performance.now();
reversed.computeWorld();
const secondMs = performance.now() - t1;
ok("segundo quadro repropaga (wy=" + reversed.objects[0].transform.wy + ")",
  reversed.objects[0].transform.wy === CHAIN + 1);
ok("segundo quadro: " + secondMs.toFixed(1) + " ms (limite " + BUDGET_MS + " ms)", secondMs < BUDGET_MS);

// Cadeia em ordem (pai antes do filho): o caminho rápido de uma passada.
const ordered = new Scene("cadeia em ordem");
let i = 0;
while (i < CHAIN) {
  const go = new GameObject("no-" + i);
  go.transform.setPosition(0, 1, 0);
  ordered.add(go, false);
  i = i + 1;
}
i = 0;
while (i < CHAIN) { ordered.objects[i].parent = i - 1; i = i + 1; }
ordered.computeWorld();
ok("cadeia em ordem: pose propagada (wy=" + ordered.objects[CHAIN - 1].transform.wy + ")",
  ordered.objects[CHAIN - 1].transform.wy === CHAIN);

// Ciclo: uma hierarquia mal editada não pode virar laço infinito. O objeto em
// ciclo mantém a última pose de mundo, como antes.
const cyclic = new Scene("ciclo");
i = 0;
while (i < 3) {
  const go = new GameObject("ciclo-" + i);
  go.transform.setPosition(0, 1, 0);
  cyclic.add(go, false);
  i = i + 1;
}
i = 0;
while (i < 3) { cyclic.objects[i].parent = (i + 1) % 3; i = i + 1; }
const t2 = performance.now();
cyclic.computeWorld();
ok("ciclo nao trava (" + (performance.now() - t2).toFixed(2) + " ms)", performance.now() - t2 < BUDGET_MS);

// Vários ramos partindo de uma raiz comum, fora de ordem: cada cadeia tem de
// ser resolvida uma vez, sem uma atrapalhar a outra.
const branches = new Scene("ramos");
const BRANCH_COUNT = 50;
const BRANCH_LEN = 40;
i = 0;
while (i < BRANCH_COUNT * BRANCH_LEN + 1) {
  const go = new GameObject("ramo-" + i);
  go.transform.setPosition(0, 1, 0);
  branches.add(go, false);
  i = i + 1;
}
const ROOT = BRANCH_COUNT * BRANCH_LEN;   // a raiz é o ÚLTIMO índice
branches.objects[ROOT].parent = 0 - 1;
let b = 0;
while (b < BRANCH_COUNT) {
  let d = 0;
  while (d < BRANCH_LEN) {
    const idx = b * BRANCH_LEN + d;
    branches.objects[idx].parent = d === BRANCH_LEN - 1 ? ROOT : idx + 1;
    d = d + 1;
  }
  b = b + 1;
}
branches.computeWorld();
let deepest = 0;
let allRight = true;
while (deepest < BRANCH_COUNT) {
  if (branches.objects[deepest * BRANCH_LEN].transform.wy !== BRANCH_LEN + 1) allRight = false;
  deepest = deepest + 1;
}
ok("ramos: " + BRANCH_COUNT + " cadeias de " + BRANCH_LEN + " sob uma raiz comum", allRight);

io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

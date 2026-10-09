// Corrotinas estilo Unity sobre async/await (engine/core/coroutine_scheduler.ts).
//
// Cada `scene.update(dt)` conta como UM quadro simulado (é a mesma chamada
// que os behaviors recebem). `await coroutineResume()` é o checkpoint que de
// fato roda os corpos das corrotinas prontas — sem ele os temporizadores
// descontam mas ninguém retoma (ver o cabeçalho de coroutine_scheduler.ts).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { coroutineActiveCount, coroutineActiveByOwner, coroutineResume } from "@engine/core/coroutine_scheduler";
import { logCountAtLeast, LOG_ERROR } from "@engine/core/logger";

let pass = 0; let fail = 0;
function ok(n: string, c: boolean): void {
  if (c) { pass = pass + 1; io.print("  [ok] " + n); }
  else { fail = fail + 1; io.print("  [FALHOU] " + n); }
}
const FDT: f64 = 1.0 / 60.0;

/// Um passo simulado completo: conta (Scene.update) e retoma (checkpoint).
async function passo(scene: Scene, dt: f64): Promise<void> {
  scene.update(dt);
  await coroutineResume();
}

class Marcador extends Behavior {
  marcas: string[] = [];
  handle: number = 0 - 1;
  marcar(s: string): void { this.marcas.push(s); }
}

function novaCena(): { scene: Scene; go: GameObject; b: Marcador } {
  const scene = new Scene("t");
  const go = new GameObject("alvo");
  const b = new Marcador();
  go.addBehavior(b);
  scene.add(go);
  return { scene, go, b };
}

// ── esperar(segundos): tempo de JOGO — descontado a cada scene.update ──────
async function testeEsperar(): Promise<void> {
  io.print("== esperar(segundos): tempo de jogo ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { b.marcar("antes"); await b.waitForSeconds(0.04); b.marcar("depois"); });
  ok("corpo roda sincrono ate o 1o await", b.marcas.length === 1 && b.marcas[0] === "antes");
  // 0.04s < 2*FDT (0.0333) mas >= o que sobra depois do 2o passo: acorda no 3o.
  await passo(scene, FDT);
  await passo(scene, FDT);
  ok("nao retomou antes do tempo passar", b.marcas.length === 1);
  await passo(scene, FDT);
  ok("retomou no quadro em que o tempo se esgotou", b.marcas.length === 2 && b.marcas[1] === "depois");
}

// ── esperar respeita PAUSA (scene.update simplesmente não é chamado) ──────
async function testePausa(): Promise<void> {
  io.print("== esperar respeita pausa (scene.update nao chamado) ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { await b.waitForSeconds(0.016); b.marcar("acordou"); });
  // "pausado": nenhum scene.update roda por 10 "quadros" de wall-clock (só o
  // checkpoint, sem contar tempo) — o Play pausado é exatamente "não chamar
  // scene.update"; aqui simulamos chamando só o checkpoint, sem update.
  let i = 0;
  while (i < 10) { await coroutineResume(); i = i + 1; }
  ok("nao acordou sem nenhum scene.update (pausa)", b.marcas.length === 0);
  await passo(scene, FDT);
  ok("acorda assim que volta a rodar", b.marcas.length === 1);
}

// ── timescale: mais/menos tempo de jogo por segundo real (via dt maior) ────
async function testeTimescale(): Promise<void> {
  io.print("== timescale (dt escalado, como stepsFor ja faz) ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { await b.waitForSeconds(0.05); b.marcar("acordou"); });
  // timescale=2: o dt de CADA passo fixo dobra na pratica porque o
  // stepsFor roda o DOBRO de passos por segundo real — aqui simulamos
  // diretamente com dt dobrado, que e o efeito observavel em esperar().
  // 2 passos de 2*FDT (~0.0333 cada) somam ~0.0667 > 0.05: dobra a
  // velocidade de quem esperava ~3 passos em tempo real (1x).
  await passo(scene, FDT * 2.0);
  await passo(scene, FDT * 2.0);
  ok("dt escalado (timescale) acelera o tempo de jogo", b.marcas.length === 1);
}

// ── proximoQuadro / esperarQuadros: contam quadros, nao tempo ─────────────
async function testeQuadros(): Promise<void> {
  io.print("== proximoQuadro / esperarQuadros ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { await b.nextFrame(); b.marcar("q1"); });
  await passo(scene, FDT);
  ok("proximoQuadro retoma no quadro seguinte", b.marcas.length === 1);

  const { scene: s2, b: b2 } = novaCena();
  b2.startCoroutine(async () => { await b2.waitForFrames(3); b2.marcar("q3"); });
  await passo(s2, FDT); await passo(s2, FDT);
  ok("esperarQuadros(3) nao retoma antes de 3 quadros", b2.marcas.length === 0);
  await passo(s2, FDT);
  ok("esperarQuadros(3) retoma no 3o quadro", b2.marcas.length === 1);
}

// ── ate(cond): checada 1x por quadro ───────────────────────────────────────
async function testeAte(): Promise<void> {
  io.print("== ate(cond) ==");
  const { scene, b } = novaCena();
  let porta = 0;
  b.startCoroutine(async () => { await b.waitUntil(() => porta === 1); b.marcar("passou"); });
  await passo(scene, FDT); await passo(scene, FDT);
  ok("nao passa enquanto a condicao for falsa", b.marcas.length === 0);
  porta = 1;
  await passo(scene, FDT);
  ok("passa no quadro em que a condicao virou verdadeira", b.marcas.length === 1);
}

// ── pararCorrotina(handle): so aquela corrotina para ───────────────────────
async function testePararUma(): Promise<void> {
  io.print("== pararCorrotina(handle) ==");
  const { scene, b } = novaCena();
  const hA = b.startCoroutine(async () => { await b.waitForSeconds(1.0); b.marcar("A"); });
  const hB = b.startCoroutine(async () => { await b.waitForSeconds(1.0); b.marcar("B"); });
  b.stopCoroutine(hA);
  await passo(scene, 2.0);
  ok("a corrotina parada nao retomou", b.marcas.indexOf("A") < 0);
  ok("a outra corrotina do mesmo objeto seguiu normal", b.marcas.indexOf("B") >= 0);
  ok("nenhum erro no log (cancelamento e silencioso)", logCountAtLeast(LOG_ERROR) === 0);
  void hB;
}

// ── pararTodasCorrotinas(): todas as do mesmo Behavior ─────────────────────
async function testePararTodas(): Promise<void> {
  io.print("== pararTodasCorrotinas() ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { await b.waitForSeconds(1.0); b.marcar("A"); });
  b.startCoroutine(async () => { await b.waitForSeconds(1.0); b.marcar("B"); });
  b.stopAllCoroutines();
  await passo(scene, 2.0);
  ok("nenhuma das duas retomou", b.marcas.length === 0);
  ok("contagem zerou", coroutineActiveCount() === 0);
  ok("nenhum erro no log", logCountAtLeast(LOG_ERROR) === 0);
}

// ── cancelamento automatico: behavior desligado (enabled=0) ────────────────
async function testeAutoCancelDisable(): Promise<void> {
  io.print("== auto-cancelamento: behavior.enabled = 0 (checado no proximo quadro) ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => { await b.waitForSeconds(0.5); b.marcar("nunca"); });
  b.enabled = 0;
  await passo(scene, 0.6); // desconta o tempo TODO, mas o dono esta desligado
  ok("nao retomou (dono desligado)", b.marcas.length === 0);
  ok("nenhum erro no log", logCountAtLeast(LOG_ERROR) === 0);
}

// ── cancelamento automatico: objeto destruido (Scene.removeAt) ─────────────
async function testeAutoCancelDestroy(): Promise<void> {
  io.print("== auto-cancelamento: Scene.removeAt (destroy) — imediato ==");
  const { scene, go, b } = novaCena();
  b.startCoroutine(async () => { await b.waitForSeconds(0.5); b.marcar("nunca"); });
  scene.removeAt(go.sceneIndex >= 0 ? go.sceneIndex : 0);
  await passo(scene, 0.6);
  ok("nao retomou (objeto destruido)", b.marcas.length === 0);
  ok("nenhum erro no log", logCountAtLeast(LOG_ERROR) === 0);
}

// ── cancelamento automatico: saida do Play (Scene.clear) ───────────────────
async function testeAutoCancelPlayStop(): Promise<void> {
  io.print("== auto-cancelamento: Scene.clear (Play stop) — imediato, sem retomar depois ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => {
    await b.waitForSeconds(0.1);
    // Se isto rodar DEPOIS do clear(), o teste abaixo pega: marcamos e o
    // teste teria que ver "tocou" apos o clear, o que seria o bug (tocar
    // objeto restaurado). Nunca deve chegar aqui.
    b.marcar("nunca-deveria-tocar-original-restaurado");
  });
  scene.clear();   // como playMode.stop() faz antes de restaurar os originais
  await passo(scene, 1.0);   // "outro" scene.update depois do stop, como o proximo quadro do editor
  ok("nunca retomou depois do Play parar", b.marcas.length === 0);
  ok("nenhum erro no log (cancelamento e silencioso)", logCountAtLeast(LOG_ERROR) === 0);
}

// ── muitas corrotinas: custo do tick limitado, sem alocar quando vazio ─────
async function testeMuitas(): Promise<void> {
  io.print("== 1000 corrotinas simultaneas ==");
  const { scene, b } = novaCena();
  let acordadas = 0;
  let i = 0;
  while (i < 1000) {
    b.startCoroutine(async () => { await b.waitForSeconds(0.08); acordadas = acordadas + 1; });
    i = i + 1;
  }
  ok("1000 corrotinas vivas", coroutineActiveCount() === 1000);
  const t0 = performance.now();
  let passos = 0;
  while (passos < 6) { await passo(scene, FDT); passos = passos + 1; }
  const custoMs = performance.now() - t0;
  ok("todas acordaram", acordadas === 1000);
  ok("contagem voltou a 0", coroutineActiveCount() === 0);
  io.print("  6 passos com ate 1000 pendentes: " + custoMs.toFixed(2) + " ms");
  ok("custo do tick com 1000 pendentes fica em ordem de milissegundos (< 200ms)", custoMs < 200.0);
}

// ── reentrancia: uma corrotina que INICIA outra corrotina (currentId nao
// pode se confundir com a corrotina recem-criada, nem antes nem depois do
// 1o await de quem chamou startCoroutine) ─────────────────────────────────
async function testeReentrancia(): Promise<void> {
  io.print("== reentrancia: corrotina que inicia outra corrotina ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => {
    b.marcar("pai-antes");
    // Inicia a FILHA sincronamente, ainda dentro do corpo da pai (antes do
    // 1o await dela) — currentId tem que voltar pra "pai" depois desta
    // chamada, senao o proximo waitFor* da pai seria atribuido a filha.
    b.startCoroutine(async () => {
      b.marcar("filho-antes");
      await b.waitForFrames(1);
      b.marcar("filho-depois");
    });
    await b.waitForFrames(2);
    b.marcar("pai-depois");
  });
  ok("pai e filho rodaram sincrono ate seus 1os awaits", b.marcas.length === 2 &&
    b.marcas[0] === "pai-antes" && b.marcas[1] === "filho-antes");
  await passo(scene, FDT);
  ok("filho (1 quadro) retomou primeiro", b.marcas.indexOf("filho-depois") >= 0 && b.marcas.indexOf("pai-depois") < 0);
  await passo(scene, FDT);
  ok("pai (2 quadros) retomou depois, sem se confundir com o filho", b.marcas.indexOf("pai-depois") >= 0);
  ok("nenhum erro no log", logCountAtLeast(LOG_ERROR) === 0);
}

// ── duas corrotinas de DONOS DIFERENTES prontas no MESMO quadro: cada uma
// tem que ver o proprio currentId ao continuar (nao o da outra) ───────────
async function testeDuasNoMesmoQuadro(): Promise<void> {
  io.print("== duas corrotinas (donos diferentes) retomando no mesmo quadro ==");
  const { scene, go, b } = novaCena();
  const go2 = new GameObject("outro");
  const b2 = new Marcador();
  go2.addBehavior(b2);
  scene.add(go2);
  b.startCoroutine(async () => {
    await b.waitForSeconds(0.02);
    b.marcar("A1");
    await b.waitForFrames(1); // se currentId vazasse pra B, isto acordaria no quadro errado
    b.marcar("A2");
  });
  b2.startCoroutine(async () => {
    await b2.waitForSeconds(0.02);
    b2.marcar("B1");
    await b2.waitForFrames(1);
    b2.marcar("B2");
  });
  await passo(scene, 0.02); // as duas ficam prontas no MESMO quadro
  ok("A1 e B1 rodaram no mesmo quadro, sem se confundir", b.marcas.indexOf("A1") >= 0 && b2.marcas.indexOf("B1") >= 0);
  ok("nenhuma pulou pro 2o estagio cedo demais", b.marcas.indexOf("A2") < 0 && b2.marcas.indexOf("B2") < 0);
  await passo(scene, FDT);
  ok("A2 e B2 retomaram cada uma no seu proprio waitForFrames(1)", b.marcas.indexOf("A2") >= 0 && b2.marcas.indexOf("B2") >= 0);
  ok("nenhum erro no log", logCountAtLeast(LOG_ERROR) === 0);
  void go;
}

// ── excecao NORMAL (nao-cancelamento) no corpo: loga, nao trava o
// escalonador, e outra corrotina independente segue normal ────────────────
async function testeExcecaoNormal(): Promise<void> {
  io.print("== excecao normal (nao-cancelamento) no corpo da corrotina ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => {
    await b.waitForFrames(1);
    throw new Error("bug do usuario");
  });
  b.startCoroutine(async () => { await b.waitForFrames(1); b.marcar("sobrevivente"); });
  const antes = logCountAtLeast(LOG_ERROR);
  await passo(scene, FDT);
  ok("a corrotina que lancou terminou (nao ficou viva)", coroutineActiveCount() === 0);
  ok("a outra corrotina do mesmo quadro nao foi afetada", b.marcas.indexOf("sobrevivente") >= 0);
  ok("o erro FOI logado (nao e cancelamento silencioso)", logCountAtLeast(LOG_ERROR) > antes);
}

// ── waitUntil com predicado que LANÇA: nao pode derrubar o escalonador nem
// as outras corrotinas pendentes ──────────────────────────────────────────
async function testePredicadoLanca(): Promise<void> {
  io.print("== waitUntil(predicado que lanca) nao mata o escalonador ==");
  const { scene, b } = novaCena();
  b.startCoroutine(async () => {
    await b.waitUntil(() => { throw new Error("predicado explodiu"); });
    b.marcar("nunca");
  });
  b.startCoroutine(async () => { await b.waitForFrames(1); b.marcar("outra-sobreviveu"); });
  const antes = logCountAtLeast(LOG_ERROR);
  await passo(scene, FDT);
  ok("a corrotina do predicado que lanca foi cancelada (nao rodou o corpo)", b.marcas.indexOf("nunca") < 0);
  ok("a outra corrotina pendente sobreviveu e rodou", b.marcas.indexOf("outra-sobreviveu") >= 0);
  ok("o erro do predicado foi logado", logCountAtLeast(LOG_ERROR) > antes);
  ok("contagem voltou a 0 (as duas terminaram)", coroutineActiveCount() === 0);
}

// ── memoria: 100k ciclos start/finish nao crescem os arrays paralelos do
// escalonador (slots totalmente liberados, sem vazar handle/owner) ────────
async function testeMemoria100k(): Promise<void> {
  io.print("== memoria: 100k ciclos start/finish sem crescimento ==");
  const { scene, b } = novaCena();
  const N = 100000;
  let terminadas = 0;
  const antes = logCountAtLeast(LOG_ERROR); // testes anteriores ja logaram erro de proposito
  let i = 0;
  while (i < N) {
    b.startCoroutine(async () => { await b.waitForFrames(1); terminadas = terminadas + 1; });
    await passo(scene, FDT);
    i = i + 1;
  }
  ok("todas as 100k terminaram", terminadas === N);
  ok("nenhuma corrotina viva sobrou", coroutineActiveCount() === 0);
  ok("nenhum erro NOVO no log", logCountAtLeast(LOG_ERROR) === antes);
}

// ── contexto/introspeccao: contagem e donos lidos do escalonador ───────────
async function testeIntrospeccao(): Promise<void> {
  io.print("== coroutineActiveCount / coroutineActiveByOwner ==");
  const { scene, go, b } = novaCena();
  go.name = "PortaoTeste";
  b.startCoroutine(async () => { await b.waitForSeconds(1.0); });
  ok("coroutineActiveCount conta 1", coroutineActiveCount() === 1);
  const donos = coroutineActiveByOwner();
  ok("coroutineActiveByOwner aponta o objeto certo", donos.length === 1 && donos[0].name === "PortaoTeste" && donos[0].count === 1);
  scene.clear();
  await passo(scene, 0.01);
}

async function rodarTudo(): Promise<void> {
  await testeEsperar();
  await testePausa();
  await testeTimescale();
  await testeQuadros();
  await testeAte();
  await testePararUma();
  await testePararTodas();
  await testeAutoCancelDisable();
  await testeAutoCancelDestroy();
  await testeAutoCancelPlayStop();
  await testeMuitas();
  await testeReentrancia();
  await testeDuasNoMesmoQuadro();
  await testeExcecaoNormal();
  await testePredicadoLanca();
  await testeMemoria100k();
  await testeIntrospeccao();

  io.print("");
  io.print("[resultado] " + pass + " ok, " + fail + " falhas");
  io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
  if (fail !== 0) throw new Error("Corrotinas: " + fail + " falhas");
}

await rodarTudo();

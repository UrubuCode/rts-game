// Task 9 — prévia de edição: fora do Play, `update(dt)` só avança quando o
// editor diz que o objeto está selecionado (economiza CPU com o efeito
// parado, como a Unity); dentro do Play, avança independente da seleção.
// `componentToData` (`toData()`) fora do Play nunca inclui o pool simulado
// (só configuração) — os campos privados sem `@serializeField` já ficam fora
// da reflexão automática (CLAUDE.md "Criação de objetos"), e o `toData()`
// customizado (Task 8) devolve só bursts/gradiente/curvaTamanho.
import { ParticleSystem, definirConsultaSelecao } from "@scripts/particlesystem";
import { componentToData } from "@engine/components";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { entrarJogo, sairJogo } from "@engine/core/modo_jogo";
import { GameObject } from "@engine/core/gameobject";

function assertTrue(msg: string, v: boolean): void { if (!v) { console.log("[FALHOU] " + msg); process.exit(1); } }
function assertEq(msg: string, a: f64, b: f64): void { if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); } }

fixarSementeAleatorio(9);
sairJogo(); // estado inicial limpo, independente de testes anteriores

// Seleção fake por id: só o id 1 é "selecionado".
let idSelecionado: number = 1;
definirConsultaSelecao((id: number) => id === idSelecionado);

// ── Fora do Play: sem dono (owner null => id -1, nunca bate com 1) ───────
// `update` não deve avançar nem `time` nem emitir.
{
  const ps = new ParticleSystem();
  ps.rateOverTime = 50.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
  ps.play();
  assertEq("play(): time começa em 0", ps.time, 0.0);
  ps.update(0.5);
  assertEq("fora do Play, sem seleção (dono != 1): time não avança", ps.time, 0.0);
  assertEq("fora do Play, sem seleção: nada emitido", ps.particleCount, 0.0);
}

// ── Fora do Play, MAS com dono cujo id bate com a seleção ────────────────
// Simula o dono via GameObject de verdade, pra checar owner.id de verdade
// (não só o caminho "sem dono").
{
  const dono = new GameObject("emissor");
  const ps = new ParticleSystem();
  dono.addBehavior(ps);
  idSelecionado = dono.id; // agora ESTE objeto é o selecionado
  ps.rateOverTime = 50.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
  ps.play();
  ps.update(0.5);
  assertTrue("fora do Play, COM seleção: time avança", ps.time > 0.0);
  assertTrue("fora do Play, COM seleção: emite", ps.particleCount > 0);

  idSelecionado = dono.id + 1000; // troca a seleção pra outro objeto
  const tempoAntes = ps.time;
  const contagemAntes = ps.particleCount;
  ps.update(0.5);
  assertEq("perdeu a seleção: time para de avançar", ps.time, tempoAntes);
  assertEq("perdeu a seleção: para de emitir", ps.particleCount, contagemAntes);
}

// ── Dentro do Play (emJogo()): avança independente da seleção ────────────
{
  entrarJogo();
  const ps = new ParticleSystem();
  ps.rateOverTime = 50.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
  idSelecionado = 0.0 - 999.0; // nada bate — se o Play não ignorasse a seleção, não avançaria
  ps.play();
  ps.update(0.5);
  assertTrue("dentro do Play (emJogo): time avança mesmo sem seleção bater", ps.time > 0.0);
  assertTrue("dentro do Play (emJogo): emite mesmo sem seleção bater", ps.particleCount > 0);
  sairJogo();
}

// ── `emPlay` da própria instância: mesmo padrão, sem depender de emJogo() ─
// (a bandeira que o PlayMode usaria ao copiar o objeto pro Play).
{
  const ps = new ParticleSystem();
  ps.rateOverTime = 50.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
  idSelecionado = 0.0 - 999.0;
  ps.emPlay = true;
  ps.play();
  ps.update(0.5);
  assertTrue("emPlay=true: time avança mesmo sem seleção bater", ps.time > 0.0);
  assertTrue("emPlay=true: emite mesmo sem seleção bater", ps.particleCount > 0);
}

// ── componentToData fora do Play nunca inclui o pool simulado ────────────
{
  const ps = new ParticleSystem();
  ps.rateOverTime = 50.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
  ps.emPlay = true; // garante que emite mesmo sem seleção, pra ter algo no pool
  ps.play();
  ps.update(0.5);
  assertTrue("setup: tem partículas vivas antes de serializar", ps.particleCount > 0);
  const data = componentToData(ps);
  assertTrue("componentToData: não é null", data !== null);
  const json = JSON.stringify(data);
  assertTrue("toData() não serializa o pool", json.indexOf("\"pool\"") < 0);
  assertTrue("toData() não serializa o buffer de descrição", json.indexOf("descBuf") < 0);
  assertTrue("toData() não serializa o buffer de saída", json.indexOf("saidaBuf") < 0);
  assertTrue("toData() não serializa o acumulador", json.indexOf("acumulado") < 0);
  assertTrue("toData() não serializa 'time' (estado de simulação)", json.indexOf("\"time\"") < 0);
  assertTrue("toData() não serializa 'emPlay' (estado de execução)", json.indexOf("emPlay") < 0);
}

console.log("[PASSOU] test_particulas_previa");

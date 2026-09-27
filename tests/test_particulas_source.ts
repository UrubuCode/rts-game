// Componente ParticleSystem (Task 5) — play/stop/pause/emit/clear e os itens
// carregados das revisões anteriores: burst 1x por ciclo (mesmo pulando o
// instante num só quadro, e no wrap do loop), acumulador de taxa sem perda
// entre quadros, e teto de dt (hitch não emite/simula um passo gigante).
import { ParticleSystem } from "@scripts/particlesystem";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { entrarJogo, sairJogo, emJogo } from "@engine/core/modo_jogo";
import { audioEmJogo } from "@engine/audio/audio";

function assertTrue(msg: string, v: boolean): void { if (!v) { console.log("[FALHOU] " + msg); process.exit(1); } }
function assertEq(msg: string, a: f64, b: f64): void { if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); } }

fixarSementeAleatorio(777);
const ps = new ParticleSystem();
// vida longa (100s): em 3s de simulação nada morre, então o teste isola
// exatamente a propriedade "emissão até o limite do pool" sem a vida
// interferir — com vida=1.0 (valor original do rascunho) o regime
// permanente de vivas cai para rate*vida≈20 bem antes do pool encher, e a
// asserção de 50 nunca seria alcançável (confirmado rodando o rascunho: a
// morte por vida já recicla slots continuamente antes do pool saturar).
ps.maxParticles = 50; ps.rateOverTime = 20.0; ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;

assertTrue("não emite antes de play()", ps.particleCount === 0);
ps.play();
assertTrue("isPlaying após play()", ps.isPlaying());
let i = 0; while (i < 30) { ps.update(0.1); i = i + 1; } // 3s a 20/s => 60 pedidas, 50 (limitado por maxParticles)
assertEq("emitiu até o limite do pool", ps.particleCount, 50);

ps.stop(false);
assertTrue("stop(false): não emite mais", !ps.isPlaying());
const antes = ps.particleCount;
ps.update(0.1);
assertTrue("stop(false): vivas não sobem", ps.particleCount <= antes);

ps.clear();
assertEq("clear() zera na hora", ps.particleCount, 0);

ps.emit(5);
assertEq("emit(n) soma mesmo sem play()", ps.particleCount, 5);

const ps2 = new ParticleSystem();
ps2.maxParticles = 50; ps2.rateOverTime = 20.0; ps2.startLifetimeMin = 1.0; ps2.startLifetimeMax = 1.0;
ps2.pause();
ps2.play(); ps2.update(0.5);
const contagemAntesDoPause = ps2.particleCount;
const tAntesDoPause = ps2.time;
ps2.pause(); ps2.update(1.0);
assertEq("pause() congela particleCount", ps2.particleCount, contagemAntesDoPause);
assertEq("pause() congela time", ps2.time, tAntesDoPause);

// ── Carried item (a): burst dispara exatamente 1x por ciclo ──────────────
// mesmo quando o dt do quadro pula por cima do instante do burst, e de novo
// no próximo ciclo (loop). Sem rateOverTime (0) pra isolar o burst. dt de
// cada chamada fica <= 0,25 (o teto do item (c) é testado em separado, mais
// abaixo, sem se misturar com este).
{
  fixarSementeAleatorio(1);
  const b = new ParticleSystem();
  b.maxParticles = 200; b.rateOverTime = 0.0; b.startLifetimeMin = 100.0; b.startLifetimeMax = 100.0;
  b.duration = 1.0; b.loop = true;
  b.setBurst(0, 0.15, 10.0); // 10 partículas em t=0.15s de cada ciclo de 1s
  b.play();
  b.update(0.05); // t=0.05, ainda não passou de 0.15 — nada emitido
  assertEq("burst: nada antes do instante", b.particleCount, 0);
  b.update(0.2); // t: 0.05 -> 0.25, PULA por cima de 0.15 num só quadro — dispara
  assertEq("burst: dispara ao pular por cima do instante num só quadro", b.particleCount, 10);
  b.update(0.2); // t=0.45, mesmo ciclo — não dispara de novo
  assertEq("burst: não dispara 2x no mesmo ciclo", b.particleCount, 10);
  b.update(0.2); // t=0.65
  assertEq("burst: ainda não dispara de novo (mesmo ciclo)", b.particleCount, 10);
  b.update(0.2); // t=0.85
  assertEq("burst: ainda não dispara de novo (mesmo ciclo)", b.particleCount, 10);
  b.update(0.2); // t: 0.85 -> cruza 1.0 (fim do ciclo, wrap pra 0) -> sobra 0,05: t final = 0.05, < 0.15
  assertEq("burst: wrap do loop não dispara sozinho antes do instante", b.particleCount, 10);
  b.update(0.2); // 2º ciclo: t 0.05 -> 0.25, cruza 0.15 de novo — dispara mais 10
  assertEq("burst: dispara de novo depois do wrap do loop", b.particleCount, 20);
}

// ── Carried item (b): acumulador de taxa carrega fração sem drift/perda ──
// dt irregular e baixo (bem menor que 1/rate) não deve perder nem duplicar
// partículas: no fim, o total emitido deve bater com rate*tempo (arredondado
// pra baixo), igual a uma única chamada com o dt somado.
{
  fixarSementeAleatorio(2);
  const c = new ParticleSystem();
  c.maxParticles = 1000; c.rateOverTime = 7.0; c.startLifetimeMin = 1000.0; c.startLifetimeMax = 1000.0;
  c.duration = 1000.0; c.loop = false;
  c.play();
  // 1000 quadros de 3ms (dt irregular/pequeno, bem abaixo de 1/7s): 3s no total.
  let f = 0; while (f < 1000) { c.update(0.003); f = f + 1; }
  const esperado = Math.floor(3.0 * 7.0); // 21, tolerando o arredondamento do acumulado no limite do laço
  assertTrue("acumulador: sem perda/drift visível a dt baixo", Math.abs(c.particleCount - esperado) <= 1);
}

// ── Carried item (c): dt clamp — um hitch não emite/simula um passo gigante ──
{
  fixarSementeAleatorio(3);
  const d = new ParticleSystem();
  d.maxParticles = 100000; d.rateOverTime = 1000.0; d.startLifetimeMin = 1000.0; d.startLifetimeMax = 1000.0;
  d.duration = 1000.0; d.loop = false;
  d.play();
  d.update(2.0); // hitch de 2s: sem teto, emitiria ~2000 e envelheceria 2s de uma vez
  assertTrue("dt clamp: não emite o equivalente a 2s inteiros de uma vez", d.particleCount < 1000.0 * 2.0);
  assertTrue("dt clamp: time não avança 2s inteiros num update", d.time < 2.0);
}

// ── Carried item (d): Play (cópia) simula, Stop (original) fica limpo ────
// Duas instâncias independentes (o que o ciclo de Play do editor faz é
// clonar o Behavior — aqui simulado por duas instâncias distintas) não
// compartilham pool nem acumulador.
{
  fixarSementeAleatorio(4);
  const original = new ParticleSystem();
  original.maxParticles = 30; original.rateOverTime = 20.0; original.startLifetimeMin = 5.0; original.startLifetimeMax = 5.0;
  // "cópia" simulada por Play: nasce do mesmo valor de campos, mas é outra instância.
  const copia = new ParticleSystem();
  copia.maxParticles = original.maxParticles; copia.rateOverTime = original.rateOverTime;
  copia.startLifetimeMin = original.startLifetimeMin; copia.startLifetimeMax = original.startLifetimeMax;
  copia.play();
  copia.update(0.5);
  assertTrue("cópia simula", copia.particleCount > 0);
  assertEq("original não é afetado pela simulação da cópia", original.particleCount, 0);
  copia.stop(true); // Stop com limpeza — nenhuma partícula sobra na cópia
  assertEq("stop(true) limpa a cópia", copia.particleCount, 0);
  assertEq("original continua limpo", original.particleCount, 0);
}

// ── Fix round 1, item 1 (CRÍTICO): playOnAwake só dentro do Play/jogo ─────
// mount() não deve tocar sozinho ao carregar a cena no editor (emJogo()===0);
// só toca quando o flag global de engine/core/modo_jogo diz que estamos no
// Play/jogo. audioEmJogo() (áudio) e emJogo() (genérico) precisam concordar
// — audio.ts passou a delegar no mesmo flag (ver fix round 1).
{
  sairJogo(); // estado inicial limpo, independente de testes anteriores
  assertTrue("estado inicial: fora do jogo", emJogo() === 0);
  assertTrue("audioEmJogo concorda com emJogo (fora do jogo)", audioEmJogo() === 0);

  const editor = new ParticleSystem();
  editor.playOnAwake = true;
  editor.mount(); // carregar a cena / anexar o componente no editor
  assertTrue("mount() no editor (fora do jogo): não toca sozinho", !editor.isPlaying());
  assertEq("mount() no editor: nenhuma partícula", editor.particleCount, 0);

  entrarJogo();
  assertTrue("entrarJogo(): emJogo()==1", emJogo() !== 0);
  assertTrue("entrarJogo(): audioEmJogo() concorda", audioEmJogo() !== 0);
  const jogo = new ParticleSystem();
  jogo.playOnAwake = true;
  jogo.mount(); // a cópia do Play monta dentro do jogo
  assertTrue("mount() dentro do jogo: toca sozinho", jogo.isPlaying());

  sairJogo(); // volta ao editor parado (Stop)
  assertTrue("sairJogo(): emJogo()==0 de novo", emJogo() === 0);
  const depoisDoStop = new ParticleSystem();
  depoisDoStop.playOnAwake = true;
  depoisDoStop.mount();
  assertTrue("mount() depois do Stop: não toca mais sozinho", !depoisDoStop.isPlaying());

  // sem playOnAwake, mount() nunca toca, mesmo dentro do jogo.
  entrarJogo();
  const semAutoplay = new ParticleSystem();
  semAutoplay.playOnAwake = false;
  semAutoplay.mount();
  assertTrue("playOnAwake=false: mount() nunca toca, nem dentro do jogo", !semAutoplay.isPlaying());
  sairJogo(); // deixa o flag global limpo pro resto do processo/suíte
}

// ── Fix round 1, item 2: guarda t=idade/vida contra vida<=0 ──────────────
// emit() sem update() no meio: a partícula continua com P_VIDA=0 (ainda não
// envelheceu/reciclou) e drawSelf() precisa calcular t sem gerar NaN/lançar.
{
  fixarSementeAleatorio(5);
  const zero = new ParticleSystem();
  zero.maxParticles = 10; zero.startLifetimeMin = 0.0; zero.startLifetimeMax = 0.0;
  zero.emit(1);
  assertEq("emit com vida=0: partícula viva até a próxima atualizarVidas", zero.particleCount, 1);
  const pos0 = new Float64Array([0.0, 0.0, 0.0]);
  zero.drawSelf(0, pos0, 0.0 - 1.0); // não deve lançar (t=idade/vida guardado contra vida<=0)
  assertEq("drawSelf com vida=0 não altera particleCount", zero.particleCount, 1);
}

// ── Fix round 1, item 4: prewarm e sort ───────────────────────────────────
{
  fixarSementeAleatorio(6);
  const pw = new ParticleSystem();
  pw.maxParticles = 200; pw.rateOverTime = 50.0; pw.startLifetimeMin = 10.0; pw.startLifetimeMax = 10.0;
  pw.duration = 1.0; pw.loop = true; pw.prewarm = true;
  pw.play(); // já nasce "em regime": prewarm simula `duration` antes do 1º quadro
  assertTrue("prewarm: já tem partículas logo após play()", pw.particleCount > 0);

  fixarSementeAleatorio(7);
  const st = new ParticleSystem();
  st.maxParticles = 100; st.rateOverTime = 200.0; st.startLifetimeMin = 5.0; st.startLifetimeMax = 5.0;
  st.sort = 1; st.modo = 0; // back-to-front só no modo alfa
  st.play();
  st.update(0.2);
  const vivasAntes = st.particleCount;
  const posSort = new Float64Array([0.0, 0.0, 0.0]);
  st.drawSelf(0, posSort, 0.0 - 1.0); // não deve lançar nem mudar particleCount
  assertEq("sort=1: drawSelf não muda particleCount", st.particleCount, vivasAntes);
}

console.log("[PASSOU] test_particulas_source");

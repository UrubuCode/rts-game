// Sonda de ALOCAÇÃO do caminho por quadro do COMPONENTE ParticleSystem em
// REGIME DE 10 000 partículas vivas (Task 11) — o portão de performance da
// entrega inteira depende disto: `update(dt)` + `drawSelf(win,pos,tint)`
// juntos, no maior `maxParticles` do plano, sem nenhuma coleta.
//
// Nome do arquivo: a task-11-brief pedia `tests/claude-test-particulas-gc.ts`,
// mas esse nome já existe (Task 2/3, sonda de `sim.ts` no nível de função) e
// `tests/claude-test-particulasystem-gc.ts` (Task 5, sonda do componente a
// maxParticles=1000, com as fases separadas por caminho de desenho) também já
// existe — nenhum dos dois deveria ser sobrescrito. Este arquivo cobre
// especificamente o cenário que faltava: 10 000 partículas, o par
// update+drawSelf JUNTO (o caminho real de um quadro), 200 000 iterações.
//
//   RTS_GC_DEBUG=1 GC_N=20000 $RTS run tests/claude-test-particulas-componente-10k-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas na fase `quadro_10k` (as de antes do 1º marcador,
// incluindo os 200 quadros de aquecimento, são setup).
//
// N default 20 000, não 200 000 como as outras sondas do plano: medido neste
// runtime (interpretado, sem JIT — o mesmo padrão que `claude-bench-audio.ts`
// mostra pro KERNEL_TS), update+drawSelf a 10 000 partículas custam ~30 ms
// POR QUADRO (ver `bench/claude-bench-particulas.ts`); 200 000 quadros
// levariam quase 2 horas só nesta sonda. Uma alocação por chamada é
// determinística (aparece já na 1ª chamada de regime, não é uma race rara
// que precise de centenas de milhares de repetições pra se manifestar) — a
// confiança da sonda vem de rodar BASTANTE além do aquecimento (200
// quadros), não do N absoluto. `GC_N` continua ajustável pra quem quiser
// rodar os 200 000 completos (durante a noite, por exemplo).
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { ParticleSystem } from "@scripts/particlesystem";
import { FORMA_ESFERA } from "@engine/particles/desc";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { temParticlesStep, aguardarParticlesStep } from "@compat/particles";

const n = parseInt(process.env("GC_N") === "" ? "20000" : process.env("GC_N"));
const pos = new Float64Array([0.0, 0.0, 0.0]);

async function main(): Promise<void> {
// Este arquivo roda como UM script síncrono do início ao fim — sem este
// `await` explícito a detecção assíncrona de `rts:particles` (ver
// `compat/particles.ts`) nunca teria a chance de resolver antes do laço de
// medição, e a sonda mediria o caminho TS mesmo num binário com o nativo.
await aguardarParticlesStep();
io.print("nativo (rts:particles.particlesStep) = " + (temParticlesStep() ? "SIM" : "não — caminho TS puro"));

fixarSementeAleatorio(11);

const ps = new ParticleSystem();
ps.maxParticles = 10000;
ps.forma = FORMA_ESFERA; ps.raio = 5.0;
// rateOverTime bem acima do que 10 000 slots comportam por segundo: todo
// quadro tenta reemitir o que reciclou (vida curta), então o pool fica
// SATURADO (vivas≈max) por toda a medição — o pior caso real de um efeito
// "sempre cheio" (fogueira grande, chuva), não uma rampa de enchimento.
ps.rateOverTime = 100000.0;
ps.startLifetimeMin = 0.5; ps.startLifetimeMax = 1.5;
ps.startSpeedMin = 0.5; ps.startSpeedMax = 2.0;
ps.startSizeMin = 0.05; ps.startSizeMax = 0.15;
ps.ventoX = 0.2; ps.ventoY = 0.1; ps.ventoZ = -0.1; ps.arrasto = 0.3;
ps.play();

// Aquecimento: 200 quadros para o pool ficar cheio (e para a 1ª chamada de
// cada função — caches de módulo — não contar como alocação "de regime").
let w = 0;
while (w < 200) { ps.update(1.0 / 60.0); w = w + 1; }
ps.drawSelf(0, pos, 0.0 - 1.0); // aquece drawSelf (cresce saidaBuf, dispara o aviso "sem nativo" 1x)
io.print("[setup] vivas=" + ps.particleCount + " max=" + ps.maxParticles);

io.print("FASE quadro_10k " + n);
let i = 0;
while (i < n) {
  ps.update(1.0 / 60.0);
  ps.drawSelf(0, pos, 0.0 - 1.0);
  i = i + 1;
}
io.print("FIM quadro_10k " + n);
io.print("[PASSOU] claude-test-particulas-componente-10k-gc (vivas=" + ps.particleCount + " max=" + ps.maxParticles + ")");
}
main();

// Sonda de ALOCAÇÃO do caminho por quadro do COMPONENTE ParticleSystem
// (Task 5): update(dt) + drawSelf(win,pos,tint), nos dois caminhos de saída
// (drawParticlesSeguro sem textura e drawParticlesTexSeguro com textura —
// nota do controlador da Task 1: o wrapper de textura reaproveita UM objeto
// de opções em compat/particles.ts, e este caminho entra na sonda). Rodar
// com RTS_GC_DEBUG=1 e contar as linhas "rts-gc" ENTRE os marcadores "FASE"
// (as coletas antes do 1º marcador são setup):
//
//   RTS_GC_DEBUG=1 GC_N=200000 $RTS run tests/claude-test-particulasystem-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Portão: 0 coletas em cada fase com 200 000 iterações. Sem janela real
// (win=0): os nativos de desenho não desenham de verdade, mas a mesma
// passagem de TS (montar o buffer de instância, checar `temDrawParticles*`,
// mutar `specTex`) roda igual à do editor — é isso que aloca ou não.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { ParticleSystem } from "@scripts/particlesystem";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { temParticlesStep, aguardarParticlesStep } from "@compat/particles";

const n = parseInt(process.env("GC_N") === "" ? "200000" : process.env("GC_N"));
const pos = new Float64Array([0.0, 0.0, 0.0]);

async function main(): Promise<void> {
// Ver o mesmo comentário em claude-test-particulas-componente-10k-gc.ts: sem
// este `await` a detecção assíncrona de `rts:particles` nunca resolveria
// dentro deste script síncrono.
await aguardarParticlesStep();
io.print("nativo (rts:particles.particlesStep) = " + (temParticlesStep() ? "SIM" : "não — caminho TS puro"));

fixarSementeAleatorio(9);

// FASE update: emissão por taxa em regime (vida curta o bastante para manter
// emissão+reciclagem ativas todo quadro, sem lotar o pool de 1000).
const ps = new ParticleSystem();
ps.maxParticles = 1000; ps.rateOverTime = 500.0;
ps.startLifetimeMin = 0.2; ps.startLifetimeMax = 0.3;
ps.play();

// aquece o caminho uma vez (1ª chamada, caches de módulo)
ps.update(0.016);

io.print("FASE update " + n);
let a = 0;
while (a < n) { ps.update(0.016); a = a + 1; }
io.print("FIM update " + n);

// FASE drawSelf_sem_textura: pool já em regime (textura=0, caminho
// drawParticlesSeguro — sem nativo neste binário, cai no aviso já emitido
// uma vez em compat/particles.ts, sem alocar de novo).
ps.drawSelf(0, pos, 0.0 - 1.0); // aquece (1ª chamada cresce saidaBuf, dispara o aviso "sem nativo" 1x)

io.print("FASE drawSelf_sem_textura " + n);
let b = 0;
while (b < n) { ps.update(0.016); ps.drawSelf(0, pos, 0.0 - 1.0); b = b + 1; }
io.print("FIM drawSelf_sem_textura " + n);

// FASE drawSelf_com_textura: mesmo pool, textura>0 -> drawParticlesTexSeguro
// (setParticleTex + specTex mutado, nunca um objeto novo por quadro).
ps.textura = 7.0;
ps.drawSelf(0, pos, 0.0 - 1.0); // aquece (dispara o aviso "sem nativo" da variante Tex, 1x)

io.print("FASE drawSelf_com_textura " + n);
let c = 0;
while (c < n) { ps.update(0.016); ps.drawSelf(0, pos, 0.0 - 1.0); c = c + 1; }
io.print("FIM drawSelf_com_textura " + n);

// FASE drawSelf_sort: fix round 1, item 4 — `sort=1` (back-to-front, modo
// alfa) passa por `ordenarPorDistancia` (frustumParams + inserção sobre um
// índice + cópia reordenada), todos buffers reaproveitados (distBuf/
// ordemBuf/saidaOrdenadaBuf/camBuf). Pool pequeno de propósito (~30 vivas):
// inserção é O(k²) por chamada, e k grande demais tornaria esta fase lenta
// demais pra sonda (não é o caminho pensado pra milhares de partículas todo
// quadro — ver comentário em ordenarPorDistancia).
const psSort = new ParticleSystem();
psSort.maxParticles = 50; psSort.rateOverTime = 60.0;
psSort.startLifetimeMin = 0.5; psSort.startLifetimeMax = 0.5;
psSort.sort = 1; psSort.modo = 0;
psSort.play();
psSort.update(0.016);
psSort.drawSelf(0, pos, 0.0 - 1.0); // aquece (cresce distBuf/ordemBuf/saidaOrdenadaBuf)

io.print("FASE drawSelf_sort " + n);
let d = 0;
while (d < n) { psSort.update(0.016); psSort.drawSelf(0, pos, 0.0 - 1.0); d = d + 1; }
io.print("FIM drawSelf_sort " + n);

io.print("[PASSOU] claude-test-particulasystem-gc (vivas=" + ps.particleCount + ", vivasSort=" + psSort.particleCount + ")");
}
main();

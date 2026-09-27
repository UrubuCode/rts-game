// Task 6 — corte por frustum do emissor: `drawSelf` não desenha (devolve 0)
// quando o emissor está fora do frustum, mesmo com partículas vivas, mas a
// simulação (`update`) nunca "perde" nada por isso — recolocando o emissor na
// frente da câmera, `drawSelf` volta a TENTAR desenhar (mesma quantidade de
// partículas vivas de antes).
//
// `temDrawParticles()` (compat/particles.ts) diz se ESTE binário do rts tem
// o nativo `drawParticles`:
// - COM nativo: sem janela real (win=0), o driver nativo em si sempre
//   devolve 0 (nota de `claude-test-particulasystem-gc.ts`: "sem janela
//   real, os nativos de desenho não desenham de verdade") — então o retorno
//   headless de `drawParticles` não distingue "cortado" de "sem janela".
//   Pra provar de verdade que `drawSelf` RETOMOU o desenho (chamou o nativo
//   com as partículas certas) sem depender do log, trocamos
//   `egui.drawParticles` por um espião que grava quantas vezes foi chamado e
//   com que `n`, e devolve `n` (como um driver real devolveria) — o retorno
//   de `drawSelf` passa a refletir esse valor de verdade: 0 quando cortado
//   (nativo nem chamado), > 0 (= partículas vivas) quando dentro do frustum.
// - SEM nativo: `drawSelf` sempre devolve 0 no fim, esteja o emissor dentro
//   ou fora do frustum — o retorno sozinho não distingue "cortado pelo
//   frustum" de "sem nativo pra desenhar". O log distingue: o aviso "sem
//   nativo" só é emitido quando o código passa pelo corte de frustum e CHEGA
//   em `drawParticlesSeguro` — atrás da câmera ele nunca é emitido (retorno
//   antecipado, antes de montar o buffer); na frente, é emitido (1x, o mesmo
//   padrão de `avisou` visto em claude-test-particulasystem-gc.ts). Esse
//   caminho continua só de log, o único sinal que existe sem nativo.
import * as egui from "rts:egui";
import { ParticleSystem } from "@scripts/particlesystem";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import { frustumBeginBuf } from "@engine/render/gpu3d";
import { logEntries, LOG_WARN } from "@engine/core/logger";
import { temDrawParticles } from "@compat/particles";

function assertTrue(msg: string, v: boolean): void { if (!v) { console.log("[FALHOU] " + msg); process.exit(1); } }
function assertEq(msg: string, a: f64, b: f64): void { if (Math.abs(a - b) > 1e-6) { console.log("[FALHOU] " + msg + " esperado=" + b + " obtido=" + a); process.exit(1); } }

function avisosSemNativo(): number { return logEntries(LOG_WARN, "drawparticles ausente").length; }

fixarSementeAleatorio(42);

// Câmera na origem, olhando para +Z (convenção deste projeto: fwd = (sin
// yaw·cos p, sin p, cos yaw·cos p) => yaw=0,pitch=0 dá fwd=(0,0,1)).
// `frustumBeginBuf`: [camX,camY,camZ,yaw,pitch,fovY,aspecto,near,far].
const camBuf = new Float64Array(9);
camBuf[0] = 0.0; camBuf[1] = 0.0; camBuf[2] = 0.0;   // posição
camBuf[3] = 0.0; camBuf[4] = 0.0;                     // yaw, pitch
camBuf[5] = 1.05; camBuf[6] = 1.0;                    // fovY, aspecto
camBuf[7] = 0.1; camBuf[8] = 500.0;                   // near, far
frustumBeginBuf(camBuf);

const comNativo = temDrawParticles();

// Espião do nativo (só instalado quando ele existe de verdade): conta
// chamadas e o `n` recebido, e devolve `n` — um driver "de mentira" que se
// comporta como um real (ao contrário do real headless, que devolve 0 sempre).
let chamadasNativo = 0;
let ultimoNNativo = 0.0 - 1.0;
if (comNativo) {
  (egui as any).drawParticles = function (win: number, buf: Float32Array, n: number, modo: number): number {
    chamadasNativo = chamadasNativo + 1; ultimoNNativo = n;
    return n;
  };
}

const ps = new ParticleSystem();
ps.maxParticles = 20; ps.rateOverTime = 0.0;
ps.startLifetimeMin = 100.0; ps.startLifetimeMax = 100.0;
ps.startSpeedMin = 0.0; ps.startSpeedMax = 0.0;
ps.raio = 0.1; ps.caixaX = 0.1; ps.caixaY = 0.1; ps.caixaZ = 0.1;
ps.emit(5);
assertEq("emit(5) antes de qualquer desenho", ps.particleCount, 5);

if (!comNativo) assertEq("nenhum aviso de 'sem nativo' ainda (drawSelf nunca chamado)", avisosSemNativo(), 0);

const posAtras = new Float64Array([0.0, 0.0, 0.0 - 20.0]); // atrás da câmera (fora do frustum, -Z)
const n1 = ps.drawSelf(0, posAtras, 0.0 - 1.0);
assertEq("emissor atrás da câmera: drawSelf não desenha nada (cortado pelo frustum)", n1, 0);
assertEq("corte no desenho não mexeu nas partículas vivas", ps.particleCount, 5);
if (comNativo) {
  assertEq("atrás da câmera, com nativo: o corte nem chega a chamar o nativo", chamadasNativo, 0);
} else {
  assertEq("atrás da câmera: corte acontece ANTES de montar o buffer (nem chega a tentar o nativo)", avisosSemNativo(), 0);
}

// A simulação continua de qualquer forma, mesmo com o desenho cortado — o
// corte é só em `drawSelf`, `update` é outro método.
ps.update(0.05);
const contagemDepoisDoUpdate = ps.particleCount;
assertTrue("update() continua simulando mesmo com o desenho cortado", contagemDepoisDoUpdate > 0);

const posFrente = new Float64Array([0.0, 0.0, 10.0]); // na frente da câmera (dentro do frustum, +Z)
const n2 = ps.drawSelf(0, posFrente, 0.0 - 1.0);
if (comNativo) {
  // Retorno REAL de drawSelf (via espião, que devolve o `n` que receberia um
  // driver de verdade): > 0 dentro do frustum, igual às partículas vivas —
  // não é mais só "não lançou", é o número certo.
  assertEq("de volta na frente, com nativo: o nativo foi chamado exatamente 1x", chamadasNativo, 1);
  assertEq("de volta na frente, com nativo: o nativo recebeu as partículas vivas certas", ultimoNNativo, contagemDepoisDoUpdate);
  assertTrue("de volta na frente, com nativo: drawSelf devolveu partículas desenhadas > 0", n2 > 0);
  assertEq("de volta na frente, com nativo: drawSelf devolveu exatamente as partículas vivas", n2, contagemDepoisDoUpdate);
  assertEq("nenhum aviso de 'sem nativo' foi emitido (o nativo está presente)", avisosSemNativo(), 0);
} else {
  assertEq("de volta na frente: drawSelf tenta desenhar de novo (chega no nativo, que está ausente)", avisosSemNativo(), 1);
  assertEq("de volta na frente, sem nativo: drawSelf continua devolvendo 0 (nativo ausente)", n2, 0);
}
assertEq("de volta na frente: nenhuma partícula foi perdida pelo corte anterior", ps.particleCount, contagemDepoisDoUpdate);
assertTrue("de volta na frente: drawSelf não lança", n2 >= 0);

console.log("[PASSOU] test_particulas_frustum");

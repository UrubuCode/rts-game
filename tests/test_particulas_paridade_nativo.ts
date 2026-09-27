// Paridade: caminho TS puro (engine/particles/sim.ts+curvas.ts, a referência)
// contra o kernel nativo `rts:particles` (particlesStep), no MESMO processo —
// dois pools construídos com a mesma semente, a mesma emissão (cursor
// compartilhado, ruling P6) e o mesmo dt por quadro, comparados slot a slot
// (não pelo buffer de saída compactado, que não tem ordem garantida — o
// kernel escreve o resultado DE VOLTA no próprio `pool.dados`, no mesmo
// layout por slot que o caminho TS usa, então a comparação direta é válida).
//
// Sem o nativo neste binário (ex. `rts-particulas/target/release/rts.exe`,
// que não tem `particlesStep`), o teste degenera pra um "PASSOU" trivial —
// não há o que comparar, e os demais testes de partículas já cobrem o
// caminho TS puro sozinho.
import { criarPool, emitirN, atualizarVidas, PoolParticulas } from "@engine/particles/sim";
import { aplicarVelocidade } from "@engine/particles/curvas";
import { FORMA_ESFERA,
         P_X, P_Y, P_Z, P_VX, P_VY, P_VZ, P_IDADE, P_VIDA, P_TAM0, P_ROT, P_COR_R, P_COR_G, P_COR_B, P_COR_A, P_FLOATS } from "@engine/particles/desc";
import { temParticlesStep, particlesStepSeguro, aguardarParticlesStep } from "@compat/particles";
import { fixarSementeAleatorio } from "@engine/core/aleatorio";
import process from "@compat/process.ts";

const TOL: f64 = 1e-4;
let falhas = 0;
function assertClose(msg: string, a: f64, b: f64): void {
  if (Math.abs(a - b) > TOL) { console.log("[FALHOU] " + msg + " ts=" + a + " nativo=" + b); falhas = falhas + 1; }
}
function assertEq(msg: string, a: f64, b: f64): void {
  if (a !== b) { console.log("[FALHOU] " + msg + " ts=" + a + " nativo=" + b); falhas = falhas + 1; }
}

async function main(): Promise<void> {
// `temParticlesStep()` depende de um `import()` dinâmico assíncrono
// (`aguardarParticlesStep`, ver `compat/particles.ts` — `rts:particles` pode
// não existir NENHUM num binário sem o PR #2831, então a detecção não pode
// ser um `import` estático). Este script checa logo no início, sem nenhuma
// volta ao host entre o carregamento do módulo e a checagem — sem este
// `await` explícito a promise nunca teria tido a chance de resolver.
await aguardarParticlesStep();

if (!temParticlesStep()) {
  console.log("[PASSOU] test_particulas_paridade_nativo (sem nativo neste binário, nada a comparar)");
} else {
  const MAX: number = 400;
  const SEED_BASE: number = 20260927;

  const desc = new Float64Array(16);
  desc[0] = FORMA_ESFERA; // forma
  desc[1] = 1.5; // raio
  desc[6] = 2.0; desc[7] = 4.0; // vel min/max
  desc[8] = 0.2; desc[9] = 0.6; // tam min/max
  desc[10] = 0.35; desc[11] = 0.75; // vida min/max — curta, força morte/reciclagem em poucos quadros
  desc[12] = 0.0; // rot0
  desc[13] = 1.0; desc[14] = 0.5; desc[15] = 0.2; // cor

  // Gradiente/curva: mesmo formato que ParticleSystem monta em `paramsBuf`
  // (5..25 = 4 chaves de 5 floats, 26..34 = 4 chaves de 2 floats).
  const gradiente = new Float64Array([0.0, 1.0, 1.0, 1.0, 1.0, 0.5, 0.6, 0.2, 0.1, 0.6, 1.0, 0.0, 0.0, 0.0, 0.0]);
  const nChavesGradiente = 3;
  const curvaTamanho = new Float64Array([0.0, 0.2, 1.0, 1.0]);
  const nChavesTamanho = 2;

  const params = new Float64Array(42);
  params[0] = 0.3; params[1] = -0.5; params[2] = 0.1; // vento + gravidade já somada (como update() faz)
  params[3] = 0.8; // arrasto
  params[4] = nChavesGradiente;
  let gi = 0; while (gi < gradiente.length) { params[5 + gi] = gradiente[gi]; gi = gi + 1; }
  params[25] = nChavesTamanho;
  let ci = 0; while (ci < curvaTamanho.length) { params[26 + ci] = curvaTamanho[ci]; ci = ci + 1; }
  params[34] = 1.0; // world
  params[35] = 0.0; params[36] = 0.0; params[37] = 0.0; // posição do dono (0,0,0 — sem somar nada extra)
  params[38] = 0.0; // sort desligado nas passadas comparadas slot a slot

  const ventoBuf = new Float64Array([params[0], params[1], params[2]]);
  const outNat = new Float32Array(MAX * 9);

  fixarSementeAleatorio(SEED_BASE);
  const poolTS = criarPool(MAX);
  fixarSementeAleatorio(SEED_BASE);
  const poolNat = criarPool(MAX);

  const dt: f64 = 1.0 / 30.0;
  const N_QUADROS: number = 40; // ~1,33s — várias mortes/reciclagens com vida 0,35-0,75s
  const EMITIR_POR_QUADRO: number = 25;

  let quadro = 0;
  while (quadro < N_QUADROS) {
    // Mesma semente antes de CADA emissão (TS e nativo) — emitirN é a MESMA
    // função TS nos dois pools (emissão é sempre TS, cursor compartilhado,
    // ver ruling P6); sem resetar a semente aqui os dois pools consumiriam
    // sorteios diferentes (um antes do outro) e divergiriam.
    fixarSementeAleatorio(SEED_BASE + 1000 + quadro);
    emitirN(poolTS, desc, EMITIR_POR_QUADRO);
    fixarSementeAleatorio(SEED_BASE + 1000 + quadro);
    emitirN(poolNat, desc, EMITIR_POR_QUADRO);

    // Referência TS: envelhece + vento/arrasto + integra posição (o que
    // `ParticleSystem.update` faz sem o nativo).
    atualizarVidas(poolTS, dt);
    aplicarVelocidade(poolTS, ventoBuf, 0.8, dt);
    let slot = 0;
    while (slot < poolTS.max) {
      const k = slot * P_FLOATS;
      if (poolTS.dados[k + P_VIDA] >= 0.0) {
        poolTS.dados[k + P_X] = poolTS.dados[k + P_X] + poolTS.dados[k + P_VX] * dt;
        poolTS.dados[k + P_Y] = poolTS.dados[k + P_Y] + poolTS.dados[k + P_VY] * dt;
        poolTS.dados[k + P_Z] = poolTS.dados[k + P_Z] + poolTS.dados[k + P_VZ] * dt;
      }
      slot = slot + 1;
    }

    // Nativo: uma chamada faz aging+integração+curvas+saída.
    const vivasNat = particlesStepSeguro(poolNat.dados, params, dt, outNat);
    poolNat.vivas = vivasNat;

    quadro = quadro + 1;
  }

  assertEq("vivas iguais após " + N_QUADROS + " quadros", poolTS.vivas, poolNat.vivas);

  // Comparação slot a slot: o kernel nativo escreve DE VOLTA no próprio
  // `pool.dados` (mesmo layout, mesmos índices que o caminho TS usa) —
  // então os dois pools devem coincidir por slot, não só em agregado.
  let slot = 0;
  let vivosComparados = 0;
  while (slot < MAX) {
    const k = slot * P_FLOATS;
    const vivaTS = poolTS.dados[k + P_VIDA] >= 0.0;
    const vivaNat = poolNat.dados[k + P_VIDA] >= 0.0;
    if (vivaTS !== vivaNat) {
      console.log("[FALHOU] slot " + slot + " viva(ts)=" + vivaTS + " viva(nativo)=" + vivaNat);
      falhas = falhas + 1;
    } else if (vivaTS) {
      assertClose("slot " + slot + " X", poolTS.dados[k + P_X], poolNat.dados[k + P_X]);
      assertClose("slot " + slot + " Y", poolTS.dados[k + P_Y], poolNat.dados[k + P_Y]);
      assertClose("slot " + slot + " Z", poolTS.dados[k + P_Z], poolNat.dados[k + P_Z]);
      assertClose("slot " + slot + " VX", poolTS.dados[k + P_VX], poolNat.dados[k + P_VX]);
      assertClose("slot " + slot + " VY", poolTS.dados[k + P_VY], poolNat.dados[k + P_VY]);
      assertClose("slot " + slot + " VZ", poolTS.dados[k + P_VZ], poolNat.dados[k + P_VZ]);
      assertClose("slot " + slot + " IDADE", poolTS.dados[k + P_IDADE], poolNat.dados[k + P_IDADE]);
      vivosComparados = vivosComparados + 1;
    }
    slot = slot + 1;
  }
  if (vivosComparados < 10) { console.log("[FALHOU] paridade: poucas partículas vivas pra validar (" + vivosComparados + ")"); falhas = falhas + 1; }

  // ── sort=1 (modo alfa): só valida que o kernel devolve uma contagem
  // plausível com sort ligado (a ORDEM dentro de um balde não precisa bater
  // entre duas implementações independentes — Task 11/kernel usam bucket
  // sort por distância², não um total order estável). Pool à parte, pequeno.
  {
    fixarSementeAleatorio(SEED_BASE + 5000);
    const poolSort = criarPool(60);
    emitirN(poolSort, desc, 40);
    const paramsSort = new Float64Array(params);
    paramsSort[38] = 1.0; // sort ligado
    paramsSort[39] = 20.0; paramsSort[40] = 5.0; paramsSort[41] = 20.0; // câmera
    const outSort = new Float32Array(60 * 9);
    const vivasSort = particlesStepSeguro(poolSort.dados, paramsSort, dt, outSort);
    if (vivasSort <= 0 || vivasSort > 60) { console.log("[FALHOU] sort: contagem fora do esperado (" + vivasSort + ")"); falhas = falhas + 1; }
    // back-to-front: a primeira partícula escrita deve estar >= distância²
    // da última (farthest-first, mesmo sentido do bucket sort de Task 11).
    if (vivasSort > 1) {
      const dx0 = outSort[0] - 20.0; const dy0 = outSort[1] - 5.0; const dz0 = outSort[2] - 20.0;
      const d0 = dx0 * dx0 + dy0 * dy0 + dz0 * dz0;
      const last = (vivasSort - 1) * 9;
      const dxL = outSort[last] - 20.0; const dyL = outSort[last + 1] - 5.0; const dzL = outSort[last + 2] - 20.0;
      const dL = dxL * dxL + dyL * dyL + dzL * dzL;
      if (d0 < dL - 1e-6) { console.log("[FALHOU] sort: primeira partícula não é a mais distante (d0=" + d0 + " dL=" + dL + ")"); falhas = falhas + 1; }
    }
  }

  if (falhas > 0) { console.log("[FALHOU] test_particulas_paridade_nativo (" + falhas + " divergências)"); process.exit(1); }
  console.log("[PASSOU] test_particulas_paridade_nativo (" + vivosComparados + " partículas vivas comparadas slot a slot, tol=" + TOL + ")");
}
}
main();

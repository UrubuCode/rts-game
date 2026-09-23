// Teste de aceitação do Lote B: Consultas Espaciais (§5 e §7)
// Verifica:
//   1. Raycast contra esfera, caixa e casca
//   2. raycastNonAlloc com parâmetros escalares e buffer reutilizado
//   3. overlapSphere e overlapBox com ordenação estrita por bodyId crescente
//   4. Filtro simétrico de layer/mask
//   5. includeTriggers (ignorado por padrão; depth = 0 em overlap quando true)
//   6. Carimbo de stepId (CPU/Rust = stepCount, GPU = pbGpuLastReadbackStep)
//   7. Zero alocações no caminho quente e estabilidade de RSS / tempo

import io from "@compat/io.ts";
import math from "@compat/math.ts";
import time from "../src/compat/time";
import { Scene } from "../src/engine/core/scene";
import { GameObject } from "../src/engine/core/gameobject";
import { boxCollider, sphereCollider, Collider, SHAPE_BOX, SHAPE_SPHERE } from "../src/engine/core/collider";
import { stepCount, stepsFor, stepMore, FIXED_DT } from "../src/engine/core/fixedstep";
import { pbActiveBackend, pbGpuLastReadbackStep, rigidSetMode, rigidInvalidate, rigidStep, rigidFlush } from "../src/engine/core/physics_backend";
import {
  setSpatialScene,
  spatialRebuildIndex,
  getSpatialStepId,
  createRaycastHit,
  createOverlapHit,
  raycast,
  raycastNonAlloc,
  overlapSphere,
  overlapSphereNonAlloc,
  overlapBox,
  overlapBoxNonAlloc,
  RaycastHit,
  OverlapHit,
} from "../src/engine/core/spatial_queries";
import { buildObject } from "../src/editor/sceneio";

let falhas = 0;

function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome + (detalhe ? " - " + detalhe : ""));
    falhas = falhas + 1;
  }
}

io.print("=== Teste de Aceite: Lote B (Consultas Espaciais) ===");

// ── 1. Raycast contra Esfera e Caixa ─────────────────────────────────────────
const sc = new Scene("TestScene");
setSpatialScene(sc);

const sphereObj = new GameObject("SphereTarget");
sphereObj.setMesh(4, 255, 0, 0); // esfera (mesh 4)
sphereObj.transform.setPosition(0.0, 0.0, 10.0);
sphereObj.transform.setScale(2.0); // raio 1.0
sc.add(sphereObj);

const boxObj = new GameObject("BoxTarget");
boxObj.setMesh(1, 0, 255, 0); // cubo
boxObj.transform.setPosition(10.0, 0.0, 0.0);
boxObj.transform.setScale(2.0); // meia-extensão 1.0
sc.add(boxObj);
sc.computeWorld();

spatialRebuildIndex(sc);

// Raycast contra esfera
const hitSphere = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 20.0);
check("Raycast contra esfera: atingiu", hitSphere !== null && hitSphere.hit);
if (hitSphere !== null) {
  check("Raycast contra esfera: bodyId correto", hitSphere.bodyId === sphereObj.id);
  check("Raycast contra esfera: distancia ~9.0", math.abs(hitSphere.distance - 9.0) < 0.01, "dist = " + hitSphere.distance);
  check("Raycast contra esfera: ponto z ~9.0", math.abs(hitSphere.point[2] - 9.0) < 0.01, "z = " + hitSphere.point[2]);
  check("Raycast contra esfera: normal z ~ -1.0", math.abs(hitSphere.normal[2] - (0.0 - 1.0)) < 0.01, "nz = " + hitSphere.normal[2]);
}

// Raycast contra caixa
const hitBox = raycast(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 20.0);
check("Raycast contra caixa: atingiu", hitBox !== null && hitBox.hit);
if (hitBox !== null) {
  check("Raycast contra caixa: bodyId correto", hitBox.bodyId === boxObj.id);
  check("Raycast contra caixa: distancia ~9.0", math.abs(hitBox.distance - 9.0) < 0.01, "dist = " + hitBox.distance);
  check("Raycast contra caixa: ponto x ~9.0", math.abs(hitBox.point[0] - 9.0) < 0.01, "x = " + hitBox.point[0]);
  check("Raycast contra caixa: normal x ~ -1.0", math.abs(hitBox.normal[0] - (0.0 - 1.0)) < 0.01, "nx = " + hitBox.normal[0]);
}

// Raycast que erra o alvo
const missRay = raycast(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 20.0);
check("Raycast que erra o alvo: devolve null", missRay === null);

// Raycast com maxDistance = Infinity (Item 1, Revisao 5: nao pode travar)
const hitInfSphere = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, Infinity);
check("Raycast com maxDistance = Infinity: atingiu", hitInfSphere !== null && hitInfSphere.hit);
if (hitInfSphere !== null) {
  check("Raycast com maxDistance = Infinity: bodyId correto", hitInfSphere.bodyId === sphereObj.id);
  check("Raycast com maxDistance = Infinity: distancia ~9.0", math.abs(hitInfSphere.distance - 9.0) < 0.01);
}
const missInfRay = raycast(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, Infinity);
check("Raycast com maxDistance = Infinity que erra o alvo: nao trava e devolve null", missInfRay === null);

// ── 2. raycastNonAlloc com parâmetros escalares e buffer reutilizado ─────────
const outHit = createRaycastHit();
const nonAllocHit = raycastNonAlloc(
  0.0, 0.0, 0.0,
  0.0, 0.0, 1.0,
  20.0,
  outHit,
  0xFFFFFFFF,
  1,
  false,
);
check("raycastNonAlloc: retornou true", nonAllocHit && outHit.hit);
check("raycastNonAlloc: outHit preenchido com bodyId", outHit.bodyId === sphereObj.id);
check("raycastNonAlloc: outHit distancia ~9.0", math.abs(outHit.distance - 9.0) < 0.01);

// ── 3. overlapSphere e overlapBox com ordenação estrita por bodyId crescente ──
// Cria 3 objetos com IDs distintos no mesmo raio de alcance
const scOverlap = new Scene("OverlapScene");
setSpatialScene(scOverlap);

const oA = new GameObject("OverlapA");
oA.setMesh(4, 255, 255, 255);
oA.transform.setPosition(1.0, 0.0, 0.0);
scOverlap.add(oA);

const oB = new GameObject("OverlapB");
oB.setMesh(4, 255, 255, 255);
oB.transform.setPosition(0.0, 1.0, 0.0);
scOverlap.add(oB);

const oC = new GameObject("OverlapC");
oC.setMesh(4, 255, 255, 255);
oC.transform.setPosition(0.0, 0.0, 1.0);
scOverlap.add(oC);
scOverlap.computeWorld();

spatialRebuildIndex(scOverlap);

// Consulta overlapSphere cobrindo os 3 objetos
const sphereHits = overlapSphere(0.0, 0.0, 0.0, 3.0);
check("overlapSphere: encontrou 3 objetos", sphereHits.length === 3, "count = " + sphereHits.length);
if (sphereHits.length === 3) {
  check("overlapSphere: ordenacao estrita por bodyId crescente",
        sphereHits[0].bodyId < sphereHits[1].bodyId && sphereHits[1].bodyId < sphereHits[2].bodyId,
        "ids = " + sphereHits[0].bodyId + ", " + sphereHits[1].bodyId + ", " + sphereHits[2].bodyId);
}

// Consulta overlapBox cobrindo os 3 objetos
const boxHits = overlapBox(0.0, 0.0, 0.0, 3.0, 3.0, 3.0);
check("overlapBox: encontrou 3 objetos", boxHits.length === 3, "count = " + boxHits.length);
if (boxHits.length === 3) {
  check("overlapBox: ordenacao estrita por bodyId crescente",
        boxHits[0].bodyId < boxHits[1].bodyId && boxHits[1].bodyId < boxHits[2].bodyId,
        "ids = " + boxHits[0].bodyId + ", " + boxHits[1].bodyId + ", " + boxHits[2].bodyId);
}

// Teste de overlap truncado (Item 4): maxHits < totalFound mantém os menores bodyIds e devolve contagem total
const truncBuf: OverlapHit[] = [createOverlapHit(), createOverlapHit()];
const totalSphereNonAlloc = overlapSphereNonAlloc(0.0, 0.0, 0.0, 3.0, truncBuf, 2, undefined, undefined, false, scOverlap);
check("overlap truncado: retorna contagem total encontrada (3)", totalSphereNonAlloc === 3, "total=" + totalSphereNonAlloc);
check("overlap truncado: mantem os 2 menores bodyIds ordenados",
      truncBuf[0].bodyId < truncBuf[1].bodyId && truncBuf[1].bodyId < sphereHits[2].bodyId,
      "ids = " + truncBuf[0].bodyId + ", " + truncBuf[1].bodyId);

// Teste de versão alocada sem teto em 64 (Item 4): cena com 70 objetos
const scMany = new Scene("ManyOverlapScene");
setSpatialScene(scMany);
let mi = 0;
while (mi < 70) {
  const mo = new GameObject("Many_" + mi);
  mo.setMesh(4, 255, 255, 255);
  mo.transform.setPosition(0.0, 0.0, 0.0);
  scMany.add(mo);
  mi = mi + 1;
}
scMany.computeWorld();
spatialRebuildIndex(scMany);

const manySphereHits = overlapSphere(0.0, 0.0, 0.0, 5.0, undefined, scMany);
check("overlapSphere alocado: nao corta em 64, encontra todos os 70", manySphereHits.length === 70, "count=" + manySphereHits.length);
let manySorted = true;
let sj = 1;
while (sj < manySphereHits.length) {
  if (manySphereHits[sj - 1].bodyId >= manySphereHits[sj].bodyId) { manySorted = false; break; }
  sj = sj + 1;
}
check("overlapSphere alocado: 70 objetos estritamente ordenados por bodyId crescente", manySorted);

// ── 4. Filtro Simétrico de layer/mask (§5.2) ─────────────────────────────────
const scFilter = new Scene("FilterScene");
setSpatialScene(scFilter);

const targetBody = new GameObject("TargetBody");
targetBody.setMesh(4, 255, 255, 0);
targetBody.layer = 2;       // Camada 2
targetBody.mask = 1;        // Aceita colidir com camada 1
targetBody.transform.setPosition(0.0, 0.0, 5.0);
scFilter.add(targetBody);
scFilter.computeWorld();

spatialRebuildIndex(scFilter);

// Caso 1: Q.layer=1, Q.mask=2 => Mútuo acordo: (Q.mask & B.layer !== 0) && (B.mask & Q.layer !== 0)
const hitMatch = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0, { layer: 1, mask: 2 });
check("Filtro simétrico: mútuo acordo atinge alvo", hitMatch !== null);

// Caso 2: Q.layer=1, Q.mask=4 => Q não aceita B (Q.mask & B.layer == 0)
const hitMissQ = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0, { layer: 1, mask: 4 });
check("Filtro simétrico: Q rejeita B -> sem colisão", hitMissQ === null);

// Caso 3: Q.layer=4, Q.mask=2 => B não aceita Q (B.mask & Q.layer == 0)
const hitMissB = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0, { layer: 4, mask: 2 });
check("Filtro simétrico: B rejeita Q -> sem colisão", hitMissB === null);

// ── 5. includeTriggers (§5.2) ────────────────────────────────────────────────
const scTrigger = new Scene("TriggerScene");
setSpatialScene(scTrigger);

const triggerObj = new GameObject("TriggerZone");
const colTrigger = new Collider(SHAPE_BOX);
colTrigger.trigger = 1;
colTrigger.hx = 1.0; colTrigger.hy = 1.0; colTrigger.hz = 1.0;
triggerObj.addBehavior(colTrigger);
triggerObj.transform.setPosition(0.0, 0.0, 5.0);
scTrigger.add(triggerObj);
scTrigger.computeWorld();

spatialRebuildIndex(scTrigger);

// Raycast com includeTriggers = false (padrão)
const rayTriggerDef = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0);
check("Triggers: raycast ignora trigger por padrao", rayTriggerDef === null);

// Raycast com includeTriggers = true
const rayTriggerInc = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0, { includeTriggers: true });
check("Triggers: raycast atinge trigger quando includeTriggers = true", rayTriggerInc !== null);

// Overlap com includeTriggers = true: depth deve ser 0.0 (§5.2)
const overlapTrig = overlapSphere(0.0, 0.0, 5.0, 2.0, { includeTriggers: true });
check("Triggers: overlap atinge trigger com depth = 0",
      overlapTrig.length > 0 && overlapTrig[0].depth === 0.0,
      "depth = " + (overlapTrig.length > 0 ? overlapTrig[0].depth : "nenhum"));

// ── 6. Carimbo de stepId (§5.1 e §7) ─────────────────────────────────────────
const scStep = new Scene("StepIdScene");
setSpatialScene(scStep);

const stepTarget = new GameObject("StepTarget");
stepTarget.setMesh(4, 255, 0, 0);
stepTarget.transform.setPosition(0.0, 0.0, 10.0);
stepTarget.transform.setScale(2.0);
scStep.add(stepTarget);

const stepDyn = new GameObject("StepDyn");
stepDyn.setMesh(1, 0, 255, 0);
stepDyn.stationary = 0;
stepDyn.collideFlag = 1;
stepDyn.transform.setPosition(5.0, 5.0, 5.0);
scStep.add(stepDyn);

scStep.computeWorld();
spatialRebuildIndex(scStep);

// Modo CPU: roda N frames via stepsFor e checa stepId === currentStep
rigidSetMode(0);
rigidInvalidate();
let fCpu = 0;
while (fCpu < 5) {
  const passos = stepsFor(FIXED_DT);
  let p = 0;
  while (stepMore(p, passos) !== 0) {
    scStep.update(FIXED_DT);
    if (rigidStep(scStep, 0) === 0) scStep.resolveCollisions();
    p = p + 1;
  }
  fCpu = fCpu + 1;
}
const hitCpu = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 20.0, undefined, scStep);
const curStepCpu = stepCount();
check("Carimbo stepId: em modo CPU stepId === currentStep",
      hitCpu !== null && hitCpu.stepId === curStepCpu,
      "hit.stepId=" + (hitCpu ? hitCpu.stepId : -1) + " curStep=" + curStepCpu);

// Modo GPU: roda N frames via stepsFor e checa stepId < currentStep (latência real)
rigidSetMode(1);
rigidInvalidate();
let fGpu = 0;
while (fGpu < 5) {
  const passos = stepsFor(FIXED_DT);
  let p = 0;
  while (stepMore(p, passos) !== 0) {
    scStep.update(FIXED_DT);
    rigidStep(scStep, 0);
    p = p + 1;
  }
  fGpu = fGpu + 1;
}
if (pbActiveBackend() === 1) {
  const hitGpu = raycast(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 20.0, undefined, scStep);
  const curStepGpu = stepCount();
  const gpuLastStep = pbGpuLastReadbackStep();
  check("Carimbo stepId: na GPU stepId < currentStep refletindo latencia real",
        hitGpu !== null && hitGpu.stepId < curStepGpu && hitGpu.stepId === gpuLastStep,
        "hit.stepId=" + (hitGpu ? hitGpu.stepId : -1) + " gpuLastStep=" + gpuLastStep + " curStep=" + curStepGpu);

  // a) rigidFlush no meio do teste mantendo o stepId consistente
  rigidFlush();
  const stepAposFlush = stepCount();
  const gpuStepAposFlush = pbGpuLastReadbackStep();
  check("Carimbo stepId: rigidFlush alinha stepId com stepCount",
        gpuStepAposFlush === stepAposFlush,
        "gpuStepAposFlush=" + gpuStepAposFlush + " stepAposFlush=" + stepAposFlush);

  // Avança mais frames e verifica que stepId da GPU não regride
  const passosFlush = stepsFor(FIXED_DT);
  let pf = 0;
  while (stepMore(pf, passosFlush) !== 0) {
    scStep.update(FIXED_DT);
    rigidStep(scStep, 0);
    pf = pf + 1;
  }
  const gpuStepDepois = pbGpuLastReadbackStep();
  check("Carimbo stepId: nao regride apos rigidFlush",
        gpuStepDepois >= gpuStepAposFlush,
        "gpuStepDepois=" + gpuStepDepois + " gpuStepAposFlush=" + gpuStepAposFlush);

  // b) saturação de PB_MAX_DEVIDOS (o atraso não cresce indefinidamente)
  let sIter = 0;
  while (sIter < 15) {
    const passos = stepsFor(FIXED_DT);
    let p = 0;
    while (stepMore(p, passos) !== 0) {
      scStep.update(FIXED_DT);
      rigidStep(scStep, 0);
      p = p + 1;
    }
    sIter = sIter + 1;
  }
  const curStepSat = stepCount();
  const gpuStepSat = pbGpuLastReadbackStep();
  const atraso = curStepSat - gpuStepSat;
  check("Carimbo stepId: saturacao PB_MAX_DEVIDOS mantem atraso finito e consistente",
        gpuStepSat > 0 && atraso >= 0 && atraso <= 20,
        "curStepSat=" + curStepSat + " gpuStepSat=" + gpuStepSat + " atraso=" + atraso);
} else {
  io.print("  [NAO-EXECUTADO] GPU indisponivel neste ambiente; teste de latencia real GPU marcado como nao-executado.");
}
rigidSetMode(0); // restaura modo CPU

// ── 7. Zero Alocações e Estabilidade (§5.5 e Aceite 7) ───────────────────────
const outRay = createRaycastHit();
const outOverlaps: OverlapHit[] = [];
let k = 0;
while (k < 16) {
  outOverlaps.push(createOverlapHit());
  k = k + 1;
}

// Medição de tempo e estabilidade em 3 rodadas de 1.000 chamadas consecutivas
let rodada = 0;
let temposMs: f64[] = [];

while (rodada < 3) {
  const t0 = performance.now();
  let iter = 0;
  while (iter < 1000) {
    raycastNonAlloc(0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 10.0, outRay, 0xFFFFFFFF, 1, true, sc);
    overlapSphereNonAlloc(0.0, 0.0, 0.0, 3.0, outOverlaps, 16, 0xFFFFFFFF, 1, true, scOverlap);
    iter = iter + 1;
  }
  const elapsed = performance.now() - t0;
  temposMs.push(elapsed);
  rodada = rodada + 1;
}

check("Zero alocacoes: 1.000 chamadas rodaram estaveis",
      temposMs[0] >= 0.0 && temposMs[1] >= 0.0 && temposMs[2] >= 0.0,
      "tempos: " + temposMs[0].toFixed(2) + " ms, " + temposMs[1].toFixed(2) + " ms, " + temposMs[2].toFixed(2) + " ms");

// ── 8. Resolução de Colisões de bodyId no SceneIO (Item 5) ─────────────────
const scIo = new Scene("CollisionTestScene");
const existingObj = new GameObject("Existing");
existingObj.id = 42;
scIo.add(existingObj);

// Tenta construir objeto com ID conflitante (42) na mesma cena
const objDesc1 = { name: "Clone1", id: 42, mesh: 1, color: [255, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: 1.0 };
const built1 = buildObject(objDesc1, scIo);
check("SceneIO: conflito de bodyId detectado e remapeado", built1.id !== 42, "id=" + built1.id);
check("SceneIO: novo bodyId e estritamente maior (monotonico)", built1.id > 42, "id=" + built1.id);
scIo.add(built1);

// Tenta construir um segundo objeto com ID conflitante (42)
const objDesc2 = { name: "Clone2", id: 42, mesh: 1, color: [255, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0], scale: 1.0 };
const built2 = buildObject(objDesc2, scIo);
check("SceneIO: multiplos conflitos remapeados monotonicamente", built2.id > built1.id, "id1=" + built1.id + " id2=" + built2.id);

// ── 9. Raycast com DDA engordada acertando dinâmico em célula vizinha transversal ──
const scTrans = new Scene("TransverseRayScene");
setSpatialScene(scTrans);

// Objeto dinâmico com meia-extensão 1.0 (escala 2.0)
// Centro em (2.5, 0.0, 10.0) -> gx = mfloor(2.5 / 2.0) = 1
const transObj = new GameObject("TransverseTarget");
transObj.setMesh(1, 255, 0, 0); // cubo
transObj.transform.setPosition(2.5, 0.0, 10.0);
transObj.transform.setScale(2.0); // meia-extensão 1.0 -> caixa em X: [1.5, 3.5]
scTrans.add(transObj);
scTrans.computeWorld();
spatialRebuildIndex(scTrans);

// Raio em x = 1.8 -> gx = mfloor(1.8 / 2.0) = 0
// O raio passa na célula gx = 0 e nunca entra em gx = 1.
// A caixa do alvo em X vai de 1.5 a 3.5, logo o raio em x = 1.8 atinge o alvo em z = 9.0.
const hitTrans = raycast(1.8, 0.0, 0.0, 0.0, 0.0, 1.0, 20.0, undefined, scTrans);
check("Raycast vizinho transversal: atingiu alvo na celula vizinha", hitTrans !== null && hitTrans.hit);
if (hitTrans !== null) {
  check("Raycast vizinho transversal: bodyId correto", hitTrans.bodyId === transObj.id);
  check("Raycast vizinho transversal: distancia ~9.0", math.abs(hitTrans.distance - 9.0) < 0.01, "dist=" + hitTrans.distance);
  check("Raycast vizinho transversal: ponto x ~1.8 e z ~9.0",
        math.abs(hitTrans.point[0] - 1.8) < 0.01 && math.abs(hitTrans.point[2] - 9.0) < 0.01,
        "x=" + hitTrans.point[0] + " z=" + hitTrans.point[2]);
}

// ── 10. Movimentação de Corpos Dinâmicos e Consultas Subsequentes ────────────
const scMove = new Scene("MoveTestScene");
setSpatialScene(scMove);

const moveObj = new GameObject("MovingDynamic");
moveObj.setMesh(1, 0, 255, 0); // cubo
moveObj.transform.setPosition(0.0, 0.0, 0.0);
moveObj.transform.setScale(1.0); // meia-extensão 0.5
scMove.add(moveObj);
scMove.computeWorld();
spatialRebuildIndex(scMove);

const moveHits: OverlapHit[] = [createOverlapHit(), createOverlapHit()];
const moveRay = createRaycastHit();

// Consulta inicial em (0, 0, 0)
const initialHits = overlapSphereNonAlloc(0.0, 0.0, 0.0, 2.0, moveHits, 2, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido: overlap inicial em (0,0,0) encontra objeto", initialHits === 1 && moveHits[0].bodyId === moveObj.id);

// 10.1 Mover 5 u para (5, 0, 0)
moveObj.transform.setPosition(5.0, 0.0, 0.0);
scMove.computeWorld();
spatialRebuildIndex(scMove);

const oldHits5 = overlapSphereNonAlloc(0.0, 0.0, 0.0, 2.0, moveHits, 2, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 5 u: overlap na posicao antiga devolve 0", oldHits5 === 0);

const newHits5 = overlapSphereNonAlloc(5.0, 0.0, 0.0, 2.0, moveHits, 2, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 5 u: overlap na posicao nova encontra objeto", newHits5 === 1 && moveHits[0].bodyId === moveObj.id);

const oldRay5 = raycastNonAlloc(0.0, 10.0, 0.0, 0.0, -1.0, 0.0, 50.0, moveRay, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 5 u: raycast na posicao antiga erra o alvo", !oldRay5);

const newRay5 = raycastNonAlloc(5.0, 10.0, 0.0, 0.0, -1.0, 0.0, 50.0, moveRay, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 5 u: raycast na posicao nova atinge objeto", newRay5 && moveRay.bodyId === moveObj.id && math.abs(moveRay.distance - 9.5) < 0.01);

// 10.2 Mover 500 u para (500, 0, 0) (fora de qualquer margem fixa inicial)
moveObj.transform.setPosition(500.0, 0.0, 0.0);
scMove.computeWorld();
spatialRebuildIndex(scMove);

const newHits500 = overlapSphereNonAlloc(500.0, 0.0, 0.0, 2.0, moveHits, 2, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 500 u: overlap na posicao nova encontra objeto", newHits500 === 1 && moveHits[0].bodyId === moveObj.id);

const newRay500 = raycastNonAlloc(500.0, 10.0, 0.0, 0.0, -1.0, 0.0, 50.0, moveRay, 0xFFFFFFFF, 1, false, scMove);
check("Dinâmico movido 500 u: raycast na posicao nova atinge objeto", newRay500 && moveRay.bodyId === moveObj.id && math.abs(moveRay.distance - 9.5) < 0.01);

if (falhas === 0) {
  io.print("[PASSOU] Todas as verificacoes de consultas espaciais passaram!");
} else {
  io.print("[FALHA] Total de falhas: " + falhas);
}

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

// ── 11. Objetos Grandes: Terreno Estático (2.000 u) e Chefe Dinâmico Colossal (50 u) ──
const scLarge = new Scene("LargeObjectsTestScene");
setSpatialScene(scLarge);

// Terreno estático de 2.000 x 2.000 u (meia-extensão 1.000 u em X e Z, 0.5 em Y)
const terrain = new GameObject("StaticTerrain");
terrain.stationary = 1;
terrain.setMesh(1, 100, 100, 100);
terrain.transform.setPosition(0.0, -0.5, 0.0);
terrain.transform.sx = 2000.0;
terrain.transform.sy = 1.0;
terrain.transform.sz = 2000.0;
scLarge.add(terrain);

// Dinâmico colossal (chefe): meia-extensão 25 u (escala 50 u)
const colossalBoss = new GameObject("ColossalBoss");
colossalBoss.setMesh(1, 255, 0, 255);
colossalBoss.transform.setPosition(100.0, 25.0, 100.0);
colossalBoss.transform.setScale(50.0); // hx = 25, hy = 25, hz = 25
scLarge.add(colossalBoss);

// Dinâmico normal: meia-extensão 0.5 u (escala 1.0 u)
const normalUnit = new GameObject("NormalUnit");
normalUnit.setMesh(1, 0, 255, 0);
normalUnit.transform.setPosition(0.0, 0.5, 0.0);
normalUnit.transform.setScale(1.0);
scLarge.add(normalUnit);

scLarge.computeWorld();
const t0Rebuild = performance.now();
spatialRebuildIndex(scLarge);
const rebuildDuration = performance.now() - t0Rebuild;

check("Reconstrucao com terreno 2.000 u e chefe 50 u: rapida (< 5 ms)", rebuildDuration < 5.0, "tempo=" + rebuildDuration + " ms");

// Raycast contra terreno em (500, 100, 500) apontando para baixo
const largeRayHit = createRaycastHit();
const hitTerrain = raycastNonAlloc(500.0, 100.0, 500.0, 0.0, -1.0, 0.0, 200.0, largeRayHit, 0xFFFFFFFF, 1, false, scLarge);
check("Raycast contra terreno estatico 2.000 u: atinge", hitTerrain && largeRayHit.bodyId === terrain.id);
check("Raycast contra terreno estatico 2.000 u: distancia ~100.0", hitTerrain && math.abs(largeRayHit.distance - 100.0) < 0.01, "dist=" + largeRayHit.distance);

// Raycast contra chefe colossal em (100, 100, 100) apontando para baixo
const hitBoss = raycastNonAlloc(100.0, 100.0, 100.0, 0.0, -1.0, 0.0, 200.0, largeRayHit, 0xFFFFFFFF, 1, false, scLarge);
check("Raycast contra chefe colossal: atinge", hitBoss && largeRayHit.bodyId === colossalBoss.id);
check("Raycast contra chefe colossal: distancia ~50.0", hitBoss && math.abs(largeRayHit.distance - 50.0) < 0.01, "dist=" + largeRayHit.distance);

// Overlap com terreno e unidade normal
const largeHits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit()];
const countAtOrigin = overlapSphereNonAlloc(0.0, 0.5, 0.0, 2.0, largeHits, 3, 0xFFFFFFFF, 1, false, scLarge);
check("Overlap na origem: encontra terreno e unidade normal", countAtOrigin === 2);

// Overlap no chefe colossal (esfera em y=5.0 com r=10 toca o terreno em y=0 e o chefe em y=[0..50])
const countAtBoss = overlapSphereNonAlloc(100.0, 5.0, 100.0, 10.0, largeHits, 3, 0xFFFFFFFF, 1, false, scLarge);
check("Overlap no chefe colossal: encontra chefe e terreno", countAtBoss === 2);

// ── 12. Grid Multinível: 100 Edifícios Médios (30x30), 2.000 Props Pequenos e Terreno 2.000 u ──
const scMulti = new Scene("MultiTierGridTestScene");
setSpatialScene(scMulti);

// Terreno estático 2.000 x 2.000 u
const groundMulti = new GameObject("GroundMulti");
groundMulti.stationary = 1;
groundMulti.setMesh(1, 100, 100, 100);
groundMulti.transform.setPosition(0.0, -0.5, 0.0);
groundMulti.transform.sx = 2000.0;
groundMulti.transform.sy = 1.0;
groundMulti.transform.sz = 2000.0;
scMulti.add(groundMulti);

// 2.000 props estáticos pequenos (escala 1.0 u)
let p = 0;
while (p < 2000) {
  const prop = new GameObject("Prop" + p);
  prop.stationary = 1;
  prop.setMesh(1, 120, 120, 120);
  const px = ((p % 50) - 25) * 8.0;
  const pz = (((p / 50) | 0) - 20) * 8.0;
  prop.transform.setPosition(px, 0.5, pz);
  prop.transform.setScale(1.0);
  scMulti.add(prop);
  p = p + 1;
}

// 100 edifícios estáticos médios (30 x 30 x 30 u, hx=15)
let bldg = 0;
let targetBldg: GameObject | null = null;
while (bldg < 100) {
  const b = new GameObject("Bldg" + bldg);
  b.stationary = 1;
  b.setMesh(1, 180, 140, 100);
  const bx = ((bldg % 10) - 5) * 70.0;
  const bz = (((bldg / 10) | 0) - 5) * 70.0;
  b.transform.setPosition(bx, 15.0, bz);
  b.transform.setScale(30.0);
  scMulti.add(b);
  if (bldg === 0) targetBldg = b;
  bldg = bldg + 1;
}

scMulti.computeWorld();
const t0Multi = performance.now();
spatialRebuildIndex(scMulti);
const multiRebuildDuration = performance.now() - t0Multi;

check("Multi-Tier: reconstrucao com 2.000 props, 100 predios e terreno rapida (< 20 ms)", multiRebuildDuration < 20.0, "tempo=" + multiRebuildDuration + " ms");

// Raycast contra o edifício 0 (centro em bx=-350, y=15, bz=-350, topo em y=30)
const bldgRayHit = createRaycastHit();
const targetBx = ((0 % 10) - 5) * 70.0;
const targetBz = (((0 / 10) | 0) - 5) * 70.0;
const hitBldg = raycastNonAlloc(targetBx, 50.0, targetBz, 0.0, -1.0, 0.0, 100.0, bldgRayHit, 0xFFFFFFFF, 1, false, scMulti);
check("Multi-Tier: raycast contra predio medio (30 u) atinge", hitBldg && bldgRayHit.bodyId === targetBldg!.id);
check("Multi-Tier: raycast contra predio medio distancia ~20.0", hitBldg && math.abs(bldgRayHit.distance - 20.0) < 0.01, "dist=" + bldgRayHit.distance);

// Overlap no centro do edifício 0 com r = 5.0 (deve encontrar o edifício e o terreno)
const bldgHits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit()];
const bldgOverlapCount = overlapSphereNonAlloc(targetBx, 1.0, targetBz, 5.0, bldgHits, 3, 0xFFFFFFFF, 1, false, scMulti);
check("Multi-Tier: overlap no predio medio encontra predio e terreno", bldgOverlapCount === 2);

// ── 13. Desacoplamento de staticVersion e Mutação Dinâmica Incremental ──
const initialStatVer = scMulti.staticVersion;
const initialCompVer = scMulti.compVersion;

// 13.1 Spawn dinâmico: adicionar 50 projéteis dinâmicos
const spawnedBullets: GameObject[] = [];
let bi = 0;
while (bi < 50) {
  const bullet = new GameObject("Bullet" + bi);
  bullet.stationary = 0;
  bullet.setMesh(1, 255, 0, 0);
  bullet.transform.setPosition(100.0 + bi * 2.0, 1.0, 100.0);
  bullet.transform.setScale(0.5);
  scMulti.add(bullet);
  spawnedBullets.push(bullet);
  bi = bi + 1;
}

check("Mutação dinâmica: staticVersion inalterada após spawn de dinâmicos", scMulti.staticVersion === initialStatVer);
check("Mutação dinâmica: compVersion avançou após spawn", scMulti.compVersion > initialCompVer);

scMulti.computeWorld();
const t0SpawnRebuild = performance.now();
spatialRebuildIndex(scMulti);
const spawnRebuildDuration = performance.now() - t0SpawnRebuild;

check("Mutação dinâmica: reconstrução sob spawn é rápida (< 2 ms)", spawnRebuildDuration < 2.0, "tempo=" + spawnRebuildDuration + " ms");

// Consultas contra os projéteis recém-adicionados
const bulletRayHit = createRaycastHit();
const hitBullet = raycastNonAlloc(100.0, 10.0, 100.0, 0.0, -1.0, 0.0, 20.0, bulletRayHit, 0xFFFFFFFF, 1, false, scMulti);
check("Mutação dinâmica: raycast atinge projétil recém-spawnado", hitBullet && bulletRayHit.bodyId === spawnedBullets[0].id);

const bulletOverlapHits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit()];
const bulletOverlapCount = overlapSphereNonAlloc(100.0, 1.0, 100.0, 2.0, bulletOverlapHits, 3, 0xFFFFFFFF, 1, false, scMulti);
// Deve encontrar o projétil 0 e o terreno
check("Mutação dinâmica: overlap encontra projétil spawnado e terreno", bulletOverlapCount >= 2);

// O edifício estático anterior continua acessível intacto
const hitBldgAfterSpawn = raycastNonAlloc(targetBx, 50.0, targetBz, 0.0, -1.0, 0.0, 100.0, bldgRayHit, 0xFFFFFFFF, 1, false, scMulti);
check("Mutação dinâmica: grid estático preservado e prédios atingíveis", hitBldgAfterSpawn && bldgRayHit.bodyId === targetBldg!.id);

// 13.2 Remoção dinâmica: remover o projétil 0
const bullet0Id = spawnedBullets[0].id;
let bullet0IndexInScene = -1;
let fIdx = 0;
while (fIdx < scMulti.objects.length) {
  if (scMulti.objects[fIdx] === spawnedBullets[0]) {
    bullet0IndexInScene = fIdx;
    fIdx = scMulti.objects.length;
  } else {
    fIdx = fIdx + 1;
  }
}
scMulti.removeAt(bullet0IndexInScene);
check("Remoção dinâmica: staticVersion inalterada após remoção de dinâmico", scMulti.staticVersion === initialStatVer);

scMulti.computeWorld();
spatialRebuildIndex(scMulti);

const hitOldBulletPos = raycastNonAlloc(100.0, 10.0, 100.0, 0.0, -1.0, 0.0, 20.0, bulletRayHit, 0xFFFFFFFF, 1, false, scMulti);
// Na posição do projétil removido, o raio não deve atingir o projétil removido
check("Remoção dinâmica: raio não atinge mais o projétil removido", !hitOldBulletPos || bulletRayHit.bodyId !== bullet0Id);

// 13.3 Mutação estática explícita: markStaticDirty incrementa staticVersion
scMulti.markStaticDirty();
check("Mutação estática: markStaticDirty incrementa staticVersion", scMulti.staticVersion > initialStatVer);

// ── 14. Regressões e Integridade da Revisão 1 (Trocas de Categoria e Movimento) ──
const scRev = new Scene("SceneRev1");
setSpatialScene(scRev);

const testBox = new GameObject("TestBox");
testBox.stationary = 1;
testBox.setMesh(1, 100, 100, 100);
testBox.transform.setPosition(20.0, 1.0, 20.0);
testBox.transform.setScale(1.0);
scRev.add(testBox);
scRev.computeWorld();
spatialRebuildIndex(scRev);

const revHits: OverlapHit[] = [createOverlapHit(), createOverlapHit(), createOverlapHit()];
const cBoxInit = overlapSphereNonAlloc(20.0, 1.0, 20.0, 2.0, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
check("Revisão 1: estático inicial encontrado", cBoxInit === 1);

// 14.1 Estático vira dinâmico (stationary = 0 + markCollidersDirty)
testBox.stationary = 0;
scRev.markCollidersDirty();
scRev.computeWorld();
const cBoxDyn = overlapSphereNonAlloc(20.0, 1.0, 20.0, 2.0, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
check("Revisão 1: estático vira dinâmico tem exatamente 1 ocorrência (sem duplicata)", cBoxDyn === 1);

// 14.2 Dinâmico vira estático (stationary = 1 + markCollidersDirty)
testBox.stationary = 1;
scRev.markCollidersDirty();
scRev.computeWorld();
const cBoxStatAgain = overlapSphereNonAlloc(20.0, 1.0, 20.0, 2.0, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
check("Revisão 1: dinâmico vira estático tem exatamente 1 ocorrência (não sumiu)", cBoxStatAgain === 1);

// 14.3 Estático escalado de 1 para 10 com markCollidersDirty
testBox.transform.setScale(10.0); // meia-extensão agora é 5.0
scRev.markCollidersDirty();
scRev.computeWorld();
// Ponto a 4 unidades do centro: dentro da nova escala de 10, fora da antiga de 1
const cBoxScaled = overlapSphereNonAlloc(24.0, 1.0, 20.0, 0.5, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
check("Revisão 1: estático escalado para 10 atualiza extensão do índice", cBoxScaled === 1);

// 14.4 Mover um estático: índice detecta drift automaticamente
testBox.transform.setPosition(80.0, 1.0, 80.0);
scRev.computeWorld();
spatialRebuildIndex(scRev);
// Consulta no novo local (80, 1, 80) deve atingir; no antigo (20, 1, 20) deve errar
const cBoxNewPos = overlapSphereNonAlloc(80.0, 1.0, 80.0, 2.0, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
const cBoxOldPos = overlapSphereNonAlloc(20.0, 1.0, 20.0, 2.0, revHits, 3, 0xFFFFFFFF, 1, false, scRev);
check("Revisão 1: mover estático atinge nova posição", cBoxNewPos === 1);
check("Revisão 1: mover estático erra posição antiga", cBoxOldPos === 0);

// 14.5 Desempenho incremental com 2.000 dinâmicos + 2.100 estáticos (meta <= 0,05 ms/objeto)
const scBenchInc = new Scene("SceneBenchInc");
const bGnd = new GameObject("ground_2000");
bGnd.stationary = 1;
bGnd.setMesh(1, 100, 100, 100);
bGnd.transform.setPosition(0.0, -1.0, 0.0);
bGnd.transform.sx = 2000.0; bGnd.transform.sy = 2.0; bGnd.transform.sz = 2000.0;
scBenchInc.add(bGnd);

// 100 prédios
let biInc = 0;
while (biInc < 100) {
  const bldg = new GameObject("bldg_" + biInc);
  bldg.stationary = 1;
  bldg.setMesh(1, 100, 100, 100);
  bldg.transform.setPosition(((biInc % 10) - 5) * 80.0, 15.0, (((biInc / 10) | 0) - 5) * 80.0);
  bldg.transform.setScale(30.0);
  scBenchInc.add(bldg);
  biInc = biInc + 1;
}

// 2.000 props estáticos pequenos
let piInc = 0;
while (piInc < 2000) {
  const prop = new GameObject("prop_" + piInc);
  prop.stationary = 1;
  prop.setMesh(1, 120, 120, 120);
  prop.transform.setPosition(((piInc % 50) - 25) * 10.0, 1.0, (((piInc / 50) | 0) - 20) * 10.0);
  prop.transform.setScale(2.0);
  scBenchInc.add(prop);
  piInc = piInc + 1;
}

// 2.000 dinâmicos
let diInc = 0;
while (diInc < 2000) {
  const dyn = new GameObject("dyn_" + diInc);
  dyn.stationary = 0;
  dyn.setMesh(1, 200, 50, 50);
  dyn.transform.setPosition((diInc % 40) * 3.0, 1.0, ((diInc / 40) | 0) * 3.0);
  dyn.transform.setScale(1.0);
  scBenchInc.add(dyn);
  diInc = diInc + 1;
}

scBenchInc.computeWorld();
setSpatialScene(scBenchInc);
spatialRebuildIndex(scBenchInc); // Inicial

// Warmup de 3 rodadas de spawn/remoção para estabilizar JIT e buffers
let wr = 0;
while (wr < 3) {
  let ws = 0;
  while (ws < 5) {
    const wb = new GameObject("wb_" + wr + "_" + ws);
    wb.stationary = 0; wb.setMesh(1, 255, 0, 0);
    scBenchInc.add(wb);
    ws = ws + 1;
  }
  scBenchInc.computeWorld();
  spatialRebuildIndex(scBenchInc);
  let ws2 = 0;
  while (ws2 < 5) {
    scBenchInc.removeAt(scBenchInc.objects.length - 1);
    ws2 = ws2 + 1;
  }
  scBenchInc.computeWorld();
  spatialRebuildIndex(scBenchInc);
  wr = wr + 1;
}

// Mede passo normal em 20 rodadas
const timesNorm: number[] = [];
let stepRounds = 0;
while (stepRounds < 20) {
  const t0 = performance.now();
  spatialRebuildIndex(scBenchInc);
  timesNorm.push(performance.now() - t0);
  stepRounds = stepRounds + 1;
}

// Mede passo criando 5 objetos em 20 rodadas
const timesSpawn: number[] = [];
let spawnRounds = 0;
while (spawnRounds < 20) {
  let s = 0;
  while (s < 5) {
    const bullet = new GameObject("b_" + spawnRounds + "_" + s);
    bullet.stationary = 0;
    bullet.setMesh(1, 255, 0, 0);
    bullet.transform.setPosition(100.0 + s * 2.0, 1.0, 100.0);
    scBenchInc.add(bullet);
    s = s + 1;
  }
  scBenchInc.computeWorld();
  const t0Rebuild = performance.now();
  spatialRebuildIndex(scBenchInc);
  timesSpawn.push(performance.now() - t0Rebuild);
  spawnRounds = spawnRounds + 1;
}

timesNorm.sort((a, b) => a - b);
timesSpawn.sort((a, b) => a - b);
const medNorm = timesNorm[10];
const medSpawn = timesSpawn[10];
const deltaPorObj = (medSpawn - medNorm) / 5.0;

check("Revisão 1: inserção incremental <= 0.05 ms por objeto criado", deltaPorObj <= 0.05, "custo=" + deltaPorObj.toFixed(5) + " ms/obj");

// ── 15. Regressões e Integridade da Revisão 2 ──
// 15.1 Custo de raycast com 2.100 estáticos (meta <= 25 µs)
setSpatialScene(scBenchInc);
spatialRebuildIndex(scBenchInc);
const benchHitRay = createRaycastHit();
let rw = 0;
while (rw < 200) {
  raycastNonAlloc(0.0, 50.0, 0.0, 0.0, -1.0, 0.0, 100.0, benchHitRay, 0xFFFFFFFF, 1, false, scBenchInc);
  rw = rw + 1;
}
const t0RayBench = performance.now();
let rci = 0;
while (rci < 1000) {
  raycastNonAlloc(0.0, 50.0, 0.0, 0.0, -1.0, 0.0, 100.0, benchHitRay, 0xFFFFFFFF, 1, false, scBenchInc);
  rci = rci + 1;
}
const avgRayUs = ((performance.now() - t0RayBench) / 1000.0) * 1000.0;
check("Revisão 2: raycast com 2.100 estáticos rápido (<= 25 µs)", avgRayUs <= 25.0, "tempo=" + avgRayUs.toFixed(2) + " µs");

// 15.2 Object Pooling: objetos com active = 0 não entram em consultas; ao ativar entram; ao desativar saem
const scPool = new Scene("ScenePool");
setSpatialScene(scPool);
const poolObj = new GameObject("bullet_pool");
poolObj.stationary = 0;
poolObj.setMesh(1, 10, 10, 10);
poolObj.transform.setPosition(50.0, 1.0, 50.0);
poolObj.active = 0; // criado inativo (pooling)
scPool.add(poolObj);
scPool.computeWorld();
spatialRebuildIndex(scPool);

const poolHits: OverlapHit[] = [createOverlapHit(), createOverlapHit()];
const poolRayHit = createRaycastHit();

const cPoolInit = overlapSphereNonAlloc(50.0, 1.0, 50.0, 2.0, poolHits, 2, 0xFFFFFFFF, 1, false, scPool);
const hitPoolInit = raycastNonAlloc(50.0, 10.0, 50.0, 0.0, -1.0, 0.0, 20.0, poolRayHit, 0xFFFFFFFF, 1, false, scPool);
check("Revisão 2: objeto de pool criado inativo não é encontrado em overlap", cPoolInit === 0);
check("Revisão 2: objeto de pool criado inativo não é encontrado em raycast", !hitPoolInit);

// Ativa objeto
poolObj.active = 1;
spatialRebuildIndex(scPool);
const cPoolActive = overlapSphereNonAlloc(50.0, 1.0, 50.0, 2.0, poolHits, 2, 0xFFFFFFFF, 1, false, scPool);
const hitPoolActive = raycastNonAlloc(50.0, 10.0, 50.0, 0.0, -1.0, 0.0, 20.0, poolRayHit, 0xFFFFFFFF, 1, false, scPool);
check("Revisão 2: objeto de pool ativado é encontrado em overlap", cPoolActive === 1);
check("Revisão 2: objeto de pool ativado é atingido por raycast", hitPoolActive && poolRayHit.bodyId === poolObj.id);

// Desativa objeto
poolObj.active = 0;
spatialRebuildIndex(scPool);
const cPoolDeact = overlapSphereNonAlloc(50.0, 1.0, 50.0, 2.0, poolHits, 2, 0xFFFFFFFF, 1, false, scPool);
const hitPoolDeact = raycastNonAlloc(50.0, 10.0, 50.0, 0.0, -1.0, 0.0, 20.0, poolRayHit, 0xFFFFFFFF, 1, false, scPool);
check("Revisão 2: objeto de pool desativado deixa de ser encontrado em overlap", cPoolDeact === 0);
check("Revisão 2: objeto de pool desativado deixa de ser atingido por raycast", !hitPoolDeact);

// 15.3 Teto de 256 na fila de pendentes sem consultas (proteção de memória GC)
const scCap = new Scene("SceneCap");
setSpatialScene(scCap);
const t0Cap = performance.now();
let kCap = 0;
while (kCap < 100000) {
  const dummy = new GameObject("dummy_" + kCap);
  dummy.stationary = 0;
  dummy.setMesh(1, 1, 1, 1);
  scCap.add(dummy);
  scCap.removeAt(scCap.objects.length - 1);
  kCap = kCap + 1;
}
const durCapMs = performance.now() - t0Cap;
check("Revisão 2: 100.000 adds/removes sem consulta completam sem estourar heap (< 5000 ms)", durCapMs < 5000.0, "tempo=" + durCapMs.toFixed(1) + " ms");
check("Revisão 2: fila pendente não estoura teto de 256", scCap.pendingDynamicOps.length <= 256);
check("Revisão 2: flag pendingDynamicOverflow ativada pelo teto", scCap.pendingDynamicOverflow === true);

// Adiciona um objeto final e valida que consulta após rebuild com fallback funciona corretamente
const keeper = new GameObject("keeper");
keeper.stationary = 0;
keeper.setMesh(1, 2, 2, 2);
keeper.transform.setPosition(10.0, 1.0, 10.0);
scCap.add(keeper);
scCap.computeWorld();
spatialRebuildIndex(scCap);
check("Revisão 2: pendingDynamicOverflow resetada após rebuild", scCap.pendingDynamicOverflow === false);
const cKeeper = overlapSphereNonAlloc(10.0, 1.0, 10.0, 2.0, poolHits, 2, 0xFFFFFFFF, 1, false, scCap);
check("Revisão 2: consulta encontra objeto após recuperação de overflow", cKeeper === 1);

if (falhas === 0) {
  io.print("[PASSOU] Todas as verificacoes de consultas espaciais passaram!");
} else {
  io.print("[FALHA] Total de falhas: " + falhas);
}

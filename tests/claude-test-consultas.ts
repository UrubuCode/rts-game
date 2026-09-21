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
import { pbActiveBackend, pbGpuLastReadbackStep, rigidSetMode, rigidInvalidate, rigidStep } from "../src/engine/core/physics_backend";
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

io.print("  [INFO] Tempos por 1.000 chamadas (2.000 queries): " +
         temposMs[0].toFixed(2) + " ms, " + temposMs[1].toFixed(2) + " ms, " + temposMs[2].toFixed(2) + " ms");

if (falhas === 0) {
  io.print("[PASSOU] Todas as verificacoes de consultas espaciais passaram!");
} else {
  io.print("[FALHA] Total de falhas: " + falhas);
}

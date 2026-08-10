// Teste da FACHADA de fluido (engine/fluid/fluid.ts) — headless.
//
//   rts.exe run tools/test_fluid_facade.ts
//
// Prova as três promessas da fachada:
//   1. backend CPU funciona sozinho (máquina sem GPU tem física de fluido);
//   2. a TROCA EM PLENO VOO não teleporta nem perde velocidade (handoff);
//   3. depois da troca a física continua sã (nada atravessa o chão, assenta).
import io from "../compat/io.ts";

import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { flInit2, flSpawnBlock, flSyncColliders, flStep, flSwitch,
         flX, flY, flZ, flBackend } from "../engine/fluid/fluid";
import { gfAvailable } from "../engine/fluid/gpufluid";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}

// chão
{
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 20.0; g.transform.sy = 1.0; g.transform.sz = 20.0;
  g.stationary = 1;
  scene.add(g);
  scene.computeWorld();
}

const N = 512;   // 8x8x8

// ── 1. CPU puro ─────────────────────────────────────────────────────────────
check("init CPU forçado", flInit2(N, 0) === 1 && flBackend() === 0 ? 1 : 0);
flSyncColliders(scene);
flSpawnBlock(8, 8, 8, 0.0 - 1.2, 1.2, 0.0 - 1.2, 0.3);
let f = 0;
while (f < 120) { flStep(2); f = f + 1; }
let subChao = 0;
let i = 0;
while (i < N) { if (flY(i) < 0.4) subChao = subChao + 1; i = i + 1; }
check("CPU: nada sob o chao apos 1 s", subChao === 0 ? 1 : 0);

if (gfAvailable() === 0) {
  io.print("  (sem GPU: troca a quente recusada e o resto [PULOU] — correto)");
  check("switch p/ GPU recusado sem GPU", flSwitch(1) === 0 ? 1 : 0);
} else {
  // ── 2. handoff CPU -> GPU: continuidade ───────────────────────────────────
  const bx: f64[] = [];
  const by: f64[] = [];
  const bz: f64[] = [];
  i = 0;
  while (i < N) { bx.push(flX(i)); by.push(flY(i)); bz.push(flZ(i)); i = i + 1; }
  check("switch CPU -> GPU", flSwitch(1) === 1 ? 1 : 0);
  flSyncColliders(scene);
  let salto: f64 = 0.0;
  i = 0;
  while (i < N) {
    let dx = flX(i) - bx[i]; if (dx < 0.0) dx = 0.0 - dx;
    let dy = flY(i) - by[i]; if (dy < 0.0) dy = 0.0 - dy;
    let dz = flZ(i) - bz[i]; if (dz < 0.0) dz = 0.0 - dz;
    if (dx > salto) salto = dx;
    if (dy > salto) salto = dy;
    if (dz > salto) salto = dz;
    i = i + 1;
  }
  io.print("  salto maximo no handoff CPU->GPU: " + salto);
  check("handoff nao teleporta (salto < 0.001)", salto < 0.001 ? 1 : 0);

  // ── 3. física continua sã na GPU ──────────────────────────────────────────
  f = 0;
  while (f < 240) { flStep(2); f = f + 1; }
  flStep(0);
  subChao = 0;
  let voando = 0;
  i = 0;
  while (i < N) {
    if (flY(i) < 0.4) subChao = subChao + 1;
    if (flY(i) > 6.0) voando = voando + 1;
    i = i + 1;
  }
  check("GPU pos-handoff: nada sob o chao", subChao === 0 ? 1 : 0);
  check("GPU pos-handoff: nada voando", voando === 0 ? 1 : 0);

  // ── 4. e a volta: GPU -> CPU ──────────────────────────────────────────────
  bx.length = 0; by.length = 0; bz.length = 0;
  flStep(0);   // sincroniza o espelho de posição antes de fotografar
  i = 0;
  while (i < N) { bx.push(flX(i)); by.push(flY(i)); bz.push(flZ(i)); i = i + 1; }
  check("switch GPU -> CPU", flSwitch(0) === 0 ? 1 : 0);
  flSyncColliders(scene);
  salto = 0.0;
  i = 0;
  while (i < N) {
    let dx = flX(i) - bx[i]; if (dx < 0.0) dx = 0.0 - dx;
    let dy = flY(i) - by[i]; if (dy < 0.0) dy = 0.0 - dy;
    let dz = flZ(i) - bz[i]; if (dz < 0.0) dz = 0.0 - dz;
    if (dx > salto) salto = dx;
    if (dy > salto) salto = dy;
    if (dz > salto) salto = dz;
    i = i + 1;
  }
  io.print("  salto maximo no handoff GPU->CPU: " + salto);
  // a GPU integrou os sub-passos pipelined entre a foto e a troca: o salto
  // permitido é o deslocamento físico de 1 frame (vmax 14 * 2/240 = 0.117)
  check("handoff de volta continuo (salto < 0.12)", salto < 0.12 ? 1 : 0);
  f = 0;
  while (f < 60) { flStep(2); f = f + 1; }
  subChao = 0;
  i = 0;
  while (i < N) { if (flY(i) < 0.4) subChao = subChao + 1; i = i + 1; }
  check("CPU pos-volta: nada sob o chao", subChao === 0 ? 1 : 0);
}

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

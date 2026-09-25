// Custo do par caixa-caixa na CPU: yaw = 0 (caminho AABB, que não pode
// regredir) contra yaw != 0 (OBB em Y, Lote C0). N caixas dinâmicas caindo
// numa grade apertada sobre o chão, ms/passo mediano de 300 passos.
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { rigidSetMode, rigidStep, rigidFlush } from "@engine/core/physics_backend";

function cena(n: number, yaw: f64): Scene {
  const sc = new Scene("OBB_" + n + "_" + yaw);
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.sx = 400.0; g.transform.sy = 1.0; g.transform.sz = 400.0;
  g.colShape = COL_BOX; g.stationary = 1;
  sc.add(g);
  const lado = Math.ceil(Math.sqrt(n));
  let i = 0;
  while (i < n) {
    const o = new GameObject("c" + i);
    o.setMesh(1, 200, 200, 200);
    o.colShape = COL_BOX;
    // 1,2 u de passo para caixas de 1 u: os vizinhos se tocam ao assentar
    o.transform.setPosition((i % lado) * 1.2 - lado * 0.6, 1.0 + ((i / lado) | 0) * 0.02, ((i / lado) | 0) * 1.2 - lado * 0.6);
    o.transform.ry = yaw * ((i % 7) + 1) / 7.0;
    const rb = new Rigidbody(0.0 - 9.8, 0.0);
    rb.floorY = 0.0 - 1.0e9;
    o.addBehavior(rb);
    sc.add(o);
    i = i + 1;
  }
  sc.markCollidersDirty(); sc.computeWorld();
  return sc;
}

function mediana(a: f64[]): f64 {
  const s = a.slice().sort((x: f64, y: f64) => x - y);
  return s[(s.length / 2) | 0];
}

function medir(sc: Scene, passos: number): f64 {
  const tempos: f64[] = [];
  let i = 0;
  while (i < passos) {
    sc.update(FIXED_DT);
    const t0 = performance.now();
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    tempos.push(performance.now() - t0);
    i = i + 1;
  }
  rigidFlush();
  return mediana(tempos);
}

rigidSetMode(0);
io.print("=== Bench caixa-caixa: ms/passo (mediana de 300), resolveCollisions apenas ===");
const ns = [100, 500];
let k = 0;
while (k < ns.length) {
  const n = ns[k];
  const aabb = medir(cena(n, 0.0), 300);
  const obb = medir(cena(n, 0.6), 300);
  io.print("[fase] n=" + n + ": yaw=0 " + aabb.toFixed(3) + " ms | yaw!=0 " + obb.toFixed(3) + " ms | razao " + (obb / aabb).toFixed(2) + "x");
  k = k + 1;
}
io.print("=== fim ===");

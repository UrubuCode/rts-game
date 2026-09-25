// Custo por passo dos eventos de contato (Lote B2): N caixas inscritas em
// repouso sobre o chão (pares persistentes re-testados a cada passo, Stay
// ligado) contra as mesmas caixas sem inscrição. Rodar com RTS_GC_DEBUG=1 para
// ver se há alocação por passo (nenhuma linha `rts-gc` entre as fases).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { Collider, SHAPE_BOX } from "@engine/core/collider";
import { Behavior } from "@engine/core/behavior";
import { ContactInfo, CONTACT_EVENTS_STAY, CONTACT_EVENTS_ENTER_EXIT } from "@engine/core/contact_events";
import { rigidSetMode, rigidStep, rigidFlush } from "@engine/core/physics_backend";

class Contador extends Behavior {
  n: number = 0;
  onCollisionEnter(c: ContactInfo): void { this.n = this.n + 1; }
  onCollisionStay(c: ContactInfo): void { this.n = this.n + 1; }
  onCollisionExit(c: ContactInfo): void { this.n = this.n + 1; }
}

function cena(n: number, events: number): Scene {
  const sc = new Scene("Bench_" + n + "_" + events);
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.sx = 400.0; g.transform.sy = 1.0; g.transform.sz = 400.0;
  g.colShape = COL_BOX; g.stationary = 1;
  sc.add(g);
  const lado = 40;
  let i = 0;
  while (i < n) {
    const o = new GameObject("c" + i);
    o.setMesh(1, 200, 200, 200);
    o.colShape = COL_BOX;
    o.transform.setPosition(((i % lado) - lado / 2) * 3.0, 1.0, (((i / lado) | 0) - 5) * 3.0);
    const rb = new Rigidbody(0.0 - 9.8, 0.0);
    rb.floorY = 0.0 - 1.0e9;
    o.addBehavior(rb);
    // Os MESMOS componentes em todas as variantes; só `events` muda. Sem isso o
    // delta media o `update` virtual dos behaviors extras, não os eventos.
    const c = new Collider(SHAPE_BOX);
    c.events = events;
    o.addBehavior(c);
    o.addBehavior(new Contador());
    sc.add(o);
    i = i + 1;
  }
  sc.markCollidersDirty(); sc.computeWorld();
  return sc;
}

function passos(sc: Scene, n: number): f64 {
  const t0 = performance.now();
  let i = 0;
  while (i < n) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    i = i + 1;
  }
  rigidFlush();
  return (performance.now() - t0) / n;
}

rigidSetMode(0);
io.print("=== Bench eventos de contato: ms/passo (2000 passos, caixas em repouso) ===");
const tamanhos = [0, 50, 200];
let k = 0;
while (k < tamanhos.length) {
  const n = tamanhos[k];
  const semEventos = cena(n, 0);
  passos(semEventos, 200);
  const base = passos(semEventos, 2000);
  const soEnterExit = cena(n, CONTACT_EVENTS_ENTER_EXIT);
  passos(soEnterExit, 200);
  const ee = passos(soEnterExit, 2000);
  const comEventos = cena(n, CONTACT_EVENTS_STAY);
  passos(comEventos, 200);
  const com = passos(comEventos, 2000);
  io.print("[fase] n=" + n + ": sem eventos " + base.toFixed(4) + " ms | enter/exit " + ee.toFixed(4) + " (+" + (ee - base).toFixed(4) + ") | com Stay " + com.toFixed(4) + " (+" + (com - base).toFixed(4) + ") ms | pares " + comEventos.contacts.count());
  k = k + 1;
}
io.print("=== fim ===");

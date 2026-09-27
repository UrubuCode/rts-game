// Teste de ALOCAÇÃO dos Gizmos (Task 7). Rodar com RTS_GC_DEBUG=1 e contar as
// linhas "rts-gc" ENTRE os marcadores "FASE" (as coletas antes do primeiro
// marcador são do setup). Portão: 1.000 e 10.000 quadros dão o MESMO número por
// fase.
//
//   RTS_GC_DEBUG=1 GC_N=1000  rts.exe run tests/claude-test-gizmos-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//   RTS_GC_DEBUG=1 GC_N=10000 rts.exe run tests/claude-test-gizmos-gc.ts 2>&1 | awk '/^FASE/{f=$2} /rts-gc/{c[f]++} END{for(k in c) print k, c[k]}'
//
// Fases: 16 objetos com um Behavior que sobrescreve onDrawGizmos(Selected)
// (linha, esfera, cone, ícone) e 16 com um desenhador registrado por tipo;
// `gizmosBegin` + `coletarGizmos` N vezes movendo a câmera, depois
// `gizmoIconAt` N vezes. `pintarGizmos` precisa de janela e fica de fora.
import io from "@compat/io.ts";
import process from "@compat/process.ts";
import { Scene } from "@engine/core/scene";
import { Behavior } from "@engine/core/behavior";
import type { GameObject } from "@engine/core/gameobject";
import { Gizmos, gizmosBegin, registerGizmoDrawer } from "@engine/core/gizmos";
import { coletarGizmos, gizmoIconAt, gizmosDoEditor } from "@editor/gizmo_pass";

const n = parseInt(process.env("GC_N") === "" ? "1000" : process.env("GC_N"));

export class SondaGizmo extends Behavior {
  a: Float64Array; b: Float64Array; dir: Float64Array;
  constructor() {
    super();
    this.a = new Float64Array(3); this.b = new Float64Array(3); this.dir = new Float64Array(3);
    this.dir[2] = 1.0;
  }
  typeName(): string { return "SondaGizmo"; }
  onDrawGizmos(g: Gizmos): void {
    this.a[0] = this.host.wx; this.a[1] = this.host.wy; this.a[2] = this.host.wz;
    this.b[0] = this.a[0] + 1.0; this.b[1] = this.a[1]; this.b[2] = this.a[2];
    g.color(0xFF8000);
    g.line(this.a, this.b);
    g.wireSphere(this.a, 0.5);
    g.icon("luz-pontual", this.a);
  }
  onDrawGizmosSelected(g: Gizmos): void { g.wireCone(this.a, this.dir, 2.0, 45.0); }
}
export class SondaTipo extends Behavior {
  typeName(): string { return "SondaTipo"; }
}
// SondaGizmo mora em tests/ (fora do catálogo gerado): o drawsGizmos gerado
// não a conhece, então um desenhador vazio liga o gizmoFlag dela.
registerGizmoDrawer("SondaGizmo", (g: Gizmos, dono: GameObject, comp: Behavior) => {});
const p = new Float64Array(3);
registerGizmoDrawer("SondaTipo", (g: Gizmos, dono: GameObject, comp: Behavior) => {
  p[0] = dono.transform.wx; p[1] = dono.transform.wy; p[2] = dono.transform.wz;
  g.color(0x9AC7F0); g.wireSphere(p, 1.0); g.icon("camera", p);
});

const sc = new Scene("sonda");
let k = 0;
while (k < 16) {
  const o = sc.createGameObject("G" + k); o.transform.setPosition(k - 8.0, 1.0, 12.0); o.addBehavior(new SondaGizmo());
  const t = sc.createGameObject("T" + k); t.transform.setPosition(k - 8.0, 3.0, 14.0); t.addBehavior(new SondaTipo());
  k = k + 1;
}
sc.computeWorld();
const pose = new Float64Array(8);
pose[5] = 1.05; pose[6] = 1280.0; pose[7] = 720.0;
const g = gizmosDoEditor;

// aquece fora das fases (buffers crescem aqui, uma vez)
gizmosBegin(g, pose); g.lado = 24.0; coletarGizmos(g, sc, 0);
io.print("aquecido: segmentos " + g.nSeg + " icones " + g.nIc);

io.print("FASE coletar " + n);
let f = 0;
while (f < n) {
  pose[0] = (f % 100) * 0.001;
  gizmosBegin(g, pose); g.lado = 24.0;
  coletarGizmos(g, sc, f % 32);
  f = f + 1;
}
io.print("FASE iconAt " + n);
let acc = 0;
f = 0;
while (f < n) {
  acc = acc + gizmoIconAt(g, 640.0 + (f % 50), 300.0);
  f = f + 1;
}
io.print("FASE fim " + acc);

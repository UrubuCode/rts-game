// Bancada de PERFORMANCE do core (headless, sem janela/GPU).
// Mede o custo por frame de computeWorld + resolveCollisions em N objetos —
// os dois laços que rodam TODO frame e definem quantas unidades a cena aguenta.
//
//   ./rts.exe run tools/bench_scene.ts
//
// Como não há relógio no subset numérico, a medida é o TEMPO DE PAREDE do
// processo: rode com `time` e compare antes/depois de uma otimização.
// FRAMES e as escalas são fixos pra comparação ser justa entre execuções.
import io from "rts:io";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";

const FRAMES = 60;

// Preenche a cena com N cubos numa grade densa (vizinhos SE tocando: é o pior
// caso realista de um RTS — um exército agrupado, não objetos espalhados).
function build(n: number): void {
  scene.clear();
  let i = 0;
  while (i < n) {
    const g = new GameObject("U");
    g.setMesh(1, 200, 200, 200);
    const c = i % 40;
    const r = (i / 40) | 0;
    g.transform.setPosition(c * 1.2 - 24.0, 1.0, r * 1.2 - 12.0);
    scene.add(g);
    i = i + 1;
  }
}

function run(n: number, label: string): void {
  build(n);
  let f = 0;
  while (f < FRAMES) {
    scene.computeWorld();
    scene.resolveCollisions();
    f = f + 1;
  }
  io.print("  [ok] " + label + " n=" + n + " x" + FRAMES + " frames");
}

io.print("== BENCH do core (mede pelo tempo de parede: use `time`) ==");
run(100, "grade densa");
run(200, "grade densa");
run(400, "grade densa");
io.print("== fim ==");

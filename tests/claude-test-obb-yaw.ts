// OBB em Y (Lote C0): uma caixa girada em yaw colide GIRADA na CPU.
// Caixas com ry = 0 seguem o caminho AABB exato de antes. Rust/GPU tratam
// caixa como AABB, então caixa girada pede o passo na CPU (como casca/offset).
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX, COL_SPHERE } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { rigidSetMode, rigidStep, rigidFlush, rigidNeedsFallback } from "@engine/core/physics_backend";
import { crAvailable } from "@engine/rigid/cpurigid";

let falhas = 0;
let total = 0;
function check(nome: string, cond: number): void {
  total = total + 1;
  if (cond !== 0) io.print("  [OK] " + nome);
  else { falhas = falhas + 1; io.print("  [FALHA] " + nome); }
}
const PI = 3.141592653589793;

function passos(sc: Scene, n: number): void {
  let i = 0;
  while (i < n) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    i = i + 1;
  }
  rigidFlush();
  sc.computeWorld();
}

function chao(sc: Scene): GameObject {
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.sx = 80.0; g.transform.sy = 1.0; g.transform.sz = 80.0;
  g.colShape = COL_BOX; g.stationary = 1;
  sc.add(g);
  return g;
}

/// Caixa ESTÁTICA de meia-extensão (hx, hy, hz) em (x, y, z) girada `yaw`.
function bloco(sc: Scene, nome: string, x: f64, y: f64, z: f64, hx: f64, hy: f64, hz: f64, yaw: f64): GameObject {
  const g = new GameObject(nome);
  g.setMesh(1, 120, 120, 120);
  g.colShape = COL_BOX; g.stationary = 1;
  g.transform.setPosition(x, y, z);
  g.transform.sx = hx * 2.0; g.transform.sy = hy * 2.0; g.transform.sz = hz * 2.0;
  g.transform.ry = yaw;
  sc.add(g);
  return g;
}

function corpo(sc: Scene, nome: string, forma: number, x: f64, y: f64, z: f64, s: f64, yaw: f64): GameObject {
  const g = new GameObject(nome);
  g.setMesh(forma === COL_BOX ? 1 : 4, 200, 200, 200);
  g.colShape = forma;
  g.transform.setPosition(x, y, z);
  g.transform.setScale(s);
  g.transform.ry = yaw;
  const rb = new Rigidbody(0.0 - 9.8, 0.0);
  rb.floorY = 0.0 - 1.0e9;
  g.addBehavior(rb);
  sc.add(g);
  return g;
}

rigidSetMode(0);
io.print("=== OBB em Y (Lote C0) ===");

// ── 1) yaw = 0: caminho AABB inalterado ───────────────────────────────────
{
  const sc = new Scene("AABB");
  chao(sc);
  const c = corpo(sc, "Caixa", COL_BOX, 0.0, 3.0, 0.0, 1.0, 0.0);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 240);
  io.print("  caixa assentou em y = " + c.transform.py.toFixed(3));
  check("1. yaw=0: caixa assenta sobre o chao (y ~ 1.0)", c.transform.py > 0.9 && c.transform.py < 1.1 ? 1 : 0);
}

// ── 2) bloco girado 45 graus: um corpo solto FORA da pegada girada mas DENTRO
//      da pegada AABB atravessa (com AABB ele pararia em cima) ─────────────
{
  const sc = new Scene("PegadaGirada");
  chao(sc);
  // bloco 4x1x1 (hx=2, hz=0.5) girado 45 graus, topo em y=3
  bloco(sc, "Bloco", 0.0, 2.5, 0.0, 2.0, 0.5, 0.5, PI / 4.0);
  // A AABB que o motor usava era a caixa SEM girar: |x| <= 2, |z| <= 0.5.
  // O ponto (1.5, 0) esta dentro dela, mas no bloco girado 45 graus fica a
  // 1.06 u do eixo longo (hz = 0.5): fora. Com OBB a esfera atravessa.
  const esf = corpo(sc, "Esfera", COL_SPHERE, 1.5, 5.0, 0.0, 0.4, 0.0);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 300);
  io.print("  esfera terminou em y = " + esf.transform.py.toFixed(3));
  check("2. esfera fora da pegada girada ATRAVESSA ate o chao (AABB antiga a segurava)", esf.transform.py < 1.0 ? 1 : 0);
  // e um corpo solto SOBRE o eixo longo girado para em cima
  const esf2 = corpo(sc, "Esfera2", COL_SPHERE, 1.0, 5.0, 0.0 - 1.0, 0.4, 0.0);
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 300);
  io.print("  esfera2 terminou em y = " + esf2.transform.py.toFixed(3));
  check("2. esfera sobre o bloco girado PARA em cima (y ~ 3.2)", esf2.transform.py > 3.0 && esf2.transform.py < 3.4 ? 1 : 0);
}

// ── 3) caixa-caixa girada: duas caixas 45 graus lado a lado, AABBs se cruzam
//      mas os OBBs nao: nenhum empurrao ─────────────────────────────────────
{
  const sc = new Scene("CaixaCaixa");
  chao(sc);
  // B (girada 45 graus) avanca em -x contra a FACE de A (yaw 0, fixa). A
  // quina de B alcanca 0.707: param com os centros a 0.5 + 0.707 = ~1.21 u.
  // Com a AABB antiga (B sem girar) parariam a 1.0. (Quina contra quina seria
  // degenerado: o SAT empurra na diagonal e B escorrega de lado.)
  const a = corpo(sc, "A", COL_BOX, 0.0, 0.5, 0.0, 1.0, 0.0);
  a.transform.mass = 0.0;   // A fixa (massa infinita), so B se move
  const b = corpo(sc, "B", COL_BOX, 3.0, 0.5, 0.0, 1.0, PI / 4.0);
  b.transform.vx = 0.0 - 3.0;
  b.transform.friction = 0.0; sc.objects[0].transform.friction = 0.0;   // desliza ate encostar
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 120);
  const dx = b.transform.px - a.transform.px;
  io.print("  separacao final girada: dx=" + dx.toFixed(3));
  check("3. quina girada encosta na face a ~1.21 u (AABB pararia a 1.0)", dx > 1.15 && dx < 1.3 ? 1 : 0);
  // as mesmas caixas com yaw=0 param a 1.0
  const sc2 = new Scene("CaixaCaixa0");
  chao(sc2);
  const a2 = corpo(sc2, "A", COL_BOX, 0.0, 0.5, 0.0, 1.0, 0.0);
  a2.transform.mass = 0.0;
  const b2 = corpo(sc2, "B", COL_BOX, 3.0, 0.5, 0.0, 1.0, 0.0);
  b2.transform.vx = 0.0 - 3.0;
  b2.transform.friction = 0.0; sc2.objects[0].transform.friction = 0.0;
  sc2.markCollidersDirty(); sc2.computeWorld();
  passos(sc2, 120);
  const dx2 = b2.transform.px - a2.transform.px;
  io.print("  com yaw=0: dx=" + dx2.toFixed(3));
  check("3. com yaw=0 param a ~1.0 u (caminho AABB)", dx2 > 0.9 && dx2 < 1.1 ? 1 : 0);
}

// ── 4) empurrao girado: caixa dinamica girada 45 contra parede reta; a
//      normal e a da PAREDE, a caixa e empurrada so em x ───────────────────
{
  const sc = new Scene("Parede");
  chao(sc);
  bloco(sc, "Parede", 3.0, 1.0, 0.0, 0.5, 1.0, 4.0, 0.0);
  const c = corpo(sc, "Caixa", COL_BOX, 2.0, 0.5, 0.0, 1.0, PI / 4.0);
  c.transform.vx = 4.0;
  sc.markCollidersDirty(); sc.computeWorld();
  passos(sc, 90);
  io.print("  caixa girada parou em x=" + c.transform.px.toFixed(3) + " z=" + c.transform.pz.toFixed(3));
  // quina girada alcança 0.707: para em x <= 2.5 - 0.707 = ~1.79 (AABB pararia em 2.0)
  check("4. a quina girada encosta na parede (x ~ 1.79, nao 2.0)", c.transform.px < 1.85 && c.transform.px > 1.6 ? 1 : 0);
  check("4. a normal e da parede: z nao muda", c.transform.pz > 0.0 - 0.05 && c.transform.pz < 0.05 ? 1 : 0);
}

// ── 5) backend: caixa girada pede a CPU ───────────────────────────────────
{
  const sc = new Scene("Fallback");
  chao(sc);
  corpo(sc, "Caixa", COL_BOX, 0.0, 3.0, 0.0, 1.0, 0.3);
  sc.markCollidersDirty(); sc.computeWorld();
  if (crAvailable() !== 0) {
    rigidSetMode(2);
    let cpu = 1;
    let i = 0;
    while (i < 30) { sc.update(FIXED_DT); if (rigidStep(sc, 0) === 0) sc.resolveCollisions(); else cpu = 0; i = i + 1; }
    check("5. com caixa girada o backend Rust recusa e o passo fica na CPU", cpu);
    check("5. rigidNeedsFallback responde 1", rigidNeedsFallback());
    rigidSetMode(0);
  } else {
    io.print("  (5. backend Rust indisponivel: pulado)");
  }
}

io.print("");
if (falhas === 0) io.print("[PASSOU] OBB em Y: " + total + " verificacoes");
else io.print("[FALHA] OBB em Y: " + falhas + " de " + total);

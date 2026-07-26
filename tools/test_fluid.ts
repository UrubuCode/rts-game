// Testes do SIMULADOR DE LÍQUIDO (headless, sem janela).
// Um fluido que "compila" não é um fluido: estes testes verificam o
// COMPORTAMENTO — desabar, espalhar, conservar volume e não explodir.
//
//   ./rts.exe run tools/test_fluid.ts     -> espera "[PASSOU]"
import io from "rts:io";
import math from "rts:math";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { Fluid } from "../scripts/fluid";

let pass = 0;
let fail = 0;
function ok(name: string, cond: number): void {
  if (cond !== 0) { pass = pass + 1; io.print("  ok   " + name); }
  else { fail = fail + 1; io.print("  FALHA " + name); }
}

// Monta uma coluna de partículas e devolve o simulador pronto.
function makeColumn(cols: number, rows: number, layers: number): Fluid {
  scene.clear();
  const sp: f64 = 0.62;
  let c = 0;
  while (c < cols) {
    let r = 0;
    while (r < rows) {
      let l = 0;
      while (l < layers) {
        const o = new GameObject("P");
        o.setMesh(4, 60, 140, 220);
        o.transform.setPosition(0.0 - 6.0 + c * sp, 1.0 + r * sp, 0.0 - 1.0 + l * sp);
        o.transform.setScale(0.62);
        scene.add(o);
        l = l + 1;
      }
      r = r + 1;
    }
    c = c + 1;
  }
  const f = new Fluid();
  f.setBounds(0.0 - 7.0, 7.0, 0.8, 0.0 - 5.0, 5.0);
  f.addFrom(scene, 0, scene.count() - 1);
  return f;
}

// estatísticas do corpo de líquido
function avgY(): f64 {
  let s: f64 = 0.0;
  let i = 0;
  while (i < scene.objects.length) { s = s + scene.objects[i].transform.py; i = i + 1; }
  return s / scene.objects.length;
}
function maxX(): f64 {
  let m: f64 = 0.0 - 1e9;
  let i = 0;
  while (i < scene.objects.length) { if (scene.objects[i].transform.px > m) m = scene.objects[i].transform.px; i = i + 1; }
  return m;
}
function anyNaN(): number {
  let i = 0;
  while (i < scene.objects.length) {
    const t: Transform = scene.objects[i].transform;
    // NaN é o único valor diferente de si mesmo
    if (t.px !== t.px || t.py !== t.py || t.pz !== t.pz) return 1;
    i = i + 1;
  }
  return 0;
}
function outOfBounds(minX: f64, maxXb: f64, minY: f64): number {
  let bad = 0;
  let i = 0;
  while (i < scene.objects.length) {
    const t: Transform = scene.objects[i].transform;
    // margem de 0.5: o passe reposiciona NA borda, não além
    if (t.px < minX - 0.5 || t.px > maxXb + 0.5 || t.py < minY - 0.5) bad = bad + 1;
    i = i + 1;
  }
  return bad;
}
function run(f: Fluid, steps: number): void {
  let s = 0;
  while (s < steps) { f.step(0.016, scene); s = s + 1; }
}

io.print("== a coluna DESABA (gravidade + pressao) ==");
{
  const f = makeColumn(5, 10, 3);
  const y0 = avgY();
  run(f, 120);   // ~2 s
  const y1 = avgY();
  io.print("  altura media: " + y0 + " -> " + y1);
  ok("  o nivel BAIXOU", y1 < y0 ? 1 : 0);
  ok("  nao afundou pelo chao", y1 > 0.5 ? 1 : 0);
}

io.print("== o liquido ESPALHA lateralmente (nao e uma pilha) ==");
{
  const f = makeColumn(5, 10, 3);
  const x0 = maxX();
  run(f, 120);
  const x1 = maxX();
  io.print("  borda direita: " + x0 + " -> " + x1);
  ok("  espalhou pro lado", x1 > x0 + 0.5 ? 1 : 0);
}

io.print("== ESTABILIDADE: nada de NaN nem fuga da caixa ==");
{
  const f = makeColumn(6, 8, 3);
  run(f, 300);   // 5 s
  ok("  nenhum NaN", anyNaN() === 0 ? 1 : 0);
  ok("  ninguem escapou da caixa", outOfBounds(0.0 - 7.0, 7.0, 0.8) === 0 ? 1 : 0);
}

io.print("== REPOUSO: o liquido assenta em vez de vibrar pra sempre ==");
{
  const f = makeColumn(5, 8, 3);
  run(f, 240);          // deixa assentar
  const ya = avgY();
  run(f, 60);           // mais 1 s
  const yb = avgY();
  let d = yb - ya;
  if (d < 0.0) d = 0.0 - d;
  io.print("  variacao de altura no ultimo segundo: " + d);
  ok("  assentou (variacao < 0.35)", d < 0.35 ? 1 : 0);
}

io.print("== VOLUME: as particulas nao colapsam num ponto ==");
{
  const f = makeColumn(5, 8, 3);
  run(f, 180);
  // distância média ao centro de massa: se colapsasse, iria a ~0
  let cx: f64 = 0.0; let cy: f64 = 0.0; let cz: f64 = 0.0;
  let i = 0;
  const n = scene.objects.length;
  while (i < n) {
    const t: Transform = scene.objects[i].transform;
    cx = cx + t.px; cy = cy + t.py; cz = cz + t.pz;
    i = i + 1;
  }
  cx = cx / n; cy = cy / n; cz = cz / n;
  let spread: f64 = 0.0;
  i = 0;
  while (i < n) {
    const t: Transform = scene.objects[i].transform;
    const ex = t.px - cx; const ey = t.py - cy; const ez = t.pz - cz;
    spread = spread + math.sqrt(ex * ex + ey * ey + ez * ez);
    i = i + 1;
  }
  spread = spread / n;
  io.print("  espalhamento medio: " + spread);
  ok("  manteve volume (nao colapsou)", spread > 0.8 ? 1 : 0);
}

io.print("");
io.print("== CANHAO: duas particulas opostas NAO se atravessam ==");
{
  // O teste que achou o bug: duas particulas disparadas uma contra a outra.
  // Com REST calibrado alto demais (6.5), o par nunca alcancava a densidade de
  // repouso, a pressao ficava ZERO e elas passavam direto uma pela outra.
  scene.clear();
  const a = new GameObject("A"); a.setMesh(4,1,1,1);
  a.transform.setPosition(0.0-3.0, 10.0, 0.0); a.transform.setScale(0.62); scene.add(a);
  const b = new GameObject("B"); b.setMesh(4,1,1,1);
  b.transform.setPosition(3.0, 10.0, 0.0); b.transform.setScale(0.62); scene.add(b);
  const f = new Fluid();
  f.setBounds(0.0-50.0, 50.0, 0.0-500.0, 0.0-50.0, 50.0);
  f.addFrom(scene, 0, 1);
  f.vx[0] = 8.0; f.vx[1] = 0.0 - 8.0;
  let keIni: f64 = f.vx[0]*f.vx[0] + f.vx[1]*f.vx[1];
  let pico: f64 = 0.0;
  let s = 0;
  while (s < 150) {
    const ke = f.vx[0]*f.vx[0] + f.vx[1]*f.vx[1];
    if (ke > pico) pico = ke;
    f.step(0.023, scene);
    s = s + 1;
  }
  ok("  A nao ultrapassou B", f.trs[0].px < f.trs[1].px ? 1 : 0);
  ok("  o impacto nao CRIOU energia", pico <= keIni + 1.0 ? 1 : 0);
  ok("  as duas caem pela gravidade", (f.vy[0] < 0.0 - 5.0 && f.vy[1] < 0.0 - 5.0) ? 1 : 0);
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
if (fail > 0) io.print("[FALHOU]");
else io.print("[PASSOU]");

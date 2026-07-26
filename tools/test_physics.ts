// TESTES DO MOTOR DE FÍSICA como SISTEMA — não features isoladas.
//
// Cada estação monta um cenário clássico de física de jogo e verifica o
// COMPORTAMENTO EMERGENTE: o berço de Newton propaga impulso pela fila, o
// bilhar espalha e freia, a torre cai quando atingida, materiais diferentes
// deslizam distâncias diferentes. São os testes que pegam bugs de interação
// entre subsistemas (colisor + impulso + material + massa), que os testes
// unitários de cada peça não veem.
//
//   ./rts.exe run tools/test_physics.ts   -> espera "[PASSOU]"
import io from "rts:io";
import math from "rts:math";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { PhysicsMaterial, MAT_ICE, MAT_STONE, MAT_RUBBER, MAT_WOOD, MAT_METAL } from "../scripts/physicsmaterial";

let pass = 0;
let fail = 0;
function ok(name: string, cond: number): void {
  if (cond !== 0) { pass = pass + 1; io.print("  ok   " + name); }
  else { fail = fail + 1; io.print("  FALHA " + name); }
}

/// Chão largo padrão das estações. `fr` é o atrito do piso.
function ground(fr: f64): GameObject {
  const g = new GameObject("Chao");
  g.setMesh(1, 70, 78, 90);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 120.0; g.transform.sy = 1.0; g.transform.sz = 40.0;
  g.stationary = 1;
  g.transform.friction = fr;
  scene.add(g);
  return g;
}

/// Bola dinâmica com material físico.
function ball(x: f64, y: f64, z: f64, s: f64, mat: number): GameObject {
  const b = new GameObject("Bola");
  b.setMesh(4, 200, 200, 200);
  b.transform.setPosition(x, y, z);
  b.transform.setScale(s);
  b.addBehavior(new PhysicsMaterial(mat));
  scene.add(b);
  return b;
}

/// Caixa dinâmica com material físico.
function box(x: f64, y: f64, z: f64, s: f64, mat: number): GameObject {
  const b = new GameObject("Caixa");
  b.setMesh(1, 200, 160, 120);
  b.transform.setPosition(x, y, z);
  b.transform.setScale(s);
  b.addBehavior(new PhysicsMaterial(mat));
  scene.add(b);
  return b;
}

/// Um passo do MUNDO inteiro: scripts (materiais reaplicam), gravidade manual
/// nos dinâmicos, transformadas e colisão. É o mesmo laço da demo visual.
function stepWorld(steps: number): void {
  let s = 0;
  while (s < steps) {
    scene.update(0.016);
    let i = 0;
    while (i < scene.objects.length) {
      const o = scene.objects[i];
      if (o.stationary === 0) {
        const t: Transform = o.transform;
        t.vy = t.vy - 9.8 * 0.016;
        t.px = t.px + t.vx * 0.016;
        t.py = t.py + t.vy * 0.016;
        t.pz = t.pz + t.vz * 0.016;
      }
      i = i + 1;
    }
    scene.computeWorld();
    scene.resolveCollisions();
    s = s + 1;
  }
}

function anyNaN(): number {
  let i = 0;
  while (i < scene.objects.length) {
    const t: Transform = scene.objects[i].transform;
    if (t.px !== t.px || t.py !== t.py || t.pz !== t.pz) return 1;
    i = i + 1;
  }
  return 0;
}

io.print("== BERCO DE NEWTON: o impulso atravessa a fila ==");
{
  // 5 bolas encostadas; a primeira chega com velocidade. Numa cadeia de massas
  // iguais, o momento tem de PROPAGAR até a última — se cada colisão perdesse
  // momento (o bug clássico de resolver o par já separado), a fila só amassava.
  scene.clear();
  ground(0.05);   // quase sem atrito, para medir só a propagação
  const b0 = ball(0.0 - 6.0, 1.0, 0.0, 1.0, MAT_METAL);
  b0.transform.vx = 8.0;
  let i = 0;
  while (i < 4) {
    const b = ball(0.0 - 2.0 + i * 1.02, 1.0, 0.0, 1.0, MAT_METAL);
    b.transform.friction = 0.05;
    i = i + 1;
  }
  b0.transform.friction = 0.05;
  const last = scene.objects[scene.objects.length - 1];
  const lastX0: f64 = last.transform.px;
  stepWorld(200);
  // O critério é DESLOCAMENTO, não velocidade final: o impulso atravessa a
  // fila, a última bola sai andando e o atrito a para dentro da janela — medir
  // vx no fim só diz que o atrito funciona, não que a propagação funcionou.
  const disp: f64 = last.transform.px - lastX0;
  io.print("  ultima bola deslocou " + disp);
  ok("  a ULTIMA bola foi EMPURRADA (> 0.5)", disp > 0.5 ? 1 : 0);
  ok("  a primeira desacelerou", b0.transform.vx < 6.0 ? 1 : 0);
  ok("  sem NaN", anyNaN() === 0 ? 1 : 0);
}

io.print("== BILHAR: a branca abre o triangulo ==");
{
  // Bola rápida contra um triângulo de 6. Tem de ESPALHAR (o span em Z cresce)
  // e depois FREAR pelo atrito — momento entra, se distribui e dissipa.
  scene.clear();
  ground(0.4);
  // Bola de bilhar de verdade: restituição ALTA (0.9) e atrito baixo. Com
  // material de pedra (e=0.15) a colisão é quase plástica: as bolas amassam
  // juntas e seguem em bloco — coerente, mas não é bilhar. Sem componente de
  // material (os valores ficam direto no Transform e nada os reaplica).
  function poolBall(x: f64, z: f64): GameObject {
    const b = new GameObject("Bilhar");
    b.setMesh(4, 230, 230, 230);
    b.transform.setPosition(x, 1.0, z);
    b.transform.setScale(1.0);
    b.transform.restitution = 0.9;
    b.transform.friction = 0.2;
    scene.add(b);
    return b;
  }
  // tacada levemente DESCENTRADA (z=0.3): a central perfeita transfere tudo em
  // linha reta e não abre o triângulo
  const cue = poolBall(0.0 - 8.0, 0.3);
  cue.transform.vx = 14.0;
  // triângulo: 1 + 2 + 3
  poolBall(0.0, 0.0);
  poolBall(1.0, 0.55);
  poolBall(1.0, 0.0 - 0.55);
  poolBall(2.0, 1.1);
  poolBall(2.0, 0.0);
  poolBall(2.0, 0.0 - 1.1);
  stepWorld(90);
  let zMin: f64 = 1e9; let zMax: f64 = 0.0 - 1e9;
  let i = 1;
  while (i < scene.objects.length) {
    const t = scene.objects[i].transform;
    if (t.pz < zMin) zMin = t.pz;
    if (t.pz > zMax) zMax = t.pz;
    i = i + 1;
  }
  io.print("  espalhamento em Z: " + (zMax - zMin));
  ok("  o triangulo ABRIU (span Z > 2.6)", (zMax - zMin) > 2.6 ? 1 : 0);
  stepWorld(400);
  let vtot: f64 = 0.0;
  i = 1;
  while (i < scene.objects.length) {
    const t = scene.objects[i].transform;
    vtot = vtot + math.sqrt(t.vx * t.vx + t.vz * t.vz);
    i = i + 1;
  }
  io.print("  |v| total apos frear: " + vtot);
  ok("  o atrito FREOU a mesa", vtot < 7.0 ? 1 : 0);
  ok("  sem NaN", anyNaN() === 0 ? 1 : 0);
}

io.print("== DEMOLICAO: bola pesada derruba a torre ==");
{
  // Torre de 4 caixas de madeira; uma bola de METAL (densa) chega veloz.
  // A torre tem de se DESMANCHAR — massa alta vence massa baixa.
  scene.clear();
  ground(0.5);
  let i = 0;
  while (i < 4) {
    box(6.0, 1.0 + i * 1.01, 0.0, 1.0, MAT_WOOD);
    i = i + 1;
  }
  const wreck = ball(0.0 - 8.0, 1.2, 0.0, 1.6, MAT_METAL);
  wreck.transform.vx = 16.0;
  stepWorld(300);
  // quanto as caixas saíram do lugar?
  let moved = 0;
  i = 1;
  while (i <= 4) {
    const t = scene.objects[i].transform;
    const dx = t.px - 6.0;
    if (dx > 1.0 || dx < 0.0 - 1.0 || t.pz > 1.0 || t.pz < 0.0 - 1.0) moved = moved + 1;
    i = i + 1;
  }
  io.print("  caixas deslocadas: " + moved + "/4");
  ok("  a torre foi DERRUBADA (>= 2 caixas)", moved >= 2 ? 1 : 0);
  ok("  sem NaN", anyNaN() === 0 ? 1 : 0);
}

io.print("== CORRIDA DE MATERIAIS: gelo desliza mais que pedra ==");
{
  // Três caixas lançadas à mesma velocidade sobre o mesmo chão. A distância
  // final tem de ORDENAR pelos atritos: gelo > madeira > pedra.
  scene.clear();
  ground(0.6);
  const ice = box(0.0 - 10.0, 1.0, 0.0 - 4.0, 1.0, MAT_ICE);
  const wood = box(0.0 - 10.0, 1.0, 0.0, 1.0, MAT_WOOD);
  const stone = box(0.0 - 10.0, 1.0, 4.0, 1.0, MAT_STONE);
  ice.transform.vx = 12.0;
  wood.transform.vx = 12.0;
  stone.transform.vx = 12.0;
  stepWorld(400);
  io.print("  gelo=" + ice.transform.px + " madeira=" + wood.transform.px + " pedra=" + stone.transform.px);
  ok("  gelo foi mais longe que madeira", ice.transform.px > wood.transform.px ? 1 : 0);
  ok("  madeira foi mais longe que pedra", wood.transform.px > stone.transform.px ? 1 : 0);
}

io.print("== QUIQUES: borracha volta mais alto que madeira ==");
{
  scene.clear();
  ground(0.5);
  const rub = ball(0.0 - 3.0, 7.0, 0.0, 1.0, MAT_RUBBER);
  const wod = ball(3.0, 7.0, 0.0, 1.0, MAT_WOOD);
  let rubMax: f64 = 0.0; let wodMax: f64 = 0.0;
  let hitR = 0; let hitW = 0;
  let s = 0;
  while (s < 300) {
    stepWorld(1);
    if (rub.transform.py < 1.6) hitR = 1;
    if (wod.transform.py < 1.6) hitW = 1;
    if (hitR !== 0 && rub.transform.py > rubMax) rubMax = rub.transform.py;
    if (hitW !== 0 && wod.transform.py > wodMax) wodMax = wod.transform.py;
    s = s + 1;
  }
  io.print("  borracha voltou a " + rubMax + " | madeira a " + wodMax);
  ok("  borracha quica mais alto", rubMax > wodMax + 0.5 ? 1 : 0);
  ok("  borracha quicou de verdade (> 2)", rubMax > 2.0 ? 1 : 0);
}

io.print("== ESTABILIDADE: pilha de caixas NAO explode sozinha ==");
{
  // Uma pilha 2x2x2 em repouso tem de FICAR em repouso — é o teste que pega
  // energia fantasma na colisão (o equivalente rígido do líquido que fervia).
  scene.clear();
  ground(0.5);
  let i = 0;
  while (i < 8) {
    box((i % 2) * 1.01 - 0.5, 1.0 + (((i / 2) | 0) % 2) * 1.01, ((i / 4) | 0) * 1.01 - 0.5, 1.0, MAT_WOOD);
    i = i + 1;
  }
  stepWorld(120);   // assenta
  // posições após assentar
  const px0: f64[] = []; const py0: f64[] = [];
  i = 1;
  while (i < scene.objects.length) {
    px0.push(scene.objects[i].transform.px);
    py0.push(scene.objects[i].transform.py);
    i = i + 1;
  }
  stepWorld(300);   // mais 5 s
  let drift: f64 = 0.0;
  i = 1;
  while (i < scene.objects.length) {
    const t = scene.objects[i].transform;
    const dx = t.px - px0[i - 1];
    const dy = t.py - py0[i - 1];
    drift = drift + math.sqrt(dx * dx + dy * dy);
    i = i + 1;
  }
  io.print("  deriva total da pilha em 5s: " + drift);
  ok("  a pilha ficou PARADA (deriva < 1)", drift < 1.0 ? 1 : 0);
  ok("  sem NaN", anyNaN() === 0 ? 1 : 0);
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
if (fail > 0) io.print("[FALHOU]");
else io.print("[PASSOU]");

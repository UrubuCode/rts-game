// Testes de CORRETUDE do core (headless): garantem que as otimizações de
// resolveCollisions (grid espacial) e computeWorld (fast path) preservam o
// comportamento. Rodar sempre que mexer em engine/core/scene.ts.
//
//   ./rts.exe run tools/test_scene.ts     -> espera "[PASSOU]"
import io from "rts:io";
import math from "rts:math";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";

let pass = 0;
let fail = 0;

function ok(name: string, cond: number): void {
  if (cond !== 0) { pass = pass + 1; io.print("  ok   " + name); }
  else { fail = fail + 1; io.print("  FALHA " + name); }
}
function near(name: string, got: f64, want: f64, tol: f64): void {
  let d = got - want;
  if (d < 0.0) d = 0.0 - d;
  if (d <= tol) { pass = pass + 1; io.print("  ok   " + name + " = " + got); }
  else { fail = fail + 1; io.print("  FALHA " + name + ": esperado ~" + want + ", veio " + got); }
}
function mk(name: string, x: f64, y: f64, z: f64, s: f64): GameObject {
  const g = new GameObject(name);
  g.setMesh(1, 200, 200, 200);
  g.transform.setPosition(x, y, z);
  g.transform.setScale(s);
  return g;
}
function dist(a: GameObject, b: GameObject): f64 {
  const dx = a.transform.px - b.transform.px;
  const dy = a.transform.py - b.transform.py;
  const dz = a.transform.pz - b.transform.pz;
  return math.sqrt(dx * dx + dy * dy + dz * dz);
}

io.print("== COLISAO: dois objetos sobrepostos se SEPARAM ==");
{
  scene.clear();
  const a = mk("A", 0.0, 1.0, 0.0, 1.0);   // raio 0.5
  const b = mk("B", 0.4, 1.0, 0.0, 1.0);   // raio 0.5 -> soma 1.0, dist 0.4 = sobrepoe
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  const d = dist(a, b);
  near("  distancia apos separar", d, 1.0, 0.001);
}

io.print("== COLISAO: objetos LONGE nao se movem ==");
{
  scene.clear();
  const a = mk("A", 0.0, 1.0, 0.0, 1.0);
  const b = mk("B", 10.0, 1.0, 0.0, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  A.x intacto", a.transform.px, 0.0, 0.0001);
  near("  B.x intacto", b.transform.px, 10.0, 0.0001);
}

io.print("== COLISAO: ESTATICO nao se move, o outro absorve tudo ==");
{
  scene.clear();
  const a = mk("Parede", 0.0, 1.0, 0.0, 1.0);
  a.stationary = 1;
  const b = mk("B", 0.4, 1.0, 0.0, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  estatico ficou parado", a.transform.px, 0.0, 0.0001);
  near("  movel foi empurrado", b.transform.px, 1.0, 0.001);
}

io.print("== COLISAO: dois ESTATICOS sobrepostos nao mexem ==");
{
  scene.clear();
  const a = mk("A", 0.0, 1.0, 0.0, 1.0); a.stationary = 1;
  const b = mk("B", 0.4, 1.0, 0.0, 1.0); b.stationary = 1;
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  A intacto", a.transform.px, 0.0, 0.0001);
  near("  B intacto", b.transform.px, 0.4, 0.0001);
}

io.print("== COLISAO: o GRID acha pares alem do limiar de 24 objetos ==");
{
  // 40 objetos espalhados (usa o caminho do GRID) + 1 par sobreposto no meio.
  scene.clear();
  let i = 0;
  while (i < 40) { scene.add(mk("Longe", 100.0 + i * 5.0, 1.0, 0.0, 1.0)); i = i + 1; }
  const a = mk("A", 0.0, 1.0, 0.0, 1.0);
  const b = mk("B", 0.4, 1.0, 0.0, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  par sobreposto separado (via grid)", dist(a, b), 1.0, 0.001);
}

io.print("== COLISAO: par em CELULAS VIZINHAS e detectado ==");
{
  // objetos grandes: a celula do grid = 2x o maior raio. Um par que se toca
  // na fronteira de duas celulas so e achado se a vizinhanca for varrida.
  scene.clear();
  let i = 0;
  while (i < 30) { scene.add(mk("Longe", 200.0 + i * 9.0, 1.0, 0.0, 1.0)); i = i + 1; }
  const a = mk("A", 0.0, 1.0, 0.0, 2.0);    // raio 1.0
  const b = mk("B", 1.6, 1.0, 0.0, 2.0);    // soma 2.0, dist 1.6 -> sobrepoe
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  separou na fronteira de celula", dist(a, b), 2.0, 0.001);
}

io.print("== COLISAO: par em Z tambem (nao so X) ==");
{
  scene.clear();
  let i = 0;
  while (i < 30) { scene.add(mk("Longe", 300.0 + i * 5.0, 1.0, 0.0, 1.0)); i = i + 1; }
  const a = mk("A", 0.0, 1.0, 0.0, 1.0);
  const b = mk("B", 0.0, 1.0, 0.4, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  separou no eixo Z", dist(a, b), 1.0, 0.001);
}

io.print("== COLISAO: coordenadas NEGATIVAS (floor do grid) ==");
{
  scene.clear();
  let i = 0;
  while (i < 30) { scene.add(mk("Longe", 400.0 + i * 5.0, 1.0, 0.0, 1.0)); i = i + 1; }
  const a = mk("A", 0.0 - 7.3, 1.0, 0.0 - 4.1, 1.0);
  const b = mk("B", 0.0 - 6.9, 1.0, 0.0 - 4.1, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();
  near("  separou em coords negativas", dist(a, b), 1.0, 0.001);
}

io.print("== COMPUTEWORLD: raiz copia local -> mundo ==");
{
  scene.clear();
  const a = mk("A", 3.0, 4.0, 5.0, 1.0);
  scene.add(a);
  scene.computeWorld();
  near("  wx", a.transform.wx, 3.0, 0.0001);
  near("  wy", a.transform.wy, 4.0, 0.0001);
  near("  wz", a.transform.wz, 5.0, 0.0001);
}

io.print("== COMPUTEWORLD: filho soma offset do pai (yaw 0 = fast path) ==");
{
  scene.clear();
  const p = mk("Pai", 10.0, 0.0, 0.0, 1.0);
  const c = mk("Filho", 2.0, 1.0, 0.0, 1.0);
  scene.add(p); scene.add(c);
  c.parent = 0;
  scene.computeWorld();
  near("  filho.wx", c.transform.wx, 12.0, 0.0001);
  near("  filho.wy", c.transform.wy, 1.0, 0.0001);
}

io.print("== COMPUTEWORLD: pai com YAW rotaciona o offset do filho ==");
{
  scene.clear();
  const p = mk("Pai", 0.0, 0.0, 0.0, 1.0);
  p.transform.ry = 1.5707963;          // 90 graus
  const c = mk("Filho", 2.0, 0.0, 0.0, 1.0);
  scene.add(p); scene.add(c);
  c.parent = 0;
  scene.computeWorld();
  // offset (2,0,0) girado 90 graus no yaw -> (0,0,-2) na convencao do motor
  near("  filho.wx", c.transform.wx, 0.0, 0.001);
  near("  filho.wz", c.transform.wz, 0.0 - 2.0, 0.001);
}

io.print("== COMPUTEWORLD: pai com indice MAIOR que o filho (fora de ordem) ==");
{
  scene.clear();
  const c = mk("Filho", 2.0, 0.0, 0.0, 1.0);   // indice 0
  const p = mk("Pai", 10.0, 0.0, 0.0, 1.0);    // indice 1
  scene.add(c); scene.add(p);
  c.parent = 1;                                 // pai vem DEPOIS
  scene.computeWorld();
  near("  filho resolvido na passada extra", c.transform.wx, 12.0, 0.0001);
}

io.print("== COMPUTEWORLD: cadeia de 3 niveis ==");
{
  scene.clear();
  const a = mk("A", 1.0, 0.0, 0.0, 1.0);
  const b = mk("B", 2.0, 0.0, 0.0, 1.0);
  const c = mk("C", 4.0, 0.0, 0.0, 1.0);
  scene.add(a); scene.add(b); scene.add(c);
  b.parent = 0; c.parent = 1;
  scene.computeWorld();
  near("  neto acumula a cadeia", c.transform.wx, 7.0, 0.0001);
}

io.print("== COLISAO: FILHO nao e empurrado pelo passe posicional ==");
{
  // O passe escreve em px/py/pz. Num filho isso e offset RELATIVO ao pai, entao
  // compara-lo com a coord de outro objeto empurraria a peca errada.
  scene.clear();
  const pai = mk("Pai", 50.0, 1.0, 0.0, 1.0);
  const filho = mk("Filho", 0.0, 0.0, 0.0, 1.0);   // local (0,0,0) = colado no pai
  const solto = mk("Solto", 0.2, 1.0, 0.0, 1.0);   // sobrepoe o LOCAL do filho
  scene.add(pai); scene.add(filho); scene.add(solto);
  filho.parent = 0;
  scene.computeWorld();
  scene.resolveCollisions();
  near("  filho manteve o offset local", filho.transform.px, 0.0, 0.0001);
  near("  filho manteve py", filho.transform.py, 0.0, 0.0001);
}

io.print("== REMOVEAT: compacta e corrige os indices de parent ==");
{
  scene.clear();
  const a = mk("A", 0.0, 0.0, 0.0, 1.0);   // 0
  const b = mk("B", 1.0, 0.0, 0.0, 1.0);   // 1
  const c = mk("C", 2.0, 0.0, 0.0, 1.0);   // 2
  const d = mk("D", 3.0, 0.0, 0.0, 1.0);   // 3
  scene.add(a); scene.add(b); scene.add(c); scene.add(d);
  d.parent = 2;    // D é filho de C
  scene.removeAt(1);   // remove B -> C vira 1, D vira 2
  ok("  sobraram 3", scene.objects.length === 3 ? 1 : 0);
  ok("  ordem preservada (A,C,D)",
     (scene.objects[0].name === "A" && scene.objects[1].name === "C" && scene.objects[2].name === "D") ? 1 : 0);
  ok("  parent de D remapeado p/ 1", scene.objects[2].parent === 1 ? 1 : 0);
}

io.print("== REMOVEAT: filho do REMOVIDO vira raiz ==");
{
  scene.clear();
  const a = mk("Pai", 0.0, 0.0, 0.0, 1.0);
  const b = mk("Filho", 1.0, 0.0, 0.0, 1.0);
  scene.add(a); scene.add(b);
  b.parent = 0;
  scene.removeAt(0);   // remove o pai
  ok("  sobrou 1", scene.objects.length === 1 ? 1 : 0);
  ok("  orfao virou raiz", scene.objects[0].parent < 0 ? 1 : 0);
}

io.print("== REMOVEAT: remover o ULTIMO nao quebra ==");
{
  scene.clear();
  scene.add(mk("A", 0.0, 0.0, 0.0, 1.0));
  scene.add(mk("B", 1.0, 0.0, 0.0, 1.0));
  scene.removeAt(1);
  ok("  sobrou 1", scene.objects.length === 1 ? 1 : 0);
  ok("  e o A", scene.objects[0].name === "A" ? 1 : 0);
}

io.print("== REMOVEAT: indice invalido e ignorado ==");
{
  scene.clear();
  scene.add(mk("A", 0.0, 0.0, 0.0, 1.0));
  scene.removeAt(9);
  scene.removeAt(0 - 1);
  ok("  cena intacta", scene.objects.length === 1 ? 1 : 0);
}

io.print("== ESPELHO trs[]: acompanha objects[] em toda mutacao ==");
{
  // O espelho paralelo de transforms (Scene.trs) é o que faz os laços quentes
  // pularem o hop `objects[i].transform`. Se ele divergir da lista, o motor
  // move o objeto ERRADO — e silenciosamente. Estes testes travam isso.
  scene.clear();
  const a = mk("A", 1.0, 0.0, 0.0, 1.0);
  const b = mk("B", 2.0, 0.0, 0.0, 1.0);
  const c = mk("C", 3.0, 0.0, 0.0, 1.0);
  scene.add(a); scene.add(b); scene.add(c);
  ok("  add: tamanhos batem", scene.trs.length === scene.objects.length ? 1 : 0);
  ok("  add: trs[1] e o transform de B", scene.trs[1] === b.transform ? 1 : 0);

  scene.removeAt(1);   // remove B
  ok("  removeAt: tamanhos batem", scene.trs.length === scene.objects.length ? 1 : 0);
  ok("  removeAt: trs[1] agora e o de C", scene.trs[1] === c.transform ? 1 : 0);

  scene.clear();
  ok("  clear: espelho zerado", scene.trs.length === 0 ? 1 : 0);

  // moveSubtree reordena a lista inteira: o espelho tem que seguir
  scene.clear();
  const p1 = mk("P1", 0.0, 0.0, 0.0, 1.0);
  const p2 = mk("P2", 1.0, 0.0, 0.0, 1.0);
  const p3 = mk("P3", 2.0, 0.0, 0.0, 1.0);
  scene.add(p1); scene.add(p2); scene.add(p3);
  scene.moveSubtree(2, 0, 0 - 1);   // move P3 pro início
  let sync = 1;
  let q = 0;
  while (q < scene.objects.length) {
    if (scene.trs[q] !== scene.objects[q].transform) sync = 0;
    q = q + 1;
  }
  ok("  moveSubtree: espelho em sincronia", sync);
}

io.print("== CACHE de colisores: invalida quando a cena muda ==");
{
  // `cIdx` (quem colide) é cacheado entre frames e só reconstruído quando
  // `colDirty` marca. Se a invalidação falhar, objetos novos NÃO colidem — ou
  // removidos continuam colidindo, com índices que já não existem.
  scene.clear();
  const a = mk("A", 0.0, 1.0, 0.0, 1.0);
  const b = mk("B", 0.4, 1.0, 0.0, 1.0);
  scene.add(a); scene.add(b);
  scene.resolveCollisions();          // popula o cache
  near("  par inicial separado", dist(a, b), 1.0, 0.001);

  // Um objeto NOVO tem que entrar na colisão sem passo manual. Fica PERTO de A
  // (não em cima): distância zero é descartada como degenerada, e o teste
  // mediria o descarte em vez do cache.
  const c = mk("C", a.transform.px + 0.3, 1.0, 0.0, 1.0);
  scene.add(c);
  const antes = dist(a, c);
  scene.resolveCollisions();
  // Basta que tenha SIDO EMPURRADO: um passe posicional com três corpos em
  // cadeia não separa tudo de uma vez (C empurra A e B no mesmo frame).
  ok("  objeto novo entrou na colisao", dist(a, c) > antes ? 1 : 0);

  // remover não pode deixar índice velho no cache
  scene.removeAt(2);
  scene.resolveCollisions();
  ok("  remover nao quebra", scene.objects.length === 2 ? 1 : 0);

  // trocar `stationary` muda quem PODE se mover
  scene.clear();
  const p = mk("P", 0.0, 1.0, 0.0, 1.0); p.stationary = 1;
  const q = mk("Q", 0.4, 1.0, 0.0, 1.0); q.stationary = 1;
  scene.add(p); scene.add(q);
  scene.resolveCollisions();          // ambos estáticos: nada se move
  near("  dois estaticos ficam parados", q.transform.px, 0.4, 0.0001);
  q.stationary = 0;
  scene.colDirty = 1;                 // o editor faz isto ao trocar o checkbox
  scene.resolveCollisions();
  ok("  virou movel e foi empurrado", q.transform.px > 0.5 ? 1 : 0);
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
if (fail > 0) io.print("[FALHOU]");
else io.print("[PASSOU]");

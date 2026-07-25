// Testes de CORRETUDE do core (headless): garantem que as otimizações de
// resolveCollisions (grid espacial) e computeWorld (fast path) preservam o
// comportamento. Rodar sempre que mexer em engine/core/scene.ts.
//
//   ./rts.exe run tools/test_scene.ts     -> espera "[PASSOU]"
import io from "rts:io";
import math from "rts:math";
import { scene } from "../editor/control/session";
import { GameObject } from "../engine/core/gameobject";
import { Animator, CH_PY, EASE_LINEAR, EASE_SMOOTH } from "../scripts/animator";

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

io.print("== COLISOR DE CAIXA: um chao achatado SEGURA o que cai ==");
{
  // O caso que a esfera nunca cobriu: `radiusOf` usa a MENOR escala, entao um
  // chao 60x0.4x60 virava uma esfera de raio 0.2 e nada se apoiava nele.
  scene.clear();
  const chao = new GameObject("Chao"); chao.setMesh(1, 80, 80, 80);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 60.0; chao.transform.sy = 0.4; chao.transform.sz = 60.0;
  chao.stationary = 1; scene.add(chao);
  const cubo = new GameObject("Cubo"); cubo.setMesh(1, 200, 100, 100);
  cubo.transform.setPosition(0.0, 5.0, 0.0); cubo.transform.setScale(1.0);
  scene.add(cubo);
  ok("  cubo default = colisor de CAIXA", cubo.colShape === 1 ? 1 : 0);
  let s = 0;
  while (s < 120) {
    cubo.transform.vy = cubo.transform.vy - 9.8 * 0.016;
    cubo.transform.py = cubo.transform.py + cubo.transform.vy * 0.016;
    scene.computeWorld(); scene.resolveCollisions();
    s = s + 1;
  }
  const y = cubo.transform.py;
  io.print("  cubo parou em y=" + y + " (esperado 0.7)");
  ok("  o chao SEGUROU", y > 0.6 && y < 0.85 ? 1 : 0);
  ok("  o chao estatico nao cedeu", chao.transform.py === 0.0 ? 1 : 0);
}

io.print("== QUEDA LIVRE longe do centro (grid + eixo Y) ==");
{
  // Dois bugs que este caso pega juntos:
  //  1. o grid dimensionava a celula por `radiusOf`, entao um chao largo
  //     reportava raio 0.2 e ficava numa celula minuscula;
  //  2. a colisao reativa so testava X/Z, entao um corpo em QUEDA LIVRE (que
  //     so muda Y) era considerado "parado" e nunca era testado.
  scene.clear();
  const chao = new GameObject("Chao"); chao.setMesh(1, 80, 80, 80);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 60.0; chao.transform.sy = 0.4; chao.transform.sz = 60.0;
  chao.stationary = 1; scene.add(chao);
  let i = 0;
  while (i < 30) {   // passa de m<24 para forcar o caminho do GRID
    const o = new GameObject("X"); o.setMesh(4, 1, 1, 1);
    o.transform.setPosition(20.0 + i, 1.0, 20.0); o.transform.setScale(0.5);
    o.stationary = 1; scene.add(o); i = i + 1;
  }
  const cubo = new GameObject("Cubo"); cubo.setMesh(1, 200, 100, 100);
  cubo.transform.setPosition(0.0 - 20.0, 5.0, 0.0 - 20.0);
  cubo.transform.setScale(1.0); scene.add(cubo);
  let s = 0;
  while (s < 120) {
    cubo.transform.vy = cubo.transform.vy - 9.8 * 0.016;
    cubo.transform.py = cubo.transform.py + cubo.transform.vy * 0.016;
    scene.computeWorld(); scene.resolveCollisions();
    s = s + 1;
  }
  ok("  segurou longe do centro, via grid", cubo.transform.py > 0.6 && cubo.transform.py < 0.85 ? 1 : 0);
}

io.print("== CAIXA x ESFERA: a bola pousa na plataforma ==");
{
  scene.clear();
  const plat = new GameObject("Plat"); plat.setMesh(1, 80, 80, 80);
  plat.transform.setPosition(0.0, 0.0, 0.0);
  plat.transform.sx = 10.0; plat.transform.sy = 1.0; plat.transform.sz = 10.0;
  plat.stationary = 1; scene.add(plat);
  const bola = new GameObject("Bola"); bola.setMesh(4, 100, 200, 100);
  bola.transform.setPosition(0.0, 6.0, 0.0); bola.transform.setScale(2.0);
  scene.add(bola);
  ok("  esfera default = colisor de ESFERA", bola.colShape === 0 ? 1 : 0);
  let s = 0;
  while (s < 120) {
    bola.transform.vy = bola.transform.vy - 9.8 * 0.016;
    bola.transform.py = bola.transform.py + bola.transform.vy * 0.016;
    scene.computeWorld(); scene.resolveCollisions();
    s = s + 1;
  }
  const y = bola.transform.py;
  io.print("  bola parou em y=" + y + " (esperado 1.5 = topo 0.5 + raio 1.0)");
  ok("  a plataforma segurou a bola", y > 1.4 && y < 1.65 ? 1 : 0);
}

io.print("== PAREDE: caixa alta bloqueia movimento lateral ==");
{
  scene.clear();
  const parede = new GameObject("Parede"); parede.setMesh(1, 80, 80, 80);
  parede.transform.setPosition(3.0, 2.0, 0.0);
  parede.transform.sx = 0.5; parede.transform.sy = 4.0; parede.transform.sz = 10.0;
  parede.stationary = 1; scene.add(parede);
  const u = new GameObject("U"); u.setMesh(1, 200, 100, 100);
  u.transform.setPosition(0.0, 2.0, 0.0); u.transform.setScale(1.0);
  scene.add(u);
  let s = 0;
  while (s < 200) {   // anda para a direita, contra a parede
    u.transform.px = u.transform.px + 0.05;
    scene.computeWorld(); scene.resolveCollisions();
    s = s + 1;
  }
  io.print("  unidade parou em x=" + u.transform.px + " (parede em 3.0, face 2.75)");
  ok("  a parede BLOQUEOU", u.transform.px < 2.8 ? 1 : 0);
}

io.print("");
io.print("== IMPULSO: corpo em movimento POE OUTRO em movimento ==");
{
  // Antes a colisao so SEPARAVA: os dois paravam e nada era transmitido.
  scene.clear();
  const a = new GameObject("A"); a.setMesh(4,1,1,1);
  a.transform.setPosition(0.0-3.0, 1.0, 0.0); a.transform.setScale(1.0);
  a.transform.vx = 6.0; scene.add(a);
  const b = new GameObject("B"); b.setMesh(4,1,1,1);
  b.transform.setPosition(0.0, 1.0, 0.0); b.transform.setScale(1.0); scene.add(b);
  let s = 0;
  while (s < 90) {
    a.transform.px = a.transform.px + a.transform.vx * 0.016;
    b.transform.px = b.transform.px + b.transform.vx * 0.016;
    scene.computeWorld(); scene.resolveCollisions(); s = s + 1;
  }
  io.print("  A.vx=" + a.transform.vx + " B.vx=" + b.transform.vx + " (soma = 6, momento conservado)");
  ok("  B recebeu impulso", b.transform.vx > 0.5 ? 1 : 0);
  ok("  A perdeu velocidade", a.transform.vx < 6.0 ? 1 : 0);
}

io.print("== MASSA: leve bate em pesado e e REBATIDO ==");
{
  scene.clear();
  const leve = new GameObject("Leve"); leve.setMesh(4,1,1,1);
  leve.transform.setPosition(0.0-3.0, 1.0, 0.0); leve.transform.setScale(1.0);
  leve.transform.vx = 6.0; leve.transform.mass = 1.0; leve.transform.restitution = 0.9;
  scene.add(leve);
  const pes = new GameObject("Pesado"); pes.setMesh(4,1,1,1);
  pes.transform.setPosition(0.0, 1.0, 0.0); pes.transform.setScale(1.0);
  pes.transform.mass = 50.0; pes.transform.restitution = 0.9; scene.add(pes);
  let s = 0;
  while (s < 90) {
    leve.transform.px = leve.transform.px + leve.transform.vx * 0.016;
    pes.transform.px = pes.transform.px + pes.transform.vx * 0.016;
    scene.computeWorld(); scene.resolveCollisions(); s = s + 1;
  }
  ok("  o leve ricocheteou (vx < 0)", leve.transform.vx < 0.0 ? 1 : 0);
  ok("  o pesado mal se moveu", pes.transform.vx < 1.0 ? 1 : 0);
}

io.print("== RESTITUICAO: bola elastica QUICA ==");
{
  scene.clear();
  const chao = new GameObject("Chao"); chao.setMesh(1,1,1,1);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 40.0; chao.transform.sy = 1.0; chao.transform.sz = 40.0;
  chao.stationary = 1; chao.transform.restitution = 0.8; scene.add(chao);
  const bola = new GameObject("Bola"); bola.setMesh(4,1,1,1);
  bola.transform.setPosition(0.0, 8.0, 0.0); bola.transform.setScale(1.0);
  bola.transform.restitution = 0.8; scene.add(bola);
  let maxAfter = 0.0 - 99.0;
  let hit = 0;
  let s = 0;
  while (s < 200) {
    bola.transform.vy = bola.transform.vy - 9.8 * 0.016;
    bola.transform.py = bola.transform.py + bola.transform.vy * 0.016;
    scene.computeWorld(); scene.resolveCollisions();
    if (bola.transform.py < 1.2) hit = 1;
    if (hit !== 0 && bola.transform.py > maxAfter) maxAfter = bola.transform.py;
    s = s + 1;
  }
  io.print("  subiu ate y=" + maxAfter + " apos o primeiro toque");
  ok("  quicou de volta", maxAfter > 2.0 ? 1 : 0);
}

io.print("== ATRITO: deslize sobre o chao PARA ==");
{
  scene.clear();
  const chao = new GameObject("Chao"); chao.setMesh(1,1,1,1);
  chao.transform.setPosition(0.0, 0.0, 0.0);
  chao.transform.sx = 60.0; chao.transform.sy = 1.0; chao.transform.sz = 60.0;
  chao.stationary = 1; chao.transform.friction = 0.9; scene.add(chao);
  const cx = new GameObject("Caixa"); cx.setMesh(1,1,1,1);
  cx.transform.setPosition(0.0, 1.0, 0.0); cx.transform.setScale(1.0);
  cx.transform.vx = 10.0; cx.transform.friction = 0.9; scene.add(cx);
  let s = 0;
  while (s < 200) {
    cx.transform.vy = cx.transform.vy - 9.8 * 0.016;
    cx.transform.px = cx.transform.px + cx.transform.vx * 0.016;
    cx.transform.py = cx.transform.py + cx.transform.vy * 0.016;
    scene.computeWorld(); scene.resolveCollisions(); s = s + 1;
  }
  io.print("  vx: 10 -> " + cx.transform.vx);
  ok("  o atrito freou", cx.transform.vx < 8.0 ? 1 : 0);
}

io.print("");
io.print("== ANIMATOR: keyframes interpolados ==");
{
  scene.clear();
  const o = new GameObject("A"); o.setMesh(1,1,1,1); scene.add(o);
  const a = new Animator(CH_PY * 1.0, EASE_LINEAR * 1.0);
  a.loop = 0.0;
  a.key(0.0, 0.0); a.key(1.0, 10.0);
  o.addBehavior(a);
  ok("  duracao = ultimo key", a.duration() === 1.0 ? 1 : 0);
  ok("  meio = 5 (linear)", a.sample(0.5) === 5.0 ? 1 : 0);
  ok("  antes do 1o key devolve o 1o", a.sample(0.0 - 5.0) === 0.0 ? 1 : 0);
  ok("  depois do ultimo devolve o ultimo", a.sample(99.0) === 10.0 ? 1 : 0);
  // keys fora de ordem: a interpolacao varre em ordem, um key fora de lugar
  // faria o valor SALTAR no meio da animacao
  const b = new Animator(CH_PY * 1.0, EASE_LINEAR * 1.0);
  b.key(1.0, 10.0); b.key(0.0, 0.0); b.key(0.5, 5.0);
  ok("  keys fora de ordem sao ordenados", (b.kt[0] === 0.0 && b.kt[1] === 0.5 && b.kt[2] === 1.0) ? 1 : 0);
  const c = new Animator(CH_PY * 1.0, EASE_SMOOTH * 1.0);
  c.key(0.0, 0.0); c.key(1.0, 10.0);
  ok("  smooth: meio igual ao linear", c.sample(0.5) === 5.0 ? 1 : 0);
  ok("  smooth: acelera devagar (0.25 < 2.5)", c.sample(0.25) < 2.5 ? 1 : 0);
  let s = 0;
  while (s < 30) { scene.update(0.016); s = s + 1; }
  io.print("  apos 0.48s: py=" + o.transform.py);
  ok("  animou pela cena", o.transform.py > 3.0 && o.transform.py < 6.0 ? 1 : 0);
}

io.print("== ANIMATOR: modos de loop ==");
{
  scene.clear();
  const o = new GameObject("A"); o.setMesh(1,1,1,1); scene.add(o);
  const a = new Animator(CH_PY * 1.0, EASE_LINEAR * 1.0);
  a.loop = 0.0;                      // para no fim
  a.key(0.0, 0.0); a.key(0.2, 10.0);
  o.addBehavior(a);
  let s = 0;
  while (s < 60) { scene.update(0.016); s = s + 1; }   // ~1s, bem alem de 0.2
  ok("  loop=0 para no ultimo valor", o.transform.py === 10.0 ? 1 : 0);
  ok("  loop=0 marca como parado", a.playing === 0.0 ? 1 : 0);
}

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
if (fail > 0) io.print("[FALHOU]");
else io.print("[PASSOU]");

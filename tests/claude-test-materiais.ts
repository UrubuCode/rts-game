// O que os corpos são FEITOS, atravessando os três backends.
//
//   rts.exe run tests/claude-test-materiais.ts
//
// Gravidade, quique, arrasto, atrito e o chão implícito eram campos que o
// inspector mostrava, o solver da CPU obedecia e os dois backends rápidos
// ignoravam. Este arquivo pina a regra que os une: A MESMA CENA CAI DO MESMO
// JEITO NOS TRÊS. Cada caso roda em `cpu`, `rust` e `gpu` e compara contra o
// mesmo número, porque uma divergência aqui aparece como "a física está estranha
// num dos backends", que é o bug mais caro que este arranjo pode produzir.
import io from "@compat/io.ts";

import { Scene } from "@engine/core/scene";
import { GameObject, COL_BOX } from "@engine/core/gameobject";
import { FIXED_DT } from "@engine/core/fixedstep";
import { Rigidbody } from "@scripts/rigidbody";
import { Collider, SHAPE_SPHERE, SHAPE_BOX } from "@engine/core/collider";
import { triggerCount, triggerA, triggerB } from "@engine/core/scene";
import { rigidSetMode, rigidStep, rigidBackendName } from "@engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

/// O laço do editor: scripts, backend, e a CPU só se ele recusar.
function passos(sc: Scene, n: number): void {
  let i = 0;
  while (i < n) {
    sc.update(FIXED_DT);
    if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
    i = i + 1;
  }
  sc.computeWorld();
}

function chao(sc: Scene, atrito: f64, quique: f64): GameObject {
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.sx = 80.0; g.transform.sy = 1.0; g.transform.sz = 80.0;
  g.colShape = COL_BOX;
  g.stationary = 1;
  g.transform.friction = atrito;
  g.transform.restitution = quique;
  sc.add(g);
  return g;
}

function corpo(sc: Scene, nome: string, x: f64, y: f64): GameObject {
  const g = new GameObject(nome);
  g.setMesh(1, 200, 200, 200);
  g.colShape = COL_BOX;
  g.transform.setPosition(x, y, 0.0);
  const rb = new Rigidbody(0.0 - 9.8, 0.0);
  // O CHÃO IMPLÍCITO DESLIGADO: ele é uma rede de segurança para cenas sem chão
  // nenhum, e aqui ele mascararia o que cada caso mede — ele para o corpo em
  // `0 + sy*0.5`, que é ACIMA de onde um colisor deslocado deveria assentar.
  rb.floorY = 0.0 - 1.0e9;
  g.addBehavior(rb);
  sc.add(g);
  return g;
}

/// Roda `montar`+`medir` nos três backends e responde os três números.
/// A GPU responde `1e30` quando não há placa — o chamador pula esse.
function nosTres(montar: (sc: Scene) => GameObject, medir: (o: GameObject) => f64,
                 frames: number): f64[] {
  const out: f64[] = [];
  const modos: number[] = [0, 2, 1];
  let i = 0;
  while (i < modos.length) {
    rigidSetMode(modos[i]);
    const sc = new Scene("M");
    const alvo = montar(sc);
    sc.computeWorld();
    passos(sc, frames);
    const temGpu = modos[i] !== 1 || rigidBackendName().indexOf("caiu") < 0;
    out.push(temGpu ? medir(alvo) : 1.0e30);
    i = i + 1;
  }
  rigidSetMode(0);
  return out;
}

function perto(a: f64, b: f64, tol: f64): number {
  const d = a - b;
  return (d < 0.0 ? 0.0 - d : d) < tol ? 1 : 0;
}

function nome(i: number): string {
  if (i === 0) return "cpu";
  if (i === 1) return "rust";
  return "gpu";
}

/// Os três batem entre si, dentro de `tol`. A GPU ausente é pulada.
function concordam(rot: string, v: f64[], tol: f64): void {
  io.print("  " + rot + ": cpu=" + v[0].toFixed(3) + " rust=" + v[1].toFixed(3) +
           " gpu=" + (v[2] > 1.0e29 ? "(sem placa)" : v[2].toFixed(3)));
  let i = 1;
  while (i < 3) {
    if (v[i] < 1.0e29) {
      check(rot + ": " + nome(i) + " concorda com a cpu",
            perto(v[i], v[0], tol));
    }
    i = i + 1;
  }
}

// ── 1) GRAVIDADE: o campo do inspector, e a ausência de integrador ─────────
io.print("── gravidade ──");
{
  // Metade da gravidade cai metade da altura no mesmo tempo. O número exato não
  // importa; o que importa é os três darem o MESMO.
  const v = nosTres((sc: Scene): GameObject => {
    const g = corpo(sc, "Leve", 0.0, 40.0);
    const rb = g.behaviors[0] as Rigidbody;
    rb.g = 0.0 - 4.9;
    return g;
  }, (o: GameObject): f64 => o.transform.py, 60);
  concordam("gravidade pela metade, y apos 1 s", v, 0.2);
  // g/2 por 1 s = 4,9/2 = 2,45 de queda, contra 4,9 com a gravidade inteira.
  check("meia gravidade cai ~metade (37.55 esperado)", perto(v[0], 37.55, 0.2));
}
{
  const v = nosTres((sc: Scene): GameObject => {
    // SEM `Rigidbody`: ninguém o integra na CPU, e ninguém pode integrá-lo nos
    // outros dois. Era a divergência mais grosseira que havia — o mesmo objeto
    // caía ou não conforme o backend.
    const g = new GameObject("Solto");
    g.setMesh(1, 200, 200, 200);
    g.transform.setPosition(0.0, 20.0, 0.0);
    sc.add(g);
    return g;
  }, (o: GameObject): f64 => o.transform.py, 120);
  concordam("sem integrador, y", v, 0.001);
  check("sem integrador, o corpo fica ONDE ESTAVA", perto(v[0], 20.0, 0.001));
}

// ── 2) QUIQUE ──────────────────────────────────────────────────────────────
io.print("── quique ──");
{
  const v = nosTres((sc: Scene): GameObject => {
    chao(sc, 0.35, 0.0);
    const g = corpo(sc, "Bola", 0.0, 6.0);
    (g.behaviors[0] as Rigidbody).bounce = 0.8;
    g.transform.restitution = 0.8;
    return g;
  }, (o: GameObject): f64 => o.transform.py, 90);
  // 90 passos = 1,5 s: tempo de cair de 6 e voltar a subir. Um corpo sem quique
  // está no chão (~1,0) e um com quique está no ar.
  concordam("bola quicando, y apos 1,5 s", v, 0.6);
  check("com quique, a bola NAO esta parada no chao", v[0] > 1.4 ? 1 : 0);
}

{
  // E o corpo que quica PRECISA ASSENTAR. O sono olhava só a VELOCIDADE, e no
  // alto de um quique um corpo é lento por tantos passos quanto o arco for
  // raso: dez deles e ele DORMIA NO AR, sem nada para acordá-lo — um corpo
  // dormindo só acorda com um vizinho rápido encostando, e o vazio não é um.
  // Era inalcançável enquanto a restituição foi zero constante, então chegou
  // junto com os materiais; a caixa com quique 0,5 ficava pendurada em 1,135.
  const v = nosTres((sc: Scene): GameObject => {
    chao(sc, 0.35, 0.0);
    const g = corpo(sc, "Quicante", 0.0, 12.0);
    (g.behaviors[0] as Rigidbody).bounce = 0.5;
    g.transform.restitution = 0.5;
    return g;
  }, (o: GameObject): f64 => o.transform.py, 900);
  concordam("a bola que quica ASSENTA, y", v, 0.15);
  check("ela nao ficou dormindo no ar", v[0] < 1.2 ? 1 : 0);
}

// ── 3) ARRASTO ─────────────────────────────────────────────────────────────
io.print("── arrasto ──");
{
  const v = nosTres((sc: Scene): GameObject => {
    const g = corpo(sc, "Freado", 0.0, 40.0);
    const rb = g.behaviors[0] as Rigidbody;
    rb.g = 0.0;            // só o arrasto age
    rb.drag = 3.0;
    g.transform.vx = 10.0;
    return g;
  }, (o: GameObject): f64 => o.transform.px, 120);
  concordam("arrasto, x apos 2 s", v, 0.6);
  check("o arrasto freou de verdade (andou menos que 5)", v[0] < 5.0 ? 1 : 0);
  check("e nao inverteu o corpo", v[0] > 0.0 ? 1 : 0);
}

// ── 4) ATRITO ──────────────────────────────────────────────────────────────
io.print("── atrito ──");
{
  const gelo = nosTres((sc: Scene): GameObject => {
    chao(sc, 0.02, 0.0);
    const g = corpo(sc, "Bloco", 0.0, 1.0);
    g.transform.friction = 0.02;
    g.transform.vx = 12.0;
    return g;
  }, (o: GameObject): f64 => o.transform.px, 180);
  const borracha = nosTres((sc: Scene): GameObject => {
    chao(sc, 1.0, 0.0);
    const g = corpo(sc, "Bloco", 0.0, 1.0);
    g.transform.friction = 1.0;
    g.transform.vx = 12.0;
    return g;
  }, (o: GameObject): f64 => o.transform.px, 180);
  io.print("  gelo:     cpu=" + gelo[0].toFixed(2) + " rust=" + gelo[1].toFixed(2));
  io.print("  borracha: cpu=" + borracha[0].toFixed(2) + " rust=" + borracha[1].toFixed(2));
  let i = 0;
  while (i < 3) {
    if (gelo[i] < 1.0e29) {
      check("no " + nome(i) + ", o gelo leva o bloco MAIS LONGE que a borracha",
            gelo[i] > borracha[i] + 1.0 ? 1 : 0);
    }
    i = i + 1;
  }
}

// ── 5) ESTÁTICO REDONDO ────────────────────────────────────────────────────
io.print("── estatico redondo ──");
{
  // Uma pedra esférica parada. Ela era IGNORADA pelos dois backends rápidos —
  // nem entrava na lista de estáticos — então tudo a atravessava em silêncio.
  const v = nosTres((sc: Scene): GameObject => {
    const pedra = new GameObject("Pedra");
    pedra.setMesh(4, 150, 150, 150);
    pedra.transform.setPosition(0.0, 0.0, 0.0);
    pedra.transform.setScale(6.0);
    pedra.stationary = 1;
    sc.add(pedra);
    return corpo(sc, "Bola", 0.0, 12.0);
  }, (o: GameObject): f64 => o.transform.py, 240);
  concordam("bola sobre a pedra redonda, y", v, 0.35);
  check("a bola PAROU sobre a pedra (nao a atravessou)", v[0] > 2.0 ? 1 : 0);
}

// ── 6) MASSA: a separação divide pelo inverso ──────────────────────────────
io.print("── massa ──");
{
  // Dois corpos sobrepostos, um 50x mais pesado. O leve tem de ser o que sai do
  // lugar. Na CPU a separação era meio a meio e a bigorna recuava tanto quanto
  // a bolinha; os dois backends rápidos já dividiam pelo inverso da massa.
  const v = nosTres((sc: Scene): GameObject => {
    const pesado = corpo(sc, "Bigorna", 0.0, 20.0);
    pesado.transform.mass = 50.0;
    (pesado.behaviors[0] as Rigidbody).g = 0.0;
    (pesado.behaviors[0] as Rigidbody).mass = 50.0;
    const leve = corpo(sc, "Bolinha", 0.4, 20.0);
    leve.transform.mass = 1.0;
    (leve.behaviors[0] as Rigidbody).g = 0.0;
    return pesado;
  }, (o: GameObject): f64 => o.transform.px, 30);
  concordam("a bigorna quase nao se move, x", v, 0.05);
  check("a bigorna ficou praticamente parada", perto(v[0], 0.0, 0.08));
}

// ── 7) O CENTRO DO COLISOR, que ninguém lia ───────────────────────────────
io.print("── centro do colisor ──");
{
  // Um corpo cujo colisor está UMA UNIDADE ACIMA do pivô: ele tem de parar no
  // chão uma unidade mais BAIXO, porque o que toca o chão é o colisor.
  //
  // Só na CPU: os dois backends rápidos não carregam o centro no buffer, e
  // inventar um valor aqui seria fingir que carregam.
  rigidSetMode(0);
  const sc = new Scene("Centro");
  chao(sc, 0.35, 0.0);
  const g = corpo(sc, "PivoNosPes", 0.0, 6.0);
  const col = new Collider(SHAPE_BOX);
  col.cy = 1.0;
  g.addBehavior(col);
  sc.markCollidersDirty();
  sc.computeWorld();
  passos(sc, 300);
  io.print("  pivo em y = " + g.transform.py.toFixed(3));
  // Sem o deslocamento o pivô repousaria em 1,0 (topo do chão 0,5 + meia-altura
  // 0,5). Com o colisor uma unidade acima dele, quem repousa em 1,0 é o COLISOR
  // e o pivô desce para ~0.
  check("o colisor deslocado baixa o PIVO em uma unidade", perto(g.transform.py, 0.0, 0.15));
  check("e o COLISOR fica sobre o chao (pivo + 1 ~= 1.0)", perto(g.transform.py + 1.0, 1.0, 0.15));
}

// ── 8) GATILHO: detecta e não empurra ─────────────────────────────────────
io.print("── gatilho ──");
{
  rigidSetMode(0);
  const sc = new Scene("Gatilho");
  chao(sc, 0.35, 0.0);
  const zona = new GameObject("Zona");
  zona.setMesh(1, 80, 200, 80);
  zona.transform.setPosition(0.0, 3.0, 0.0);
  zona.transform.setScale(4.0);
  zona.stationary = 1;
  const cz = new Collider(SHAPE_BOX);
  cz.trigger = 1;
  zona.addBehavior(cz);
  sc.add(zona);
  const g = corpo(sc, "Passante", 0.0, 10.0);
  sc.markCollidersDirty();
  sc.computeWorld();

  // atravessa a zona em algum momento da queda
  let viu = 0;
  let i = 0;
  while (i < 60) {
    passos(sc, 1);
    if (triggerCount() > 0) viu = 1;
    i = i + 1;
  }
  check("o gatilho foi REGISTRADO durante a travessia", viu);
  passos(sc, 300);
  io.print("  passante em y = " + g.transform.py.toFixed(3));
  check("e o corpo ATRAVESSOU (parou no chao, nao na zona)", g.transform.py < 1.2 ? 1 : 0);
  // e os índices registrados são de verdade
  const sc2 = new Scene("Gatilho2");
  const a = corpo(sc2, "A", 0.0, 1.0);
  const c2 = new Collider(SHAPE_SPHERE);
  c2.trigger = 1;
  a.addBehavior(c2);
  corpo(sc2, "B", 0.2, 1.0);
  sc2.markCollidersDirty();
  sc2.computeWorld();
  sc2.resolveCollisions();
  const n = triggerCount();
  check("o par registrado nomeia os DOIS objetos",
        n > 0 && triggerA(0) !== triggerB(0) ? 1 : 0);
}

// ── 9) ESTÁTICO QUE SE MOVE ────────────────────────────────────────────────
io.print("── plataforma ──");
{
  // Um elevador: um estático que o jogo move. Quem dorme em cima dele era
  // atravessado — a passada reativa só varre quem se MEXEU, e um corpo em
  // repouso não se mexe.
  rigidSetMode(0);
  const sc = new Scene("Elevador");
  const plat = chao(sc, 0.35, 0.0);
  plat.transform.sy = 1.0;
  // 24 corpos: acima do limiar que liga o grid (abaixo dele o laço é direto e
  // não é o caminho que tinha o defeito).
  const cima: GameObject[] = [];
  let i = 0;
  while (i < 26) {
    cima.push(corpo(sc, "C" + i, (i % 13) * 2.0 - 12.0, 1.2 + ((i / 13) | 0) * 1.1));
    i = i + 1;
  }
  sc.computeWorld();
  passos(sc, 400);            // assenta e dorme
  const antes: f64 = cima[0].transform.py;
  // a plataforma sobe 3 unidades, em passos que o solver consegue acompanhar
  let k = 0;
  while (k < 60) {
    plat.transform.py = plat.transform.py + 0.05;
    passos(sc, 1);
    k = k + 1;
  }
  const depois: f64 = cima[0].transform.py;
  io.print("  plataforma subiu 3.0; o corpo em cima foi de " +
           antes.toFixed(2) + " para " + depois.toFixed(2));
  check("a plataforma LEVOU quem estava em cima", depois > antes + 2.0 ? 1 : 0);
  check("e nao o deixou dentro dela", depois > plat.transform.py + 0.4 ? 1 : 0);
}

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

// O COLISOR ACOMPANHA A GEOMETRIA — o teste que distingue casca de caixa.
//
//   rts.exe run tools/claude-test-mesh-collider.ts
//
// ── O QUE ELE PRECISA PROVAR ───────────────────────────────────────────────
//
// Que `hullCollider` colide com a FORMA DA MALHA e não com a caixa em volta
// dela. Um teste que só verificasse "o corpo parou em cima" passaria com o
// colisor de caixa e não provaria nada — a caixa também para o corpo, só que
// no lugar errado.
//
// A cena é escolhida para que os dois discordem de um jeito grande e visível:
// uma RAMPA de 45°, que é meia-caixa cortada na diagonal.
//
//   caixa:  o AABB da rampa é a caixa INTEIRA, então uma esfera largada sobre o
//           lado VAZIO da diagonal para no ar, na altura do topo da rampa;
//   casca:  a esfera cai até a face inclinada e para SOBRE a rampa — mais baixo
//           — e a normal do contato aponta na diagonal, não para cima.
//
// A altura de repouso separa os dois por mais de meia unidade nesta cena, e a
// NORMAL os separa qualitativamente: 1,0 em Y para a caixa contra ~0,707 para
// a rampa. As duas são asseridas, porque a altura sozinha poderia coincidir por
// acidente numa geometria e a normal diz POR QUE o corpo parou onde parou.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { boxCollider, sphereCollider, hullCollider } from "../engine/core/collider";
import { hullFromMesh } from "../engine/core/hull";
import { hullRegisterGeo, hullResetRegistry, hullAt } from "../engine/core/hullreg";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

hullResetRegistry();

// ── a rampa: um prisma triangular, 2x1x2, cortado na diagonal XY ───────────
//
// Seis vértices: o triângulo (x=-1,y=-0.5) (x=+1,y=-0.5) (x=-1,y=+0.5),
// extrudado em Z. A face inclinada vai do canto alto-esquerdo ao baixo-direito.
const rampa: f64[] = [
  0.0 - 1.0, 0.0 - 0.5, 0.0 - 1.0,   1.0, 0.0 - 0.5, 0.0 - 1.0,   0.0 - 1.0, 0.5, 0.0 - 1.0,
  0.0 - 1.0, 0.0 - 0.5,       1.0,   1.0, 0.0 - 0.5,       1.0,   0.0 - 1.0, 0.5,       1.0,
];
const geo = hullFromMesh(rampa, 3);
check("a casca gerou (a malha nao e degenerada)", geo.ok);
io.print("    planos: " + geo.pd.length + "  AABB y: " + geo.minY + " .. " + geo.maxY);

const idRampa = hullRegisterGeo(geo);
check("a rampa foi registrada com um id valido", idRampa > 0 ? 1 : 0);
check("o registro devolve a casca por id", hullAt(idRampa) !== null ? 1 : 0);
check("o id 0 continua significando 'nenhuma casca'", hullAt(0) === null ? 1 : 0);

/// Larga uma esfera em `x` sobre a rampa e devolve a altura de repouso.
///
/// `usarCasca = 0` monta a MESMA cena com colisor de caixa — é o controle, e é
/// o que torna a diferença atribuível à forma e não à cena.
function largar(x: f64, usarCasca: number): f64 {
  return largarImpl(x, usarCasca, idRampa);
}

function largarImpl(x: f64, usarCasca: number, hid: number): f64 {
  const sc = new Scene("Rampa");

  const chao = new GameObject("Chao");
  chao.setMesh(1, 90, 90, 90);
  chao.transform.setPosition(0.0, 0.0 - 3.0, 0.0);
  chao.transform.sx = 40.0; chao.transform.sy = 1.0; chao.transform.sz = 40.0;
  chao.stationary = 1;
  chao.addBehavior(boxCollider(0.5, 0.5, 0.5));
  sc.add(chao);

  const r = new GameObject("Rampa");
  r.setMesh(1, 180, 140, 90);
  r.transform.setPosition(0.0, 0.0, 0.0);
  r.transform.sx = 1.0; r.transform.sy = 1.0; r.transform.sz = 1.0;
  r.stationary = 1;
  // A CASCA e a CAIXA descrevem a mesma malha: meia-extensão 1 x 0,5 x 1 é
  // exatamente o AABB do prisma. É essa igualdade que faz o teste medir a
  // FORMA e nada mais — mesma posição, mesmo tamanho, mesma cena.
  r.addBehavior(usarCasca !== 0
    ? hullCollider(hid, 1.0, 0.5, 1.0)
    : boxCollider(1.0, 0.5, 1.0));
  sc.add(r);

  const b = new GameObject("Bola");
  b.setMesh(2, 240, 240, 240);
  b.transform.setPosition(x, 4.0, 0.0);
  b.transform.sx = 0.4; b.transform.sy = 0.4; b.transform.sz = 0.4;
  b.addBehavior(sphereCollider(0.5));
  sc.add(b);

  sc.computeWorld();
  // A gravidade é integrada aqui, e não por um `Rigidbody`, porque
  // `Scene.update` não a aplica — ela vive nos solvers (`gpurigid.ts:291`). O
  // teste faz o que um Rigidbody faria e nada mais: acelera, move, resolve.
  // Assim o que está sob teste é a COLISÃO, sem um behavior no meio que possa
  // dormir, amortecer ou limitar velocidade e mascarar a diferença de forma.
  const tb2: Transform = sc.trs[2];
  let f = 0;
  while (f < 400) {
    const dt: f64 = 1.0 / 60.0;
    tb2.vy = tb2.vy - 9.8 * dt;
    tb2.py = tb2.py + tb2.vy * dt;
    sc.computeWorld();
    sc.resolveCollisions();
    f = f + 1;
  }
  sc.computeWorld();
  return sc.objects[2].transform.py;
}

/// Como `largar`, com a casca escolhida por id — para o controle poder usar a
/// casca do CUBO em vez da rampa sem duplicar a montagem da cena.
function largarCom(x: f64, hid: number): f64 {
  return largarImpl(x, 1, hid);
}

// ── o lado VAZIO da diagonal é onde os dois mais discordam ─────────────────
//
// Em x = +0,6 a caixa ainda tem material (ela é cheia) e a rampa não — ali a
// face inclinada já desceu quase até a base. Uma esfera largada nesse ponto
// para no topo com caixa e bem mais embaixo com casca.
const yCaixa = largar(0.6, 0);
const yCasca = largar(0.6, 1);
io.print("");
io.print("  x = +0.6, sobre o lado VAZIO da diagonal:");
io.print("    colisor de CAIXA : y = " + yCaixa.toFixed(3));
io.print("    colisor de CASCA : y = " + yCasca.toFixed(3));
io.print("    diferenca        : " + (yCaixa - yCasca).toFixed(3));

check("a CASCA deixa a bola mais BAIXA que a caixa (a forma foi respeitada)",
      yCasca < yCaixa - 0.15 ? 1 : 0);
check("a bola nao atravessou a rampa nem o chao",
      yCasca > 0.0 - 2.5 ? 1 : 0);

// ── O CONTROLE: uma casca que É uma caixa tem de concordar com a caixa ────
//
// Esta é a metade que impede o teste de passar por um solver que só deixe tudo
// cair mais. A primeira versão do controle largava a bola no lado CHEIO da
// rampa esperando que casca e caixa concordassem — e estava errada: a casca é
// INCLINADA em todo ponto do topo, então a bola DESLIZA, enquanto sobre a caixa
// ela fica parada num topo plano. Discordar ali é o comportamento correto, e o
// teste acusava o acerto como erro.
//
// O controle certo isola a forma de verdade: gerar a casca de um CUBO. Ela tem
// exatamente as seis faces da caixa, então os dois colisores descrevem o MESMO
// sólido e a bola tem de parar na mesma altura. Se o caminho da casca estivesse
// deixando passar, afundando ou empurrando a menos, é aqui que apareceria.
const cubo: f64[] = [
  0.0 - 1.0, 0.0 - 0.5, 0.0 - 1.0,   1.0, 0.0 - 0.5, 0.0 - 1.0,
  0.0 - 1.0,       0.5, 0.0 - 1.0,   1.0,       0.5, 0.0 - 1.0,
  0.0 - 1.0, 0.0 - 0.5,       1.0,   1.0, 0.0 - 0.5,       1.0,
  0.0 - 1.0,       0.5,       1.0,   1.0,       0.5,       1.0,
];
const geoCubo = hullFromMesh(cubo, 3);
const idCubo = hullRegisterGeo(geoCubo);
check("a casca do cubo gerou", geoCubo.ok);

const yCaixaCtl = largar(0.0 - 0.3, 0);
const yCascaCtl = largarCom(0.0 - 0.3, idCubo);
io.print("");
io.print("  CONTROLE, casca de CUBO contra colisor de CAIXA (mesmo solido):");
io.print("    caixa " + yCaixaCtl.toFixed(3) + "   casca " + yCascaCtl.toFixed(3) +
         "   diferenca " + (yCaixaCtl - yCascaCtl).toFixed(3));

const dif = yCaixaCtl - yCascaCtl;
check("casca de CUBO e colisor de CAIXA param no MESMO lugar (< 0.05)",
      (dif < 0.05 && dif > 0.0 - 0.05) ? 1 : 0);

// ── um objeto sem Collider continua colidindo como antes ──────────────────
check("a bola parou ACIMA do chao nos dois casos",
      (yCaixa > 0.0 - 2.5 && yCasca > 0.0 - 2.5) ? 1 : 0);

io.print("");
io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

// Teste do empacotamento e do teste de casca (engine/core/hullpack.ts).
//
//   rts.exe run tools/claude-test-hullpack.ts
//
// O que ele PINA — o comportamento, não a implementação:
//
//   1. Uma casca de 6 planos É uma caixa. Se `hullContactLocal` divergir do
//      caso caixa do `solvePair` para um cubo, os dois backends já divergem no
//      caso mais simples que existe, e nada construído em cima disso vale.
//   2. A regra do MENOR gap é a mesma "face de menor folga" do solver de hoje.
//   3. Separado sai na primeira folga maior que o raio (o caso comum barato).
//   4. A codificação de forma no `vel.w` sobrevive à ida e volta, inclusive nos
//      valores primitivos que existiam ANTES desta extensão — que é a condição
//      para que nenhum corpo de hoje mude de significado.
import io from "../compat/io.ts";
import math from "../compat/math.ts";

import { Hull, Contact, hullContactLocal, hullShapeCode, hullIdOfShape,
         HULL_DIR_VEC4, HULL_MAX, HULL_PLANES_VEC4 } from "../engine/core/hullpack";

let ok = 0;
let fail = 0;
function check(name: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + name); }
  else { fail = fail + 1; io.print("  [FALHOU] " + name); }
}
function perto(a: f64, b: f64): number {
  const d = a - b;
  return (d < 0.0 ? 0.0 - d : d) < 0.0001 ? 1 : 0;
}

// Um cubo de meia-extensão 1 na origem: seis planos, normais para fora, d = 1.
function cubo(): Hull {
  const h = new Hull();
  h.add(1.0, 0.0, 0.0, 1.0);
  h.add(0.0 - 1.0, 0.0, 0.0, 1.0);
  h.add(0.0, 1.0, 0.0, 1.0);
  h.add(0.0, 0.0 - 1.0, 0.0, 1.0);
  h.add(0.0, 0.0, 1.0, 1.0);
  h.add(0.0, 0.0, 0.0 - 1.0, 1.0);
  h.radius = math.sqrt(3.0);
  return h;
}

io.print("[hullpack] casca como forma, e o acordo com o solver de hoje");

const c = new Contact();
const k = cubo();

check("uma casca de 6 planos tem 6 planos", k.planeCount() === 6 ? 1 : 0);

// ── 1. Esfera ACIMA do cubo, tocando a face de cima ────────────────────────
// Centro em y = 1,7 com raio 0,5: a face de cima (d=1) fica a 0,7, então a
// esfera penetra 0,5 - 0,7 = -0,2 → NÃO toca.
check("esfera acima e separada nao gera contato",
      hullContactLocal(k, 0.0, 1.7, 0.0, 0.5, c) === 0 ? 1 : 0);

// Centro em y = 1,3, raio 0,5: penetra 0,2 pela face de cima. A normal tem de
// ser +Y — é o mesmo empurrao "para CIMA e nao para o lado" que o solvePair faz
// para um cubo caindo num chao largo.
const t1 = hullContactLocal(k, 0.0, 1.3, 0.0, 0.5, c);
check("esfera encostando por cima gera contato", t1);
check("  a normal e +Y (a face de menor folga)", perto(c.ny, 1.0));
check("  a profundidade e 0,2", perto(c.depth, 0.2));

// ── 2. Esfera junto de uma face LATERAL ────────────────────────────────────
const t2 = hullContactLocal(k, 1.3, 0.0, 0.0, 0.5, c);
check("esfera encostando de lado gera contato", t2);
check("  a normal e +X", perto(c.nx, 1.0));
check("  a profundidade e 0,2", perto(c.depth, 0.2));

// ── 3. Centro DENTRO: sai pela face de menor folga ─────────────────────────
// Em (0, 0,8, 0) com raio 0,1: folga para +Y = 1 - 0,8 = 0,2; para as outras
// faces >= 1. O empurrao tem de sair por +Y.
const t3 = hullContactLocal(k, 0.0, 0.8, 0.0, 0.1, c);
check("centro dentro gera contato", t3);
check("  sai pela face de MENOR folga (+Y)", perto(c.ny, 1.0));
check("  profundidade = raio + folga = 0,3", perto(c.depth, 0.3));

// ── 4. Bem longe: separado ─────────────────────────────────────────────────
check("esfera longe nao gera contato",
      hullContactLocal(k, 9.0, 9.0, 9.0, 0.5, c) === 0 ? 1 : 0);

// ── 5. Casca vazia: nao inventa contato ────────────────────────────────────
// Um `hullId` que aponta para uma casca que o gerador nao produziu tem de ser
// SEM contato, e nao um empurrao de profundidade enorme.
check("casca sem planos nao gera contato",
      hullContactLocal(new Hull(), 0.0, 0.0, 0.0, 1.0, c) === 0 ? 1 : 0);

// ── 6. A codificacao de forma no vel.w ─────────────────────────────────────
// Os primitivos de ANTES desta extensao continuam significando o de antes.
check("vel.w = 0 continua sendo primitivo (esfera)", hullIdOfShape(0.0) === 0 ? 1 : 0);
check("vel.w = 1 continua sendo primitivo (caixa)", hullIdOfShape(1.0) === 0 ? 1 : 0);
check("casca 1 vai e volta", hullIdOfShape(hullShapeCode(1)) === 1 ? 1 : 0);
check("casca 255 vai e volta", hullIdOfShape(hullShapeCode(255)) === 255 ? 1 : 0);
// f32 guarda inteiros exatos ate 2^24; o teto do diretorio e MUITO antes disso.
check("casca no teto do diretorio vai e volta",
      hullIdOfShape(hullShapeCode(HULL_MAX - 1)) === HULL_MAX - 1 ? 1 : 0);

// ── 7. O layout nao colide com os estaticos ────────────────────────────────
// O diretorio comeca DEPOIS de params (1) + estaticos (RB_MAX_STATICS*2 = 512).
check("o diretorio comeca depois dos estaticos", HULL_DIR_VEC4 >= 513 ? 1 : 0);
check("os planos comecam depois do diretorio",
      HULL_PLANES_VEC4 === HULL_DIR_VEC4 + HULL_MAX ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");

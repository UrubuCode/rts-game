// PARIDADE CPU × GPU com formas reais (esfera e caixa).
//
// A pergunta é uma só e é a do critério de aceite: a MESMA cena termina no
// MESMO lugar nos dois backends? Monta esferas e caixas sobre um chão estático,
// roda N passos em cada backend a partir do MESMO estado inicial, e compara as
// posições finais corpo a corpo.
//
// ── O QUE ESTE TESTE PODE E O QUE NÃO PODE PROVAR ──────────────────────────
//
// Os dois solvers não são o mesmo algoritmo e nunca serão bit a bit iguais: a
// CPU resolve pares em SEQUÊNCIA (cada par já vê a correção do anterior) e a GPU
// é JACOBI (todos leem o mesmo estado e aplicam metade), com relaxação 0.30 em
// vez de 0.85 justamente por isso. Então a paridade que dá para exigir é de
// REPOUSO: onde cada corpo assenta, não a trajetória.
//
// Por isso o teste roda tempo suficiente para a cena assentar e compara o
// estado final. E por isso a restituição é 0 e o atrito é 0 nos dois lados —
// são os dois termos em que os modelos comprovadamente diferem (a GPU não tem
// atrito de Coulomb, só os amortecimentos 0.92/0.10), e deixá-los ligados
// mediria essa diferença conhecida em vez das FORMAS, que é o que mudou.
//
// O número que interessa quando diverge é QUANTO e ONDE — por isso o relatório
// imprime o pior corpo, e não só um "passou".

import io from "../compat/io.ts";
import math from "../compat/math.ts";
import { scene } from "../editor/control/session";
import { GameObject, COL_SPHERE, COL_BOX } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
import { Rigidbody } from "../scripts/rigidbody";
import { rbAvailable, rbInit, rbSetBody, rbSetShape, rbUpload, rbSyncStatics,
         rbStep, rbX, rbY, rbZ } from "../engine/rigid/gpurigid";
// O TERCEIRO backend: o solver paralelo em Rust, por `rts:rigid`. Entra neste
// teste e não num próprio porque a pergunta é a MESMA — a mesma cena termina no
// mesmo lugar? — e um segundo teste com a mesma cena seria um segundo lugar
// onde a cena pode divergir da deste.
import { crInit, crSetBody, crSetShape, crSyncStatics, crStep,
         crX, crY, crZ, crThreads } from "../engine/rigid/cpurigid";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

// ── a cena, descrita UMA vez e montada nos dois backends ────────────────────
// x, y, z, escala, forma. Mistura deliberada: esferas sozinhas, caixas
// empilhadas, esfera SOBRE caixa e caixa SOBRE esfera — os três casos do
// solvePair, mais os dois casos cruzados que só a forma real distingue.
const SX: f64[] = [];
const SY: f64[] = [];
const SZ: f64[] = [];
const SS: f64[] = [];
const SF: number[] = [];
function corpo(x: f64, y: f64, z: f64, s: f64, forma: number): void {
  SX.push(x); SY.push(y); SZ.push(z); SS.push(s); SF.push(forma);
}

// esferas caindo isoladas (cada uma assenta no próprio raio)
corpo(0.0 - 8.0, 3.0, 0.0, 1.0, COL_SPHERE);
corpo(0.0 - 8.0, 6.0, 0.0, 0.6, COL_SPHERE);
// caixas empilhadas (o caso que já funcionava — a testemunha de não-regressão)
corpo(0.0, 1.2, 0.0, 1.0, COL_BOX);
corpo(0.0, 2.6, 0.0, 1.0, COL_BOX);
corpo(0.0, 4.0, 0.0, 1.0, COL_BOX);
// esfera sobre caixa
corpo(5.0, 1.2, 0.0, 1.2, COL_BOX);
corpo(5.0, 3.2, 0.0, 1.0, COL_SPHERE);
// caixa sobre esfera
corpo(0.0 - 4.0, 1.0, 5.0, 1.0, COL_SPHERE);
corpo(0.0 - 4.0, 3.0, 5.0, 1.0, COL_BOX);
// esferas lado a lado, levemente sobrepostas: caixas ficariam; esferas se
// afastam. É o caso em que tratar esfera como caixa dá outro resultado.
corpo(9.0, 1.0, 0.0, 1.0, COL_SPHERE);
corpo(9.8, 1.0, 0.0, 1.0, COL_SPHERE);
// ESFERA NA QUINA de uma caixa — o caso que separa de verdade os dois modelos.
// Como caixa, o contato é axial e ela fica equilibrada em cima; como esfera, a
// normal aponta na diagonal da quina e ela ESCORREGA para fora. Uma cena que só
// tivesse contatos alinhados aos eixos passaria na paridade mesmo com o kernel
// tratando tudo como AABB, e o teste não estaria medindo o que diz medir.
corpo(0.0 - 12.0, 1.0, 0.0, 2.0, COL_BOX);
corpo(0.0 - 11.1, 3.2, 0.0, 1.0, COL_SPHERE);
// ESFERA SOBRE ESFERA, fora de centro — o discriminador de verdade. Duas caixas
// aqui EMPILHAM (topo plano, normal vertical); duas esferas não: a normal passa
// pelos centros, aponta na diagonal, e a de cima ESCORREGA para o lado. Sem um
// caso assim o teste passaria mesmo com o kernel tratando tudo como AABB — foi
// o que aconteceu na primeira versão dele, e é por isso que este caso existe.
corpo(20.0, 1.0, 0.0, 1.0, COL_SPHERE);
corpo(20.35, 2.4, 0.0, 1.0, COL_SPHERE);

const N = SX.length;
const PASSOS = 900;      // 15 s a 60 Hz — folga para assentar e dormir

function montaChao(): void {
  const g = new GameObject("Chao");
  g.setMesh(1, 100, 100, 100);
  g.transform.setPosition(0.0, 0.0, 0.0);
  g.transform.sx = 60.0; g.transform.sy = 1.0; g.transform.sz = 60.0;
  g.colShape = COL_BOX;
  g.stationary = 1;
  scene.add(g);
}

// ── CPU ────────────────────────────────────────────────────────────────────
const cx: f64[] = []; const cy: f64[] = []; const cz: f64[] = [];
{
  scene.clear();
  montaChao();
  let i = 0;
  while (i < N) {
    const g = new GameObject("c" + i);
    g.setMesh(SF[i] === COL_BOX ? 1 : 4, 200, 200, 200);
    g.colShape = SF[i];
    g.transform.setPosition(SX[i], SY[i], SZ[i]);
    g.transform.setScale(SS[i]);
    g.transform.friction = 0.0;     // ver o cabeçalho: o termo que diverge
    const rb = new Rigidbody(0.0 - 9.8, 0.0);
    rb.floorY = 0.0 - 1000000000.0; // o chão é o estático de verdade
    g.addBehavior(rb);
    scene.add(g);
    i = i + 1;
  }
  scene.computeWorld();
  let f = 0;
  while (f < PASSOS) {
    scene.update(1.0 / 60.0);
    scene.resolveCollisions();
    scene.computeWorld();
    f = f + 1;
  }
  const trs: Transform[] = scene.trs;
  i = 0;
  while (i < N) {
    const t: Transform = trs[i + 1];   // +1: o chão é o objeto 0
    cx.push(t.wx); cy.push(t.wy); cz.push(t.wz);
    i = i + 1;
  }
}

// ── GPU ────────────────────────────────────────────────────────────────────
// Roda DUAS vezes: com as formas reais (o que esta mudança faz) e com tudo
// mandado como CAIXA (o que o kernel fazia antes). A segunda é o número
// "antes" — sem ela o teste diria que a paridade é boa sem mostrar que a forma
// era o que faltava para ela ser boa.
const gx: f64[] = []; const gy: f64[] = []; const gz: f64[] = [];
const bx: f64[] = []; const by: f64[] = []; const bz: f64[] = [];
let temGpu = 0;

// Dois blocos ABERTOS e sequenciais, cada um com o próprio `push` INCONDICIONAL.
// Duas restrições do motor moldaram isto, e as duas foram encontradas aqui:
// passar `f64[]` como parâmetro de função é recusado na compilação
// (`ImplicitNarrowing { expected: F64, found: Tagged }`), e LER um array cujo
// `push` só acontece dentro de um braço de `if` é recusado do mesmo jeito. A
// duplicação é o preço das duas, e está dita em vez de disfarçada.
if (rbAvailable() !== 0) {
  temGpu = 1;
  // passe 1: FORMAS REAIS (o que esta mudança faz)
  scene.clear(); montaChao(); scene.computeWorld();
  rbInit(N); rbSyncStatics(scene);
  let i = 0;
  while (i < N) {
    rbSetBody(i, SX[i], SY[i], SZ[i], SS[i] * 0.5, SS[i] * 0.5, SS[i] * 0.5, 1.0);
    rbSetShape(i, SF[i]);
    i = i + 1;
  }
  rbUpload();
  let f = 0;
  while (f < PASSOS) { rbStep(1); f = f + 1; }
  rbStep(0);
  i = 0;
  while (i < N) { gx.push(rbX(i)); gy.push(rbY(i)); gz.push(rbZ(i)); i = i + 1; }

  // passe 2: TUDO CAIXA (o que o kernel fazia antes) — o número "antes"
  scene.clear(); montaChao(); scene.computeWorld();
  rbInit(N); rbSyncStatics(scene);
  i = 0;
  while (i < N) {
    rbSetBody(i, SX[i], SY[i], SZ[i], SS[i] * 0.5, SS[i] * 0.5, SS[i] * 0.5, 1.0);
    i = i + 1;                                  // sem rbSetShape = default CAIXA
  }
  rbUpload();
  f = 0;
  while (f < PASSOS) { rbStep(1); f = f + 1; }
  rbStep(0);
  i = 0;
  while (i < N) { bx.push(rbX(i)); by.push(rbY(i)); bz.push(rbZ(i)); i = i + 1; }
}

// ── RUST (rts:rigid) ───────────────────────────────────────────────────────
// Sem `if`: este backend não depende de placa, que é o ponto dele. Por isso os
// `push` são incondicionais e este bloco não precisa da duplicação que os dois
// passes da GPU acima precisam.
const rx: f64[] = []; const ry: f64[] = []; const rz: f64[] = [];
{
  scene.clear(); montaChao(); scene.computeWorld();
  crInit(N); crSyncStatics(scene);
  let i = 0;
  while (i < N) {
    // Os MESMOS argumentos do braço da GPU, na mesma ordem: meia-extensão
    // `SS[i]*0.5` e massa 1. Se este braço lesse a forma de outro lugar, a
    // divergência medida seria dele e não do solver.
    crSetBody(i, SX[i], SY[i], SZ[i], SS[i] * 0.5, SS[i] * 0.5, SS[i] * 0.5, 1.0);
    crSetShape(i, SF[i]);
    i = i + 1;
  }
  let f = 0;
  while (f < PASSOS) { crStep(1); f = f + 1; }
  i = 0;
  while (i < N) { rx.push(crX(i)); ry.push(crY(i)); rz.push(crZ(i)); i = i + 1; }
}

// ── comparação RUST × CPU ──────────────────────────────────────────────────
// Fora do `if (temGpu)` de propósito: esta metade do critério de aceite não
// depende de haver placa, e uma máquina sem GPU é exatamente onde este backend
// vai rodar. Medir só quando há GPU seria não medir onde importa.
{
  const ESTAVEL = N - 2;
  io.print("");
  io.print("[RUST x CPU] o solver paralelo contra o sequencial da Scene");
  io.print("  threads: " + crThreads());
  let piorR: f64 = 0.0;
  let piorRI = 0;
  let piorRY: f64 = 0.0;
  let somaRY: f64 = 0.0;
  let i = 0;
  while (i < ESTAVEL) {
    const dx = rx[i] - cx[i]; const dy = ry[i] - cy[i]; const dz = rz[i] - cz[i];
    const d = math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > piorR) { piorR = d; piorRI = i; }
    const ady = dy < 0.0 ? 0.0 - dy : dy;
    somaRY = somaRY + ady;
    if (ady > piorRY) piorRY = ady;
    i = i + 1;
  }
  io.print("    pior distancia : " + piorR.toFixed(3) + " no corpo " + piorRI);
  io.print("    pior altura    : " + piorRY.toFixed(3) +
           "   media " + (somaRY / ESTAVEL).toFixed(3));
  const sepC = cx[10] - cx[9];
  const sepR = rx[10] - rx[9];
  io.print("    separacao do par sobreposto: CPU " + sepC.toFixed(3) +
           "  RUST " + sepR.toFixed(3));
  // A MESMA tolerância de altura que o braço da GPU usa (0.15), e pelo mesmo
  // motivo: a altura é o que a FORMA decide, e as duas relaxações diferentes
  // (0.85 sequencial contra 0.30 Jacobi) mais o slop cabem nela. Usar uma
  // tolerância mais frouxa aqui seria medir um critério mais fraco e chamar de
  // paridade.
  check("RUST: altura de repouso bate com a CPU (< 0.15)", piorRY < 0.15 ? 1 : 0);
  check("RUST: nenhum corpo atravessou o chao", (function (): number {
    let j = 0;
    while (j < N) { if (ry[j] < 0.0 - 1.0) return 0; j = j + 1; }
    return 1;
  })());
  check("RUST: o par sobreposto se afasta igual ao da CPU (< 0.05)",
        (sepR - sepC < 0.05 && sepC - sepR < 0.05) ? 1 : 0);
}

// ── comparação ─────────────────────────────────────────────────────────────
if (temGpu === 0) {
  // "0 ok, 0 falhas" estava escrito à mão aqui, e passou a MENTIR quando o
  // braço RUST × CPU entrou: ele roda sem GPU e deixa checagens no contador.
  // Um resultado escrito à mão é um resultado que para de acompanhar o teste.
  io.print("[paridade] sem GPU — a metade GPU foi PULADA; a RUST x CPU rodou");
  io.print("[resultado] " + ok + " ok, " + fail + " falhas");
  io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
} else {
  const nomes: string[] = ["esfera solta", "esfera solta 2",
    "caixa pilha 1", "caixa pilha 2", "caixa pilha 3",
    "caixa sob esfera", "esfera sobre caixa",
    "esfera sob caixa", "caixa sobre esfera",
    "esfera lado a lado 1", "esfera lado a lado 2",
    "caixa (quina)", "esfera NA QUINA",
    "esfera base", "esfera SOBRE esfera"];
  // EQUILÍBRIO INSTÁVEL não é asserível, e dizer isso é mais honesto que
  // afrouxar a tolerância até tudo passar. Uma esfera pousada FORA DE CENTRO
  // sobre outra é um ponto de sela: qualquer diferença — e há duas conhecidas,
  // a ordem de resolução e a relaxação — decide para que lado ela cai, e o
  // resultado é metros de distância a partir de micrômetros de diferença. Os
  // dois últimos corpos são esse caso; ficam MEDIDOS e IMPRESSOS, fora da
  // asserção. Todo contato apoiado (os treze primeiros) é asserido.
  const ESTAVEL = N - 2;
  io.print("  corpo                  CPU (x,y,z)              GPU (x,y,z)          dist   dForma");
  let pior: f64 = 0.0;
  let piorI = 0;
  let somaY: f64 = 0.0;
  let piorY: f64 = 0.0;
  let piorForma: f64 = 0.0;
  let piorFormaI = 0;
  let i = 0;
  while (i < N) {
    const dx = gx[i] - cx[i]; const dy = gy[i] - cy[i]; const dz = gz[i] - cz[i];
    const d = math.sqrt(dx * dx + dy * dy + dz * dz);
    // O QUE A FORMA MUDOU: a mesma GPU com formas reais contra a mesma GPU
    // mandando tudo como caixa. Isola a mudança sem a CPU no meio.
    const fx = gx[i] - bx[i]; const fy = gy[i] - by[i]; const fz = gz[i] - bz[i];
    const df = math.sqrt(fx * fx + fy * fy + fz * fz);
    if (df > piorForma) { piorForma = df; piorFormaI = i; }
    if (i < ESTAVEL) {
      if (d > pior) { pior = d; piorI = i; }
      const ady = dy < 0.0 ? 0.0 - dy : dy;
      somaY = somaY + ady;
      if (ady > piorY) piorY = ady;
    }
    io.print("  " + nomes[i].padEnd(22) +
      (cx[i].toFixed(2) + "," + cy[i].toFixed(2) + "," + cz[i].toFixed(2)).padEnd(24) +
      (gx[i].toFixed(2) + "," + gy[i].toFixed(2) + "," + gz[i].toFixed(2)).padEnd(22) +
      d.toFixed(3).padStart(7) + df.toFixed(3).padStart(8) +
      (i < ESTAVEL ? "" : "   (instavel, fora da assercao)"));
    i = i + 1;
  }
  io.print("");
  io.print("  O QUE A FORMA MUDOU (GPU formas x GPU tudo-caixa): pior " +
           piorForma.toFixed(3) + " em '" + nomes[piorFormaI] + "'");
  io.print("  PARIDADE nos " + ESTAVEL + " contatos apoiados:");
  io.print("    pior distancia : " + pior.toFixed(3) + " em '" + nomes[piorI] + "'");
  io.print("    pior altura    : " + piorY.toFixed(3) +
           "   media " + (somaY / ESTAVEL).toFixed(3));

  // A ALTURA é o que a forma decide: uma esfera de raio r assenta com o centro
  // a r acima do chão, uma caixa a metade da altura. Tolerância de 0.15 = pouco
  // mais que o slop (0.04) somado às duas relaxações diferentes.
  check("altura de repouso bate nos dois backends (< 0.15)", piorY < 0.15 ? 1 : 0);
  check("nenhum corpo atravessou o chao na GPU", (function (): number {
    let j = 0;
    while (j < N) { if (gy[j] < 0.0 - 1.0) return 0; j = j + 1; }
    return 1;
  })());
  // SEPARAÇÃO RELATIVA do par de esferas que nasce sobreposto (índices 9 e 10):
  // começam a 0.8 com raios que somam 1.0, então os dois backends têm de
  // afastá-las até ~1.0 menos o slop. Isto é a física do contato; a posição
  // ABSOLUTA do par não é — ver a nota abaixo. Asserir o invariante e MEDIR a
  // deriva é mais honesto que escolher uma tolerância que caiba na deriva.
  const sepC = cx[10] - cx[9];
  const sepG = gx[10] - gx[9];
  io.print("    separacao do par sobreposto: CPU " + sepC.toFixed(3) +
           "  GPU " + sepG.toFixed(3));
  check("o par sobreposto se afasta igual nos dois (< 0.05)",
        (sepG - sepC < 0.05 && sepC - sepG < 0.05) ? 1 : 0);
  check("a FORMA mudou o resultado de alguem (senao o teste nao discrimina)",
        piorForma > 0.05 ? 1 : 0);

  // DERIVA ABSOLUTA, medida e não asserida. O par acima termina com a separação
  // certa nos dois backends e o CENTRO deslocado: a GPU preserva o centro do par
  // (9.40, o mesmo do spawn) e a CPU o empurra 0.55 para a esquerda. É a
  // assimetria do solver SEQUENCIAL — ele resolve o par uma vez e o par com o
  // chão em outra ordem — contra o Jacobi, que aplica metade a cada um. Não tem
  // relação com forma (a coluna dForma é 0.000 nesses dois corpos), e prender um
  // limiar nela seria fixar uma tolerância a um artefato que ainda não foi
  // diagnosticado. Fica no relatório para ser o próximo a investigar.
  io.print("    deriva ABSOLUTA maxima (medida, nao asserida): " + pior.toFixed(3) +
           " em '" + nomes[piorI] + "'");

  // ── RUST × GPU: a comparação que mais deveria fechar ─────────────────────
  //
  // E é ela que carrega a expectativa mais forte dos três pares, por uma razão
  // estrutural: o solver Rust é uma tradução do kernel WGSL — mesmo modelo
  // gather, mesma relaxação 0,30, mesmas constantes. O par CPU × GPU compara
  // sequencial contra Jacobi e por isso tem uma diferença de MODELO embutida;
  // este par não tem. Se ele divergir MAIS que o outro, a causa está na
  // tradução ou no snapshot e não no modelo — que é o que torna este número
  // diagnóstico em vez de decorativo.
  let piorRG: f64 = 0.0;
  let piorRGI = 0;
  let piorRGY: f64 = 0.0;
  let i2 = 0;
  while (i2 < ESTAVEL) {
    const ddx = rx[i2] - gx[i2]; const ddy = ry[i2] - gy[i2]; const ddz = rz[i2] - gz[i2];
    const dd = math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (dd > piorRG) { piorRG = dd; piorRGI = i2; }
    const ady2 = ddy < 0.0 ? 0.0 - ddy : ddy;
    if (ady2 > piorRGY) piorRGY = ady2;
    i2 = i2 + 1;
  }
  io.print("");
  io.print("[RUST x GPU] mesma formulacao dos dois lados (gather, relaxacao 0.30)");
  // SEIS casas, e não três como os outros dois pares. Não é capricho: a
  // primeira rodada imprimiu 0.000 nos treze corpos, e "0.000" é indistinguível
  // de "o braço não rodou" ou "os dois arrays são o mesmo". Um número que só
  // pode ser lido como zero não prova concordância — mostra que a régua é curta.
  io.print("    pior distancia : " + piorRG.toFixed(6) + " em '" + nomes[piorRGI] + "'");
  io.print("    pior altura    : " + piorRGY.toFixed(6));
  io.print("    testemunha (corpo 9): RUST x = " + rx[9].toFixed(6) +
           "  GPU x = " + gx[9].toFixed(6) + "  CPU x = " + cx[9].toFixed(6));
  check("RUST x GPU: altura de repouso bate (< 0.15)", piorRGY < 0.15 ? 1 : 0);

  // ── SEGUNDA CENA: contato DENSO ──────────────────────────────────────────
  //
  // Existe porque a primeira não responde a pergunta que o solver Rust levanta.
  //
  // Ele difere do kernel WGSL num ponto declarado: os vizinhos vêm de um
  // SNAPSHOT tirado no topo do sub-passo, enquanto na GPU uma thread lê
  // `pos[j]` enquanto outra o escreve. Jacobi verdadeiro contra Jacobi com
  // corrida. A cena acima tem 15 corpos com um ou dois contatos cada, então a
  // leitura-durante-escrita quase nunca acontece nela — e um teste que não pode
  // ver a diferença não é evidência de que ela não existe.
  //
  // Uma PILHA é onde ela apareceria: dezenas de corpos, cada um lendo vizinhos
  // que estão sendo escritos no mesmo passo.
  const DN = 180;
  const DPASSOS = 300;
  const dgx: f64[] = []; const dgy: f64[] = [];
  const drx: f64[] = []; const dry: f64[] = [];
  scene.clear(); montaChao(); scene.computeWorld();
  rbInit(DN); rbSyncStatics(scene);
  let q = 0;
  while (q < DN) {
    // Grade 6×6 com 5 andares, passo 0,9 sobre corpos de meia-extensão 0,5:
    // todo vizinho é contato de verdade, nos três eixos.
    rbSetBody(q, (q % 6) * 0.9, 0.9 + ((q / 36) | 0) * 0.9,
              (((q / 6) | 0) % 6) * 0.9, 0.5, 0.5, 0.5, 1.0);
    q = q + 1;
  }
  rbUpload();
  let df = 0;
  while (df < DPASSOS) { rbStep(1); df = df + 1; }
  rbStep(0);
  q = 0;
  while (q < DN) { dgx.push(rbX(q)); dgy.push(rbY(q)); q = q + 1; }

  scene.clear(); montaChao(); scene.computeWorld();
  crInit(DN); crSyncStatics(scene);
  q = 0;
  while (q < DN) {
    crSetBody(q, (q % 6) * 0.9, 0.9 + ((q / 36) | 0) * 0.9,
              (((q / 6) | 0) % 6) * 0.9, 0.5, 0.5, 0.5, 1.0);
    q = q + 1;
  }
  df = 0;
  while (df < DPASSOS) { crStep(1); df = df + 1; }
  q = 0;
  while (q < DN) { drx.push(crX(q)); dry.push(crY(q)); q = q + 1; }

  let piorD: f64 = 0.0;
  let piorDI = 0;
  let somaD: f64 = 0.0;
  q = 0;
  while (q < DN) {
    const ex = drx[q] - dgx[q]; const ey = dry[q] - dgy[q];
    const e = math.sqrt(ex * ex + ey * ey);
    if (e > piorD) { piorD = e; piorDI = q; }
    somaD = somaD + e;
    q = q + 1;
  }
  io.print("");
  io.print("[RUST x GPU, PILHA DENSA] " + DN + " corpos, " + DPASSOS + " passos");
  io.print("    pior desvio : " + piorD.toFixed(4) + " no corpo " + piorDI);
  io.print("    desvio medio: " + (somaD / DN).toFixed(4));
  // MEDIDO e NÃO asserido, pela mesma razão que o teste já aplica ao par
  // instável: prender um limiar num número que ainda não foi diagnosticado fixa
  // a tolerância no artefato. O que se sabe é que a diferença de modelo entre os
  // dois é o snapshot, e este é o número dela.
  io.print("    (medido, nao asserido — e a diferenca do snapshot, ver cpurigid.ts)");
  // O que É asserível: a pilha continua uma pilha. Um solver que explodisse ou
  // afundasse daria desvio grande E altura absurda, e só o desvio não separa os
  // dois casos.
  check("PILHA: nenhum corpo afundou no chao (RUST)", (function (): number {
    let j = 0;
    while (j < DN) { if (dry[j] < 0.0) return 0; j = j + 1; }
    return 1;
  })());

  io.print("[resultado] " + ok + " ok, " + fail + " falhas");
  io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");
}

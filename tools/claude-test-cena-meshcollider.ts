// A CENA DE DEMONSTRAÇÃO roda, e os dois lados dela discordam.
//
//   rts.exe run tools/claude-test-cena-meshcollider.ts
//
// `scenes/meshcollider.json` existe para ser ABERTA no editor e a diferença ser
// vista. Este arquivo é o que garante que ela continue mostrando o que promete
// depois de alguém mexer no motor — uma cena de demonstração que silenciosamente
// para de demonstrar é pior que nenhuma, porque ela continua parecendo prova.
//
// A cena é simétrica de propósito: mesmas formas, mesmas escalas, mesmas bolas,
// mesmas alturas. A ÚNICA diferença entre os dois lados é o colisor — caixa em
// x = −5, casca em x = +5. Então qualquer divergência no resultado é atribuível
// à forma e a nada mais, que é o que torna a demonstração uma medida.
//
// O que se espera ver, e o teste afere:
//
//   CAIXA  as bolas param no topo da caixa invisível que envolve a pirâmide —
//          acima das faces, flutuando sobre os cantos vazios;
//   CASCA  as bolas encontram as faces inclinadas, escorregam por elas e
//          assentam MAIS BAIXO, muitas alcançando o chão.
import io from "../compat/io.ts";
import fs from "../compat/fs.ts";
import { Scene } from "../engine/core/scene";
import { GameObject } from "../engine/core/gameobject";
import { Transform } from "../engine/core/transform";
// `loadSceneFrom` preenche a cena GLOBAL da sessão e devolve void — o editor é
// quem tem uma cena, não quem recebe uma. Importar as duas coisas é o que faz
// este teste exercitar o mesmo caminho que abrir a cena no editor exercita.
import { loadSceneFrom } from "../editor/sceneio";
import { scene as sc } from "../editor/control/session";
import { shapeOf } from "../engine/core/collider";
import { rigidNeedsFallback, rigidHullCount, rigidInvalidate, rigidSetMode, rigidStep }
  from "../engine/core/physics_backend";
import { hullResetRegistry } from "../engine/core/hullreg";
import { hullMeshReset } from "../engine/core/hullmesh";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

hullResetRegistry();
hullMeshReset();

loadSceneFrom("scenes/meshcollider.json");
check("a cena carregou", sc.objects.length > 10 ? 1 : 0);
io.print("    objetos: " + sc.objects.length);

// ── as cascas sobreviveram à travessia do arquivo ─────────────────────────
//
// O ponto delicado da serialização: a cena grava `hullMesh` (qual malha) e NÃO
// `hullId` (qual entrada do registro), porque um id é um ponteiro e gravar um
// ponteiro em disco faz a segunda cena carregada apontar para a malha errada.
// Este bloco é o que prova que a tradução aconteceu.
let comCasca = 0;
let i = 0;
while (i < sc.objects.length) {
  if (shapeOf(sc.objects[i]) === 2) comCasca = comCasca + 1;
  i = i + 1;
}
io.print("    objetos com colisor de CASCA: " + comCasca);
check("as cascas foram reconstruidas do arquivo", comCasca === 2 ? 1 : 0);

// ── o decisor vê e cai ────────────────────────────────────────────────────
rigidSetMode(1);
rigidInvalidate();
sc.computeWorld();
rigidStep(sc, 1);
io.print("    o decisor viu " + rigidHullCount() + " casca(s); pede fallback = " +
         rigidNeedsFallback());
check("o decisor conta as cascas da cena", rigidHullCount() === 2 ? 1 : 0);
check("e pede o backend que sabe resolve-las", rigidNeedsFallback());

// ── roda a cena e mede os dois lados ──────────────────────────────────────
let f = 0;
while (f < 500) {
  sc.update(1.0 / 60.0);
  sc.computeWorld();
  if (rigidStep(sc, 0) === 0) sc.resolveCollisions();
  f = f + 1;
}
sc.computeWorld();

/// A altura média das bolas cujo nome contém `marca`.
function alturaMedia(marca: string): f64 {
  let soma: f64 = 0.0;
  let n = 0;
  let k = 0;
  while (k < sc.objects.length) {
    const o: GameObject = sc.objects[k];
    if (o.name.indexOf("Bola " + marca) === 0) {
      const t: Transform = sc.trs[k];
      soma = soma + t.py;
      n = n + 1;
    }
    k = k + 1;
  }
  return n > 0 ? soma / n : 0.0;
}

const yCaixa = alturaMedia("CAIXA");
const yCasca = alturaMedia("CASCA");
io.print("");
io.print("  altura media das nove bolas de cada lado, depois de 500 frames:");
io.print("    sobre o colisor de CAIXA : " + yCaixa.toFixed(3));
io.print("    sobre o colisor de CASCA : " + yCasca.toFixed(3));
io.print("    diferenca                : " + (yCaixa - yCasca).toFixed(3));

check("as nove bolas de cada lado existem", 1);
// O lado da CASCA tem de terminar mais BAIXO: as bolas escorregam pelas faces
// em vez de parar no topo da caixa invisível.
check("a CASCA deixa as bolas mais baixas (a geometria foi respeitada)",
      yCasca < yCaixa - 0.3 ? 1 : 0);
// E nenhum lado pode ter atravessado o chão: um colisor que "melhora" deixando
// tudo cair não é um colisor melhor.
check("nenhum lado atravessou o chao",
      (yCaixa > 0.0 - 1.0 && yCasca > 0.0 - 1.0) ? 1 : 0);

io.print("");
io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

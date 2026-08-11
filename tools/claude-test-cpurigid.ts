// O backend RUST sozinho, sem a GPU no caminho.
//
//   rts.exe run tools/claude-test-cpurigid.ts
//
// Existe separado do `claude-test-paridade-formas.ts` por uma razão de
// DIAGNÓSTICO e não de cobertura: aquele importa `rts:gpu` no topo, então numa
// máquina sem a superfície de GPU registrada ele nem carrega — e "não carregou"
// e "a física está errada" são a mesma mensagem para quem lê a saída. Este roda
// em qualquer build do motor, que é exatamente onde o fallback precisa rodar.
//
// O que ele pina é a ponte, não a física: a física está pinada em Rust
// (`crates/rts-physics/src/solver/tests.rs`), onde um teste pode nomear uma
// constante. Aqui a pergunta é se os `Float32Array` atravessam, se os corpos
// assentam nas alturas que a FORMA manda, e se o estático da cena chega.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject, COL_SPHERE, COL_BOX } from "../engine/core/gameobject";
import { crInit, crSetBody, crSetShape, crSyncStatics, crStep,
         crX, crY, crZ, crSleep, crThreads, crCount } from "../engine/rigid/cpurigid";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

const PASSOS = 900;

const sc = new Scene("CpuRigid");
const chao = new GameObject("Chao");
chao.setMesh(1, 100, 100, 100);
chao.transform.setPosition(0.0, 0.0, 0.0);
chao.transform.sx = 60.0; chao.transform.sy = 1.0; chao.transform.sz = 60.0;
chao.colShape = COL_BOX;
chao.stationary = 1;
sc.add(chao);
sc.computeWorld();

io.print("[cpurigid] threads = " + crThreads());

// Uma caixa e uma esfera, cada uma sobre o chão. As duas assentam em alturas
// DIFERENTES e é isso que prova que a forma atravessou: a caixa de escala 1
// assenta com o centro a 0,5 do topo do chão, a esfera de escala 2 a 1,0.
crInit(2);
crSyncStatics(sc);
crSetBody(0, 0.0, 8.0, 0.0, 0.5, 0.5, 0.5, 1.0);
crSetShape(0, COL_BOX);
crSetBody(1, 6.0, 8.0, 0.0, 1.0, 1.0, 1.0, 1.0);
crSetShape(1, COL_SPHERE);

check("crInit registrou os dois corpos", crCount() === 2 ? 1 : 0);

let f = 0;
while (f < PASSOS) { crStep(1); f = f + 1; }

io.print("  caixa  y = " + crY(0).toFixed(3) + "  sono " + crSleep(0).toFixed(0));
io.print("  esfera y = " + crY(1).toFixed(3) + "  sono " + crSleep(1).toFixed(0));

// O topo do chão está em y = 0,5 (centro 0, meia-altura 0,5).
const alvoCaixa = 1.0;
const alvoEsfera = 1.5;
const dCaixa = crY(0) - alvoCaixa < 0.0 ? alvoCaixa - crY(0) : crY(0) - alvoCaixa;
const dEsfera = crY(1) - alvoEsfera < 0.0 ? alvoEsfera - crY(1) : crY(1) - alvoEsfera;
check("a caixa assenta sobre o chao (< 0.15)", dCaixa < 0.15 ? 1 : 0);
check("a esfera assenta no PROPRIO raio (< 0.15)", dEsfera < 0.15 ? 1 : 0);
check("nenhum dos dois atravessou o chao", (crY(0) > 0.0 && crY(1) > 0.0) ? 1 : 0);
// Assentado e parado tem de DORMIR: é o que faz uma cena em repouso ser barata,
// e um solver que nunca dorme passa nas alturas e custa o dobro para sempre.
check("os dois dormem depois de assentar", (crSleep(0) >= 10.0 && crSleep(1) >= 10.0) ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

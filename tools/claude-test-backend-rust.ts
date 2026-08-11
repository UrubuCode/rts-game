// O DECISOR com o backend Rust: `rigidSetMode(2)`.
//
//   rts.exe run tools/claude-test-backend-rust.ts
//
// O `claude-test-paridade-formas.ts` dirige `cpurigid` DIRETO, então ele mede o
// solver e não a costura. Esta é a costura: `rigidStep` escolhe o ramo, coleta
// os corpos pelo mesmo critério dos outros dois backends, e escreve o resultado
// de volta nos transforms. Cada uma dessas três é um lugar onde o backend novo
// pode estar ligado errado sem que o solver tenha nada.
import io from "../compat/io.ts";
import { Scene } from "../engine/core/scene";
import { GameObject, COL_SPHERE, COL_BOX } from "../engine/core/gameobject";
import { rigidSetMode, rigidMode, rigidStep, rigidBackendName,
         rigidBodyCount, rigidFreshFrames } from "../engine/core/physics_backend";

let ok = 0;
let fail = 0;
function check(nome: string, cond: number): void {
  if (cond !== 0) { ok = ok + 1; io.print("  [ok] " + nome); }
  else { fail = fail + 1; io.print("  [FALHOU] " + nome); }
}

const sc = new Scene("BackendRust");
const chao = new GameObject("Chao");
chao.setMesh(1, 100, 100, 100);
chao.transform.setPosition(0.0, 0.0, 0.0);
chao.transform.sx = 60.0; chao.transform.sy = 1.0; chao.transform.sz = 60.0;
chao.colShape = COL_BOX;
chao.stationary = 1;
sc.add(chao);

const caixa = new GameObject("Caixa");
caixa.setMesh(1, 200, 200, 200);
caixa.colShape = COL_BOX;
caixa.transform.setPosition(0.0, 8.0, 0.0);
caixa.transform.setScale(1.0);
sc.add(caixa);

const esfera = new GameObject("Esfera");
esfera.setMesh(4, 200, 200, 200);
esfera.colShape = COL_SPHERE;
esfera.transform.setPosition(6.0, 8.0, 0.0);
esfera.transform.setScale(2.0);
sc.add(esfera);

sc.computeWorld();

rigidSetMode(2);
check("o modo 2 fica em 2 (era mapeado para 0 antes)", rigidMode() === 2 ? 1 : 0);

let f = 0;
let assumiu = 0;
while (f < 600) {
  // 1 = o backend assumiu o frame e o caminho CPU deve ser PULADO. Um backend
  // que devolvesse 0 faria as duas físicas rodarem sobre o mesmo estado.
  if (rigidStep(sc, 0) !== 0) assumiu = assumiu + 1;
  sc.computeWorld();
  f = f + 1;
}

io.print("  backend ativo : " + rigidBackendName());
io.print("  corpos        : " + rigidBodyCount());
io.print("  frames que o backend assumiu: " + assumiu + " de 600");
io.print("  frames com estado novo      : " + rigidFreshFrames());
io.print("  caixa  y = " + caixa.transform.py.toFixed(3));
io.print("  esfera y = " + esfera.transform.py.toFixed(3));

check("o backend assumiu TODOS os frames", assumiu === 600 ? 1 : 0);
check("coletou os dois corpos dinamicos (e nao o chao)", rigidBodyCount() === 2 ? 1 : 0);
// As mesmas alturas que o teste direto pina, agora atravessando a costura: se
// `pbApplyRust` escrevesse no campo errado, os corpos ficariam onde nasceram.
const dCaixa = caixa.transform.py - 1.0 < 0.0 ? 1.0 - caixa.transform.py : caixa.transform.py - 1.0;
const dEsfera = esfera.transform.py - 1.5 < 0.0 ? 1.5 - esfera.transform.py : esfera.transform.py - 1.5;
check("a caixa assentou sobre o chao (< 0.15)", dCaixa < 0.15 ? 1 : 0);
check("a esfera assentou no proprio raio (< 0.15)", dEsfera < 0.15 ? 1 : 0);

io.print("[resultado] " + ok + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

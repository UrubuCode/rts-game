// O que o passo fixo conserta, provado em vez de afirmado.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { scene } from "../editor/control/session";
import { Rigidbody } from "../scripts/rigidbody";
import { stepsFor, FIXED_DT, stepAlpha, stepDiscards, stepReset } from "../engine/core/fixedstep";

let pass = 0; let fail = 0;
function ok(n: string, c: number): void {
  if (c !== 0) { pass = pass + 1; io.print("  [ok] " + n); }
  else { fail = fail + 1; io.print("  [FALHOU] " + n); }
}

// Uma bola solta de y=20 sobre um chão fino de 0.2 — a geometria que o passo
// variável atravessa.
function simular(dts: number[]): f64 {
  stepReset();
  scene.clear();
  const chao = new GameObject("chao");
  chao.setMesh(1, 120, 120, 120);
  chao.transform.setPosition(0, 0, 0);
  chao.transform.sx = 40; chao.transform.sy = 0.2; chao.transform.sz = 40;
  chao.stationary = 1;
  scene.add(chao);

  const b = new GameObject("bola");
  b.setMesh(4, 200, 60, 60);
  b.transform.setPosition(0, 20, 0);
  b.transform.setScale(0.5);
  b.addBehavior(new Rigidbody(0.0 - 9.8, 0.3));
  scene.add(b);

  for (let i = 0; i < dts.length; i++) {
    const passos = stepsFor(dts[i]);
    for (let p = 0; p < passos; p++) { scene.update(FIXED_DT); scene.resolveCollisions(); }
  }
  scene.computeWorld();
  return b.transform.py;
}

// 3 segundos de simulação, entregues em ritmos diferentes — todos DENTRO do
// teto de 5 passos por frame. Acima dele o desenho promete outra coisa (ver o
// bloco de câmera lenta mais abaixo), e testar igualdade ali seria testar contra
// o que o código diz que faz.
const suave: number[] = [];   for (let i = 0; i < 180; i++) suave.push(1.0 / 60.0);   // 60fps: 1 passo/frame
const meio: number[] = [];    for (let i = 0; i < 90; i++) meio.push(1.0 / 30.0);     // 30fps: 2 passos/frame
const irregular: number[] = [];
// Soma exatamente 3 s, alternando frames rápidos e travados (máx. 4 passos).
for (let i = 0; i < 45; i++) { irregular.push(0.0666666666666667); irregular.push(0.0); }

io.print("== DETERMINISMO: o mesmo tempo simulado, em ritmos diferentes ==");
const yA = simular(suave);
const yB = simular(meio);
const yC = simular(irregular);
io.print("  60fps constante : y=" + yA.toFixed(4));
io.print("  30fps constante : y=" + yB.toFixed(4));
io.print("  irregular       : y=" + yC.toFixed(4));
// Mesmo número de passos = MESMO resultado. É o ponto inteiro do passo fixo, e
// era o que o `dt` do frame não dava: ali cada ritmo integrava outra coisa.
ok("60fps e 30fps chegam ao mesmo lugar", Math.abs(yA - yB) < 0.001 ? 1 : 0);
ok("o ritmo irregular nao muda o resultado", Math.abs(yA - yC) < 0.001 ? 1 : 0);

io.print("");
io.print("== CAMERA LENTA acima do teto (comportamento PROMETIDO, nao defeito) ==");
const lento: number[] = []; for (let i = 0; i < 30; i++) lento.push(0.1);  // 10fps: pede 6, teto 5
const yD = simular(lento);
io.print("  10fps (pede 6 passos/frame, teto 5): y=" + yD.toFixed(4));
// Menos passos rodados = menos tempo simulado = a bola caiu MENOS. Isso é a
// espiral da morte sendo evitada: câmera lenta visível e recuperável, em vez de
// um programa que nunca mais alcança o tempo real.
ok("acima do teto a simulacao fica ATRASADA (e nao trava)", yD > yA ? 1 : 0);

io.print("");
io.print("== TUNNELING: chao de 0.2 de espessura, queda de 20 ==");
ok("a bola parou SOBRE o chao (nao atravessou)", yA > 0.0 ? 1 : 0);
io.print("  y final = " + yA.toFixed(4) + " (o chao tem meia-altura 0.1)");

io.print("");
io.print("== ESPIRAL DA MORTE: um frame de 2 segundos ==");
stepReset();
const antes = stepDiscards();
const passos = stepsFor(2.0);
ok("um frame gigante nao pede passos sem limite", passos <= 5 ? 1 : 0);
ok("o tempo que nao coube foi DESCARTADO", stepDiscards() > antes ? 1 : 0);
io.print("  pediu " + passos + " passos (teto 5) e descartou o resto");

io.print("");
io.print("== ALPHA para interpolacao ==");
stepReset();
stepsFor(1.0 / 60.0 * 1.5);   // um passo e meio
const a = stepAlpha();
ok("alpha fica entre 0 e 1", a >= 0.0 && a <= 1.0 ? 1 : 0);
io.print("  alpha=" + a.toFixed(3) + " (meio passo sobrando = ~0.5)");

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

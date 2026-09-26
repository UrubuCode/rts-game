// Cache do envio de luzes (Task 10.5, passo 4): a coleta roda todo quadro, o
// envio ao renderer (setLights/setLight/setShadow) só sai quando o pacote muda.
//   rts.exe run tests/test_light_cache.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { Light } from "@engine/core/light";
import { aplicarLuzes, enviosDeLuz, reenviarLuzes } from "@engine/render/scene_lighting";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }

const sc = new Scene("cache");
const sol = sc.createGameObject("Sol");
sol.transform.setPosition(0.0, 10.0, 0.0);
const ls = new Light(); ls.tipo = "direcional"; ls.sombra = true; sol.addBehavior(ls);
const a = sc.createGameObject("A");
a.transform.setPosition(0.0 - 5.0, 1.0, 0.0);
const la = new Light(); la.tipo = "pontual"; la.cor = 0xFF0000; a.addBehavior(la);
const b = sc.createGameObject("B");
b.transform.setPosition(5.0, 1.0, 0.0);
const lb = new Light(); lb.tipo = "pontual"; lb.cor = 0x0000FF; b.addBehavior(lb);
sc.computeWorld();

const cam = new Float64Array(3); cam[0] = 0.0 - 1.0; cam[1] = 2.0; cam[2] = 0.0 - 10.0;
const legado = new Float64Array(4); legado[0] = 7.0; legado[1] = 13.0; legado[2] = 5.0; legado[3] = 0.28;

reenviarLuzes();
aplicarLuzes(0, sc, cam, legado);
const e0 = enviosDeLuz();
let f = 0;
while (f < 1000) { aplicarLuzes(0, sc, cam, legado); f = f + 1; }
check(enviosDeLuz() === e0, "cena parada: 0 envios em 1000 quadros (vieram " + (enviosDeLuz() - e0) + ")");

// mover a luz A: um envio, e só um
a.transform.setPosition(0.0 - 4.0, 1.0, 0.0); sc.computeWorld();
f = 0;
while (f < 10) { aplicarLuzes(0, sc, cam, legado); f = f + 1; }
check(enviosDeLuz() === e0 + 1, "mover a luz: 1 envio (vieram " + (enviosDeLuz() - e0) + ")");

// mudar um campo (cor) sem mexer na pose: também reenvia uma vez
lb.cor = 0x00FF00;
f = 0;
while (f < 10) { aplicarLuzes(0, sc, cam, legado); f = f + 1; }
check(enviosDeLuz() === e0 + 2, "mudar a cor: 1 envio");

// câmera anda sem mudar a ordem (A continua mais perto): nenhum envio
cam[2] = 0.0 - 9.0;
f = 0;
while (f < 10) { cam[0] = 0.0 - 1.0 - f * 0.01; aplicarLuzes(0, sc, cam, legado); f = f + 1; }
check(enviosDeLuz() === e0 + 2, "câmera anda sem reordenar: 0 envios");

// câmera passa para o lado de B: a ordem das pontuais troca → 1 envio
cam[0] = 6.0;
f = 0;
while (f < 10) { aplicarLuzes(0, sc, cam, legado); f = f + 1; }
check(enviosDeLuz() === e0 + 3, "câmera reordena as pontuais: 1 envio (vieram " + (enviosDeLuz() - e0) + ")");

// outra cena na mesma janela: reenvia
const sc2 = new Scene("outra");
aplicarLuzes(0, sc2, cam, legado);
check(enviosDeLuz() === e0 + 4, "outra cena: reenvia");
io.print("[PASSOU] cache de luzes: parada 0/1000, mover 1, campo 1, câmera sem reordenar 0, reordenar 1, troca de cena 1");

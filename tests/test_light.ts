// Teste SEM JANELA do component Light e da coleta de luzes da cena: cache,
// limite de 8, ordem (direcional principal primeiro), formato, serialização,
// sombra e a "Luz Direcional" de uma cena nova.
//
//   rts.exe run tests/test_light.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Light, MAX_LUZES, FLOATS_POR_LUZ } from "@engine/core/light";
import { recreateBehavior } from "@editor/sceneio";
import { componentToData } from "@engine/components";
import { aplicarLuzes, sombraAtual } from "@engine/render/scene_lighting";
import { sceneDocument } from "@editor/scene_document";
import { scene } from "@editor/control/session";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
function perto(a: number, b: number): boolean { return Math.abs(a - b) < 1e-6; }
function luz(sc: Scene, nome: string, tipo: string, x: number): Light {
  const o = sc.createGameObject(nome);
  o.transform.setPosition(x, 0.0, 0.0);
  const l = new Light(); l.tipo = tipo; o.addBehavior(l);
  return l;
}
function dono(l: Light): GameObject { return l.owner as GameObject; }

// 1) cache: entra ao anexar, sai ao remover o componente ou o objeto
const sc = new Scene("teste");
const a = luz(sc, "A", "pontual", 1.0);
check(sc.lightObjs.length === 1, "Light anexado entra no cache");
sc.objects[0].removeBehavior(0);
check(sc.lightObjs.length === 0, "remover o componente tira do cache");
sc.objects[0].addBehavior(a);
check(sc.lightObjs.length === 1, "anexar de novo volta ao cache");
sc.removeAt(0);
check(sc.lightObjs.length === 0, "remover o objeto tira do cache");

// 2) 10 pontuais em x = 10..1, uma direcional, uma desligada e uma filha de pai inativo
let k = 10;
while (k >= 1) { luz(sc, "P" + k, "pontual", k); k = k - 1; }
const sol = luz(sc, "Sol", "direcional", 50.0); sol.sombra = true;
const desligada = luz(sc, "Desligada", "pontual", 0.5); desligada.enabled = 0;
const pai = sc.createGameObject("Pai"); pai.active = 0;
const filha = luz(sc, "Filha", "pontual", 0.25);
dono(filha).parent = sc.objects.indexOf(pai);
sc.computeWorld();
const buf = new Float64Array(MAX_LUZES * FLOATS_POR_LUZ);
const cam = new Float64Array(3);
const n = sc.collectLights(buf, cam);
check(n === MAX_LUZES, "limite de 8: " + n);
check(buf[0] === 0.0 && perto(buf[1], 50.0), "a direcional vem primeiro");
let j = 1;
while (j < n) {
  check(perto(buf[j * FLOATS_POR_LUZ + 1], j), "pontual " + j + " em ordem de distância: " + buf[j * FLOATS_POR_LUZ + 1]);
  j = j + 1;
}

// 3) formato: +Z sem rotação; -Y com pitch -90°; cor e cones
const s2 = new Scene("formato");
const spot = luz(s2, "Spot", "spot", 0.0);
spot.cor = 0xFF8000; spot.intensidade = 2.0; spot.alcance = 7.0; spot.anguloSpot = 60.0;
s2.computeWorld();
const b2 = new Float64Array(FLOATS_POR_LUZ);
check(s2.collectLights(b2, cam) === 1, "uma luz");
check(b2[0] === 2.0, "spot = tipo 2");
check(perto(b2[4], 0.0) && perto(b2[5], 0.0) && perto(b2[6], 1.0), "sem rotação a luz aponta para +Z");
check(perto(b2[7], 1.0) && perto(b2[8], 128.0 / 255.0) && perto(b2[9], 0.0), "cor 0xFF8000");
check(b2[10] === 2.0 && b2[11] === 7.0, "intensidade e alcance");
check(perto(b2[13], Math.cos(30.0 * Math.PI / 180.0)) && perto(b2[12], Math.cos(24.0 * Math.PI / 180.0)), "cone externo 30°, interno 24°");
s2.objects[0].transform.rx = 0.0 - Math.PI / 2.0; s2.computeWorld(); s2.collectLights(b2, cam);
check(perto(b2[5], -1.0), "pitch -90° aponta para baixo");

// 4) ida e volta pelo formato de cena
const copia = recreateBehavior(componentToData(spot)) as Light;
check(copia.tipo === "spot" && copia.cor === 0xFF8000 && copia.anguloSpot === 60.0 && copia.alcance === 7.0, "Light sobrevive a salvar/carregar");

// 5) aplicarLuzes (nativos são no-op sem janela): sombra legada, da principal, ou desligada
const legado = new Float64Array(4); legado[0] = 7.0; legado[1] = 13.0; legado[2] = 5.0; legado[3] = 0.28;
check(aplicarLuzes(0, new Scene("vazia"), cam, legado) === 0, "sem Light: n = 0 (shading legado)");
check(sombraAtual()[0] === -7.0 && sombraAtual()[6] > 0.0, "sem Light, a sombra segue a luz legada");
check(aplicarLuzes(0, sc, cam, legado) === MAX_LUZES && perto(sombraAtual()[0], buf[4]) && sombraAtual()[6] > 0.0, "sombra da direcional principal");
sol.sombra = false; aplicarLuzes(0, sc, cam, legado);
check(sombraAtual()[6] === 0.0, "principal sem sombra: shadow map desligado");

// 6) cena nova ganha a Luz Direcional
sceneDocument.pending = "new"; sceneDocument.complete();
check(scene.objects.length === 1 && scene.objects[0].name === "Luz Direcional", "cena nova com Luz Direcional");
check(scene.lightObjs.length === 1 && (scene.objects[0].behaviors[0] as Light).sombra, "a luz padrão projeta sombra");
io.print("[PASSOU] light: cache, limite de 8, ordem, formato, serialização, sombra, cena nova");

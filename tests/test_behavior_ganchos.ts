// Teste SEM JANELA dos ganchos de saída: onDestroy chega uma vez a quem sai da
// cena de vez (removeAt, clear, removeBehavior), nunca a quem só é solto
// (detachAll, usado pelo Play para guardar os originais); a carga de cena só
// destrói os objetos anteriores depois de validar a nova; activeInHierarchy.
//   rts.exe run tests/test_behavior_ganchos.ts
import io from "@compat/io.ts";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Behavior } from "@engine/core/behavior";
import { scene } from "@editor/control/session";
import { sceneFromJSON } from "@editor/sceneio";

function check(c: boolean, m: string): void { if (!c) throw new Error(m); }
class Espiao extends Behavior {
  destruido: number;
  recargas: number;
  constructor() { super(); this.destruido = 0; this.recargas = 0; }
  onDestroy(): void { this.destruido = this.destruido + 1; }
  onDomReload(): void { this.recargas = this.recargas + 1; }
}
function objeto(sc: Scene, nome: string, e: Espiao): GameObject {
  const o = new GameObject(nome); o.addBehavior(e); sc.add(o); return o;
}

const base = new Behavior(); base.onDestroy(); base.onDomReload();   // padrão: no-op

const sc = new Scene("ganchos");
const e1 = new Espiao(); objeto(sc, "a", e1);
const e2 = new Espiao(); objeto(sc, "b", e2);
sc.removeAt(0);
check(e1.destruido === 1 && e2.destruido === 0 && sc.objects.length === 1, "removeAt destrói só o removido");
sc.clear();
check(e2.destruido === 1 && sc.objects.length === 0, "clear destrói todos, uma vez");
const e3 = new Espiao(); const o3 = objeto(sc, "c", e3);
sc.detachAll();
check(e3.destruido === 0 && sc.objects.length === 0 && o3.uiOwner === null, "detachAll só solta");
const e4 = new Espiao(); const o4 = objeto(sc, "d", e4);
o4.removeBehavior(0);
check(e4.destruido === 1 && e4.owner === null && o4.behaviors.length === 0, "removeBehavior destrói o componente removido");
e4.onDomReload();
check(e4.recargas === 1, "onDomReload é um gancho comum");

sc.clear();
const pai = new GameObject("pai"); sc.add(pai);
const filho = new GameObject("filho"); filho.parent = 0; sc.add(filho);
check(sc.activeInHierarchy(filho) === 1, "ativo com pai ativo");
pai.active = 0;
check(sc.activeInHierarchy(filho) === 0 && sc.activeInHierarchy(pai) === 0, "pai inativo desliga o filho");
pai.active = 1; filho.active = 0;
check(sc.activeInHierarchy(filho) === 0 && sc.activeInHierarchy(pai) === 1, "o próprio active conta");

scene.clear();
const e5 = new Espiao(); objeto(scene, "antes", e5);
let recusou = false;
try { sceneFromJSON("{\"objects\":[{\"name\":1}]}"); } catch (e) { recusou = true; }
check(recusou && e5.destruido === 0 && scene.objects.length === 1, "cena inválida: a atual fica e não é destruída");
sceneFromJSON("{\"objects\":[]}");
check(e5.destruido === 1 && scene.objects.length === 0, "cena nova destrói a anterior");
io.print("[PASSOU] ganchos: onDestroy/onDomReload, clear x detachAll, removeAt/removeBehavior, activeInHierarchy, carga de cena");

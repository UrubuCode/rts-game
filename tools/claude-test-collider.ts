// O componente Collider: o que ele descreve e o que o objeto passa a saber.
import io from "../compat/io.ts";
import { GameObject } from "../engine/core/gameobject";
import { KIND_COLLIDER } from "../engine/core/behavior";
import { Collider, boxCollider, sphereCollider, hullCollider,
         SHAPE_SPHERE, SHAPE_BOX, SHAPE_HULL } from "../engine/core/collider";

let pass = 0; let fail = 0;
function ok(n: string, c: number): void {
  if (c !== 0) { pass = pass + 1; io.print("  [ok] " + n); }
  else { fail = fail + 1; io.print("  [FALHOU] " + n); }
}

const g = new GameObject("corpo");
ok("sem Collider, colIdx = -1 (caminho legado)", g.colIdx === 0 - 1 ? 1 : 0);

const c = boxCollider(0.5, 1.0, 0.25);
g.addBehavior(c);
ok("com Collider, colIdx aponta para ele", g.colIdx >= 0 ? 1 : 0);
ok("o kind e KIND_COLLIDER", g.behaviors[g.colIdx].kind() === KIND_COLLIDER ? 1 : 0);

// A leitura pela fisica e por despacho virtual, sem cast — o mesmo padrao do
// MeshRenderer. Se isto quebrar, o solver perde a forma sem avisar.
const lido = g.behaviors[g.colIdx];
ok("cShape() responde BOX", lido.cShape() === SHAPE_BOX ? 1 : 0);
ok("cHalfY() responde 1.0", lido.cHalfY() === 1.0 ? 1 : 0);
ok("cCenter comeca em zero", lido.cCenterX() === 0.0 && lido.cCenterY() === 0.0 ? 1 : 0);

// CENTRO deslocado: um personagem com pivo nos pes precisa disso, e a escala
// nunca poderia dar.
c.cy = 1.0;
ok("centro deslocado e lido", lido.cCenterY() === 1.0 ? 1 : 0);

const e = sphereCollider(2.0);
ok("esfera guarda o raio em hx", e.cHalfX() === 2.0 ? 1 : 0);
ok("esfera repete o raio nos outros eixos (nao e achatada)", e.hy === 2.0 && e.hz === 2.0 ? 1 : 0);

const h = hullCollider(7, 1.5, 0.5, 3.0);
ok("hull guarda o id da casca", h.cHullId() === 7 ? 1 : 0);
ok("hull TAMBEM carrega o AABB (a broadphase precisa)", h.cHalfZ() === 3.0 ? 1 : 0);
ok("hull e SHAPE_HULL", h.cShape() === SHAPE_HULL ? 1 : 0);

// O inspector precisa conseguir editar sem saber o que e um colisor.
ok("inspector ve 7 campos", c.fieldCount() === 7 ? 1 : 0);
c.fieldSet(4, 9.0);
ok("inspector escreve o tamanho", c.hx === 9.0 ? 1 : 0);
ok("inspector le de volta", c.fieldGet(4) === 9.0 ? 1 : 0);

// Trigger: detecta e nao empurra.
c.trigger = 1;
ok("trigger e lido pela fisica", lido.cTrigger() === 1 ? 1 : 0);

io.print("");
io.print("[resultado] " + pass + " ok, " + fail + " falhas");
io.print(fail === 0 ? "[PASSOU]" : "[FALHOU]");

// Teste de regressão Q1: round-trip de todos os behaviors registrados via sceneio
import io from "@compat/io.ts";
import { GameObject } from "../src/engine/core/gameobject";
import { recreateBehavior, objectToData, buildObject } from "../src/editor/sceneio";
import { Spinner } from "../src/scripts/spinner";
import { Bobber } from "../src/scripts/bobber";
import { Rigidbody } from "../src/scripts/rigidbody";
import { Mover } from "../src/scripts/mover";
import { Pulse } from "../src/scripts/pulse";
import { Orbit } from "../src/scripts/orbit";
import { Patrol } from "../src/scripts/patrol";
import { SceneRef } from "../src/engine/core/sceneref";
import { Collider, SHAPE_BOX, SHAPE_SPHERE } from "../src/engine/core/collider";
import { BODY_KINEMATIC, BODY_DYNAMIC } from "../src/engine/rigid/materials";

let falhas = 0;

function check(nome: string, ok: boolean, detalhe?: string): void {
  if (ok) {
    io.print("  [OK] " + nome);
  } else {
    io.print("  [FALHA] " + nome + (detalhe ? " - " + detalhe : ""));
    falhas = falhas + 1;
  }
}

io.print("=== Teste de Round-trip de Behaviors (sceneio) ===");

// 1. Instanciar um de cada comportamento com valores não-triviais
const behaviors = [
  new Spinner(1.5, 2.5),
  new Bobber(0.75, 3.2, 1.2),
  (() => {
    const rb = new Rigidbody(-9.8, 0.5);
    rb.mass = 2.0;
    rb.drag = 0.1;
    rb.floorY = -0.5;
    rb.bodyType = BODY_KINEMATIC;
    return rb;
  })(),
  new Mover(3.0, 1.0, -2.0),
  new Pulse(0.3, 2.0, 1.0),
  new Orbit(5.0, 1.2, 2.0, -3.0),
  new Patrol(10.0, 4.0),
  new SceneRef("scenes/test.json"),
  (() => {
    const c = new Collider(SHAPE_SPHERE);
    c.cx = 0.1; c.cy = 0.2; c.cz = 0.3;
    c.hx = 1.0; c.hy = 1.0; c.hz = 1.0;
    c.trigger = 1;
    return c;
  })()
];

let i = 0;
while (i < behaviors.length) {
  const bOrig = behaviors[i];
  const dOrig = bOrig.toData();
  const tipo = dOrig.type || dOrig.t;
  
  // Recriar comportamento
  const bRecriado = recreateBehavior(dOrig);
  const dRecriado = bRecriado.toData();

  const strOrig = JSON.stringify(dOrig);
  const strRecriado = JSON.stringify(dRecriado);
  check("Round-trip behavior: " + tipo, strOrig === strRecriado,
        strOrig !== strRecriado ? "orig: " + strOrig + " vs rec: " + strRecriado : undefined);

  i = i + 1;
}

// 2. Testar round-trip completo de um GameObject com múltiplos behaviors
const go = new GameObject("TestObject");
go.stationary = 0;
go.layer = 2;
go.mask = 0x0F;
go.transform.setPosition(10.0, 20.0, 30.0);
go.transform.rx = 0.1;
go.transform.ry = 0.2;
go.transform.sx = 2.0;
go.transform.sy = 3.0;
go.transform.sz = 4.0;

const rb = new Rigidbody(-9.8, 0.4);
rb.bodyType = BODY_KINEMATIC;
go.addBehavior(rb);
go.addBehavior(new Mover(1, 2, 3));
go.addBehavior(new Bobber(0.5, 1.5, 2.0));

const data = objectToData(go);
const restored = buildObject(data);
const restoredData = objectToData(restored);

check("Round-trip GameObject: id preservado", restored.id === go.id && typeof restored.id === "number");
check("Round-trip GameObject: layer e mask", restored.layer === 2 && restored.mask === 0x0F);
check("Round-trip GameObject: transform",
      restored.transform.px === 10.0 && restored.transform.py === 20.0 && restored.transform.pz === 30.0 &&
      restored.transform.sx === 2.0 && restored.transform.sy === 3.0 && restored.transform.sz === 4.0);
check("Round-trip GameObject: behaviors count", restored.behaviors.length === 3);
check("Round-trip GameObject: data serializado bate", JSON.stringify(data) === JSON.stringify(restoredData));

if (falhas === 0) {
  io.print("[PASSOU] Round-trip sceneio completo (14/14)");
} else {
  io.print("[FALHA] Total de falhas: " + falhas);
}

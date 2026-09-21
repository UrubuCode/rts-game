import io from "@compat/io.ts";
import { COMPONENT_NAMES, createComponent } from "@editor/components";
import { GameObject } from "@engine/core/gameobject";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
let index = 0;
while (index < COMPONENT_NAMES.length) {
  const component = createComponent(COMPONENT_NAMES[index]);
  check(component.typeName() === COMPONENT_NAMES[index], "catalogo e fabrica concordam: " + COMPONENT_NAMES[index]);
  index = index + 1;
}
const object = new GameObject("Teste");
object.transform.px = 12;
const patrol = createComponent("Patrol");
object.addBehavior(patrol);
patrol.mount();
patrol.update(0.1);
check(object.transform.px > 12 && object.transform.px < 13, "mount ancora o componente no objeto selecionado");
const physical = createComponent("PhysicsMaterial");
object.addBehavior(physical);
physical.mount();
check(object.transform.mass > 0, "material inicializado ao adicionar");
io.print("[PASSOU] Component factory: catalogo completo e inicializacao no objeto");

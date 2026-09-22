import { Behavior } from "./core/behavior";
import { componentMetadata } from "./core/component_metadata";

// Disponivel tambem para scripts: objeto.addBehavior(createComponent("MeuScript")).
export function createComponent(name: string): Behavior { return componentMetadata.provider.create(name); }

// Mantem os formatos antigos (spin.sy etc.) e acrescenta os campos automaticos.
// Campos publicos novos nao desaparecem ao salvar um script migrado.
export function componentToData(component: Behavior): any {
  const data = component.toData();
  if (data === null) return null;
  const fields = componentMetadata.provider.legacyFields(component);
  if (fields !== null) data.componentFields = fields;
  return data;
}

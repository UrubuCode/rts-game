// Editor RTS — REGISTRO DE COMPONENTES. A lista de componentes que o dev pode
// adicionar a um GameObject pelo inspector ("Add Component"), + a fábrica que
// cria cada um com valores padrão. Um componente novo entra aqui e já aparece
// na lista. (Componentes = Behaviors; cada um se autodescreve via fieldCount/
// fieldLabel/fieldGet/fieldSet pro inspector desenhar a config.)

import { Behavior } from "../engine/core/behavior";
import { Spinner } from "../scripts/spinner";
import { Bobber } from "../scripts/bobber";
import { Rigidbody } from "../scripts/rigidbody";
import { Mover } from "../scripts/mover";
import { Pulse } from "../scripts/pulse";

/// Nomes dos componentes disponíveis (aparecem na lista "Add Component").
export const COMPONENT_NAMES: string[] = ["Spinner", "Bobber", "Rigidbody", "Mover", "Pulse"];

/// Cria um componente pelo nome, com valores padrão sensatos.
export function createComponent(name: string): Behavior {
  if (name === "Bobber") return new Bobber(0.6, 1.5, 2.0);
  if (name === "Rigidbody") return new Rigidbody(0 - 9.8, 0.5);
  if (name === "Mover") return new Mover(1.0, 0.0, 0.0);
  if (name === "Pulse") return new Pulse(0.3, 2.0, 1.0);
  return new Spinner(1.0, 0.0);   // default = Spinner
}

// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject } from "./gameobject";

export class Scene {
  name: string;
  objects: GameObject[];

  constructor(name: string) {
    this.name = name;
    this.objects = [];
  }

  add(go: GameObject): GameObject {
    this.objects.push(go);
    go.mount();
    return go;
  }

  update(dt: f64): void {
    let i = 0;
    while (i < this.objects.length) {
      const o = this.objects[i];
      if (o.active !== 0) o.update(dt);
      i = i + 1;
    }
  }

  count(): number {
    return this.objects.length;
  }

  /// Esvazia a cena (pra carregar outra por cima).
  clear(): void {
    this.objects = [];
  }
}

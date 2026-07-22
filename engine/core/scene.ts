// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject } from "./gameobject";
import math from "rts:math";

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

  /// Colisão esfera-esfera entre objetos (raio = escala*0.5). Sobreposição:
  /// empurra o par pra fora (metade cada) e amortece a velocidade vertical no
  /// contato — assim corpos com Rigidbody empilham/espalham em vez de atravessar.
  /// Chame depois de update(dt). Passe posicional (simples e estável).
  resolveCollisions(): void {
    const n = this.objects.length;
    let i = 0;
    while (i < n) {
      const a = this.objects[i];
      if (a.meshKind !== 0) {
        const ra: f64 = a.transform.sx * 0.5;
        let j = i + 1;
        while (j < n) {
          const b = this.objects[j];
          if (b.meshKind !== 0) {
            const rb: f64 = b.transform.sx * 0.5;
            const dx: f64 = b.transform.px - a.transform.px;
            const dy: f64 = b.transform.py - a.transform.py;
            const dz: f64 = b.transform.pz - a.transform.pz;
            const d2: f64 = dx * dx + dy * dy + dz * dz;
            const rs: f64 = ra + rb;
            if (d2 < rs * rs && d2 > 0.0001) {
              const d: f64 = math.sqrt(d2);
              const nx: f64 = dx / d;
              const ny: f64 = dy / d;
              const nz: f64 = dz / d;
              const push: f64 = (rs - d) * 0.5;
              a.transform.px = a.transform.px - nx * push;
              a.transform.py = a.transform.py - ny * push;
              a.transform.pz = a.transform.pz - nz * push;
              b.transform.px = b.transform.px + nx * push;
              b.transform.py = b.transform.py + ny * push;
              b.transform.pz = b.transform.pz + nz * push;
              // contato vertical → zera a velocidade que empurra pra dentro
              if (ny > 0.5) {
                if (b.transform.vy < 0) b.transform.vy = 0.0;
                if (a.transform.vy > 0) a.transform.vy = 0.0;
              } else if (ny < 0 - 0.5) {
                if (a.transform.vy < 0) a.transform.vy = 0.0;
                if (b.transform.vy > 0) b.transform.vy = 0.0;
              }
            }
          }
          j = j + 1;
        }
      }
      i = i + 1;
    }
  }
}

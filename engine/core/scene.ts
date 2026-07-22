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

  /// Remove o objeto no índice `i`, corrigindo os índices de parent dos demais
  /// (quem apontava pra i vira raiz; quem apontava depois de i decrementa).
  removeAt(i: number): void {
    const next: GameObject[] = [];
    let k = 0;
    while (k < this.objects.length) {
      if (k !== i) {
        const o = this.objects[k];
        if (o.parent === i) o.parent = 0 - 1;
        else if (o.parent > i) o.parent = o.parent - 1;
        next.push(o);
      }
      k = k + 1;
    }
    this.objects = next;
  }

  /// Computa a posição de MUNDO (wx,wy,wz) de cada objeto a partir do local
  /// (px,py,pz) e do pai: raiz → mundo = local; filho → mundo do pai + offset
  /// local ROTACIONADO pelo yaw (ry) do pai (o filho orbita quando o pai gira).
  /// Assume pai com índice MENOR que o filho (pais adicionados antes). Chame a
  /// cada frame antes do render.
  computeWorld(): void {
    let i = 0;
    while (i < this.objects.length) {
      const o = this.objects[i];
      if (o.parent < 0 || o.parent >= i) {
        o.transform.wx = o.transform.px;
        o.transform.wy = o.transform.py;
        o.transform.wz = o.transform.pz;
        o.transform.wrx = o.transform.rx;
        o.transform.wry = o.transform.ry;
      } else {
        const p = this.objects[o.parent];
        const pyaw: f64 = p.transform.wry;   // yaw de MUNDO do pai (aninhamento correto)
        const c: f64 = math.cos(pyaw);
        const s: f64 = math.sin(pyaw);
        const lx: f64 = o.transform.px;
        const ly: f64 = o.transform.py;
        const lz: f64 = o.transform.pz;
        o.transform.wx = p.transform.wx + (lx * c + lz * s);
        o.transform.wy = p.transform.wy + ly;
        o.transform.wz = p.transform.wz + (0 - lx * s + lz * c);
        // herda a rotação do pai (euler aditivo — o filho gira junto E orbita)
        o.transform.wrx = p.transform.wrx + o.transform.rx;
        o.transform.wry = p.transform.wry + o.transform.ry;
      }
      i = i + 1;
    }
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
            if (d2 < rs * rs && d2 > 0.0001 && (a.stationary === 0 || b.stationary === 0)) {
              const d: f64 = math.sqrt(d2);
              const nx: f64 = dx / d;
              const ny: f64 = dy / d;
              const nz: f64 = dz / d;
              const overlap: f64 = rs - d;
              // reparte o empurrão: estático não se move (o outro absorve tudo).
              let pushA: f64 = overlap * 0.5;
              let pushB: f64 = overlap * 0.5;
              if (a.stationary !== 0) { pushA = 0.0; pushB = overlap; }
              else if (b.stationary !== 0) { pushA = overlap; pushB = 0.0; }
              a.transform.px = a.transform.px - nx * pushA;
              a.transform.py = a.transform.py - ny * pushA;
              a.transform.pz = a.transform.pz - nz * pushA;
              b.transform.px = b.transform.px + nx * pushB;
              b.transform.py = b.transform.py + ny * pushB;
              b.transform.pz = b.transform.pz + nz * pushB;
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

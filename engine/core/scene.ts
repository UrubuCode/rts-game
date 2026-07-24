// Engine RTS — Scene: a lista de GameObjects + o laço de update polimórfico.
// O render pass roda separado (main.ts) lendo os objetos desta cena.

import { GameObject } from "./gameobject";
import { KIND_CAMERA } from "./behavior";
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

  /// Move a subárvore do objeto `dragIdx` (ele + descendentes) para antes do
  /// índice `beforeIdx`, com novo pai `newParentIdx` (-1 = raiz). Reordena o array
  /// e remapeia todos os índices de parent por REFERÊNCIA (estável). É o backend do
  /// drag-drop com slots de inserção do editor. No-op se criar ciclo.
  moveSubtree(dragIdx: number, beforeIdx: number, newParentIdx: number): void {
    const n = this.objects.length;
    if (dragIdx < 0 || dragIdx >= n) return;
    // flags: quem está na subárvore do arrastado (ele + descendentes)
    const inSub: number[] = [];
    let i = 0;
    while (i < n) {
      let a = i; let sub = 0; let g = 0;
      while (a >= 0 && g < 128) {
        if (a === dragIdx) { sub = 1; a = 0 - 1; } else { a = this.objects[a].parent; }
        g = g + 1;
      }
      inSub.push(sub);
      i = i + 1;
    }
    // ciclo: novo pai não pode estar na subárvore
    if (newParentIdx >= 0 && newParentIdx < n && inSub[newParentIdx] === 1) return;
    // ref do pai de cada objeto (sentinela = ele mesmo quando raiz)
    const pref: GameObject[] = [];
    const hasP: number[] = [];
    i = 0;
    while (i < n) {
      const o = this.objects[i];
      if (o.parent >= 0 && o.parent < n) { pref.push(this.objects[o.parent]); hasP.push(1); }
      else { pref.push(o); hasP.push(0); }
      i = i + 1;
    }
    const dragged = this.objects[dragIdx];
    let npRef = dragged; let npHas = 0;
    if (newParentIdx >= 0 && newParentIdx < n) { npRef = this.objects[newParentIdx]; npHas = 1; }
    // posição de inserção entre os NÃO-movendo
    let insertPos = 0;
    i = 0;
    while (i < beforeIdx && i < n) { if (inSub[i] === 0) insertPos = insertPos + 1; i = i + 1; }
    // monta nova ordem
    const order: GameObject[] = [];
    const opref: GameObject[] = [];
    const ohasP: number[] = [];
    let restCount = 0;
    let inserted = 0;
    let k = 0;
    while (k < n) {
      if (inserted === 0 && restCount === insertPos) {
        let b = 0;
        while (b < n) {
          if (inSub[b] === 1) {
            order.push(this.objects[b]);
            if (this.objects[b] === dragged) { opref.push(npRef); ohasP.push(npHas); }
            else { opref.push(pref[b]); ohasP.push(hasP[b]); }
          }
          b = b + 1;
        }
        inserted = 1;
      }
      if (inSub[k] === 0) {
        order.push(this.objects[k]); opref.push(pref[k]); ohasP.push(hasP[k]);
        restCount = restCount + 1;
      }
      k = k + 1;
    }
    if (inserted === 0) {
      let b = 0;
      while (b < n) {
        if (inSub[b] === 1) {
          order.push(this.objects[b]);
          if (this.objects[b] === dragged) { opref.push(npRef); ohasP.push(npHas); }
          else { opref.push(pref[b]); ohasP.push(hasP[b]); }
        }
        b = b + 1;
      }
    }
    // aplica + remapeia parent por referência
    this.objects = order;
    let j = 0;
    while (j < order.length) {
      const o = order[j];
      if (ohasP[j] === 0) { o.parent = 0 - 1; }
      else {
        let pj = 0; let found = 0 - 1;
        while (pj < order.length) {
          if (order[pj] === opref[j]) { found = pj; pj = order.length; } else pj = pj + 1;
        }
        o.parent = found;
      }
      j = j + 1;
    }
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

  /// Índice do objeto ATIVO que carrega a câmera principal (-1 = nenhuma).
  /// O runtime do jogo renderiza por ela; se houver várias, vence a primeira
  /// marcada como `isMain`, senão a primeira câmera encontrada.
  mainCameraIdx(): number {
    let fallback = 0 - 1;
    let i = 0;
    while (i < this.objects.length) {
      const o = this.objects[i];
      if (o.active !== 0) {
        const ci = o.componentIdx(KIND_CAMERA);
        if (ci >= 0) {
          const c = o.behaviors[ci];
          if (c.enabled !== 0) {
            if (c.camIsMain() !== 0) return i;
            if (fallback < 0) fallback = i;
          }
        }
      }
      i = i + 1;
    }
    return fallback;
  }

  /// Computa a posição de MUNDO (wx,wy,wz) de cada objeto a partir do local
  /// (px,py,pz) e do pai: raiz → mundo = local; filho → mundo do pai + offset
  /// local ROTACIONADO pelo yaw (ry) do pai (o filho orbita quando o pai gira).
  /// Assume pai com índice MENOR que o filho (pais adicionados antes). Chame a
  /// cada frame antes do render.
  computeWorld(): void {
    const n = this.objects.length;
    // flags de "já computado" — resolve em qualquer ORDEM de parent (reparent na
    // árvore pode fazer o pai ter índice MAIOR que o filho).
    const done: number[] = [];
    let k = 0;
    while (k < n) { done.push(0); k = k + 1; }
    let pass = 0;
    while (pass <= n) {
      let left = 0;
      let i = 0;
      while (i < n) {
        if (done[i] === 0) {
          const o = this.objects[i];
          if (o.parent < 0 || o.parent >= n) {
            o.transform.wx = o.transform.px;
            o.transform.wy = o.transform.py;
            o.transform.wz = o.transform.pz;
            o.transform.wrx = o.transform.rx;
            o.transform.wry = o.transform.ry;
            done[i] = 1;
          } else if (done[o.parent] === 1) {
            const p = this.objects[o.parent];
            const pyaw: f64 = p.transform.wry;
            const c: f64 = math.cos(pyaw);
            const s: f64 = math.sin(pyaw);
            const lx: f64 = o.transform.px;
            const ly: f64 = o.transform.py;
            const lz: f64 = o.transform.pz;
            o.transform.wx = p.transform.wx + (lx * c + lz * s);
            o.transform.wy = p.transform.wy + ly;
            o.transform.wz = p.transform.wz + (0 - lx * s + lz * c);
            o.transform.wrx = p.transform.wrx + o.transform.rx;
            o.transform.wry = p.transform.wry + o.transform.ry;
            done[i] = 1;
          } else {
            left = 1;   // pai ainda não resolvido — próxima passada
          }
        }
        i = i + 1;
      }
      if (left === 0) pass = n + 1;
      else pass = pass + 1;
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

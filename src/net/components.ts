// Componentes de rede no modelo do motor: NetworkObject é um Behavior preso ao
// GameObject; o estado replicado vem dos NetComponente registrados nele, em
// ordem fixa (a mesma no servidor e no cliente).
import { Behavior } from "@engine/core/behavior";
import { GameObject } from "@engine/core/gameobject";
import { Transform } from "@engine/core/transform";
import { NetWriter, NetReader } from "./buffer";

export class NetComponente {
  netEscrever(w: NetWriter): void {}
  netLer(r: NetReader): void {}
}

export class NetworkObject extends Behavior {
  netId: number;
  tipo: number;
  dono: number;
  go: GameObject | null;
  componentes: NetComponente[];

  constructor(tipo: number, dono: number) {
    super();
    this.netId = 0;
    this.tipo = tipo;
    this.dono = dono;
    this.go = null;
    this.componentes = [];
  }

  typeName(): string { return "NetworkObject"; }

  adicionar(c: NetComponente): NetworkObject {
    this.componentes.push(c);
    return this;
  }

  escreverEstado(w: NetWriter): void {
    w.u8(this.go !== null ? this.go.active : 0);
    let i = 0;
    while (i < this.componentes.length) { this.componentes[i].netEscrever(w); i = i + 1; }
  }

  lerEstado(r: NetReader): void {
    const ativo = r.u8();
    if (this.go !== null && !r.erro) this.go.active = ativo;
    let i = 0;
    while (i < this.componentes.length) { this.componentes[i].netLer(r); i = i + 1; }
  }
}

/// Posição (f32 × 3) e yaw quantizado (u16): 14 bytes.
export class NetworkTransform extends NetComponente {
  t: Transform;

  constructor(t: Transform) {
    super();
    this.t = t;
  }

  netEscrever(w: NetWriter): void {
    w.f32(this.t.px);
    w.f32(this.t.py);
    w.f32(this.t.pz);
    w.angulo(this.t.ry);
  }

  netLer(r: NetReader): void {
    const x = r.f32();
    const y = r.f32();
    const z = r.f32();
    const yaw = r.angulo();
    if (r.erro) return;
    this.t.setPosition(x, y, z);
    this.t.ry = yaw;
  }
}

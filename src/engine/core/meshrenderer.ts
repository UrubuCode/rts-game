// Engine RTS — MeshRenderer: o component que diz O QUE desenhar (a geometria),
// estilo MeshFilter+MeshRenderer do Unity. É um Behavior de DADOS (sem update):
// o render pass, pra cada objeto, pergunta ao MeshRenderer (kind RENDERER) qual
// mesh usar, e ao Material (kind MATERIAL) a aparência. Com fallback: objetos sem
// MeshRenderer ainda desenham pelos campos legado do GameObject (meshKind/customMesh).
//
// Este é o SEAM da visão "tudo é GameObject": geometria vira component, então um
// dia um painel de UI pode ser um GameObject com um UIRenderer no mesmo lugar.

import { Behavior, KIND_RENDERER } from "./behavior";

export class MeshRenderer extends Behavior {
  meshKind: number;   // 1=cubo 2=pirâmide 3=octaedro 4=esfera (0 = usar customMesh)
  customMesh: number; // id de mesh .obj (>0) — tem prioridade sobre meshKind

  constructor(meshKind: number) {
    super();
    this.meshKind = meshKind;
    this.customMesh = 0;
  }

  kind(): number { return KIND_RENDERER; }
  typeName(): string { return "MeshRenderer"; }

  // geometria lida pelo render (dispatch virtual, sem cast):
  rMeshKind(): number { return this.meshKind; }
  rCustomMesh(): number { return this.customMesh; }

  // config numérica no inspector: o primitivo (1..4).
  fieldCount(): number { return 1; }
  fieldLabel(i: number): string { if (i === 0) return "Mesh"; return ""; }
  fieldGet(i: number): f64 { if (i === 0) return this.meshKind; return 0.0; }
  fieldSet(i: number, v: f64): void {
    if (i === 0) {
      let k = v | 0;
      if (k < 0) k = 0;
      if (k > 4) k = 4;
      this.meshKind = k;
    }
  }

  toData(): any {
    return { type: "meshRenderer", meshKind: this.meshKind, customMesh: this.customMesh };
  }
}

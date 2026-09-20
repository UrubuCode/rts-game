// Editor RTS — UNDO/REDO por SNAPSHOT da cena. Antes de cada operação mutante o
// dispatch chama history.snapshot() (serializa a cena atual num string JSON e
// empilha). undo restaura o topo da pilha de undo (e joga o estado atual na de
// redo); redo faz o inverso. Coarse (snapshot de cena inteira) mas simples e
// robusto — reusa a serialização do sceneio (sceneToJSON/sceneFromJSON).
//
// Encapsulado num SINGLETON (métodos despacham sem pegadinha de gcell). O arrasto
// do gizmo NÃO faz snapshot por frame — só as operações discretas (via dispatch).

import { sceneToJSON, sceneFromJSON } from "./sceneio";

const CAP: number = 40;   // teto de estados guardados

export class History {
  u: string[];   // pilha de undo (estados anteriores)
  r: string[];   // pilha de redo

  constructor() {
    this.u = [];
    this.r = [];
  }

  /// Guarda o estado ATUAL antes de uma operação mutante; limpa a pilha de redo.
  snapshot(): void {
    this.u.push(sceneToJSON());
    this.r = [];
    while (this.u.length > CAP) this.u.shift();
  }

  /// Desfaz: restaura o último estado guardado (empurra o atual pro redo). 1=ok, 0=vazio.
  undo(): number {
    if (this.u.length === 0) return 0;
    this.r.push(sceneToJSON());
    const s = this.u.pop();
    sceneFromJSON(s);
    return 1;
  }

  /// Refaz: restaura o último estado desfeito (empurra o atual pro undo). 1=ok, 0=vazio.
  redo(): number {
    if (this.r.length === 0) return 0;
    this.u.push(sceneToJSON());
    const s = this.r.pop();
    sceneFromJSON(s);
    return 1;
  }

  undoDepth(): number { return this.u.length; }
  redoDepth(): number { return this.r.length; }
}

export const history = new History();

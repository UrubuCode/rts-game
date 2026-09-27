// Editor RTS — UNDO/REDO por SNAPSHOT da cena. Antes de cada operação mutante o
// dispatch chama history.snapshot() (serializa a cena atual num string JSON e
// empilha). undo restaura o topo da pilha de undo (e joga o estado atual na de
// redo); redo faz o inverso. Coarse (snapshot de cena inteira) mas simples e
// robusto — reusa a serialização do sceneio (sceneToJSON/sceneFromJSON).
//
// Encapsulado num SINGLETON (métodos despacham sem pegadinha de gcell). O arrasto
// do gizmo NÃO faz snapshot por frame — só as operações discretas (via dispatch).

import { sceneToJSON, sceneFromJSON } from "./sceneio";
import { scene, S } from "./control/session";
import { skeletonOfObject } from "./skeleton_preview";

// Modelo do Skeleton dono do osso escolhido ("" = nenhum), lido antes de
// restaurar a cena.
function selectedBoneModel(): string {
  let path = "";
  const owner = S.selectedBoneOwner;
  if (S.selectedBone >= 0 && owner !== null) {
    const sk = skeletonOfObject(owner);
    if (sk !== null) path = sk.modelPath;
  }
  return path;
}

// Desfazer/Refazer recriam os objetos: o osso escolhido continua valendo se o
// objeto selecionado restaurado tem um Skeleton do MESMO modelo com esse osso
// (o dono passa a ser o objeto novo); senão a escolha é zerada.
function rebindSelectedBone(previousPath: string): void {
  let kept = false;
  if (S.selectedBone >= 0 && previousPath !== "" && S.selected >= 0 && S.selected < scene.objects.length) {
    const o = scene.objects[S.selected];
    const sk = skeletonOfObject(o);
    if (sk !== null && sk.modelPath === previousPath) {
      sk.ensureAsset(S.win);
      if (sk.asset !== null && S.selectedBone < sk.boneCount()) { S.selectedBoneOwner = o; kept = true; }
    }
  }
  if (!kept) { S.selectedBone = 0 - 1; S.selectedBoneOwner = null; }
}

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
    const bonePath = selectedBoneModel();
    sceneFromJSON(s);
    rebindSelectedBone(bonePath);
    return 1;
  }

  /// Refaz: restaura o último estado desfeito (empurra o atual pro undo). 1=ok, 0=vazio.
  redo(): number {
    if (this.r.length === 0) return 0;
    this.u.push(sceneToJSON());
    const s = this.r.pop();
    const bonePath = selectedBoneModel();
    sceneFromJSON(s);
    rebindSelectedBone(bonePath);
    return 1;
  }

  undoDepth(): number { return this.u.length; }
  redoDepth(): number { return this.r.length; }
}

export const history = new History();

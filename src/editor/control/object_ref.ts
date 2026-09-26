// REFERÊNCIA A OBJETO pela porta de controle: caminho na hierarquia (Pai/Filho)
// e filhos diretos. Só funções puras sobre a cena recebida (sem importar a
// sessão), para servir ao despacho, aos comandos e aos pacotes.
//
// Só roda quando um comando chega (nunca por quadro).
import type { Scene } from "@engine/core/scene";

/// Separador do caminho na hierarquia (o mesmo do menu: `Pai/Filho`).
export const SEPARADOR_CAMINHO: string = "/";

/// Caminho do objeto `i` a partir da raiz ("Pai/Filho"). O limite de passos
/// protege de uma hierarquia cíclica (que a cena não deveria ter).
export function caminhoObjeto(sc: Scene, i: number): string {
  if (i < 0 || i >= sc.objects.length) return "";
  let s = sc.objects[i].name;
  let p = sc.objects[i].parent;
  let passos = 0;
  while (p >= 0 && p < sc.objects.length && passos < sc.objects.length) {
    s = sc.objects[p].name + SEPARADOR_CAMINHO + s;
    p = sc.objects[p].parent;
    passos = passos + 1;
  }
  return s;
}

/// Índices dos filhos diretos do objeto `i`.
export function filhosObjeto(sc: Scene, i: number): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < sc.objects.length) { if (sc.objects[k].parent === i) out.push(k); k = k + 1; }
  return out;
}

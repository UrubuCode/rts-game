// Comandos de HIERARQUIA (via WebSocket) — inspecionar e REPARENTEAR objetos,
// o mesmo que arrastar na árvore do editor faz (scene.moveSubtree). Posicionar já
// é o `move`; isto muda o PAI (aninha/desaninha) e reordena.
import { scene } from "../session";

/// tree — lista a hierarquia (índice, nome, índice do pai; -1 = raiz).
export function cmdTree(): string {
  let m = "[tree] " + scene.objects.length + " objs";
  let i = 0;
  while (i < scene.objects.length) {
    const o = scene.objects[i];
    m = m + " | #" + i + " " + o.name + " parent=" + o.parent;
    i = i + 1;
  }
  return m;
}

/// parent <filho> <pai> — torna <filho> filho de <pai> (pai=-1 => raiz).
/// NOTA: reordena o array; re-consulte `tree` depois pois os índices mudam.
export function cmdParent(parts: string[]): string {
  const child = parseFloat(parts[1]) | 0;
  const par = parseFloat(parts[2]) | 0;
  const n = scene.objects.length;
  if (child < 0 || child >= n) return "[erro] filho invalido";
  if (par < 0) {
    scene.moveSubtree(child, n, 0 - 1);       // vira RAIZ (no fim)
    return "[ok] parent #" + child + " -> raiz";
  }
  if (par >= n) return "[erro] pai invalido";
  scene.moveSubtree(child, par + 1, par);     // vira 1o filho de <par>
  return "[ok] parent #" + child + " -> #" + par;
}

/// movetree <drag> <before> <newparent> — expõe o moveSubtree cru (reordenar+reparent).
export function cmdMoveTree(parts: string[]): string {
  scene.moveSubtree(parseFloat(parts[1]) | 0, parseFloat(parts[2]) | 0, parseFloat(parts[3]) | 0);
  return "[ok] movetree";
}

// Comandos de HIERARQUIA (via WebSocket) — inspecionar e REPARENTEAR objetos,
// o mesmo que arrastar na árvore do editor faz (scene.moveSubtree). Posicionar já
// é o `move`; isto muda o PAI (aninha/desaninha) e reordena.
import { scene } from "../session";
import { argInt, argObj, erroObj } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";
import { buscarObjetos, caminhoObjeto } from "@editor/control/object_ref";

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
  if (parts.length < 3) return erroUso("parent");
  const child = argObj(parts, 1);
  if (child < 0) return erroObj(parts, 1);
  const par = argInt(parts, 2);
  const n = scene.objects.length;
  if (par === 0 - 1) {
    scene.moveSubtree(child, n, 0 - 1);       // vira RAIZ (no fim)
    return "[ok] parent #" + child + " -> raiz";
  }
  if (!(par >= 0 && par < n)) return "[erro] pai invalido: '" + parts[2] + "' (indice, nome, caminho ou -1 = raiz)";
  if (par === child) return "[erro] um objeto nao pode ser pai de si mesmo";
  scene.moveSubtree(child, par + 1, par);     // vira 1o filho de <par>
  return "[ok] parent #" + child + " -> #" + par;
}

/// movetree <drag> <before> <newparent> — expõe o moveSubtree cru (reordenar+reparent).
export function cmdMoveTree(parts: string[]): string {
  if (parts.length < 4) return erroUso("movetree");
  const n = scene.objects.length;
  const drag = argObj(parts, 1);
  if (drag < 0) return erroObj(parts, 1);
  const before = argInt(parts, 2);
  if (!(before >= 0 && before <= n)) return "[erro] posicao 'antes' invalida: '" + parts[2] + "' (0.." + n + ")";
  const par = argInt(parts, 3);
  if (!(par >= 0 - 1 && par < n)) return "[erro] pai invalido: '" + parts[3] + "' (-1 = raiz)";
  scene.moveSubtree(drag, before, par);
  return "[ok] movetree";
}

/// find <nome|trecho> — objetos cujo nome contém o trecho (sem diferenciar
/// maiúsculas), com índice e caminho. O trecho é o resto da linha.
export function cmdFind(parts: string[]): string {
  if (parts.length < 2 || parts[1].length === 0) return erroUso("find");
  const termo = parts.slice(1).join(" ");
  const achados = buscarObjetos(scene, termo);
  let m = "[find] " + achados.length + " com '" + termo + "'";
  let k = 0;
  while (k < achados.length) {
    const i = achados[k];
    m = m + " | #" + i + " " + scene.objects[i].name + " (" + caminhoObjeto(scene, i) + ")";
    k = k + 1;
  }
  return m;
}

import type { GameObject } from "@engine/core/gameobject";
import { activeScene } from "@engine/core/active_scene";
/// O GameObject de nome `nome` na cena ativa; reaproveita `cache` enquanto ele
/// ainda estiver numa cena (uiOwner não nulo) e com o mesmo nome.
export function acharAlvo(nome: string, cache: GameObject | null): GameObject | null {
  let achado: GameObject | null = null;
  if (cache !== null && cache.name === nome && cache.uiOwner !== null) achado = cache;
  const sc = activeScene();
  if (achado === null && sc !== null && nome.length > 0) {
    let i = 0;
    while (i < sc.objects.length && achado === null) { if (sc.objects[i].name === nome) achado = sc.objects[i]; i = i + 1; }
  }
  return achado;
}

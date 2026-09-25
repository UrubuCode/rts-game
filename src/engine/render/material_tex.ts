// Resolve a textura de um Material na primeira vez que ele é desenhado numa
// janela: imagem PNG pelo `texturePath` ou textura procedural pelo nome. O id
// de GPU não serializa (é da janela), então uma cena carregada chega com o
// caminho/nome e sem id; isto o obtém uma vez e guarda no Material.
//
// Falha (arquivo ausente, formato não suportado) marca o id como -1: o render
// cai no modo sem imagem e isto não tenta de novo a cada frame. O motivo sai
// uma vez no log.
import { Behavior } from "@engine/core/behavior";
import { loadTexture } from "@engine/render/gpu3d";
import { procTexture, PROC_NOMES } from "@engine/render/proc_textures";
import { logWarn } from "@engine/core/logger";

/// Id de textura (>= 2) do Material, resolvendo na primeira chamada; 0 se o
/// material não pede textura, -1 se pediu e falhou.
export function resolveMaterialTexture(win: number, m: Behavior): number {
  const tid = m.matTexId() | 0;
  if (tid !== 0) return tid;
  const proc = m.matProc();
  const path = m.matTexPath();
  if (proc.length === 0 && path.length === 0) return 0;
  let id = 0 - 1;
  if (proc.length > 0) {
    if (PROC_NOMES.indexOf(proc) >= 0) id = procTexture(win, proc);
    else logWarn("Textura procedural desconhecida: '" + proc + "' (use " + PROC_NOMES.join(", ") + ").");
  } else {
    try { id = loadTexture(win, path); }
    catch (error) { logWarn("Textura '" + path + "' nao carregou: " + String(error)); id = 0 - 1; }
  }
  if (id <= 0) id = 0 - 1;
  m.setMatTexture(id, path);
  return id;
}

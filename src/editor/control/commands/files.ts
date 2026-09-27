// Comandos de SISTEMA DE ARQUIVOS (via WebSocket) — a IA lista/cria/deleta/lê/
// escreve/renomeia arquivos e pastas do projeto direto pelo socket (fs namespace).
// Conteúdo em uma linha só (o protocolo quebra por \n).
import fs from "@compat/fs.ts";

import { scene, S } from "../session";
import { GameObject } from "@engine/core/gameobject";
import { objectToData, instantiatePrefab } from "@editor/sceneio";
import { loadTexture } from "@engine/render/gpu3d";
import { isModelPath } from "@engine/render/model";
import { instantiateAt } from "@editor/dnd";
import { argNum, argInt, argObj, erroObj, argsNumericos } from "@editor/control/args";
import { erroUso } from "@editor/control/builtin_commands";
import { importFileToAssets, defaultImportDir } from "@editor/import_assets";
import { assetsCurrentDir } from "@editor/assets";

/// makeprefab <path> [i] — salva o objeto (default=selecionado) como PREFAB (JSON de
/// 1 objeto), pra instanciar depois via o asset browser (duplo-clique) ou prefab.
export function cmdMakePrefab(parts: string[]): string {
  if (parts.length < 2) return erroUso("makeprefab");
  let i = S.selected;
  if (parts.length > 2) { i = argObj(parts, 2); if (i < 0) return erroObj(parts, 2); }
  if (i < 0 || i >= scene.objects.length) return "[erro] nenhum objeto selecionado";
  const d = objectToData(scene.objects[i]);
  d.parent = 0 - 1;   // prefab é raiz (sem parent do contexto atual)
  fs.write(parts[1], JSON.stringify(d));
  return "[ok] makeprefab " + parts[1] + " <- #" + i + " (" + scene.objects[i].name + ")";
}

/// instprefab <path> — instancia um PREFAB (JSON de 1 objeto) na cena e o seleciona.
export function cmdInstPrefab(parts: string[]): string {
  if (parts.length < 2) return erroUso("instprefab");
  if (!fs.exists(parts[1])) return "[erro] nao existe: " + parts[1];
  const before = scene.objects.length;
  instantiatePrefab(parts[1]);
  if (scene.objects.length === before) return "[erro] falha ao instanciar: " + parts[1];
  S.selected = scene.objects.length - 1;
  return "[ok] instprefab " + parts[1] + " -> #" + S.selected;
}

/// importar <caminho> [pasta] — copia um arquivo de FORA de `assets/` pra
/// dentro (como a Unity), com sufixo em colisão de nome; se já está dentro de
/// `assets/`, só usa o caminho. Sem `pasta`: áudio (.wav/.ogg) vai para
/// `assets/audio`, os demais para a pasta aberta no Project. É a MESMA função
/// usada pela soltura de arquivos do Explorer (item 5 do brief de áudio).
export function cmdImportar(parts: string[]): string {
  if (parts.length < 2) return erroUso("importar");
  const origem = parts[1];
  const destDir = parts.length > 2 ? parts[2] : defaultImportDir(origem, assetsCurrentDir());
  try {
    const destino = importFileToAssets(origem, destDir);
    return "[ok] importado " + origem + " -> " + destino;
  } catch (e) {
    return "[erro] importar: " + (e instanceof Error ? e.message : String(e));
  }
}

/// setcustom <objIdx> <meshId> — DEBUG: força o customMesh de um objeto (0=primitivo).
export function cmdSetCustom(parts: string[]): string {
  const oi = argObj(parts, 1);
  if (oi < 0) return parts.length < 2 ? erroUso("setcustom") : erroObj(parts, 1);
  const mid = argInt(parts, 2);
  if (!(mid >= 0)) return erroUso("setcustom") + " (meshId inteiro >= 0)";
  scene.objects[oi].customMesh = mid;
  scene.objects[oi].refreshCollide();
  return "[ok] setcustom #" + oi + " customMesh=" + mid;
}

/// loadobj <path> [nome] [x] [y] [z] — carrega um MODELO real (.obj/.glb/.gltf) e
/// cria o(s) objeto(s) com ele. Multi-material vira uma raiz + uma filha por
/// submesh (mesma regra do drag & drop — a lógica é compartilhada em editor/dnd).
export function cmdLoadObj(parts: string[]): string {
  if (parts.length < 2) return erroUso("loadobj");
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  if (!isModelPath(path)) return "[erro] nao e um modelo (.obj/.glb/.gltf): " + path;
  let x: f64 = 0.0; let y: f64 = 1.0; let z: f64 = 0.0;
  if (parts.length > 3) {
    if (!argsNumericos(parts, 3, 3)) return erroUso("loadobj") + " (x, y e z numericos)";
    x = argNum(parts, 3); y = argNum(parts, 4); z = argNum(parts, 5);
  }
  const before = scene.objects.length;
  // instantiateAt assenta sobre o chão quando `placed`; aqui a posição é
  // explícita (coordenada de mundo), então passamos y já como o centro.
  const pos = new Float64Array(3); pos[0] = x; pos[1] = y - 0.5; pos[2] = z;
  const idx = instantiateAt("model", path, pos);
  if (idx < 0) return "[erro] falha ao carregar/parsear: " + path;
  if (parts.length > 2) scene.objects[idx].name = parts[2];
  const n = scene.objects.length - before;
  return "[ok] loadobj " + path + " -> obj#" + idx + " (" + n + " no(s), mesh#" +
    scene.objects[idx].customMesh + ")";
}

/// loadtex <objIdx> <path> — carrega uma imagem REAL (PNG/JPG/BMP/WebP) do disco,
/// sobe pra VRAM e aplica como textura (triplanar) no objeto <objIdx>.
export function cmdLoadTex(parts: string[]): string {
  if (parts.length < 3) return erroUso("loadtex");
  const oi = argObj(parts, 1);
  if (oi < 0) return erroObj(parts, 1);
  const path = parts[2];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  const tex = loadTexture(S.win, path) | 0;
  if (tex === 0) return "[erro] falha ao decodificar/subir: " + path;
  // aplica no component Material do objeto (cria um se não houver).
  scene.objects[oi].applyTexture(tex, path);
  return "[ok] loadtex " + path + " -> tex#" + tex + " no Material de #" + oi;
}

/// ls [path] — lista uma pasta (sufixo / nas pastas).
export function cmdLs(parts: string[]): string {
  let path = ".";
  if (parts.length > 1) path = parts[1];
  if (!fs.exists(path)) return "[ls] nao existe: " + path;
  const list = fs.readdir(path);
  if (list === undefined) return "[ls] erro: " + path;
  let m = "[ls] " + path + " (" + list.length + ")";
  let i = 0;
  while (i < list.length) {
    let nm = list[i];
    if (fs.is_dir(path + "/" + nm)) nm = nm + "/";
    m = m + " | " + nm;
    i = i + 1;
  }
  return m;
}

/// mkdir <path> — cria a pasta (e pais que faltarem).
export function cmdMkdir(parts: string[]): string {
  if (parts.length < 2 || parts[1].length === 0) return erroUso("mkdir");
  const r = fs.create_dir_all(parts[1]);
  return "[ok] mkdir " + parts[1] + " (r=" + r + ")";
}

/// rmpath <path> — deleta arquivo ou pasta (recursivo).
export function cmdRmpath(parts: string[]): string {
  if (parts.length < 2 || parts[1].length === 0) return erroUso("rmpath");
  const p = parts[1];
  if (!fs.exists(p)) return "[erro] nao existe: " + p;
  if (fs.is_dir(p)) fs.remove_dir_all(p);
  else fs.remove_file(p);
  return "[ok] rm " + p;
}

/// readfile <path> — devolve o conteúdo do arquivo.
export function cmdReadFile(parts: string[]): string {
  if (parts.length < 2 || parts[1].length === 0) return erroUso("readfile");
  const p = parts[1];
  if (!fs.exists(p)) return "[erro] nao existe: " + p;
  return "[file] " + p + ":\n" + fs.read_text(p);
}

/// writefile <path> <conteudo...> — escreve (conteúdo = resto da linha).
export function cmdWriteFile(parts: string[]): string {
  if (parts.length < 2 || parts[1].length === 0) return erroUso("writefile");
  const p = parts[1];
  let content = "";
  let i = 2;
  while (i < parts.length) {
    if (i > 2) content = content + " ";
    content = content + parts[i];
    i = i + 1;
  }
  fs.write(p, content);
  return "[ok] write " + p + " (" + content.length + " bytes)";
}

/// mv <de> <para> — renomeia/move.
export function cmdMv(parts: string[]): string {
  if (parts.length < 3) return erroUso("mv");
  const r = fs.rename(parts[1], parts[2]);
  return "[ok] mv " + parts[1] + " -> " + parts[2] + " (r=" + r + ")";
}

// Comandos de SISTEMA DE ARQUIVOS (via WebSocket) — a IA lista/cria/deleta/lê/
// escreve/renomeia arquivos e pastas do projeto direto pelo socket (fs namespace).
// Conteúdo em uma linha só (o protocolo quebra por \n).
import fs from "rts:fs";

import { scene, S } from "../session";
import { GameObject } from "../../../engine/core/gameobject";
import { objectToData, instantiatePrefab } from "../../sceneio";
import { loadObj, loadTexture } from "../../../engine/render/gpu3d";

/// makeprefab <path> [i] — salva o objeto (default=selecionado) como PREFAB (JSON de
/// 1 objeto), pra instanciar depois via o asset browser (duplo-clique) ou prefab.
export function cmdMakePrefab(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: makeprefab <path> [i]";
  let i = S.selected;
  if (parts.length > 2) i = parseFloat(parts[2]) | 0;
  if (i < 0 || i >= scene.objects.length) return "[erro] objeto invalido: " + i;
  const d = objectToData(scene.objects[i]);
  d.parent = 0 - 1;   // prefab é raiz (sem parent do contexto atual)
  fs.write(parts[1], JSON.stringify(d));
  return "[ok] makeprefab " + parts[1] + " <- #" + i + " (" + scene.objects[i].name + ")";
}

/// instprefab <path> — instancia um PREFAB (JSON de 1 objeto) na cena e o seleciona.
export function cmdInstPrefab(parts: string[]): string {
  if (parts.length < 2) return "[erro] uso: instprefab <path>";
  if (!fs.exists(parts[1])) return "[erro] nao existe: " + parts[1];
  const before = scene.objects.length;
  instantiatePrefab(parts[1]);
  if (scene.objects.length === before) return "[erro] falha ao instanciar: " + parts[1];
  S.selected = scene.objects.length - 1;
  return "[ok] instprefab " + parts[1] + " -> #" + S.selected;
}

/// setcustom <objIdx> <meshId> — DEBUG: força o customMesh de um objeto (0=primitivo).
export function cmdSetCustom(parts: string[]): string {
  const oi = parseFloat(parts[1]) | 0;
  const mid = parseFloat(parts[2]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido";
  scene.objects[oi].customMesh = mid;
  return "[ok] setcustom #" + oi + " customMesh=" + mid;
}

/// loadobj <path> [nome] [x] [y] [z] — carrega um .obj REAL e cria um objeto com ele.
export function cmdLoadObj(parts: string[]): string {
  const path = parts[1];
  if (!fs.exists(path)) return "[erro] nao existe: " + path;
  const mesh = loadObj(S.win, path);
  if (mesh === 0) return "[erro] falha ao carregar/parsear: " + path;
  let name = "OBJ";
  if (parts.length > 2) name = parts[2];
  const go = new GameObject(name);
  go.setMesh(1, 200, 200, 210);   // meshKind qualquer; customMesh manda no render
  go.customMesh = mesh;
  go.stationary = 1;
  let x: f64 = 0.0; let y: f64 = 1.0; let z: f64 = 0.0;
  if (parts.length > 5) { x = parseFloat(parts[3]); y = parseFloat(parts[4]); z = parseFloat(parts[5]); }
  go.transform.setPosition(x, y, z);
  const idx = scene.objects.length;
  scene.add(go);
  S.selected = idx;
  return "[ok] loadobj " + path + " -> mesh#" + mesh + " obj#" + idx;
}

/// loadtex <objIdx> <path> — carrega uma imagem REAL (PNG/JPG/BMP/WebP) do disco,
/// sobe pra VRAM e aplica como textura (triplanar) no objeto <objIdx>.
export function cmdLoadTex(parts: string[]): string {
  if (parts.length < 3) return "[erro] uso: loadtex <objIdx> <path>";
  const oi = parseFloat(parts[1]) | 0;
  if (oi < 0 || oi >= scene.objects.length) return "[erro] objeto invalido: " + oi;
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
  const r = fs.create_dir_all(parts[1]);
  return "[ok] mkdir " + parts[1] + " (r=" + r + ")";
}

/// rmpath <path> — deleta arquivo ou pasta (recursivo).
export function cmdRmpath(parts: string[]): string {
  const p = parts[1];
  if (!fs.exists(p)) return "[erro] nao existe: " + p;
  if (fs.is_dir(p)) fs.remove_dir_all(p);
  else fs.remove_file(p);
  return "[ok] rm " + p;
}

/// readfile <path> — devolve o conteúdo do arquivo.
export function cmdReadFile(parts: string[]): string {
  const p = parts[1];
  if (!fs.exists(p)) return "[erro] nao existe: " + p;
  return "[file] " + p + ":\n" + fs.read_text(p);
}

/// writefile <path> <conteudo...> — escreve (conteúdo = resto da linha).
export function cmdWriteFile(parts: string[]): string {
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
  const r = fs.rename(parts[1], parts[2]);
  return "[ok] mv " + parts[1] + " -> " + parts[2] + " (r=" + r + ")";
}

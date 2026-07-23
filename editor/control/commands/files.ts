// Comandos de SISTEMA DE ARQUIVOS (via WebSocket) — a IA lista/cria/deleta/lê/
// escreve/renomeia arquivos e pastas do projeto direto pelo socket (fs namespace).
// Conteúdo em uma linha só (o protocolo quebra por \n).
import fs from "rts:fs";

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

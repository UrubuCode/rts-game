// IMPORTAR arquivos para dentro de `assets/`, como a Unity: a soltura do
// Explorer (item 5 do brief de áudio-arquivos) e o comando WS `importar`
// (item 6) chamam a MESMA função, pra nunca duas implementações divergirem.
//
// Regra: um arquivo já dentro de `assets/` não é copiado (usa o caminho como
// está); um arquivo de fora é copiado para `destDir`, com sufixo " 1", " 2"…
// em caso de colisão de nome (a Unity faz o mesmo). `destDir` é criado se
// faltar. Nada aqui roda por quadro — é sempre um clique/comando, então
// try/catch aqui não viola a regra de custo por quadro do CLAUDE.md.
import fs from "@compat/fs.ts";

export const ASSETS_ROOT: string = "assets";
export const ASSETS_AUDIO_DIR: string = "assets/audio";

const AUDIO_EXTS: string[] = [".wav", ".ogg"];

function lower(s: string): string {
  return s.toLowerCase();
}

export function extOf(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charCodeAt(i) !== 46 /* . */ && path.charCodeAt(i) !== 47 /* / */) i = i - 1;
  if (i < 0 || path.charCodeAt(i) !== 46) return "";
  return lower(path.substring(i));
}

export function isAudioPath(path: string): boolean {
  const e = extOf(path);
  return AUDIO_EXTS.indexOf(e) >= 0;
}

function baseName(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charCodeAt(i) !== 47 && path.charCodeAt(i) !== 92) i = i - 1;
  return path.substring(i + 1);
}

/// True se `path` já está dentro da raiz de assets (mesmo prefixo de pasta).
export function isInsideAssets(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  return norm === ASSETS_ROOT || norm.indexOf(ASSETS_ROOT + "/") === 0;
}

/// Nome único dentro de `dir`: "nome.ext", "nome 1.ext", "nome 2.ext"...
function uniqueName(dir: string, name: string): string {
  if (!fs.exists(dir + "/" + name)) return name;
  const ext = extOf(name);
  const stem = ext.length > 0 ? name.substring(0, name.length - ext.length) : name;
  let n = 1;
  let candidate = stem + " " + n + ext;
  while (fs.exists(dir + "/" + candidate)) { n = n + 1; candidate = stem + " " + n + ext; }
  return candidate;
}

/// Importa `srcPath` para dentro de `destDir` (relativo à raiz do projeto).
/// Devolve o caminho relativo final (o mesmo `srcPath`, se já estava dentro de
/// `assets/`). Lança Error com uma mensagem clara em caso de falha — o
/// chamador (WS ou o drop) decide como reportar.
export function importFileToAssets(srcPath: string, destDir: string): string {
  const norm = srcPath.replace(/\\/g, "/");
  if (!fs.exists(norm)) throw new Error("arquivo não encontrado: " + srcPath);
  if (isInsideAssets(norm)) return norm;
  const dir = destDir.replace(/\\/g, "/");
  fs.create_dir_all(dir);
  const name = uniqueName(dir, baseName(norm));
  const dest = dir + "/" + name;
  let data: any;
  try {
    data = fs.read_all(norm);
  } catch (e) {
    throw new Error("falha ao ler '" + srcPath + "': " + String(e));
  }
  try {
    fs.write(dest, data);
  } catch (e) {
    throw new Error("falha ao copiar para '" + dest + "' (verifique a escrita): " + String(e));
  }
  return dest;
}

/// A pasta padrão para um arquivo, quando o alvo do drop/comando não é o
/// Project panel (que usaria a pasta aberta): áudio vai para `assets/audio`,
/// os demais para a pasta aberta do Project (passada como `fallbackDir`).
export function defaultImportDir(srcPath: string, fallbackDir: string): string {
  return isAudioPath(srcPath) ? ASSETS_AUDIO_DIR : fallbackDir;
}

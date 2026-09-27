// Índice de arquivos de `assets/` por extensão, para o ObjectField (item 2 do
// brief de áudio-arquivos): uma varredura RECURSIVA cacheada, refeita só quando
// a versão muda (Project rescan/`importar`), nunca por quadro — quem abre o
// seletor chama `scanAssets` de novo só se `assetIndexVersion()` mudou desde a
// última vez (ver ObjectFieldPicker.rescanIfNeeded).
import fs from "@compat/fs.ts";

let version = 0;
/// Chamar depois de qualquer mudança no conteúdo de `assets/` visível ao
/// editor: Project.rescan() e importFileToAssets() (soltura do Explorer e `importar`).
export function bumpAssetIndex(): void {
  version = version + 1;
}
export function assetIndexVersion(): number {
  return version;
}

function lower(s: string): string {
  return s.toLowerCase();
}
function hasExt(name: string, exts: string[]): boolean {
  const n = lower(name);
  let i = 0;
  while (i < exts.length) {
    const e = exts[i];
    if (n.length >= e.length && n.substring(n.length - e.length) === e) return true;
    i = i + 1;
  }
  return false;
}

/// Varre `root` recursivamente por arquivos cuja extensão (minúscula, com
/// ponto: ".wav") está em `exts`. Só roda quando o índice é refeito — nunca por
/// quadro. Devolve os caminhos relativos ordenados.
export function scanAssets(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let list: string[] = [];
    try { list = fs.readdir(dir); } catch { list = []; }
    let i = 0;
    while (i < list.length) {
      const nm = list[i];
      const full = dir + "/" + nm;
      if (fs.is_dir(full)) stack.push(full);
      else if (hasExt(nm, exts)) out.push(full);
      i = i + 1;
    }
  }
  out.sort();
  return out;
}

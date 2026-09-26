import fs from 'node:fs';
import path from 'node:path';

/// Localiza o rts.exe: RTS_COMPILER, rts.exe na raiz, RTS_MOTOR, ../rts e, para
/// worktrees dentro de build/, um checkout `rts` irmão de qualquer ancestral.
export function findCompiler(projectRoot) {
  const candidates = [process.env.RTS_COMPILER, path.join(projectRoot, 'rts.exe'),
    process.env.RTS_MOTOR && path.join(process.env.RTS_MOTOR, 'target/release/rts.exe'),
    path.resolve(projectRoot, '../rts/target/release/rts.exe')].filter(Boolean);
  let ancestor = projectRoot;
  while (path.dirname(ancestor) !== ancestor) {
    candidates.push(path.join(ancestor, 'rts', 'target', 'release', 'rts.exe'));
    ancestor = path.dirname(ancestor);
  }
  const compiler = candidates.find(candidate => fs.existsSync(candidate));
  if (!compiler) throw new Error('Defina RTS_COMPILER com o caminho do rts.exe, ou coloque o CLI na raiz do projeto.');
  return compiler;
}

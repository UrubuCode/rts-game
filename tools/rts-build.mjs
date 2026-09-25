import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateComponents, projectRoot } from './generate-components.mjs';

try {
  const [entry = 'main.ts', destination = 'build/RTSEditor.exe'] = process.argv.slice(2);
  const entryPath = path.resolve(projectRoot, entry);
  if (!fs.existsSync(entryPath)) throw new Error(`Entrada inexistente: ${entry}`);
  const candidates = [process.env.RTS_COMPILER, path.join(projectRoot, 'rts.exe'),
    process.env.RTS_MOTOR && path.join(process.env.RTS_MOTOR, 'target/release/rts.exe'),
    path.resolve(projectRoot, '../rts/target/release/rts.exe')].filter(Boolean);
  // Git worktrees can live under build/. Walk ancestors to find the sibling
  // motor checkout too; explicit environment/local overrides keep priority.
  let ancestor = projectRoot;
  while (path.dirname(ancestor) !== ancestor) {
    candidates.push(path.join(ancestor, 'rts', 'target', 'release', 'rts.exe'));
    ancestor = path.dirname(ancestor);
  }
  const compiler = candidates.find(candidate => fs.existsSync(candidate));
  if (!compiler) throw new Error('Defina RTS_COMPILER com o caminho do rts.exe, ou coloque o CLI na raiz do projeto.');
  console.log(`[components] ${generateComponents().length} classes descobertas`);
  fs.mkdirSync(path.dirname(path.resolve(projectRoot, destination)), { recursive: true });
  const result = spawnSync(compiler, ['compile', '--no-compiler', entry, destination], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }

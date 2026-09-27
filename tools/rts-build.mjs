import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateComponents, projectRoot } from './generate-components.mjs';
import { findCompiler } from './rts-compiler.mjs';

try {
  const [entry = 'main.ts', destination = 'build/RTSEditor.exe'] = process.argv.slice(2);
  const entryPath = path.resolve(projectRoot, entry);
  if (!fs.existsSync(entryPath)) throw new Error(`Entrada inexistente: ${entry}`);
  const compiler = findCompiler(projectRoot);
  console.log(`[components] ${generateComponents().length} classes descobertas`);
  fs.mkdirSync(path.dirname(path.resolve(projectRoot, destination)), { recursive: true });
  const result = spawnSync(compiler, ['compile', '--no-compiler', entry, destination], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }

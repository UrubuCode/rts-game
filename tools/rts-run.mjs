// Roda um .ts com o rts.exe encontrado por findCompiler (mesma busca do build).
//   node tools/rts-run.mjs tools/game-build/check-registro.ts
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './generate-components.mjs';
import { findCompiler } from './rts-compiler.mjs';

try {
  const entry = process.argv[2];
  if (!entry) throw new Error('uso: node tools/rts-run.mjs <arquivo.ts>');
  const result = spawnSync(findCompiler(projectRoot), ['run', entry], { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }

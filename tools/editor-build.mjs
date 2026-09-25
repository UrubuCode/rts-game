import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = path.resolve(root, process.argv[2] ?? '');
const builds = path.join(root, 'build') + path.sep;
if (!run.startsWith(builds) || !fs.existsSync(path.join(run, 'scene.json'))) throw new Error('Invalid build request directory');
const status = (state, message) => {
  fs.writeFileSync(path.join(run, 'status.tmp'), JSON.stringify({ state, message }));
  fs.renameSync(path.join(run, 'status.tmp'), path.join(run, 'status.json'));
};
try {
  status('running', 'Compilando jogo...');
  const destination = path.join(run, 'RTSGame.exe');
  const result = spawnSync(process.execPath, ['tools/rts-build.mjs', 'game.ts', destination], { cwd: root, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(run, 'output.log'), (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? ''));
  if (result.status !== 0) throw new Error('Compilacao falhou. Consulte o Console.');
  fs.cpSync(path.join(root, 'assets'), path.join(run, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'scenes'))) fs.cpSync(path.join(root, 'scenes'), path.join(run, 'scenes'), { recursive: true });
  fs.copyFileSync(path.join(run, 'scene.json'), path.join(run, 'assets', 'scene.json'));
  status('ok', `Build concluido: ${destination}`);
} catch (error) { status('error', String(error)); process.exitCode = 1; }

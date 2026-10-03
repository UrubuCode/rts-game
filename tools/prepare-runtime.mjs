import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readRuntimeLock, fileSha256 } from './runtime-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, cwd, capture = false) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${command} falhou (${r.status}): ${capture ? r.stderr : 'consulte a saida acima'}`);
  return r.stdout?.trim() ?? '';
}
try {
  if (process.platform !== 'win32') throw new Error('Este contrato de distribuicao atualmente suporta Windows x64.');
  const { lock, patch, key } = readRuntimeLock(root);
  const profile = process.argv.includes('--debug') ? 'debug' : 'release';
  const base = path.join(root, 'build', 'runtime', key);
  const targetOption=process.argv.indexOf('--target-dir');
  if(targetOption>=0&&!process.argv[targetOption+1])throw new Error('--target-dir exige um caminho.');
  const source = path.join(base, 'source'), target = targetOption>=0?path.resolve(process.argv[targetOption+1]):path.join(base, 'target'), bin = path.join(target, profile);
  fs.mkdirSync(base, { recursive: true });
  const normalizedPatch = path.join(base, 'runtime.patch');
  fs.writeFileSync(normalizedPatch, patch);
  if (!fs.existsSync(path.join(source, '.git'))) {
    if (fs.existsSync(source)) throw new Error(`Diretorio de origem inesperado: ${source}`);
    run('git', ['clone', '--no-checkout', '--filter=blob:none', lock.repository, source], root);
    run('git', ['checkout', '--detach', lock.commit], source);
    run('git', ['apply', '--check', normalizedPatch], source);
    run('git', ['apply', normalizedPatch], source);
    // O índice é o snapshot esperado; alterações posteriores não são aceitas.
    run('git', ['add', '--all'], source);
    fs.writeFileSync(path.join(base, 'source-tree.txt'), run('git', ['write-tree'], source, true));
  }
  if (run('git', ['rev-parse', 'HEAD'], source, true) !== lock.commit) throw new Error('Checkout do runtime em revisao inesperada');
  if (run('git', ['write-tree'], source, true) !== fs.readFileSync(path.join(base, 'source-tree.txt'), 'utf8').trim()) throw new Error('Indice do runtime foi modificado');
  run('git', ['diff', '--exit-code'], source);
  if (run('git', ['ls-files', '--others', '--exclude-standard'], source, true)) throw new Error('Arquivos extras no checkout do runtime');
  if (process.argv.includes('--prepare-only')) { console.log(`[runtime] checkout validado: ${source}`); process.exit(0); }
  const rust = run('rustc', ['--version'], source, true);
  if (!rust.startsWith(`rustc ${lock.rust} `)) throw new Error(`Use Rust ${lock.rust}; encontrado ${rust}`);
  const common = ['--locked', '--target-dir', target];
  if (profile === 'release') common.push('--release');
  run('cargo', ['build', '-p', 'rts-runtime', ...common], source);
  run('cargo', ['build', '-p', 'rts', '--features', 'ui', ...common], source);
  const files = {};
  for (const name of ['rts.exe', 'rts_runtime.lib']) files[name] = fileSha256(path.join(bin, name));
  const manifest = { key, commit: lock.commit, patchSha256: lock.patchSha256, rust, profile, files };
  fs.writeFileSync(path.join(bin, 'runtime-build.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'build', 'runtime-selection.json'), JSON.stringify({ directory: bin }, null, 2));
  console.log(`[runtime] ${bin}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }

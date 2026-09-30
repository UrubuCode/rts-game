// Gera o executável distribuível e o zip do rts-fps, sem variável de ambiente:
//
//   node tools/build-exe.mjs
//
// 1. Acha o runtime: pasta com rts.exe + rts_runtime.lib. Primeiro a de
//    `config/build.json` ("runtime", relativa à raiz do rts-fps); se não houver,
//    procura ../rts-uv-mundo/target/release e ../rts/target/release.
// 2. Compila: rts compile --no-compiler src/client.ts build/rts-fps.exe
//    (gera também build/rts-fps.rtsdata).
// 3. Monta build/rts-fps-dist/ com o exe, o .rtsdata, dist/LEIA-ME.txt e os
//    assets de ARQUIVOS (abaixo) e compacta em build/rts-fps-windows.zip.
//    Sem config/: o .exe distribuído não abre a porta de controle.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CANDIDATOS = ['../rts-uv-mundo/target/release', '../rts/target/release'];
// Conteúdo do zip (além do exe e do .rtsdata): pastas copiadas inteiras e arquivos avulsos.
const ARQUIVOS = [
  ['dist/LEIA-ME.txt', 'LEIA-ME.txt'],
  ['assets/animators/fps-personagem.controller.json', 'assets/animators/fps-personagem.controller.json'],
  ['assets/kenney/LICENCA-Kenney-CC0.txt', 'assets/kenney/LICENCA-Kenney-CC0.txt'],
  ['assets/kenney/armas', 'assets/kenney/armas'],
  ['assets/kenney/personagens', 'assets/kenney/personagens'],
  ['assets/audio', 'assets/audio'],
  ['assets/environment', 'assets/environment'],
  ['config/audio.json', 'config/audio.json'],
];

function falhar(msg) { console.error('[build] ' + msg); process.exit(1); }

function acharRuntime() {
  const lista = [];
  const cfg = path.join(raiz, 'config', 'build.json');
  if (fs.existsSync(cfg)) {
    let j;
    try { j = JSON.parse(fs.readFileSync(cfg, 'utf8')); } catch (e) { falhar(cfg + ' invalido: ' + e.message); }
    if (typeof j.runtime === 'string') lista.push(j.runtime);
  }
  lista.push(...CANDIDATOS);
  for (const rel of lista) {
    const d = path.resolve(raiz, rel);
    if (fs.existsSync(path.join(d, 'rts.exe')) && fs.existsSync(path.join(d, 'rts_runtime.lib'))) return d;
    console.log('[build] sem rts.exe + rts_runtime.lib em ' + d);
  }
  falhar('runtime nao encontrado; ajuste "runtime" em config/build.json');
}

const rt = acharRuntime();
const rts = path.join(rt, 'rts.exe');
console.log('[build] runtime: ' + rt);
fs.mkdirSync(path.join(raiz, 'build'), { recursive: true });
const c = spawnSync(rts, ['compile', '--no-compiler', 'src/client.ts', 'build/rts-fps.exe'], { cwd: raiz, stdio: 'inherit' });
if (c.status !== 0) falhar('rts compile falhou (codigo ' + c.status + ')');
for (const f of ['build/rts-fps.exe', 'build/rts-fps.rtsdata']) {
  if (!fs.existsSync(path.join(raiz, f))) falhar('faltou ' + f + ' depois do compile');
}

const dist = path.join(raiz, 'build', 'rts-fps-dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(raiz, 'build/rts-fps.exe'), path.join(dist, 'rts-fps.exe'));
fs.copyFileSync(path.join(raiz, 'build/rts-fps.rtsdata'), path.join(dist, 'rts-fps.rtsdata'));
for (const [de, para] of ARQUIVOS) {
  const origem = path.join(raiz, de);
  if (!fs.existsSync(origem)) falhar('faltou ' + de);
  fs.cpSync(origem, path.join(dist, para), { recursive: true });
}

const zip = path.join(raiz, 'build', 'rts-fps-windows.zip');
fs.rmSync(zip, { force: true });
// tar do Windows (bsdtar, em System32) grava zip com '/' nos caminhos. Caminho
// explícito: no Git Bash o `tar` do PATH é o GNU, que não faz zip.
const tarWin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
if (!fs.existsSync(tarWin)) falhar('nao achei ' + tarWin + ' (Windows 10 1803+ traz o tar)');
const entradas = fs.readdirSync(dist);
const z = spawnSync(tarWin, ['-a', '-c', '-f', zip, ...entradas], { cwd: dist, stdio: 'inherit' });
if (z.status !== 0) falhar('tar -a (zip) falhou (codigo ' + z.status + ')');
console.log('[build] ' + zip + ' (' + (fs.statSync(zip).size / 1048576).toFixed(1) + ' MB) a partir de ' + dist);

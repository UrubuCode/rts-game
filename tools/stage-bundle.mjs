import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompiler } from './rts-compiler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  const compiler=findCompiler(root),bundle=path.resolve(root,process.argv[2]??'bundle');
  const required=['rts-game.exe','rts-game.rtsdata','RTSGame.exe','RTSGame.rtsdata'];
  for(const file of required)if(!fs.statSync(path.join(root,'release',file)).isFile())throw new Error(`Artefato ausente: ${file}`);
  if(!fs.existsSync(path.join(root,'scenes','shadowdemo.json')))throw new Error('Cena inicial ausente');
  // Nunca mistura uma publicação anterior com a atual.
  if(fs.existsSync(bundle)&&fs.readdirSync(bundle).length)throw new Error('bundle deve estar vazio; escolha/remova explicitamente a publicacao anterior antes de empacotar.');
  fs.mkdirSync(bundle,{recursive:true});
  for(const file of required)fs.copyFileSync(path.join(root,'release',file),path.join(bundle,file));
  for(const directory of ['assets','scenes','src','tools','tests','patches'])fs.cpSync(path.join(root,directory),path.join(bundle,directory),{recursive:true});
  for(const file of ['main.ts','game.ts','tsconfig.json','package.json','package-lock.json'])fs.copyFileSync(path.join(root,file),path.join(bundle,file));
  // O gerador de componentes usa TypeScript durante o build do projeto.
  fs.cpSync(path.join(root,'node_modules','typescript'),path.join(bundle,'node_modules','typescript'),{recursive:true});
  fs.mkdirSync(path.join(bundle,'runtime'),{recursive:true});
  for(const file of ['rts.exe','rts_runtime.lib','runtime-build.json'])fs.copyFileSync(path.join(path.dirname(compiler),file),path.join(bundle,'runtime',file));
  fs.copyFileSync(path.join(root,'runtime.lock.json'),path.join(bundle,'runtime.lock.json'));
  fs.copyFileSync(path.join(path.dirname(compiler),'runtime-build.json'),path.join(bundle,'runtime-build.json'));
  fs.copyFileSync(path.join(root,'docs','editor-distribution.md'),path.join(bundle,'LEIA-ME.md'));
  fs.writeFileSync(path.join(bundle,'Abrir-Editor.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nrts-game.exe\r\n');
  console.log('Bundle da IDE inclui compilador RTS, staticlib, fontes e ferramentas de build.');
}catch(error){console.error(error.message);process.exitCode=1;}

import fs from 'node:fs';
import path from 'node:path';
import { verifyRuntime } from './runtime-contract.mjs';

// Builds oficiais exigem o par CLI/staticlib identificado pelo lock do projeto.
export function findCompiler(projectRoot) {
  let directory;
  if(process.env.RTS_COMPILER)directory=path.dirname(path.resolve(process.env.RTS_COMPILER));
  else if(fs.existsSync(path.join(projectRoot,'runtime','runtime-build.json')))directory=path.join(projectRoot,'runtime');
  else {
    const selection=path.join(projectRoot,'build','runtime-selection.json');
    if(!fs.existsSync(selection))throw new Error('Runtime fixado ausente. Execute npm run runtime:prepare.');
    directory=JSON.parse(fs.readFileSync(selection,'utf8')).directory;
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw new Error('Selecao de runtime invalida.');
  }
  const compiler=verifyRuntime(projectRoot,directory);
  if(process.env.RTS_COMPILER&&path.resolve(process.env.RTS_COMPILER).toLowerCase()!==compiler.toLowerCase())throw new Error('RTS_COMPILER precisa apontar para o rts.exe validado.');
  return compiler;
}

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompiler } from './rts-compiler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  const compiler=findCompiler(root);
  const result=spawnSync(compiler,['run','tests/runtime-capabilities.ts'],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;if(result.status!==0)throw new Error('Runtime nao passou no teste de capacidades.');
}catch(error){console.error(error.message);process.exitCode=1;}

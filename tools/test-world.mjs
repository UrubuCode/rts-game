import { checkedProcess } from './checked-process.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompiler } from './rts-compiler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  const compiler=findCompiler(root);
  for(const [file,marker] of [['tests/test_ws_world.ts','PASS WS world:'],['tests/test_ws_heightmap.ts','PASS WS heightmap:'],['tests/test_ws_river_mask.ts','PASS WS river mask:'],['tests/test_terrain_drag.ts','PASS terrain drag:'],['tests/terrain.ts','PASS terrain:']]){
    const result=checkedProcess(compiler,['run',file],{cwd:root,marker,timeoutMs:180000});
    if(!result.ok)throw new Error(file+': '+result.reason+'\n'+result.stdout+'\n'+result.stderr+'\n'+result.error);
    console.log(result.stdout.split(/\r?\n/).find(line=>line.startsWith(marker)));
  }
}catch(error){console.error(error.message);process.exitCode=1;}

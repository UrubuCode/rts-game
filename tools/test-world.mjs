import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompiler } from './rts-compiler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  const compiler=findCompiler(root);
  for(const [file,marker] of [['tests/test_ws_world.ts','PASS WS world:'],['tests/test_ws_heightmap.ts','PASS WS heightmap:'],['tests/test_ws_river_mask.ts','PASS WS river mask:'],['tests/test_terrain_drag.ts','PASS terrain drag:'],['tests/terrain.ts','PASS terrain:']]){
    const result=spawnSync(compiler,['run',file],{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
    const output=(result.stdout??'')+(result.stderr??'');
    // Algumas rejeicoes do runtime ainda encerram com codigo zero.
    if(result.error||result.status!==0||!output.split(/\r?\n/).some(line=>line.startsWith(marker))||output.includes('unhandled promise rejection'))throw new Error(`${file}: ${result.error?.message??''}\n${output}`);
    console.log(output.split(/\r?\n/).find(line=>line.startsWith(marker)));
  }
}catch(error){console.error(error.message);process.exitCode=1;}

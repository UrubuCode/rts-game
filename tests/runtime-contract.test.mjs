import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRuntimeLock, verifyRuntime, sha256 } from '../tools/runtime-contract.mjs';
import { findCompiler } from '../tools/rts-compiler.mjs';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rts-runtime-contract-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const lock={schema:1,repository:'https://github.com/UrubuCode/rts.git',commit:'a'.repeat(40),rust:'1.98.0',patch:'runtime.patch',patchSha256:sha256('patch\n')};
  fs.writeFileSync(path.join(root,'runtime.patch'),'patch\r\n');fs.writeFileSync(path.join(root,'runtime.lock.json'),JSON.stringify(lock));
  return root;
}
test('patch aceita CRLF, mas rejeita mudanca real',t=>{
  const root=fixture(t);assert.ok(readRuntimeLock(root).key);
  fs.writeFileSync(path.join(root,'runtime.patch'),'outro\n');assert.throws(()=>readRuntimeLock(root),/Patch nativo mudou/);
});
test('par CLI/archive precisa corresponder ao lock e aos hashes',t=>{
  const root=fixture(t),{key}=readRuntimeLock(root),files={};
  for(const name of ['rts.exe','rts_runtime.lib']){fs.writeFileSync(path.join(root,name),name);files[name]=sha256(name);}
  fs.writeFileSync(path.join(root,'runtime-build.json'),JSON.stringify({key,files}));
  assert.equal(verifyRuntime(root,root),path.join(root,'rts.exe'));
  fs.writeFileSync(path.join(root,'rts_runtime.lib'),'archive antigo');assert.throws(()=>verifyRuntime(root,root),/divergente/);
});
test('manifesto de outra revisao nao passa',t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'runtime-build.json'),JSON.stringify({key:'outro'}));
  assert.throws(()=>verifyRuntime(root,root),/outro lock/);
});

test('IDE descobre o compilador distribuido depois de mover o pacote',t=>{
  const root=fixture(t),directory=path.join(root,'runtime'),files={};
  const previous=process.env.RTS_COMPILER;
  delete process.env.RTS_COMPILER;
  t.after(()=>{if(previous===undefined)delete process.env.RTS_COMPILER;else process.env.RTS_COMPILER=previous;});
  fs.mkdirSync(directory);
  for(const name of ['rts.exe','rts_runtime.lib']){fs.writeFileSync(path.join(directory,name),name);files[name]=sha256(name);}
  fs.writeFileSync(path.join(directory,'runtime-build.json'),JSON.stringify({key:readRuntimeLock(root).key,files}));
  const relocated=path.join(root,'relocated');
  fs.mkdirSync(relocated);
  for(const name of ['runtime','runtime.patch','runtime.lock.json'])fs.cpSync(path.join(root,name),path.join(relocated,name),{recursive:true});
  assert.equal(findCompiler(relocated),path.join(relocated,'runtime','rts.exe'));
  fs.writeFileSync(path.join(relocated,'runtime','rts.exe'),'compiler antigo');
  assert.throws(()=>findCompiler(relocated),/divergente/);
});

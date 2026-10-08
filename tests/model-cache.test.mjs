import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { prepareModelCache } from '../tools/prepare-model-cache.mjs';
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rts-model-cache-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'assets'));
  const bytes=Buffer.alloc(42);[0,0,0,2,0,0,0,3,0].forEach((v,i)=>bytes.writeFloatLE(v,i*4));
  [0,1,2].forEach((v,i)=>bytes.writeUInt16LE(v,36+i*2));fs.writeFileSync(path.join(root,'assets/a.bin'),bytes);
  const g={asset:{version:'2.0'},buffers:[{uri:'a.bin',byteLength:42}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}],meshes:[{name:'triangle',primitives:[{attributes:{POSITION:0},indices:1}]}]};
  fs.writeFileSync(path.join(root,'assets/a.gltf'),JSON.stringify(g));
  const key=crypto.createHash('sha256').update('assets/a.gltf').digest('hex').slice(0,24);
  return {root,g,key,metadata:()=>JSON.parse(fs.readFileSync(path.join(root,'assets/runtime-cache/models',key+'.json'))),binary:()=>fs.readFileSync(path.join(root,'assets/runtime-cache/models',key+'.bin'))};
}
test('cache preserva geometria, indices, layout e raio sem simplificacao',t=>{
  const f=fixture(t);assert.equal(prepareModelCache(f.root,'assets/a.gltf'),true);
  const m=f.metadata(), b=f.binary();assert.equal(m.parts[0].vertices,3);assert.equal(m.parts[0].indices,3);assert.equal(m.parts[0].radius,3);
  assert.equal(b.readFloatLE(32),2);assert.equal(b.readFloatLE(68),3);assert.equal(b.readFloatLE(16),1);
  assert.deepEqual([b.readUInt32LE(96),b.readUInt32LE(100),b.readUInt32LE(104)],[0,1,2]);
});
test('alterar buffer invalida cache; arquivo derivado corrompido e reconstruido',t=>{
  const f=fixture(t);prepareModelCache(f.root,'assets/a.gltf');const old=f.metadata().sha256;
  const file=path.join(f.root,'assets/a.bin'),b=fs.readFileSync(file);b.writeFloatLE(4,12);fs.writeFileSync(file,b);
  prepareModelCache(f.root,'assets/a.gltf');assert.notEqual(f.metadata().sha256,old);assert.equal(f.metadata().parts[0].radius,4);
  fs.writeFileSync(path.join(f.root,'assets/runtime-cache/models',f.key+'.bin'),Buffer.from('broken'));
  prepareModelCache(f.root,'assets/a.gltf');assert.equal(f.binary().length,108);
  fs.writeFileSync(path.join(f.root,'assets/runtime-cache/models',f.key+'.json'),'broken');
  prepareModelCache(f.root,'assets/a.gltf');assert.equal(f.metadata().version,1);
});
test('indice fora da malha nao publica cache',t=>{
  const f=fixture(t),file=path.join(f.root,'assets/a.bin'),b=fs.readFileSync(file);b.writeUInt16LE(99,36);fs.writeFileSync(file,b);
  assert.throws(()=>prepareModelCache(f.root,'assets/a.gltf'),/Indice invalido/);
  assert.equal(fs.existsSync(path.join(f.root,'assets/runtime-cache/models',f.key+'.json')),false);
});

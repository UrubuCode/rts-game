import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
export function fileSha256(file) {
  const fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024),hash=crypto.createHash('sha256');
  try {let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}
  finally{fs.closeSync(fd);}
}
export function readRuntimeLock(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'runtime.lock.json'), 'utf8'));
  if (lock.schema !== 1 || !/^[0-9a-f]{40}$/.test(lock.commit) || !/^[0-9a-f]{64}$/.test(lock.patchSha256)) throw new Error('runtime.lock.json invalido');
  if (lock.repository !== 'https://github.com/UrubuCode/rts.git' || !/^\d+\.\d+\.\d+$/.test(lock.rust)) throw new Error('Origem/toolchain do runtime invalidos');
  const patch = fs.readFileSync(path.join(root, lock.patch), 'utf8').replace(/\r\n/g, '\n');
  if (sha256(patch) !== lock.patchSha256) throw new Error('Patch nativo mudou: atualize runtime.lock.json e reconstrua o runtime.');
  return { lock, patch, key: sha256(JSON.stringify(lock)) };
}

export function verifyRuntime(root, directory) {
  const { key } = readRuntimeLock(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'runtime-build.json'), 'utf8'));
  if (manifest.key !== key) throw new Error('Runtime construido para outro lock/patch. Execute npm run runtime:prepare.');
  for (const name of ['rts.exe', 'rts_runtime.lib']) {
    if (!manifest.files?.[name] || fileSha256(path.join(directory, name)) !== manifest.files[name]) throw new Error(`Artefato do runtime divergente: ${name}`);
  }
  return path.join(directory, 'rts.exe');
}

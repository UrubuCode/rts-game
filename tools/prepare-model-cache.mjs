// Cache de geometria derivado: originais e quantidade de triangulos preservados.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export function prepareModelCache(root, source) {
  source = source.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!source.toLowerCase().endsWith('.gltf')) return false;
  const input = fs.readFileSync(path.join(root, source));
  const g = JSON.parse(input);
  if (g.buffers?.length !== 1 || !g.buffers[0].uri || g.buffers[0].uri.startsWith('data:')) return false;
  if (g.images?.some(i => !i.uri || i.uri.startsWith('data:'))) return false;
  const binPath = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURIComponent(g.buffers[0].uri)));
  const bin = fs.readFileSync(path.join(root, binPath));
  const dependencies = [{ path: source, sha256: sha(input) }, { path: binPath, sha256: sha(bin) }];
  const folder = path.join(root, 'assets/runtime-cache/models');
  const key = sha(source).slice(0, 24), manifest = path.join(folder, key + '.json');
  if (fs.existsSync(manifest)) {
    let old = {};
    try { old = JSON.parse(fs.readFileSync(manifest)); } catch {}
    if (old.version === 1 && JSON.stringify(old.dependencies) === JSON.stringify(dependencies) &&
        fs.existsSync(path.join(folder, key + '.bin')) && sha(fs.readFileSync(path.join(folder, key + '.bin'))) === old.sha256) return true;
  }
  function accessor(index, expected) {
    const a = g.accessors?.[index], v = g.bufferViews?.[a?.bufferView];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a?.type];
    const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a?.componentType];
    if (!a || !v || a.sparse || a.normalized || !size || components !== expected || (v.buffer ?? 0) !== 0) throw Error('Accessor nao suportado pelo cache');
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? components * size;
    if (!Number.isInteger(a.count) || a.count < 0 || offset < 0 || stride < components * size ||
        offset + Math.max(0, a.count - 1) * stride + components * size > bin.length) throw Error('Accessor fora do buffer');
    const read = {5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
    return { count: a.count, get(i, c) { return bin[read](offset + i * stride + c * size); } };
  }
  const parts = [], chunks = []; let offset = 0;
  for (const [mi, mesh] of (g.meshes ?? []).entries()) {
    for (const [pi, p] of (mesh.primitives ?? []).entries()) {
      if ((p.mode ?? 4) !== 4 || p.extensions || p.attributes?.POSITION === undefined) throw Error('Primitiva nao suportada pelo cache');
      const pos = accessor(p.attributes.POSITION, 3);
      const normal = p.attributes.NORMAL === undefined ? null : accessor(p.attributes.NORMAL, 3);
      const uv = p.attributes.TEXCOORD_0 === undefined ? null : accessor(p.attributes.TEXCOORD_0, 2);
      if ((normal && normal.count !== pos.count) || (uv && uv.count !== pos.count)) throw Error('Atributos com tamanhos diferentes');
      const vertices = Buffer.alloc(pos.count * 32); let radius2 = 0;
      for (let i = 0; i < pos.count; i++) {
        const xyz = [pos.get(i,0), pos.get(i,1), pos.get(i,2)];
        radius2 = Math.max(radius2, xyz.reduce((sum,x)=>sum+x*x,0));
        const values = [...xyz, ...(normal ? [normal.get(i,0),normal.get(i,1),normal.get(i,2)] : [0,1,0]), ...(uv ? [uv.get(i,0),uv.get(i,1)] : [0,0])];
        for (let c=0;c<8;c++) { if (!Number.isFinite(values[c])) throw Error('Vertice nao finito'); vertices.writeFloatLE(values[c],i*32+c*4); }
      }
      const indices = p.indices === undefined ? null : accessor(p.indices,1);
      const count = indices ? indices.count : pos.count;
      if (count < 3 || count % 3 !== 0) throw Error('Indices nao formam triangulos');
      const indexBytes = Buffer.alloc(count * 4);
      for (let i=0;i<count;i++) { const index=indices ? indices.get(i,0) : i; if (!Number.isInteger(index)||index<0||index>=pos.count) throw Error('Indice invalido'); indexBytes.writeUInt32LE(index,i*4); }
      const name=(mesh.name ?? 'mesh'+mi)+(mesh.primitives.length>1?'_'+pi:'');
      parts.push({name, material:p.material ?? -1, offset, vertices:pos.count, indices:count, radius:Math.sqrt(radius2)});
      chunks.push(vertices,indexBytes);offset+=vertices.length+indexBytes.length;
    }
  }
  if (!parts.length) return false;
  const payload = Buffer.concat(chunks);
  const metadata = {version:1, source, dependencies, sha256:sha(payload), parts, gltf:{materials:g.materials,textures:g.textures,images:g.images}};
  fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,key+'.bin'),payload);
  fs.writeFileSync(manifest,JSON.stringify(metadata));
  return true;
}
export function prepareModelCaches(root) {
  const models = new Set();
  function scan(folder) {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder,{withFileTypes:true})) {
      const file=path.join(folder,entry.name);
      if (entry.isDirectory()) scan(file);
      else if(entry.name.endsWith('.json')) {
        try { for(const object of JSON.parse(fs.readFileSync(file)).objects ?? []) if(object.meshPath)models.add(object.meshPath); } catch {}
      }
    }
  }
  scan(path.join(root,'scenes'));
  const user=path.join(root,'assets/scene.json');
  if(fs.existsSync(user))for(const object of JSON.parse(fs.readFileSync(user)).objects ?? [])if(object.meshPath)models.add(object.meshPath);
  let count=0;
  for(const model of models) {
    try {if(prepareModelCache(root,model))count++;}
    catch(error){console.warn(`[model-cache] ${model}: ${error.message}; usando importador normal`);}
  }
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  console.log(`[model-cache] ${prepareModelCaches(root)} modelos preparados`);
}

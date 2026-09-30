// Reproducible original tileable surfaces; no downloaded assets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/environment');
const size = 256;
const palette = {
  steel: [48, 69, 73], edge: [105, 119, 119], wood: [115, 87, 59],
  dark: [39, 44, 45], concrete: [150, 152, 144], glass: [34, 57, 66],
  ochre: [183, 142, 69], paving: [91, 99, 100], white: [197, 198, 178],
};
function hash(x, y) {
  let v = Math.imul(x + 17, 374761393) ^ Math.imul(y + 53, 668265263);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967295;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(bytes.length, 0); body.copy(out, 4); out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length-4);
  return out;
}
for (const [name, base] of Object.entries(palette)) {
  const data = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const broad = Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4)) * 4;
    let grain = (hash(x, y) - .5) * 13 + broad;
    if (name === 'wood') grain += Math.sin(v * Math.PI * 50 + Math.sin(u * Math.PI * 4)) * 9;
    if (name === 'steel' || name === 'edge') grain += Math.sin(v * Math.PI * 128) * 2;
    if (name === 'glass') grain = Math.sin(v * Math.PI * 2) * 6 + Math.sin(u * Math.PI * 2) * 3;
    if (name === 'concrete' || name === 'paving') grain += hash(x, y) < .04 ? -17 : 0;
    const k = y * (size * 3 + 1) + 1 + x * 3;
    for (let channel = 0; channel < 3; channel++) data[k+channel] = Math.max(0, Math.min(255, base[channel] + grain));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8]=8; header[9]=2;
  fs.writeFileSync(path.join(root, `${name}.png`), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT',deflateSync(data)), chunk('IEND',Buffer.alloc(0))]));
}
// UVs for the authored quads: triangles are emitted in pairs by create_environment.py.
for (const name of ['crate', 'container', 'tower', 'streets']) {
  const file = path.join(root, `${name}.obj`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(line => !line.startsWith('vt '));
  let triangle = 0;
  const output = ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1'];
  for (let line of lines) {
    if (line.startsWith('f ')) {
      const uv = triangle++ % 2 === 0 ? [1,2,3] : [1,3,4];
      line = 'f ' + line.slice(2).split(' ').map((v,i) => `${v.split('/')[0]}/${uv[i]}`).join(' ');
    }
    output.push(line);
  }
  fs.writeFileSync(file, output.join('\n'));
}
fs.writeFileSync(path.join(root, 'environment.mtl'), Object.keys(palette).map(name =>
  `newmtl ${name}\nKd 1 1 1\nmap_Kd ${name}.png\n`).join('\n'));
console.log('9 materials with UVs: concrete pores, timber grain, painted steel and glass.');

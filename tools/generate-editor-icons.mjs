// Original editor artwork, defined as small vector primitives. Deterministic
// PNG rasterization with supersampling; no external service or build dependency.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
const directory = fileURLToPath(new URL('../assets/editor/icons/', import.meta.url));
const source = JSON.parse(fs.readFileSync(path.join(directory, 'source.json'), 'utf8'));
function inside(s, x, y) {
  if (s.kind === 'circle' || s.kind === 'ring') {
    const distance = Math.hypot(x - s.cx, y - s.cy);
    return s.kind === 'circle' ? distance <= s.r : Math.abs(distance - s.r) <= s.width / 2;
  }
  if (s.kind === 'line') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - s.x1 - t * dx, y - s.y1 - t * dy) <= s.width / 2;
  }
  let hit = false;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const [ax, ay] = s.points[i], [bx, by] = s.points[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) hit = !hit;
  }
  return hit;
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4); return result;
}
const size = source.size * source.scale;
for (const [name, shapes] of Object.entries(source.icons)) {
  if (!/^[a-z]+$/.test(name)) throw new Error('Invalid icon name');
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0]; let covered = 0;
    for (let sy = 0; sy < source.samples; sy++) for (let sx = 0; sx < source.samples; sx++) {
      const px = (x + (sx + 0.5) / source.samples) / source.scale;
      const py = (y + (sy + 0.5) / source.samples) / source.scale;
      let color;
      for (const shape of shapes) if (inside(shape, px, py)) color = source.palette[shape.color];
      if (color) { covered++; for (let c = 0; c < 3; c++) sum[c] += parseInt(color.slice(1 + c * 2, 3 + c * 2), 16); }
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (covered) for (let c = 0; c < 3; c++) scanlines[offset + c] = Math.round(sum[c] / covered);
    scanlines[offset + 3] = Math.round(covered * 255 / (source.samples * source.samples));
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
  const destination = path.join(directory, name + '.png');
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(png)) throw new Error(`Regenerate ${name}.png`);
  } else fs.writeFileSync(destination, png);
}
console.log(`[editor icons] ${Object.keys(source.icons).length} PNGs, ${size}x${size}, RGBA`);

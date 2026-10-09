// Gera uma animação original sobre o personagem Kenney (CC0), sem alterar
// o modelo de origem. Execute com Node 22: node tools/create-wave-demo.ts.
// Usa glTF porque a engine ainda não tem um formato/editor de clipes .anim.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'assets/models/kenney/character-a.glb'));
const jsonSize = source.readUInt32LE(12);
const model = JSON.parse(source.subarray(20, 20 + jsonSize).toString('utf8'));
const binHeader = 20 + jsonSize;
const originalBin = source.subarray(binHeader + 8, binHeader + 8 + source.readUInt32LE(binHeader));
const buffers = [originalBin];
let offset = originalBin.length;
function accessor(values: number[], width: number): number {
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => data.writeFloatLE(value, i * 4));
  const view = model.bufferViews.length;
  model.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
  buffers.push(data); offset += data.length;
  const index = model.accessors.length;
  const record: any = { bufferView: view, componentType: 5126, count: values.length / width,
    type: width === 1 ? 'SCALAR' : 'VEC4' };
  if (width === 1) { record.min = [Math.min(...values)]; record.max = [Math.max(...values)]; }
  model.accessors.push(record);
  return index;
}
const times = [0, 0.45, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.85, 3.3, 3.8];
const input = accessor(times, 1);
const clip: any = { name: 'Wave', samplers: [], channels: [] };
function rotate(name: string, axis: number, degrees: number[]): void {
  const node = model.nodes.findIndex((n: any) => n.name === name);
  if (node < 0 || degrees.length !== times.length) throw new Error('Canal inválido: ' + name);
  const values: number[] = [];
  for (const angle of degrees) {
    const half = angle * Math.PI / 360;
    const q = [0, 0, 0, Math.cos(half)]; q[axis] = Math.sin(half);
    values.push(...q);
  }
  clip.channels.push({ sampler: clip.samplers.length, target: { node, path: 'rotation' } });
  clip.samplers.push({ input, output: accessor(values, 4), interpolation: 'LINEAR' });
}
rotate('arm-right', 2, [0, -55, -145, -120, -155, -120, -155, -125, -70, 0, 0]);
rotate('head', 2, [0, 0, 9, 9, 6, 9, 6, 9, 4, 0, 0]);
rotate('torso', 2, [0, 2, 5, 5, 3, 5, 3, 5, 2, 0, 0]);
model.animations = [clip];
model.buffers[0].byteLength = offset;
const rawJson = Buffer.from(JSON.stringify(model));
const json = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20); rawJson.copy(json);
const bin = Buffer.concat(buffers);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const tail = Buffer.alloc(8); tail.writeUInt32LE(bin.length, 0); tail.writeUInt32LE(0x004e4942, 4);
const modelPath = 'assets/models/kenney/character-wave-demo.glb';
fs.writeFileSync(path.join(root, modelPath), Buffer.concat([header, json, tail, bin]));

function object(name: string, pos: number[], scale: number[], color: number[]): any {
  return { name, active: 1, mesh: 1, color, pos, rot: [0, 0, 0], scale3: scale,
    parent: -1, stationary: 1, layer: 1, mask: 4294967295, scripts: [] };
}
const actor = object('WaveDemo', [0, 0.2, 0], [1, 1, 1], [255, 255, 255]);
actor.mesh = 0;
actor.rot = [0, Math.PI, 0];
actor.scripts = [{ type: 'skeleton', modelPath, pose: [] },
  { type: 'script:src/engine/core/animation_player.ts#AnimationPlayer', fields: { clip: 'Wave', speed: 1, loop: true, playing: true } }];
const podium = object('Palco', [0, 0, 0], [3.6, 0.4, 2.8], [53, 105, 130]);
const ground = object('Chao', [0, -0.3, 0], [30, 0.2, 30], [47, 55, 70]);
const scene = { name: 'Teste de animacao - Aceno', objects: [actor, podium, ground],
  camera: [1.7, 1.2, -6.7, -0.248, 0], light: [-3, 7, -5, 0.55],
  ambiente: { ceu: { modo: 'cor', topo: [0.055, 0.075, 0.11], estrelas: 0 } } };
fs.writeFileSync(path.join(root, 'scenes/wave-demo.json'), JSON.stringify(scene, null, 2) + '\n');
console.log('Criados: ' + modelPath + ' e scenes/wave-demo.json (Wave, 3 canais, 11 chaves/canal, 3,8 s).');

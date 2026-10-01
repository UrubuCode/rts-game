// Deterministic, project-owned reference textures: no network/download/license.
import fs from 'node:fs';
import zlib from 'node:zlib';
const dir = new URL('../assets/pbr/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
function crc(bytes) { let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);} return (c^0xffffffff)>>>0; }
function chunk(type,bytes) {const t=Buffer.from(type), n=Buffer.alloc(4), c=Buffer.alloc(4); n.writeUInt32BE(bytes.length); c.writeUInt32BE(crc(Buffer.concat([t,bytes]))); return Buffer.concat([n,t,bytes,c]);}
export function png(w,h,pixels) {
  const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;
  const scan=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)Buffer.from(pixels.buffer,pixels.byteOffset+y*w*4,w*4).copy(scan,y*(w*4+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
const size=256;
function noise(x,y) {let v=Math.imul(x+31,374761393)^Math.imul(y+71,668265263);v=Math.imul(v^(v>>>13),1274126177);return ((v^(v>>>16))>>>0)/4294967295;}
function height(kind,x,y){x=(x+size)%size;y=(y+size)%size;
  if(kind==='stone')return (x%64<2||y%64<2)?-0.13:noise(x,y)*0.015;
  if(kind==='wood')return Math.sin(x*0.42+Math.sin(y*0.025)*2)*0.025+noise(x,y)*0.008;
  return Math.sin(x*Math.PI/16)*0.01+noise(x,y)*0.008;
}
for(const kind of ['stone','wood','metal']) {
  const albedo=new Uint8Array(size*size*4),normal=new Uint8Array(albedo.length),orm=new Uint8Array(albedo.length);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=(y*size+x)*4,n=noise(x,y),h=height(kind,x,y),seam=kind==='stone'&&h<0;
    const base=kind==='wood'?[107,67,37]:kind==='metal'?[157,167,176]:[143,137,125];
    const variation=seam?0.36:0.91+n*0.14+h*2;
    for(let c=0;c<3;c++)albedo[i+c]=Math.min(255,base[c]*variation);albedo[i+3]=255;
    const dx=(height(kind,x+1,y)-height(kind,x-1,y))*3,dy=(height(kind,x,y+1)-height(kind,x,y-1))*3;
    const len=Math.hypot(dx,dy,1);normal.set([Math.round((-dx/len*0.5+0.5)*255),Math.round((-dy/len*0.5+0.5)*255),Math.round((1/len*0.5+0.5)*255),255],i);
    orm.set([seam?100:255,kind==='metal'?70+n*30:kind==='wood'?155+n*30:195+n*40,kind==='metal'?255:0,255],i);
  }
  for(const [suffix,p]of [['base',albedo],['normal',normal],['orm',orm]])fs.writeFileSync(new URL(`${kind}-${suffix}.png`,dir),png(size,size,p));
}
console.log('Generated 9 PBR reference textures in assets/pbr.');

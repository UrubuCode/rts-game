// Convert native renderer P6 captures to portable PNGs for visual review.
import fs from 'node:fs';
import zlib from 'node:zlib';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node tools/pbr-preview.mjs input.ppm output.png');
const data=fs.readFileSync(input);let off=0;
function word(){while(data[off]<=32)off++;const start=off;while(data[off]>32)off++;return data.subarray(start,off).toString();}
if(word()!=='P6')throw Error('Expected P6');const w=Number(word()),h=Number(word());if(word()!=='255')throw Error('Expected 8-bit');
if(data[off]===13&&data[off+1]===10)off+=2;else off++;
if(data.length-off!==w*h*3)throw Error('Truncated capture');
const scan=Buffer.alloc(h*(w*3+1));for(let y=0;y<h;y++)data.copy(scan,y*(w*3+1)+1,off+y*w*3,off+(y+1)*w*3);
function chunk(type,body){const t=Buffer.from(type),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(body.length);let c=0xffffffff;
  for(const b of Buffer.concat([t,body])){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}crc.writeUInt32BE((c^0xffffffff)>>>0);return Buffer.concat([n,t,body,crc]);}
const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=2;
fs.writeFileSync(output,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]));
console.log(output);

import fs from 'node:fs';
const objects=[];
for(let z=0;z<30;z++)for(let x=0;x<30;x++){
  const height=1+(x*7+z*13)%14;
  objects.push({name:`building-${x}-${z}`,mesh:1,color:[125+x%4*20,125+z%4*15,140],pos:[(x-15)*4,height/2,z*4],rot:[0,0],scale3:[2.5,height,2.5],parent:-1,stationary:1});
}
fs.mkdirSync('assets/pbr',{recursive:true});
fs.writeFileSync('assets/pbr/loading-city.scene.json',JSON.stringify({name:'Async city / 900 objects',objects}));

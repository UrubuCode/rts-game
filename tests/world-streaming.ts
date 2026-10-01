import { FpsWorldField, FPS_WORLD_CHUNK, FpsChunkWindow } from "@engine/core/world_streaming";
function fpsAssert(ok:boolean,message:string):void{if(!ok)throw new Error(message);}
const fpsField=new FpsWorldField(42),fpsOther=new FpsWorldField(43);
fpsAssert(fpsField.height(10,10)===new FpsWorldField(42).height(10,10),"seed repeatability");
fpsAssert(fpsField.random(3,-7)!==fpsOther.random(3,-7),"seed variation");
let fpsHigh=0,fpsLow=1000;
for(let x=-1000;x<=1000;x+=50)for(let z=-1000;z<=1000;z+=50){const h=fpsField.height(x,z);fpsHigh=Math.max(fpsHigh,h);fpsLow=Math.min(fpsLow,h);}
fpsAssert(fpsHigh>65&&fpsLow<0,"mountains and river basins");
for(let cx=-3;cx<3;cx++)for(let z=0;z<=16;z++){
  const a=fpsField.vertexHeight(cx,2,16,z),b=fpsField.vertexHeight(cx+1,2,0,z);
  fpsAssert(a===b,"shared edge differs");
}
const fpsWindow=new FpsChunkWindow(2);
fpsWindow.move(-.1,-.1);fpsAssert(fpsWindow.cx===-1&&fpsWindow.cz===-1,"negative coordinate floor");
fpsAssert(fpsWindow.x.length===25,"bounded window");
fpsWindow.move(FPS_WORLD_CHUNK*12+1,FPS_WORLD_CHUNK*-18+1);
fpsAssert(fpsWindow.cx===12&&fpsWindow.cz===-18,"travel coordinates");
fpsAssert(fpsWindow.x[0]===12&&fpsWindow.z[0]===-18,"nearest chunk first");
fpsAssert(!fpsWindow.contains(0,0),"old chunks evicted");
fpsWindow.move(0,0);fpsAssert(fpsWindow.x.length===25&&fpsWindow.contains(0,0),"return visit");
println("PASS world-streaming: seed, shared edges, negative coordinates, bounded window, mountains/river, return visit");

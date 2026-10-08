import { HeightfieldWater } from "@engine/water/heightfield_water";
const water=new HeightfieldWater(4,1,new Float64Array(16));water.addVolume(1,1,5);
console.log("ADAPTIVE_GC_BEGIN");
for(let i=0;i<200000;i++){water.addVolume(1,1,.00001);water.step(.05);}
console.log("ADAPTIVE_GC_END");
if(Math.abs(water.volume()-7)>.000001)throw new Error("volume perdido");
console.log("adaptive-water-gc OK");

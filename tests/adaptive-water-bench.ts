import { HeightfieldWater } from "@engine/water/heightfield_water";
for(let n=8;n<=32;n*=2){const s=new HeightfieldWater(n,1,new Float64Array(n*n));s.addVolume(n/2,n/2,500);for(let i=0;i<20;i++)s.step(.05);const start=Date.now();for(let i=0;i<100;i++)s.step(.05);console.log("adaptive-water bench n="+n+" ms/step="+(Date.now()-start)/100);}

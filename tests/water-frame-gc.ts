import { WaterSurface } from "@engine/core/water_surface";
const water=new WaterSurface(),pos=new Float64Array(3);
for(let i=0;i<1000;i++){water.update(.016);water.drawSelf(0,pos,-1);}
println("WATER_GC_BEGIN");
for(let i=0;i<200000;i++){water.update(.016);water.drawSelf(0,pos,-1);}
println("WATER_GC_END");

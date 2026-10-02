import { WaterSurface } from "@engine/core/water_surface";
const water=new WaterSurface(),pos=new Float64Array(3);
for(let i=0;i<1000;i++){water.update(.016);water.drawSelf(0,pos,-1);}
println("WATER_GC_BEGIN");
for(let i=0;i<200000;i++){water.update(.016);water.drawSelf(0,pos,-1);}
println("WATER_GC_END");

import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { Buoyancy } from "@engine/core/buoyancy";
import { Rigidbody } from "@scripts/rigidbody";
const scene=new Scene("gc"),lake=new GameObject("Lake"),box=new GameObject("Box"),buoyancy=new Buoyancy();
lake.addBehavior(new WaterSurface());scene.add(lake);box.addBehavior(buoyancy);box.addBehavior(new Rigidbody());scene.add(box);scene.computeWorld();
for(let i=0;i<1000;i++)buoyancy.update(.016);
println("BUOYANCY_GC_BEGIN");
for(let i=0;i<200000;i++)buoyancy.update(.016);
println("BUOYANCY_GC_END");scene.clear();

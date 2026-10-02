import { Spline } from "@engine/core/spline";
import { WaterBody } from "@engine/core/water_body";
import { Buoyancy } from "@engine/core/buoyancy";
import { Rigidbody } from "@scripts/rigidbody";
import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { frustumBeginBuf } from "@engine/render/gpu3d";
const scene=new Scene(),o=new GameObject("River"),curve=new Spline(),water=new WaterBody(),q=new Float64Array(6),pos=new Float64Array(3);
o.addBehavior(curve);o.addBehavior(water);scene.add(o);
const box=new GameObject("Float"),b=new Buoyancy();box.addBehavior(b);box.addBehavior(new Rigidbody());scene.add(box);scene.computeWorld();
// Malhas sintéticas isolam o marshalling sem alocar uploads na janela nula.
const access:any=water;for(let i=0;i<access.patches.length;i++)access.patches[i].mesh=1;
frustumBeginBuf(new Float64Array([0,10,-30,0,-.3,1,1.6,.1,500,0,5]));
for(let i=0;i<1000;i++){water.update(.016);water.sample(0,0,q);b.update(.016);water.drawSelf(0,pos,-1);}
println("SPLINE_GC_BEGIN");
for(let i=0;i<200000;i++){water.update(.016);water.sample(0,0,q);b.update(.016);water.drawSelf(0,pos,-1);}
println("SPLINE_GC_END");
for(let i=0;i<access.patches.length;i++)access.patches[i].mesh=0;scene.clear();

import { AdaptiveWater } from "@engine/core/adaptive_water";
import { Terrain } from "@engine/core/terrain";
import { GameObject } from "@engine/core/gameobject";
import { Scene } from "@engine/core/scene";
const scene=new Scene(),g=new GameObject("Terrain"),t=new Terrain(),o=new GameObject("Water"),w=new AdaptiveWater();
g.addBehavior(t);scene.add(g);w.resolution=4;w.sourceRate=.001;o.addBehavior(w);scene.add(o);scene.computeWorld();w.update(.05);
const query=new Float64Array(4);
console.log("ADAPTIVE_COMPONENT_GC_BEGIN");
for(let i=0;i<200000;i++){w.update(.016);w.sample(0,0,query);}
console.log("ADAPTIVE_COMPONENT_GC_END");
if(w.error()!==""||w.volume()<=0)throw new Error("simulacao falhou");
scene.clear();console.log("adaptive-water-component-gc OK");

import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { WaterSurface } from "@engine/core/water_surface";
import { SailboatController } from "@engine/core/sailboat_controller";
import { SailboatRenderer } from "@engine/core/sailboat_renderer";
const scene=new Scene(),ocean=new GameObject("Ocean"),water=new WaterSurface();water.width=10000;water.length=10000;ocean.addBehavior(water);scene.add(ocean);
const boat=new GameObject("Boat"),controller=new SailboatController(),renderer=new SailboatRenderer();boat.addBehavior(controller);boat.addBehavior(renderer);scene.add(boat);scene.computeWorld();
const access:any=renderer;access.hull=1;access.deck=1;access.sailMesh=1;
const pos=new Float64Array(3);
for(let i=0;i<1000;i++){controller.update(.016);renderer.drawSelf(0,pos,-1);}
println("SAILING_GC_BEGIN");
for(let i=0;i<200000;i++){controller.update(.016);renderer.drawSelf(0,pos,-1);}
println("SAILING_GC_END");access.hull=0;access.deck=0;access.sailMesh=0;scene.clear();

import { ProceduralWorld } from "@engine/core/procedural_world";
import { frustumBeginBuf } from "@engine/render/gpu3d";
// Isola o caminho de quadro com chunks residentes, sem iniciar GPU/worker.
class ResidentProbe {
  chunks:number[]=[];window:any={x:[0]};error:string="";offsetY:number=0;calls:number=0;
  move(x:number,z:number):void{}
  tick():void{}
  draw(x:number,z:number,camera:Float64Array):void{this.calls++;}
}
const component=new ProceduralWorld(),probe=new ResidentProbe(),access:any=component;
access.world=probe;access.window=1;
const camera=new Float64Array([4,38,-42,0,-.13,1.05,1.6,.15,390,0,5]),pos=new Float64Array(3);
frustumBeginBuf(camera);component.drawSelf(1,pos,-1);
println("WORLD_COMPONENT_GC_BEGIN");
for(let i=0;i<200000;i++)component.drawSelf(1,pos,-1);
println("WORLD_COMPONENT_GC_END "+probe.calls);
if(probe.calls!==200001)throw new Error("Renderer not exercised");

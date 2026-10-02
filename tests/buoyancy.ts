import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { WaterSurface } from "@engine/core/water_surface";
import { Buoyancy } from "@engine/core/buoyancy";
import { Rigidbody } from "@scripts/rigidbody";
import { createComponent,componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
import { rigidSetMode,rigidStep,rigidFlush,rigidInvalidate } from "@engine/core/physics_backend";
function check(ok:boolean,name:string):void{if(!ok)throw new Error(name);println("[OK] "+name);}
function simulate(mass:number,dt:number):number {
  const scene=new Scene("Buoyancy"),lake=new GameObject("Lake"),water=new WaterSurface();water.waveAmplitude=0;lake.addBehavior(water);scene.add(lake);
  const box=new GameObject("Box"),rb=new Rigidbody();rb.mass=mass;rb.floorY=-100;
  box.transform.py=2;box.addBehavior(new Buoyancy());box.addBehavior(rb);scene.add(box);scene.computeWorld();
  for(let i=0;i<Math.floor(12/dt);i++){scene.update(dt);scene.computeWorld();}
  const y=box.transform.py;check(Number.isFinite(y),"simulação finita");
  if(mass<1){check(Math.abs(y-(.5-mass))<.13,"corpo leve converge ao deslocamento de volume");
    const old=box.transform.py;box.transform.px=100;for(let i=0;i<60;i++)scene.update(1/60);check(box.transform.py<old-1,"fora da superfície não recebe empuxo");}
  scene.clear();return y;
}
const a=simulate(.4,1/60),b=simulate(.4,1/120);check(Math.abs(a-b)<.08,"estável em 60/120 Hz");
check(simulate(2,1/60)<-2,"corpo mais denso afunda");
const component=createComponent("Buoyancy") as Buoyancy;component.waterObject="Lake";component.fluidDensity=3;
const restored=recreateBehavior(componentToData(component)) as Buoyancy;
check(restored instanceof Buoyancy&&restored.waterObject==="Lake"&&restored.fluidDensity===3,"configuração serializa");
for(let mode=1;mode<=2;mode++){
  const scene=new Scene("external"),lake=new GameObject("Lake"),water=new WaterSurface();water.waveAmplitude=0;lake.addBehavior(water);scene.add(lake);
  const box=new GameObject("Box");box.setMesh(1,160,120,60);box.transform.py=1;
  const body=new Rigidbody();body.mass=.4;body.floorY=-20;box.addBehavior(new Buoyancy());box.addBehavior(body);scene.add(box);scene.computeWorld();
  rigidSetMode(mode);rigidInvalidate();rigidStep(scene,0);rigidFlush();
  for(let i=0;i<600;i++){scene.update(1/60);rigidStep(scene,0);rigidFlush();scene.computeWorld();}
  println("backend "+mode+" y="+box.transform.py);
  check(Math.abs(box.transform.py-.1)<.15,"empuxo chega ao backend externo "+mode);
  rigidSetMode(0);rigidInvalidate();scene.clear();
}
println("[PASSOU] buoyancy");

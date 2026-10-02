import { Scene } from "@engine/core/scene";
import { GameObject } from "@engine/core/gameobject";
import { WaterSurface } from "@engine/core/water_surface";
import { SailboatController } from "@engine/core/sailboat_controller";
import { componentToData } from "@engine/components";
import { recreateBehavior } from "@editor/sceneio";
function check(ok:boolean,msg:string):void{if(!ok)throw new Error(msg);println("[OK] "+msg);}
function simulate(dt:number):number {
  const scene=new Scene(),ocean=new GameObject("Ocean"),water=new WaterSurface();water.width=800;water.length=800;water.waveAmplitude=.4;water.wavelength=20;ocean.addBehavior(water);scene.add(ocean);
  const boat=new GameObject("Boat"),control=new SailboatController();boat.addBehavior(control);scene.add(boat);scene.computeWorld();control.setSail(1);
  for(let i=0;i<Math.round(10/dt);i++){scene.update(dt);scene.computeWorld();}
  const distance=boat.transform.pz;check(distance>20&&control.forwardSpeed()>3,"vela impulsiona o barco");
  check(Math.abs(boat.transform.rx)>0.0001||Math.abs(boat.transform.rz)>0.0001,"apoio multiponto inclina embarcacao");
  control.setRudder(1);const yaw=boat.transform.ry;for(let i=0;i<Math.round(2/dt);i++)scene.update(dt);check(boat.transform.ry>yaw+.2,"leme altera rumo");
  control.toggleAnchor();for(let i=0;i<Math.round(4/dt);i++)scene.update(dt);check(control.forwardSpeed()<.001,"ancora desacelera ate parar");
  boat.transform.px=1000;scene.update(dt);check(!control.hasWater()&&control.forwardSpeed()===0,"fora da agua nao navega");
  control.resetMotion();check(control.sailAmount()===0&&!control.isAnchored(),"reinicio limpa controles");scene.clear();return distance;
}
const a=simulate(1/60),b=simulate(1/120);check(Math.abs(a-b)<.6,"resultado estavel em 60 e 120 Hz");
const c=new SailboatController();c.windStrength=.7;c.waterObject="Lake";c.setSail(1);const restored=recreateBehavior(componentToData(c)) as SailboatController;
check(restored.windStrength===.7&&restored.waterObject==="Lake"&&restored.sailAmount()===0,"configuracao salva sem estado de pilotagem");
println("[PASSOU] sailboat");

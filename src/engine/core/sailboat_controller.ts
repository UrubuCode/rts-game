import { Behavior } from "./behavior";
import { WaterSurface } from "./water_surface";
import { WaterBody } from "./water_body";
import { activeInScene } from "./gameobject";
/**
 * @componentCategory Física
 * @componentDescription Navegação de veleiro com vento, leme, âncora e apoio nas ondas.
 * @componentKeywords barco boat navio vela leme oceano
 */
export class SailboatController extends Behavior {
  waterObject:string="Ocean";
  length:number=10;
  width:number=4;
  freeboard:number=.55;
  maxSpeed:number=12;
  acceleration:number=2;
  steering:number=.48;
  windHeading:number=.6;
  windStrength:number=1;
  private rudder:number=0;
  private sail:number=0;
  private anchored:boolean=false;
  private speed:number=0;
  private surface:Behavior|null=null;
  private submerged:boolean=false;
  mount():void{this.onValidate("");this.findWater();}
  onValidate(field:string):void {
    this.length=this.limit(this.length,1,100,10);this.width=this.limit(this.width,.5,30,4);
    this.freeboard=this.limit(this.freeboard,-2,5,.55);this.maxSpeed=this.limit(this.maxSpeed,1,40,12);
    this.acceleration=this.limit(this.acceleration,.1,10,2);this.steering=this.limit(this.steering,.05,2,.48);
    this.windHeading=this.limit(this.windHeading,-Math.PI*2,Math.PI*2,.6);this.windStrength=this.limit(this.windStrength,0,3,1);
  }
  private limit(v:number,min:number,max:number,fallback:number):number{return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;}
  setRudder(value:number):void{this.rudder=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0;}
  setSail(value:number):void{this.sail=Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;}
  sailAmount():number{return this.sail;}
  forwardSpeed():number{return this.speed;}
  isAnchored():boolean{return this.anchored;}
  controlStatus():string{return JSON.stringify({rudder:this.rudder,sail:this.sail,anchored:this.anchored,speed:this.speed,hasWater:this.submerged});}
  hasWater():boolean{return this.submerged;}
  toggleAnchor():void{this.anchored=!this.anchored;}
  stopMotion():void{this.speed=0;this.host.vx=0;this.host.vz=0;}
  resetMotion():void{this.speed=0;this.sail=0;this.rudder=0;this.anchored=false;this.host.vx=0;this.host.vy=0;this.host.vz=0;}
  private findWater():void {
    this.surface=null;const owner=this.owner;if(owner===null||owner.uiOwner===null)return;
    const objects=owner.uiOwner.objects;
    for(let i=0;i<objects.length;i++){
      const o=objects[i];if(!activeInScene(objects,o)||(this.waterObject!==""&&o.name!==this.waterObject))continue;
      for(let j=0;j<o.behaviors.length;j++){const b=o.behaviors[j];if(b.enabled!==0&&(b instanceof WaterSurface||b instanceof WaterBody)){this.surface=b;return;}}
    }
  }
  private height(x:number,z:number):number {
    const w=this.surface;if(w===null||w.enabled===0||w.owner===null||w.owner.uiOwner===null||!activeInScene(w.owner.uiOwner.objects,w.owner))return NaN;
    if(w instanceof WaterSurface)return w.contains(x,z)?w.heightAt(x,z):NaN;
    if(w instanceof WaterBody)return w.waterHeightAt(x,z);
    return NaN;
  }
  update(dt:number):void {
    if(this.enabled===0||!Number.isFinite(dt)||dt<=0||this.owner===null||this.owner.parent>=0)return;
    if(this.surface===null||this.surface.owner===null)this.findWater();
    const steps=Math.max(1,Math.ceil(Math.min(dt,.1)*60)),step=Math.min(dt,.1)/steps;
    for(let i=0;i<steps;i++)this.integrate(step);
  }
  private integrate(dt:number):void {
    const t=this.host,h=this.height(t.px,t.pz);this.submerged=Number.isFinite(h);
    if(!this.submerged){this.speed=0;t.vx=0;t.vz=0;return;}
    const alignment=Math.cos(t.ry-this.windHeading),wind=.18+.82*Math.sqrt(Math.max(0,(alignment+1)*.5));
    const thrust=this.anchored?0:this.sail*this.acceleration*this.windStrength*wind;
    this.speed=Math.max(0,Math.min(this.maxSpeed,(this.speed+thrust*dt)*Math.exp(-(this.anchored?3:.08+.015*this.speed)*dt)));
    t.ry+=this.rudder*this.steering*Math.min(1,this.speed/4)*dt;
    const sy=Math.sin(t.ry),cy=Math.cos(t.ry),x=t.px+sy*this.speed*dt,z=t.pz+cy*this.speed*dt;
    if(Number.isFinite(this.height(x,z))){t.px=x;t.pz=z;}else this.speed=0;
    t.vx=sy*this.speed;t.vz=cy*this.speed;
    const front=this.height(t.px+sy*this.length*.4,t.pz+cy*this.length*.4),back=this.height(t.px-sy*this.length*.4,t.pz-cy*this.length*.4);
    const right=this.height(t.px+cy*this.width*.4,t.pz-sy*this.width*.4),left=this.height(t.px-cy*this.width*.4,t.pz+sy*this.width*.4);
    const blend=1-Math.exp(-4*dt),target=h+this.freeboard;
    t.py+=(target-t.py)*blend;
    if(Number.isFinite(front)&&Number.isFinite(back))t.rx+=(Math.atan2(front-back,this.length*.8)-t.rx)*blend;
    if(Number.isFinite(right)&&Number.isFinite(left))t.rz+=(Math.atan2(right-left,this.width*.8)-this.rudder*this.speed*.012-t.rz)*blend;
  }
  releaseResources():void{this.surface=null;this.resetMotion();}
}

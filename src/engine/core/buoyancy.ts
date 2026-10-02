import { Behavior } from "./behavior";
import { WaterSurface } from "./water_surface";
import { ProceduralWorld } from "./procedural_world";
import { activeInScene } from "./gameobject";
import { BODY_DYNAMIC } from "../rigid/materials";
/**
 * @componentCategory Física
 * @componentDescription Empuxo e arrasto de água para um Rigidbody dinâmico.
 * @componentKeywords agua water buoyancy flutuacao empuxo
 */
export class Buoyancy extends Behavior {
  waterObject:string="";
  fluidDensity:number=1;
  drag:number=2;
  volumeScale:number=1;
  private body:Behavior|null=null;
  mount():void {
    this.body=null;
    if(this.owner!==null)for(let i=0;i<this.owner.behaviors.length;i++){
      const b=this.owner.behaviors[i];if(b.bodyIntegrates()!==0){this.body=b;break;}
    }
    this.onValidate("");
  }
  onValidate(field:string):void {
    this.fluidDensity=Number.isFinite(this.fluidDensity)?Math.max(.001,Math.min(10000,this.fluidDensity)):1;
    this.drag=Number.isFinite(this.drag)?Math.max(0,Math.min(100,this.drag)):2;
    this.volumeScale=Number.isFinite(this.volumeScale)?Math.max(.001,Math.min(1000,this.volumeScale)):1;
  }
  private surfaceHeight():number {
    const owner=this.owner;if(owner===null||owner.uiOwner===null)return NaN;
    const objects=owner.uiOwner.objects,t=this.host;
    let height=NaN;
    for(let i=0;i<objects.length;i++){
      const go=objects[i];if(!activeInScene(objects,go)||(this.waterObject!==""&&go.name!==this.waterObject))continue;
      for(let j=0;j<go.behaviors.length;j++){
        const b=go.behaviors[j];if(b.enabled===0)continue;
        let h=NaN;
        if(b instanceof WaterSurface&&b.contains(t.px,t.pz))h=b.heightAt(t.px,t.pz);
        else if(b instanceof ProceduralWorld)h=b.waterHeightAt(t.px,t.pz);
        if(Number.isFinite(h)&&(!Number.isFinite(height)||h>height))height=h;
      }
    }
    return height;
  }
  update(dt:number):void {
    if(this.owner!==null&&(this.body===null||this.owner.behaviors.indexOf(this.body)<0))this.mount();
    const o=this.owner,b=this.body,t=this.host;
    if(this.enabled===0||o===null||o.parent>=0||o.stationary!==0||b===null||b.enabled===0||b.bodyType!==BODY_DYNAMIC||t.mass<=0||!Number.isFinite(dt)||dt<=0)return;
    const h=this.surfaceHeight();if(!Number.isFinite(h))return;
    const sy=Math.abs(t.sy);if(sy<.0001)return;
    const submerged=Math.max(0,Math.min(1,(h-t.py+sy*.5)/sy));if(submerged===0)return;
    const step=Math.min(dt,.1),volume=Math.abs(t.sx*t.sy*t.sz)*this.volumeScale;
    t.vy+=Math.abs(b.bodyGravity())*this.fluidDensity*volume*submerged/t.mass*step;
    const attenuation=Math.exp(-this.drag*submerged*step);
    t.vx*=attenuation;t.vy*=attenuation;t.vz*=attenuation;t.asleep=0;t.quiet=0;
  }
  releaseResources():void{this.body=null;}
}

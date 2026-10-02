import { Behavior,KIND_RENDERER } from "./behavior";
import { drawWaterSurface } from "rts:egui";
/**
 * @componentCategory Renderização
 * @componentDescription Água com ondas GPU, refração, absorção por profundidade e espuma nas margens.
 * @componentKeywords water água rio lago oceano ondas
 */
export class WaterSurface extends Behavior {
  width:number=32;
  length:number=32;
  waveAmplitude:number=.12;
  wavelength:number=5;
  waveSpeed:number=1;
  foamWidth:number=.4;
  opacity:number=.85;
  refraction:number=8;
  absorption:number=.3;
  red:number=.025;green:number=.19;blue:number=.16;
  resolution:number=64;
  reflectionStrength:number=.8;
  reflectionDistance:number=50;
  reflectionSteps:number=24;
  private time:number=0;
  private data:Float64Array=new Float64Array(24);
  setWaveOrigin(x:number,z:number):void{this.data[20]=x;this.data[21]=z;}
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  rBoundRadius():number{return Math.sqrt(this.width*this.width+this.length*this.length)*.5+this.waveAmplitude*1.35;}
  mount():void{this.onValidate("");}
  onValidate(field:string):void {
    this.width=this.limit(this.width,.1,10000,32);this.length=this.limit(this.length,.1,10000,32);
    this.waveAmplitude=this.limit(this.waveAmplitude,0,10,.12);this.wavelength=this.limit(this.wavelength,.1,1000,5);
    this.waveSpeed=this.limit(this.waveSpeed,-10,10,1);this.foamWidth=this.limit(this.foamWidth,.01,10,.4);
    this.opacity=this.limit(this.opacity,0,1,.85);this.refraction=this.limit(this.refraction,0,32,8);
    this.absorption=this.limit(this.absorption,.01,10,.3);this.resolution=Math.floor(this.limit(this.resolution,8,128,64));
    this.reflectionStrength=this.limit(this.reflectionStrength,0,1,.8);this.reflectionDistance=this.limit(this.reflectionDistance,1,200,50);this.reflectionSteps=Math.floor(this.limit(this.reflectionSteps,8,48,24));
    this.red=this.limit(this.red,0,1,.025);this.green=this.limit(this.green,0,1,.19);this.blue=this.limit(this.blue,0,1,.16);
    if(this.owner!==null)this.owner.boundRadius=this.rBoundRadius();
  }
  private limit(v:number,min:number,max:number,fallback:number):number{return Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;}
  update(dt:number):void{if(this.enabled!==0&&Number.isFinite(dt)&&dt>0)this.time+=Math.min(dt,.1);}
  contains(x:number,z:number):boolean{return Math.abs(x-this.host.wx)<=this.width*.5&&Math.abs(z-this.host.wz)<=this.length*.5;}
  /** Altura mundial das mesmas duas ondas do shader, para consultar a superfície. */
  heightAt(x:number,z:number):number {
    const k=2*Math.PI/this.wavelength,t=this.time*this.waveSpeed;
    return this.host.wy+this.waveAmplitude*(Math.sin(k*(x*.8+z*.6)+t)+.35*Math.sin(k*1.7*(-x*.6+z*.8)+t*1.3));
  }
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    if(this.enabled===0)return 1;
    const p=this.data;p[0]=pos[0];p[1]=pos[1];p[2]=pos[2];p[3]=this.width;
    p[4]=this.length;p[5]=this.time;p[6]=this.waveAmplitude;p[7]=this.wavelength;
    p[8]=this.waveSpeed;p[9]=this.foamWidth;p[10]=this.opacity;p[11]=this.refraction;
    p[12]=this.red;p[13]=this.green;p[14]=this.blue;p[15]=this.absorption;p[16]=this.resolution;
    p[17]=this.reflectionStrength;p[18]=this.reflectionDistance;p[19]=this.reflectionSteps;
    drawWaterSurface(win,p);return 1;
  }
  releaseResources():void{this.time=0;}
}

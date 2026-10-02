import { Behavior, KIND_RENDERER } from "./behavior";
import { Material } from "./material";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
import { meshUpload, meshFree } from "rts:egui";
import { drawGPUMeshBuf, DRAW_FLOATS, D_X,D_Y,D_Z,D_RX,D_RY,D_SX,D_SY,D_SZ,D_COR,D_TEX,D_TILE,D_MATERIAL,D_EMISSIVO } from "../render/gpu3d";
import { resolvePbrMaterial } from "../render/pbr_material";
import { resolveMaterialTexture } from "../render/material_tex";

export class TerrainMesh {
  vertices:number[]=[];
  indices:number[]=[];
}
/**
 * @componentCategory Mundo
 * @componentDescription Terreno heightfield com pincel de altura e relevo salvo na cena.
 * @componentKeywords terreno terrain relevo altura pincel
 */
export class Terrain extends Behavior {
  size:number=32;
  resolution:number=32;
  brushX:number=0;brushZ:number=0;brushRadius:number=4;brushStrength:number=0.5;
  private heights:Float64Array=new Float64Array(1089);
  private mesh:number=0;private window:number=0;private dirty:boolean=true;
  private draw:Float64Array=new Float64Array(DRAW_FLOATS);
  private marker:Float64Array=new Float64Array(3);
  private fallback:Material=new Material();
  constructor(){super();this.fallback.pbr=1;this.fallback.roughness=0.95;}
  typeName():string{return "Terrain";}
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  mount():void{this.updateBounds();}
  private updateBounds():void {
    let max=0;for(let i=0;i<this.heights.length;i++)max=Math.max(max,Math.abs(this.heights[i]));
    if(this.owner!==null)this.owner.boundRadius=Math.sqrt(this.size*this.size/2+max*max);
  }
  heightAt(x:number,z:number):number {
    const n=this.resolution,fx=Math.max(0,Math.min(n,(x/this.size+0.5)*n)),fz=Math.max(0,Math.min(n,(z/this.size+0.5)*n));
    const ix=Math.min(n-1,Math.floor(fx)),iz=Math.min(n-1,Math.floor(fz)),u=fx-ix,v=fz-iz;
    const a=iz*(n+1)+ix,h=this.heights;
    if(u+v<=1)return h[a]+(h[a+1]-h[a])*u+(h[a+n+1]-h[a])*v;
    return h[a+n+2]+(h[a+n+1]-h[a+n+2])*(1-u)+(h[a+1]-h[a+n+2])*(1-v);
  }
  brush(x:number,z:number,radius:number,amount:number):void {
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||!Number.isFinite(amount)||radius<=0)return;
    const n=this.resolution;
    for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
      const dx=(col/n-0.5)*this.size-x,dz=(row/n-0.5)*this.size-z,d=Math.sqrt(dx*dx+dz*dz)/radius;
      if(d<1){const t=1-d,weight=t*t*(3-2*t),i=row*(n+1)+col;this.heights[i]=Math.max(-1000,Math.min(1000,this.heights[i]+amount*weight));}
    }
    this.dirty=true;this.updateBounds();
  }
  flatten():void {this.heights.fill(0);this.dirty=true;this.updateBounds();}
  applyHeightmap(values:Float64Array):void {
    if(values.length!==this.heights.length)throw new Error("Heightmap com tamanho incorreto");
    for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])||Math.abs(values[i])>1000)throw new Error("Altura invalida");
    this.heights.set(values);this.dirty=true;this.updateBounds();
  }
  buildMesh():TerrainMesh {
    const out=new TerrainMesh(),n=this.resolution,step=this.size/n;
    for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
      const left=Math.max(0,col-1),right=Math.min(n,col+1),top=Math.max(0,row-1),bottom=Math.min(n,row+1);
      const dx=(this.heights[row*(n+1)+right]-this.heights[row*(n+1)+left])/((right-left)*step);
      const dz=(this.heights[bottom*(n+1)+col]-this.heights[top*(n+1)+col])/((bottom-top)*step);
      const len=Math.sqrt(dx*dx+1+dz*dz);
      out.vertices.push((col/n-0.5)*this.size,this.heights[row*(n+1)+col],(row/n-0.5)*this.size,-dx/len,1/len,-dz/len,col/n,row/n);
      if(row<n&&col<n){const a=row*(n+1)+col;out.indices.push(a,a+n+1,a+1,a+1,a+n+1,a+n+2);}
    }
    return out;
  }
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    if(this.mesh===0||this.window!==win||this.dirty){
      const data=this.buildMesh();
      const fresh=meshUpload(win,new Float32Array(data.vertices),new Uint32Array(data.indices));
      if(fresh<=0)return 0;
      if(this.mesh>0&&this.window===win)meshFree(win,this.mesh);
      this.mesh=fresh;this.window=win;this.dirty=false;
    }
    let material=this.fallback;
    if(this.owner!==null&&this.owner.matIdx>=0){const m=this.owner.behaviors[this.owner.matIdx];if(m instanceof Material)material=m;}
    const d=this.draw;d[D_X]=pos[0];d[D_Y]=pos[1];d[D_Z]=pos[2];d[D_RX]=this.host.wrx;d[D_RY]=this.host.wry;
    d[D_SX]=this.host.sx;d[D_SY]=this.host.sy;d[D_SZ]=this.host.sz;
    d[D_COR]=tint>=0?tint:0x8a9d70;d[D_MATERIAL]=material.pbr!==0?resolvePbrMaterial(win,material):0;
    d[D_TEX]=resolveMaterialTexture(win,material);d[D_TILE]=material.tile;d[D_EMISSIVO]=material.emissive;
    drawGPUMeshBuf(win,this.mesh,d);return 1;
  }
  fieldCount():number{return 6;}
  fieldType(i:number):string{return "number";}
  fieldLabel(i:number):string{return i===0?"Tamanho":i===1?"Resolucao":i===2?"Pincel X":i===3?"Pincel Z":i===4?"Raio":"Forca";}
  fieldName(i:number):string{return this.fieldLabel(i);}
  fieldGet(i:number):number{return i===0?this.size:i===1?this.resolution:i===2?this.brushX:i===3?this.brushZ:i===4?this.brushRadius:this.brushStrength;}
  fieldSet(i:number,v:number):void {
    if(!Number.isFinite(v))return;
    if(i===0){this.size=Math.max(1,Math.min(2048,v));this.dirty=true;this.updateBounds();}
    else if(i===1){
      const count=Math.max(8,Math.min(128,Math.floor(v))),next=new Float64Array((count+1)*(count+1));
      for(let row=0;row<=count;row++)for(let col=0;col<=count;col++)next[row*(count+1)+col]=this.heightAt((col/count-0.5)*this.size,(row/count-0.5)*this.size);
      this.resolution=count;this.heights=next;this.dirty=true;this.updateBounds();
    }else if(i===2)this.brushX=v;else if(i===3)this.brushZ=v;else if(i===4)this.brushRadius=Math.max(0.1,Math.min(2048,v));else if(i===5)this.brushStrength=Math.max(0.01,Math.min(100,v));
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.label("Heightfield local XZ / sem collider automatico");
    for(let i=0;i<this.fieldCount();i++)ui.field(this.fieldName(i));
    if(ui.button("Elevar relevo")){ui.alterar();this.brush(this.brushX,this.brushZ,this.brushRadius,this.brushStrength);}
    if(ui.button("Rebaixar relevo")){ui.alterar();this.brush(this.brushX,this.brushZ,this.brushRadius,-this.brushStrength);}
    if(ui.button("Aplainar tudo")){ui.alterar();this.flatten();}
  }
  onDrawGizmosSelected(g:Gizmos):void {
    const sy=Math.sin(this.host.wry),cy=Math.cos(this.host.wry),x=this.brushX*this.host.sx,z=this.brushZ*this.host.sz;
    this.marker[0]=this.host.wx+x*cy+z*sy;this.marker[1]=this.host.wy+this.heightAt(this.brushX,this.brushZ)*this.host.sy;
    this.marker[2]=this.host.wz+z*cy-x*sy;g.color(0x55dd88);g.wireSphere(this.marker,this.brushRadius*Math.max(this.host.sx,this.host.sz));
  }
  toData():any {
    const values:number[]=[];for(let i=0;i<this.heights.length;i++)values.push(this.heights[i]);
    return {type:"terrain",size:this.size,resolution:this.resolution,heights:values};
  }
  static fromData(data:any):Terrain {
    if(!Number.isFinite(data.size)||data.size<1||data.size>2048||!Number.isInteger(data.resolution)||data.resolution<8||data.resolution>128)throw new Error("Dimensoes de terreno invalidas");
    const count=(data.resolution+1)*(data.resolution+1);
    if(!Array.isArray(data.heights)||data.heights.length!==count)throw new Error("Heightmap invalido");
    const result=new Terrain();result.size=data.size;result.resolution=data.resolution;result.heights=new Float64Array(count);
    for(let i=0;i<count;i++){const h=data.heights[i];if(!Number.isFinite(h)||Math.abs(h)>1000)throw new Error("Altura de terreno invalida");result.heights[i]=h;}
    return result;
  }
}

import { Behavior,KIND_RENDERER } from "./behavior";
import { Spline } from "./spline";
import { WaterSurface } from "./water_surface";
import { Terrain } from "./terrain";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
import { meshUpload,meshFree } from "rts:egui";
import { inFrustumFast } from "../render/gpu3d";
class WaterPatch {
  vertices:number[]=[];indices:number[]=[];mesh:number=0;
  x:number=0;y:number=0;z:number=0;radius:number=0;
}
/**
 * @componentCategory Mundo
 * @componentDescription Rio ou lago definido por Spline, com corrente e escavação de Terrain.
 * @componentKeywords agua water rio lago spline corrente
 */
export class WaterBody extends Behavior {
  terrainObject:string="";
  waveAmplitude:number=.08;
  reflectionStrength:number=.6;
  previewBed:boolean=true;
  private curve:Spline|null=null;
  private revision:number=-1;
  private closed:boolean=false;
  private samples:Float64Array=new Float64Array(0);
  private surface:WaterSurface=new WaterSurface();
  private vertices:number[]=[];
  private indices:number[]=[];
  private patches:WaterPatch[]=[];
  private window:number=0;
  private radius:number=1;
  private message:string="Adicione Spline ao mesmo objeto.";
  private editStatus:string="";
  private a:Float64Array=new Float64Array(6);
  private b:Float64Array=new Float64Array(6);
  private query:Float64Array=new Float64Array(4);
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  rBoundRadius():number{return this.radius;}
  error():string{return this.message;}
  mount():void{this.synchronize();}
  onValidate(field:string):void {
    this.waveAmplitude=Number.isFinite(this.waveAmplitude)?Math.max(0,Math.min(2,this.waveAmplitude)):.08;
    this.reflectionStrength=Number.isFinite(this.reflectionStrength)?Math.max(0,Math.min(1,this.reflectionStrength)):.6;
    this.surface.waveAmplitude=this.waveAmplitude;this.surface.reflectionStrength=this.reflectionStrength;
  }
  synchronize():void {
    let curve:Spline|null=null;
    if(this.owner!==null)for(let i=0;i<this.owner.behaviors.length;i++){const b=this.owner.behaviors[i];if(b instanceof Spline&&b.enabled!==0){curve=b;break;}}
    if(curve!==this.curve){this.curve=curve;this.revision=-1;}
    if(curve===null){this.message="Adicione Spline ao mesmo objeto.";return;}
    if(this.revision!==curve.revision()||this.closed!==curve.closed)this.rebuild();
  }
  private rebuild():void {
    const c=this.curve;if(c===null)return;this.revision=c.revision();this.closed=c.closed;this.vertices=[];this.indices=[];this.message="";
    const steps=Math.min(256,(c.closed?c.count():c.count()-1)*8),count=c.closed?steps:steps+1;
    this.samples=new Float64Array(count*6);this.radius=1;
    for(let i=0;i<count;i++){
      c.sample(i/steps,this.a);
      // Lago horizontal: nível definido pelo primeiro ponto, independente da seleção.
      if(c.closed){c.point(0,this.b);this.a[1]=this.b[1];}
      for(let j=0;j<6;j++)this.samples[i*6+j]=this.a[j];
      this.radius=Math.max(this.radius,Math.sqrt(this.a[0]*this.a[0]+this.a[1]*this.a[1]+this.a[2]*this.a[2])+this.a[3]);
    }
    if(c.closed)this.buildLake();else this.buildRiver();
    this.splitPatches();this.onValidate("");if(this.owner!==null)this.owner.boundRadius=this.radius;
  }
  private splitPatches():void {
    for(let i=0;i<this.patches.length;i++)if(this.patches[i].mesh>0)meshFree(this.window,this.patches[i].mesh);
    this.patches=[];const keys:string[]=[];
    for(let i=0;i<this.indices.length;i+=3){
      const a=this.indices[i]*8,b=this.indices[i+1]*8,c=this.indices[i+2]*8,v=this.vertices;
      const key=Math.floor((v[a]+v[b]+v[c])/96)+":"+Math.floor((v[a+2]+v[b+2]+v[c+2])/96);
      let index=keys.indexOf(key);if(index<0){index=keys.length;keys.push(key);this.patches.push(new WaterPatch());}
      const p=this.patches[index];
      for(let j=0;j<3;j++){const base=this.indices[i+j]*8;p.indices.push(p.vertices.length/8);for(let k=0;k<8;k++)p.vertices.push(v[base+k]);}
    }
    for(let i=0;i<this.patches.length;i++){
      const p=this.patches[i],v=p.vertices;let minX=1e30,minY=1e30,minZ=1e30,maxX=-1e30,maxY=-1e30,maxZ=-1e30;
      for(let j=0;j<v.length;j+=8){minX=Math.min(minX,v[j]);minY=Math.min(minY,v[j+1]);minZ=Math.min(minZ,v[j+2]);maxX=Math.max(maxX,v[j]);maxY=Math.max(maxY,v[j+1]);maxZ=Math.max(maxZ,v[j+2]);}
      p.x=(minX+maxX)*.5;p.y=(minY+maxY)*.5;p.z=(minZ+maxZ)*.5;p.radius=Math.sqrt((maxX-minX)**2+(maxY-minY)**2+(maxZ-minZ)**2)*.5+3;
    }
    this.vertices=[];this.indices=[];
  }
  private vertex(x:number,y:number,z:number):number {
    const i=this.vertices.length/8;this.vertices.push(x,y,z,0,0,0,0,0);return i;
  }
  private buildRiver():void {
    const s=this.samples,n=s.length/6;
    for(let i=0;i<n;i++){
      const k=i*6,prev=Math.max(0,i-1)*6,next=Math.min(n-1,i+1)*6,dx=s[next]-s[prev],dz=s[next+2]-s[prev+2],len=Math.sqrt(dx*dx+dz*dz);
      if(len<.00001){this.message="Rio com pontos coincidentes.";this.vertices=[];this.indices=[];return;}
      for(let j=0;j<=8;j++){
        const offset=(j/8-.5)*s[k+3],v=this.vertex(s[k]-dz/len*offset,s[k+1],s[k+2]+dx/len*offset)*8;
        this.vertices[v+3]=dx/len*s[k+5];this.vertices[v+5]=dz/len*s[k+5];
        if(i>0&&j<8){const a=i*9+j,b=a-9;this.indices.push(a,b,a+1,a+1,b,b+1);}
      }
    }
  }
  private cross(a:number,b:number,c:number):number {
    const s=this.samples;return (s[b*6]-s[a*6])*(s[c*6+2]-s[a*6+2])-(s[b*6+2]-s[a*6+2])*(s[c*6]-s[a*6]);
  }
  private buildLake():void {
    const n=this.samples.length/6,s=this.samples;
    if(n<3){this.message="Lago precisa de tres pontos.";return;}
    // Interseções próprias tornam o contorno ambíguo: recusa em vez de preencher errado.
    for(let a=0;a<n;a++)for(let b=a+2;b<n;b++){
      const an=(a+1)%n,bn=(b+1)%n;if(bn===a)continue;
      if(this.cross(a,an,b)*this.cross(a,an,bn)<0&&this.cross(b,bn,a)*this.cross(b,bn,an)<0){this.message="Contorno do lago cruza a si mesmo.";return;}
    }
    let area=0;const left:number[]=[];
    for(let i=0;i<n;i++){const j=(i+1)%n;area+=s[i*6]*s[j*6+2]-s[j*6]*s[i*6+2];left.push(i);this.vertex(s[i*6],s[i*6+1],s[i*6+2]);}
    if(Math.abs(area)<.00001){this.message="Lago sem area.";this.vertices=[];return;}
    const sign=area>0?1:-1;
    while(left.length>2){
      let found=false;
      for(let i=0;i<left.length;i++){
        const a=left[(i+left.length-1)%left.length],b=left[i],c=left[(i+1)%left.length];if(this.cross(a,b,c)*sign<=.000001)continue;
        let inside=false;
        for(let j=0;j<left.length;j++){const p=left[j];if(p===a||p===b||p===c)continue;if(this.cross(a,b,p)*sign>=0&&this.cross(b,c,p)*sign>=0&&this.cross(c,a,p)*sign>=0){inside=true;break;}}
        if(inside)continue;this.indices.push(a,b,c);left.splice(i,1);found=true;break;
      }
      if(!found){this.message="Contorno degenerado: ajuste os pontos.";this.vertices=[];this.indices=[];return;}
    }
    // Subdivide a malha uma vez na edição para as ondas deslocarem também o interior.
    for(let pass=0;pass<3;pass++){
      const old=this.indices;this.indices=[];
      for(let i=0;i<old.length;i+=3){const a=old[i],b=old[i+1],c=old[i+2],ab=this.midpoint(a,b),bc=this.midpoint(b,c),ca=this.midpoint(c,a);this.indices.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);}
    }
  }
  private midpoint(a:number,b:number):number {const v=this.vertices;return this.vertex((v[a*8]+v[b*8])*.5,(v[a*8+1]+v[b*8+1])*.5,(v[a*8+2]+v[b*8+2])*.5);}
  /** Resultado: nível sem ondas, profundidade, velocidade X/Z. Sem água: false. */
  sample(x:number,z:number,out:Float64Array):boolean {
    if(this.curve===null||this.curve.enabled===0||this.message!==""||this.enabled===0)return false;
    x-=this.host.wx;z-=this.host.wz;const s=this.samples,n=s.length/6;
    if(this.closed){
      let inside=false;
      for(let i=0,j=n-1;i<n;j=i++){const a=i*6,b=j*6;if((s[a+2]>z)!==(s[b+2]>z)&&x<(s[b]-s[a])*(z-s[a+2])/(s[b+2]-s[a+2])+s[a])inside=!inside;}
      if(!inside)return false;out[0]=s[1]+this.host.wy;out[1]=s[4];out[2]=0;out[3]=0;return true;
    }
    let best=1e30,chosen=-1,f=0;
    for(let i=0;i<n-1;i++){
      const a=i*6,b=a+6,dx=s[b]-s[a],dz=s[b+2]-s[a+2],len=dx*dx+dz*dz;if(len<.000001)continue;
      const u=Math.max(0,Math.min(1,((x-s[a])*dx+(z-s[a+2])*dz)/len)),ex=x-s[a]-dx*u,ez=z-s[a+2]-dz*u,d=ex*ex+ez*ez;
      if(d<best){best=d;chosen=i;f=u;}
    }
    if(chosen<0)return false;
    const a=chosen*6,b=a+6,width=s[a+3]+(s[b+3]-s[a+3])*f;
    if(best>width*width*.25)return false;
    const dx=s[b]-s[a],dz=s[b+2]-s[a+2],len=Math.sqrt(dx*dx+dz*dz),speed=s[a+5]+(s[b+5]-s[a+5])*f;
    // As extremidades são abertas; não estende corrente além das tampas.
    if((chosen===0&&f===0&&((x-s[a])*dx+(z-s[a+2])*dz)<0)||(chosen===n-2&&f===1&&((x-s[b])*dx+(z-s[b+2])*dz)>0))return false;
    out[0]=s[a+1]+(s[b+1]-s[a+1])*f+this.host.wy;out[1]=s[a+4]+(s[b+4]-s[a+4])*f;out[2]=dx/len*speed;out[3]=dz/len*speed;return true;
  }
  waterHeightAt(x:number,z:number):number{return this.sample(x,z,this.query)?this.query[0]+this.surface.heightAt(x,z):NaN;}
  update(dt:number):void{this.synchronize();this.surface.update(dt);}
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    this.synchronize();if(this.curve===null||this.message!==""||this.enabled===0)return 1;
    if(this.window!==win){for(let i=0;i<this.patches.length;i++){const p=this.patches[i];if(p.mesh>0)meshFree(this.window,p.mesh);p.mesh=0;}this.window=win;}
    let uploaded=false;
    for(let i=0;i<this.patches.length;i++){
      const p=this.patches[i];if(!inFrustumFast(pos[0]+p.x,pos[1]+p.y,pos[2]+p.z,p.radius))continue;
      if(p.mesh===0){if(uploaded)continue;p.mesh=meshUpload(win,new Float32Array(p.vertices),new Uint32Array(p.indices));uploaded=true;if(p.mesh<=0)continue;}
      this.surface.setSurfaceMesh(p.mesh);this.surface.drawSelf(win,pos,tint);
    }
    return 1;
  }
  carveTerrain():boolean {
    this.synchronize();if(this.owner===null||this.owner.uiOwner===null||this.terrainObject===""||this.message!=="")return false;
    const objects=this.owner.uiOwner.objects;
    for(let i=0;i<objects.length;i++){
      const go=objects[i];if(go.name!==this.terrainObject)continue;const t=go.transform;
      if(t.wrx!==0||t.wry!==0||t.rz!==0||t.sx!==1||t.sy!==1||t.sz!==1)return false;
      for(let j=0;j<go.behaviors.length;j++){const terrain=go.behaviors[j];if(!(terrain instanceof Terrain))continue;
        const n=terrain.resolution,values=new Float64Array((n+1)*(n+1));
        for(let row=0;row<=n;row++)for(let col=0;col<=n;col++){
          const x=(col/n-.5)*terrain.size,z=(row/n-.5)*terrain.size,k=row*(n+1)+col,h=terrain.heightAt(x,z);
          values[k]=this.sample(x+t.wx,z+t.wz,this.query)?Math.min(h,this.query[0]-this.query[1]-t.wy):h;
        }
        terrain.applyHeightmap(values);return true;
      }
    }
    return false;
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.label("Spline aberta: rio / fechada: lago");ui.label("Use translacao; rotacao zero e escala 1.");
    ui.field("waveAmplitude");ui.field("reflectionStrength");ui.field("terrainObject");ui.field("previewBed");
    if(ui.button("Escavar Terrain (Desfazer disponivel)")){ui.alterar();this.editStatus=this.carveTerrain()?"Leito aplicado. Use Desfazer para restaurar.":"Terrain nao encontrado ou transform incompativel.";}
    if(this.message!=="")ui.label(this.message);
    if(this.editStatus!=="")ui.label(this.editStatus);
  }
  onDrawGizmosSelected(g:Gizmos):void {
    if(!this.previewBed)return;const s=this.samples,n=s.length/6;g.color(0xddaa55);
    for(let i=0;i<n;i++){
      const k=i*6;this.a[0]=s[k]+this.host.wx;this.a[1]=s[k+1]+this.host.wy;this.a[2]=s[k+2]+this.host.wz;
      for(let j=0;j<3;j++)this.b[j]=this.a[j];this.b[1]-=s[k+4];if(i%8===0)g.line(this.a,this.b);
    }
  }
  releaseResources():void{for(let i=0;i<this.patches.length;i++){const p=this.patches[i];if(p.mesh>0)meshFree(this.window,p.mesh);p.mesh=0;}this.window=0;this.surface.releaseResources();}
}

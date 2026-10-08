import { Behavior,KIND_RENDERER } from "./behavior";
import { Terrain } from "./terrain";
import { WaterSurface } from "./water_surface";
import { HeightfieldWater } from "../water/heightfield_water";
import { deferResourceDisposal } from "./resources";
import { meshUpload,meshFree } from "rts:egui";
import type { Gizmos } from "./gizmos";
import type { InspectorUI } from "./inspector_ui";
/**
 * @componentCategory Mundo
 * @componentDescription Água por volume sobre Terrain, com fonte, enchimento e snapshot congelável.
 * @componentKeywords agua rio lago fonte simulacao volume snapshot
 */
export class AdaptiveWater extends Behavior {
  terrainObject:string="Terrain";
  size:number=32;
  resolution:number=8;
  sourceX:number=0;
  sourceZ:number=0;
  sourceRate:number=2;
  dynamic:boolean=true;
  waveAmplitude:number=.025;
  /** @hideInInspector */
  bakedState:string="";
  private simulation:HeightfieldWater|null=null;
  private surface:WaterSurface=new WaterSurface();
  private attempted:boolean=false;
  private message:string="";
  private accumulator:number=0;
  private meshElapsed:number=0;
  private dirty:boolean=true;
  private mesh:number=0;
  private window:number=0;
  private vertices:Float32Array=new Float32Array(0);
  private indices:Uint32Array=new Uint32Array(0);
  private query:Float64Array=new Float64Array(4);
  private radius:number=32;
  private marker:Float64Array=new Float64Array(3);
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  rBoundRadius():number{return this.radius;}
  error():string{return this.message;}
  volume():number{return this.simulation===null?0:this.simulation.volume();}
  onValidate(field:string):void {
    this.size=Number.isFinite(this.size)?Math.max(1,Math.min(512,this.size)):32;
    this.resolution=Number.isFinite(this.resolution)?Math.max(4,Math.min(32,Math.floor(this.resolution))):8;
    this.size=Math.max(this.size,this.resolution*.1);
    this.sourceRate=Number.isFinite(this.sourceRate)?Math.max(0,Math.min(1000,this.sourceRate)):2;
    this.sourceX=Number.isFinite(this.sourceX)?this.sourceX:0;this.sourceZ=Number.isFinite(this.sourceZ)?this.sourceZ:0;
    this.waveAmplitude=Number.isFinite(this.waveAmplitude)?Math.max(0,Math.min(.2,this.waveAmplitude)):.025;
    if(field==="size"||field==="resolution"||field==="terrainObject"||field==="bakedState"){this.releaseResources();this.attempted=false;}
  }
  private prepare():void {
    if(this.attempted)return;this.attempted=true;
    try{this.initialize();this.message="";}catch(e){this.message="Agua: "+String(e);this.simulation=null;}
  }
  /** Amostra o leito uma vez. Após esculpir, use Reiniciar para invalidar o cache. */
  private initialize():void {
    this.onValidate("");const owner=this.owner;
    if(owner===null||owner.uiOwner===null)throw new Error("Adicione a agua a uma cena.");
    const h=this.host;
    if(h.wrx!==0||h.wry!==0||h.rz!==0||h.sx!==1||h.sy!==1||h.sz!==1)throw new Error("Use translacao, rotacao zero e escala 1.");
    let terrain:Terrain|null=null;
    const objects=owner.uiOwner.objects;
    for(let i=0;i<objects.length;i++)if(objects[i].name===this.terrainObject)for(let j=0;j<objects[i].behaviors.length;j++){
      const b=objects[i].behaviors[j];if(b instanceof Terrain&&b.enabled!==0)terrain=b;
    }
    if(terrain===null)throw new Error("Terrain nao encontrado.");
    const t=terrain.host,n=this.resolution,cell=this.size/n;
    if(t.wrx!==0||t.wry!==0||t.rz!==0||t.sx!==1||t.sy!==1||t.sz!==1)throw new Error("Terrain requer rotacao zero e escala 1.");
    if(Math.abs(h.wx-t.wx)+this.size*.5>terrain.size*.5+.00001||Math.abs(h.wz-t.wz)+this.size*.5>terrain.size*.5+.00001)throw new Error("Grade fora do Terrain.");
    const bed=new Float64Array(n*n);
    for(let row=0;row<n;row++)for(let col=0;col<n;col++)bed[row*n+col]=terrain.heightAt(h.wx-t.wx+(col+.5)*cell-this.size*.5,h.wz-t.wz+(row+.5)*cell-this.size*.5)+t.wy-h.wy;
    const sim=new HeightfieldWater(n,cell,bed);
    if(this.bakedState!=="")sim.restore(this.bakedState);
    this.simulation=sim;this.vertices=new Float32Array(n*n*32);this.indices=new Uint32Array(n*n*6);
    this.dirty=true;this.accumulator=0;this.meshElapsed=0;this.updateBounds();
  }
  private updateBounds():void {
    const s=this.simulation;if(s===null)return;let height=0;
    for(let i=0;i<s.depth.length;i++)height=Math.max(height,Math.abs(s.bed[i]+s.depth[i]));
    this.radius=Math.sqrt(this.size*this.size*.5+height*height)+1;
    if(this.owner!==null)this.owner.boundRadius=this.radius;
  }
  resetSimulation():void {this.bakedState="";this.releaseResources();this.attempted=false;this.prepare();}
  /** Captura a forma atual na cena; congelar mantém as ondas visuais. */
  bake():boolean {
    this.prepare();if(this.simulation===null)return false;
    this.bakedState=this.simulation.snapshot();this.dynamic=false;this.accumulator=0;this.dirty=true;return true;
  }
  private tick():void {
    const s=this.simulation;if(s===null)return;
    const col=Math.floor((this.sourceX/this.size+.5)*s.resolution),row=Math.floor((this.sourceZ/this.size+.5)*s.resolution);
    this.message=s.addVolume(col,row,this.sourceRate*.05)?"":"Fonte fora da grade ou capacidade excedida.";s.step(.05);
  }
  /** Prévia explícita, limitada a um segundo por comando (não roda no Inspector). */
  previewSecond():void {this.prepare();if(this.simulation===null)return;for(let i=0;i<20;i++)this.tick();this.dirty=true;this.updateBounds();}
  update(dt:number):void {
    if(this.enabled===0||!Number.isFinite(dt)||dt<=0)return;
    if(!this.attempted)this.prepare();this.surface.update(dt);
    if(!this.dynamic||this.simulation===null)return;
    // Máximo de um passo por quadro; descarta atraso para não entrar em espiral.
    this.accumulator=Math.min(.1,this.accumulator+dt);this.meshElapsed+=Math.min(dt,.1);
    if(this.accumulator>=.05){this.tick();this.accumulator-=.05;if(this.accumulator>=.05)this.accumulator%=.05;}
    if(this.meshElapsed>=.2){this.meshElapsed=0;this.dirty=true;this.updateBounds();}
  }
  sample(x:number,z:number,out:Float64Array):boolean {
    const s=this.simulation;if(s===null||this.enabled===0||!Number.isFinite(x)||!Number.isFinite(z))return false;
    const col=Math.floor(((x-this.host.wx)/this.size+.5)*s.resolution),row=Math.floor(((z-this.host.wz)/this.size+.5)*s.resolution);
    if(col<0||row<0||col>=s.resolution||row>=s.resolution)return false;
    const i=row*s.resolution+col;if(s.depth[i]<=.001)return false;
    out[0]=this.host.wy+s.bed[i]+s.depth[i];out[1]=s.depth[i];out[2]=s.velocityX[i];out[3]=s.velocityZ[i];return true;
  }
  waterHeightAt(x:number,z:number):number{return this.sample(x,z,this.query)?this.query[0]:NaN;}
  private buildSurface():void {
    const s=this.simulation;if(s===null)return;
    const n=s.resolution,c=s.cellSize,v=this.vertices,ix=this.indices;
    for(let row=0;row<n;row++)for(let col=0;col<n;col++){
      const i=row*n+col,k=i*32,a=i*4,x=col*c-this.size*.5,z=row*c-this.size*.5,y=s.bed[i]+s.depth[i];
      for(let corner=0;corner<4;corner++){
        const b=k+corner*8;v[b]=x+(corner%2)*c;v[b+1]=y;v[b+2]=z+(corner>=2?c:0);
        v[b+3]=s.velocityX[i];v[b+4]=0;v[b+5]=s.velocityZ[i];v[b+6]=0;v[b+7]=0;
      }
      // Células secas usam triângulos degenerados; nenhum array temporário.
      const wet=s.depth[i]>.001,b=i*6;ix[b]=a;ix[b+1]=wet?a+2:a;ix[b+2]=wet?a+1:a;
      ix[b+3]=wet?a+1:a;ix[b+4]=wet?a+2:a;ix[b+5]=wet?a+3:a;
    }
  }
  private discardMesh():void {
    if(this.mesh<=0)return;const win=this.window,id=this.mesh;deferResourceDisposal(win,()=>{meshFree(win,id);});this.mesh=0;
  }
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    if(this.enabled===0)return 1;if(!this.attempted)this.prepare();if(this.simulation===null)return 1;
    if(this.window!==win){this.discardMesh();this.window=win;this.dirty=true;}
    if(this.dirty){this.buildSurface();const fresh=meshUpload(win,this.vertices,this.indices);if(fresh>0){this.discardMesh();this.mesh=fresh;this.dirty=false;}}
    if(this.mesh>0){this.surface.waveAmplitude=this.waveAmplitude;this.surface.setSurfaceMesh(this.mesh);this.surface.drawSelf(win,pos,tint);}return 1;
  }
  onDrawGizmosSelected(g:Gizmos):void {
    if(!this.attempted)this.prepare();const s=this.simulation;if(s===null)return;
    const col=Math.floor((this.sourceX/this.size+.5)*s.resolution),row=Math.floor((this.sourceZ/this.size+.5)*s.resolution);
    if(col<0||row<0||col>=s.resolution||row>=s.resolution)return;
    this.marker[0]=this.host.wx+this.sourceX;this.marker[1]=this.host.wy+s.bed[row*s.resolution+col]+.4;this.marker[2]=this.host.wz+this.sourceZ;
    g.color(0x44ccff);g.wireSphere(this.marker,.4);
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.label("Grade de volume / bordas fechadas / fonte XZ local");
    ui.field("terrainObject");ui.field("size");ui.field("resolution");ui.field("sourceX");ui.field("sourceZ");ui.field("sourceRate");ui.field("dynamic");ui.field("waveAmplitude");
    ui.label("Vazao em m3/s. Leito amostrado ao iniciar.");
    if(ui.button("Simular 1 segundo")){ui.alterar();this.previewSecond();if(this.simulation!==null)this.bakedState=this.simulation.snapshot();}
    if(ui.button("Guardar snapshot e congelar")){ui.alterar();this.bake();}
    if(ui.button("Reiniciar e reler Terrain")){ui.alterar();this.resetSimulation();}
    if(this.message!=="")ui.label(this.message);
  }
  releaseResources():void {this.discardMesh();this.simulation=null;this.vertices=new Float32Array(0);this.indices=new Uint32Array(0);this.accumulator=0;this.meshElapsed=0;this.surface.releaseResources();this.attempted=false;}
}

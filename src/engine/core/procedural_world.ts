import { Behavior,KIND_RENDERER } from "./behavior";
import { WorldStream } from "../render/world_stream_render";
import { WorldGenerationProfile } from "./world_generation";
import { WorldBiomeField } from "./world_biomes";
import { FpsWorldField } from "./world_streaming";
import { VegetationMask } from "./vegetation_mask";
import { frustumParams,frustumNear,frustumFar } from "../render/gpu3d";
import type { InspectorUI } from "./inspector_ui";
import type { Gizmos } from "./gizmos";
import { activeInScene } from "./gameobject";

/**
 * @componentCategory Mundo
 * @componentDescription Mundo procedural com streaming, LOD e máscara de vegetação salva na cena.
 * @componentKeywords terrain mundo procedural chunks vegetação árvores mato pincel
 */
export class ProceduralWorld extends Behavior {
  seed:number=42;
  generator:string="heightfield";
  generatorSettings:string="{}";
  biomes:boolean=false;biomeScale:number=512;heightScale:number=28;caves:boolean=true;
  chunkRadius:number=2;
  memoryMiB:number=128;
  treeDensity:number=1;
  grassDensity:number=.65;
  maxSlope:number=35;
  brushX:number=0;brushZ:number=0;brushRadius:number=24;brushStrength:number=1;
  /** @hideInInspector */
  vegetationMask:string="";
  private world:WorldStream|null=null;
  private window:number=0;
  private field:FpsWorldField=new FpsWorldField(42);
  private frustum:number[]=[0,0,0,0,0,0,0,0,0];
  private camera:Float64Array=new Float64Array(11);
  private marker:Float64Array=new Float64Array(3);
  private message:string="A geração começa quando o objeto é desenhado.";
  private failed:boolean=false;private lastChunks:number=-1;
  typeName():string{return "ProceduralWorld";}
  kind():number{return KIND_RENDERER;}
  drawsSelf():number{return 1;}
  rBoundRadius():number{return 100000000;}
  mount():void{this.onValidate("");}
  onValidate(field:string):void {
    this.seed=Number.isFinite(this.seed)?Math.floor(this.seed)>>>0:42;
    this.biomeScale=this.limit(this.biomeScale,64,8192,512);
    this.heightScale=this.limit(this.heightScale,1,48,28);
    this.chunkRadius=this.limit(this.chunkRadius,1,4,2)|0;
    this.memoryMiB=this.limit(this.memoryMiB,16,512,128);
    this.treeDensity=this.limit(this.treeDensity,0,1,1);
    this.grassDensity=this.limit(this.grassDensity,0,1,.65);
    this.maxSlope=this.limit(this.maxSlope,0,89,35);
    this.brushX=this.limit(this.brushX,-10000000,10000000,0);
    this.brushZ=this.limit(this.brushZ,-10000000,10000000,0);
    this.brushRadius=this.limit(this.brushRadius,.1,2048,24);
    this.brushStrength=this.limit(this.brushStrength,0,1,1);
    if(field.indexOf("brush")!==0)this.regenerate();
  }
  private limit(value:number,min:number,max:number,fallback:number):number{return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;}
  regenerate():void {
    this.releaseResources();this.failed=false;this.lastChunks=-1;
    this.field=this.biomes||this.generator==="voxel"?new WorldBiomeField(this.seed,this.biomeScale,this.heightScale):new FpsWorldField(this.seed);this.message="Preparando mundo em background...";
  }
  releaseResources():void {
    if(this.world!==null)this.world.dispose();this.world=null;this.window=0;
  }
  isReady():boolean{return this.world!==null&&this.world.ready;}
  resourceBytes():number{return this.world===null?0:this.world.budget.bytes;}
  loadError():string{return this.failed?this.message:this.world===null?"":this.world.error;}
  private initialize(win:number):void {
    try{
      this.onValidate("");
      new VegetationMask(this.vegetationMask);
      const profile=new WorldGenerationProfile();profile.generator=this.generator;profile.biomes=this.biomes;profile.biomeScale=this.biomeScale;profile.heightScale=this.heightScale;profile.caves=this.caves;
      if(this.generatorSettings.length>65536)throw new Error("Configuração da extensão muito grande");
      profile.options=JSON.parse(this.generatorSettings);
      this.world=new WorldStream(win,this.seed,this.chunkRadius,profile);this.window=win;
      this.world.budget.maxBytes=this.memoryMiB*1024*1024;
      this.world.vegetation={trees:this.treeDensity,grass:this.grassDensity,slope:this.maxSlope,mask:this.vegetationMask};
    }catch(error){this.releaseResources();this.failed=true;this.message=String(error);}
  }
  drawSelf(win:number,pos:Float64Array,tint:number):number {
    if(this.enabled===0){this.releaseResources();return 1;}
    if(this.owner!==null&&this.owner.uiOwner!==null&&!activeInScene(this.owner.uiOwner.objects,this.owner)){this.releaseResources();return 1;}
    if(this.host.wrx!==0||this.host.wry!==0||this.host.sx!==1||this.host.sy!==1||this.host.sz!==1){
      this.releaseResources();this.message="Use escala 1 e rotação 0 no mundo procedural.";return 1;
    }
    if(this.failed)return 1;
    if(this.window!==0&&this.window!==win)this.releaseResources();
    if(this.world===null)this.initialize(win);
    const world=this.world;if(world===null)return 1;
    const f=this.frustum;frustumParams(f);
    world.move(f[0]-pos[0],f[2]-pos[2]);world.tick();world.offsetY=pos[1];
    if(f[7]>0&&f[8]>0){
      const c=this.camera;c[0]=f[0];c[1]=f[1];c[2]=f[2];c[3]=Math.atan2(f[4],f[3]);c[4]=Math.atan2(f[6],f[5]);
      c[5]=2*Math.atan(f[8]);c[6]=f[7]/f[8];c[7]=frustumNear();c[8]=frustumFar();c[9]=0;c[10]=5;
      world.draw(-pos[0],-pos[2],c);
    }else world.draw(-pos[0],-pos[2]);
    if(world.error.length>0)this.message=world.error;
    else if(world.chunks.length!==this.lastChunks){this.lastChunks=world.chunks.length;this.message="Chunks ativos: "+this.lastChunks+" / "+world.window.x.length;}
    return 1;
  }
  paintVegetation(amount:number):void {
    const mask=new VegetationMask(this.vegetationMask);
    mask.paint(this.brushX,this.brushZ,this.brushRadius,amount);
    this.vegetationMask=mask.serialize();this.regenerate();
  }
  onInspectorGUI(ui:InspectorUI):void {
    ui.field("seed");ui.field("chunkRadius");ui.field("memoryMiB");
    ui.field("generator");ui.label("Extensões: heightfield ou voxel");
    if(this.generator!=="heightfield"&&this.generator!=="voxel")ui.field("generatorSettings");
    ui.field("biomes");ui.field("biomeScale");ui.field("heightScale");ui.field("caves");
    ui.label("Cavernas: voxel. No heightfield, ative biomas para usar as escalas.");
    if(this.generator==="voxel"){ui.label("Voxels: blocos e cavernas. Pintura de vegetação não se aplica.");ui.label(this.message);if(ui.button("Regenerar mundo"))this.regenerate();return;}
    ui.field("treeDensity");ui.field("grassDensity");ui.field("maxSlope");
    ui.label("Pincel local XZ: máscara compartilhada por árvores e mato.");
    ui.field("brushX");ui.field("brushZ");ui.field("brushRadius");ui.field("brushStrength");
    if(ui.button("Abrir clareira")){ui.alterar();this.paintVegetation(-this.brushStrength);}
    if(ui.button("Restaurar vegetação")){ui.alterar();this.paintVegetation(this.brushStrength);}
    if(ui.button("Limpar máscara")){ui.alterar();this.vegetationMask="";this.regenerate();}
    if(ui.button("Regenerar mundo"))this.regenerate();
    ui.label(this.message);
    ui.label("Prévia segue a câmera. Sem rotação/escala; translação permitida.");
  }
  onDrawGizmosSelected(g:Gizmos):void {
    this.marker[0]=this.host.wx+this.brushX;this.marker[1]=this.host.wy+this.field.height(this.brushX,this.brushZ);this.marker[2]=this.host.wz+this.brushZ;
    g.color(0x55dd88);g.wireSphere(this.marker,this.brushRadius);
  }
}

import { meshUpload,meshFree,materialFree } from "rts:egui";
import { FpsWorldField,FpsChunkWindow } from "../core/world_streaming";
import { WorldChunkLoader } from "../core/world_chunk_loading";
import { WorldGenerationProfile } from "../core/world_generation";
import { createWorldGeneratorRegistry } from "../core/world_generators";
import { WorldBiomeField } from "../core/world_biomes";
import { FpsChunkCache } from "../core/chunk_cache";
import { FpsResourceBudget } from "../core/resource_budget";
import { fpsChunkLod } from "../core/chunk_lod";
import { FpsWorldCollision } from "../core/world_collision";
import { Material } from "../core/material";
import { WaterSurface } from "../core/water_surface";
import { resolvePbrMaterial } from "./pbr_material";
import { drawGPUMeshBuf,DRAW_FLOATS,frustumBeginBuf,inFrustumFast } from "./gpu3d";

const FPS_WORLD_COLORS=[0x728464,0x81796d,0x343b45,0x9a958a,0xc4ad91,0x9b654d,0x617282,0xffc486,0x354e3c,0x594538,0x477985,0xe7eff2];
export class FpsWorldChunk {
  x:number;z:number;ids:number[]=[];kinds:number[]=[];details:number[]=[];byteSize:number=0;
  lod:number=0;minY:number=0;maxY:number=0;
  colliders:number[]=[];
  private budget:FpsResourceBudget;
  constructor(x:number,z:number,budget:FpsResourceBudget){this.x=x;this.z=z;this.budget=budget;}
  dispose(win:number):void{
    if(this.ids.length===0)return;
    for(let i=0;i<this.ids.length;i++)meshFree(win,this.ids[i]);
    this.budget.release(this.byteSize,this.ids.length);this.byteSize=0;
    this.ids.length=0;this.kinds.length=0;this.details.length=0;
    this.colliders.length=0;
  }
}
/** Bounded resident set. New chunks publish atomically; stale jobs are discarded. */
export class WorldStream {
  waterEnabled:boolean=true;
  water:WaterSurface=new WaterSurface();
  private waterPosition:Float64Array=new Float64Array(3);
  field:FpsWorldField;window:FpsChunkWindow;
  private profile:WorldGenerationProfile;chunkSize:number;
  chunks:FpsWorldChunk[]=[];generated:number=0;unloaded:number=0;maxStepMs:number=0;
  cacheHits:number=0;cache:FpsChunkCache;
  budget:FpsResourceBudget=new FpsResourceBudget(128*1024*1024,4096);
  vegetation:any=null;offsetY:number=0;
  collision:FpsWorldCollision=new FpsWorldCollision();
  error:string="";disposed:boolean=false;visibleChunks:number=0;culledChunks:number=0;drawCalls:number=0;
  private win:number;private job:WorldChunkLoader|null=null;private pending:FpsWorldChunk|null=null;
  private materials:number[]=[];private drawBuffer:Float64Array=new Float64Array(DRAW_FLOATS);
  constructor(win:number,seed:number,radius:number,profile?:WorldGenerationProfile){
    this.profile=WorldGenerationProfile.fromData(profile);
    this.chunkSize=createWorldGeneratorRegistry().chunkSize(this.profile.generator);
    this.water.width=this.chunkSize;this.water.length=this.chunkSize;this.water.wavelength=18;this.water.waveAmplitude=.15;
    this.win=win;this.field=this.profile.biomes||this.profile.generator==="voxel"?new WorldBiomeField(seed,this.profile.biomeScale,this.profile.heightScale):new FpsWorldField(seed);
    this.window=new FpsChunkWindow(radius,this.chunkSize);this.collision=new FpsWorldCollision(this.chunkSize);
    this.cache=new FpsChunkCache(25,32*1024*1024,(chunk:any)=>{chunk.dispose(this.win);this.unloaded++;});
    for(let i=0;i<FPS_WORLD_COLORS.length;i++){
      const m=new Material();m.pbr=1;m.roughness=i===10?.16:i===6?.25:.87;m.metallic=i===6?.45:0;
      if(i===7){m.emissiveR=2;m.emissiveG=.9;m.emissiveB=.25;}
      this.materials.push(resolvePbrMaterial(win,m));
    }
    this.drawBuffer[5]=1;this.drawBuffer[6]=1;this.drawBuffer[7]=1;
  }
  move(x:number,z:number):void {
    if(this.disposed)return;
    if(!this.window.move(x,z))return;
    if(this.job!==null&&!this.window.contains(this.job.x,this.job.z)){this.job.cancel();if(this.pending!==null)this.pending.dispose(this.win);this.pending=null;this.job=null;}
    // Retrieve the destination before inserting departures, so they cannot
    // evict the very region to which the camera is returning.
    const reused:FpsWorldChunk[]=[];
    for(let i=0;i<this.window.x.length;i++){
      const cached=this.cache.take(this.window.x[i],this.window.z[i]);
      if(cached!==null){reused.push(cached);this.cacheHits++;}
    }
    for(let i=this.chunks.length-1;i>=0;i--)if(!this.window.contains(this.chunks[i].x,this.chunks[i].z)){
      const c=this.chunks[i];this.collision.remove(c.x,c.z);this.cache.put(c);this.chunks.splice(i,1);
    }
    for(let i=0;i<reused.length;i++){const c=reused[i];this.chunks.push(c);this.collision.add(c.x,c.z,c.colliders);}
  }
  get ready():boolean{return this.chunks.length===this.window.x.length&&this.window.x.length>0;}
  update(dt:number):void{if(!this.disposed)this.water.update(dt);}
  waterHeightAt(x:number,z:number):number {
    if(this.disposed||!this.waterEnabled||this.profile.generator!=="heightfield")return NaN;
    const cx=Math.floor(x/this.chunkSize),cz=Math.floor(z/this.chunkSize);
    let resident=false;for(let i=0;i<this.chunks.length;i++)if(this.chunks[i].x===cx&&this.chunks[i].z===cz){resident=true;break;}
    if(!resident||this.field.height(x,z)>=0)return NaN;
    return this.water.heightAt(x,z)+this.offsetY;
  }
  get progress():number{return (this.chunks.length+(this.job===null?0:Math.min(.95,this.job.meshes/30)))/Math.max(1,this.window.x.length);}
  private receiveMesh(mesh:any):void {
    if(this.pending===null)return;
    if(mesh.kind==="colliders"){
      if(!Array.isArray(mesh.boxes)||mesh.boxes.length>24576||mesh.boxes.length%6!==0)throw new Error("Invalid chunk colliders");
      for(let i=0;i<mesh.boxes.length;i++)if(!Number.isFinite(mesh.boxes[i]))throw new Error("Invalid collider coordinate");
      this.pending.colliders=mesh.boxes;return;
    }
    if(!Array.isArray(mesh.vertices)||!Array.isArray(mesh.indices)||mesh.vertices.length===0||mesh.vertices.length>6144||mesh.vertices.length%8!==0||mesh.indices.length===0||mesh.indices.length>4608||mesh.indices.length%3!==0||!Number.isInteger(mesh.material)||mesh.material<0||mesh.material>=FPS_WORLD_COLORS.length||!Number.isInteger(mesh.lod)||mesh.lod<0||mesh.lod>2)throw new Error("Invalid chunk mesh packet");
    for(let i=0;i<mesh.vertices.length;i++)if(!Number.isFinite(mesh.vertices[i]))throw new Error("Invalid chunk vertex");
    for(let i=0;i<mesh.indices.length;i++)if(!Number.isInteger(mesh.indices[i])||mesh.indices[i]<0||mesh.indices[i]>=mesh.vertices.length/8)throw new Error("Invalid chunk index");
    const bytes=(mesh.vertices.length+mesh.indices.length)*4;
    while(!this.budget.reserve(bytes)){if(!this.cache.evictOldest())throw new Error("World mesh memory budget exhausted");}
    let id=0;
    try{id=meshUpload(this.win,new Float32Array(mesh.vertices),new Uint32Array(mesh.indices));}
    catch(error){this.budget.release(bytes,1);throw error;}
    if(id===0){this.budget.release(bytes,1);throw new Error("World mesh upload failed");}
    this.pending.ids.push(id);this.pending.kinds.push(mesh.material);
    this.pending.details.push(mesh.lod);this.pending.byteSize+=bytes;
    for(let i=1;i<mesh.vertices.length;i+=8){this.pending.minY=Math.min(this.pending.minY,mesh.vertices[i]);this.pending.maxY=Math.max(this.pending.maxY,mesh.vertices[i]);}
  }
  tick():void {
    if(this.disposed||this.error.length>0||this.ready)return;
    const start=performance.now();
    if(this.job===null){
      for(let i=0;i<this.window.x.length;i++){
        const x=this.window.x[i],z=this.window.z[i];let found=false;
        for(let k=0;k<this.chunks.length;k++)if(this.chunks[k].x===x&&this.chunks[k].z===z){found=true;break;}
        if(!found){
          this.pending=new FpsWorldChunk(x,z,this.budget);
          this.job=new WorldChunkLoader(this.field.seed,x,z,(mesh:any)=>{this.receiveMesh(mesh);});this.job.profile=this.profile;this.job.vegetation=this.vegetation;break;
        }
      }
    }
    if(this.job!==null){
      this.job.tick();
      if(this.job.error.length>0){this.error=this.job.error;this.job.cancel();if(this.pending!==null)this.pending.dispose(this.win);this.pending=null;this.job=null;return;}
      if(this.job.done&&this.pending!==null){const c=this.pending;this.chunks.push(c);this.collision.add(c.x,c.z,c.colliders);this.pending=null;this.job=null;this.generated++;}
    }
    this.maxStepMs=Math.max(this.maxStepMs,performance.now()-start);
  }
  draw(originX:number,originZ:number,camera?:Float64Array):void {
    if(this.disposed)return;
    this.water.setWaveOrigin(originX,originZ);
    this.visibleChunks=0;this.culledChunks=0;this.drawCalls=0;
    if(camera!==undefined)frustumBeginBuf(camera);
    const d=this.drawBuffer;
    d[1]=this.offsetY;
    for(let i=0;i<this.chunks.length;i++){
      const c=this.chunks[i];d[0]=c.x*this.chunkSize-originX;d[2]=c.z*this.chunkSize-originZ;
      if(camera!==undefined){
        const half=(c.maxY-c.minY)/2,radius=Math.sqrt(this.chunkSize*this.chunkSize/2+half*half),center=this.chunkSize/2;
        if(inFrustumFast(d[0]+center,this.offsetY+(c.minY+c.maxY)/2,d[2]+center,radius+24)===0){this.culledChunks++;continue;}
        const dx=d[0]+center-camera[0],dz=d[2]+center-camera[2];c.lod=fpsChunkLod(c.lod,Math.sqrt(dx*dx+dz*dz));
      }
      this.visibleChunks++;
      for(let k=0;k<c.ids.length;k++){
        const detail=c.details[k];if((detail===1&&c.lod===1)||(detail===2&&c.lod===0))continue;
        const kind=c.kinds[k];
        if(kind===10&&this.profile.generator==="heightfield"){
          if(this.waterEnabled&&c.minY<0){const p=this.waterPosition;p[0]=d[0]+this.chunkSize/2;p[1]=this.offsetY;p[2]=d[2]+this.chunkSize/2;this.water.drawSelf(this.win,p,-1);this.drawCalls++;}
          continue;
        }
        d[8]=FPS_WORLD_COLORS[kind];d[16]=this.materials[kind];drawGPUMeshBuf(this.win,c.ids[k],d);
        this.drawCalls++;
      }
    }
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    if(this.job!==null){this.job.cancel();if(this.pending!==null)this.pending.dispose(this.win);this.pending=null;this.job=null;}
    for(let i=0;i<this.chunks.length;i++)this.chunks[i].dispose(this.win);this.chunks.length=0;
    this.cache.clear();
    this.collision.clear();
    for(let i=0;i<this.materials.length;i++)materialFree(this.win,this.materials[i]);this.materials.length=0;
  }
}
/** @deprecated Use WorldStream com um WorldGenerationProfile. */
export class FpsWorldStream extends WorldStream {
  constructor(win:number,seed:number,radius:number){super(win,seed,radius);}
}

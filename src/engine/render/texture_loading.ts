import { textureLoadBegin,textureLoadPoll,textureLoadProgress,textureLoadError,textureLoadCancel } from "rts:egui";
import { cacheTexture, cachedTexture } from "./gpu3d";
import { cachePbrTexture, cachedPbrTexture } from "./pbr_material";
import { resourceCache, resourcePath, ResourceLease } from "../core/resources";

class TextureJob {
  done:boolean=false;progress:number=0;error:string="";texture:number=0;
  private id:number;private win:number;private path:string;private data:boolean;
  constructor(win:number,path:string,data:boolean){
    this.win=win;this.path=path;this.data=data;
    this.id=textureLoadBegin(path,data?1:0);
    if(this.id===0){this.done=true;this.error="Failed to start texture worker";}
  }
  tick():void {
    if(this.done)return;
    this.progress=textureLoadProgress(this.id);
    const result=textureLoadPoll(this.win,this.id);
    if(result>0){
      this.texture=result;
      if(!this.data)cacheTexture(this.win,this.path,result);
      cachePbrTexture(this.win,this.path,result,this.data);
      this.progress=1;this.done=true;
    }else if(result<0){this.error=textureLoadError(this.id);this.done=true;textureLoadCancel(this.id);}
  }
  cancel():void {if(!this.done){textureLoadCancel(this.id);this.done=true;this.error="cancelled";}}
}
const textureJobs=resourceCache<TextureJob>("texture-jobs");
function disposeTextureJob(job:TextureJob):void {job.cancel();}

/** Pedidos simultaneos compartilham um job; cancelar solta apenas este consumidor. */
export class TextureLoadOperation {
  done:boolean=false;progress:number=0;error:string="";texture:number=0;
  private lease:ResourceLease<TextureJob>|null=null;
  constructor(win:number,path:string,data:boolean=false){
    this.texture=data?cachedPbrTexture(win,path,true):cachedTexture(win,path);
    if(this.texture>0){cachePbrTexture(win,path,this.texture,data);this.done=true;this.progress=1;return;}
    const key=win+":"+(data?"data:":"color:")+resourcePath(path);
    this.lease=textureJobs.acquire(key,()=>new TextureJob(win,path,data),disposeTextureJob);
  }
  tick():void {
    if(this.done||this.lease===null)return;
    const job=this.lease.value;job.tick();
    this.progress=job.progress;
    if(job.done){
      this.done=true;this.texture=job.texture;this.error=job.error;
      this.lease.release();this.lease=null;
    }
  }
  cancel():void {
    if(this.done)return;
    this.done=true;this.error="cancelled";
    if(this.lease!==null){this.lease.release();this.lease=null;}
  }
}

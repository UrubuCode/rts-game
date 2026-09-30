import { textureLoadBegin,textureLoadPoll,textureLoadProgress,textureLoadError,textureLoadCancel } from "rts:egui";
import { cacheTexture } from "./gpu3d";
/** Native background PNG read/decode/mipmap generation; one GPU upload on tick. */
export class TextureLoadOperation {
  done:boolean=false;progress:number=0;error:string="";texture:number=0;
  private id:number;private win:number;private path:string;
  constructor(win:number,path:string){this.win=win;this.path=path;this.id=textureLoadBegin(path);if(this.id===0){this.done=true;this.error="Failed to start texture worker";}}
  tick():void {
    if(this.done)return;
    this.progress=textureLoadProgress(this.id);
    const result=textureLoadPoll(this.win,this.id);
    if(result>0){this.texture=result;cacheTexture(this.win,this.path,result);this.progress=1;this.done=true;}
    else if(result<0){this.error=textureLoadError(this.id);this.done=true;textureLoadCancel(this.id);}
  }
  cancel():void {if(!this.done){textureLoadCancel(this.id);this.done=true;this.error="cancelled";}}
}

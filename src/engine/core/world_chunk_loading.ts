import { Worker } from "node:worker_threads";
import fs from "node:fs";
import { time } from "rts";
let fpsWorldWorkerSource="";
/** Real worker owns generation/mesh construction. One bounded packet in flight. */
export class FpsWorldChunkLoader {
  x:number;z:number;done:boolean=false;error:string="";cancelled:boolean=false;
  meshes:number=0;lastStepMs:number=0;maxStepMs:number=0;buildMs:number=0;
  private worker:any=null;private packet:string="";private seed:number;
  vegetation:any=null;
  private consume:(mesh:any)=>void;
  constructor(seed:number,x:number,z:number,consume:(mesh:any)=>void){
    this.x=x;this.z=z;this.consume=consume;this.seed=seed;
  }
  private start():void {
    try {
    if(fpsWorldWorkerSource.length===0)fpsWorldWorkerSource=fs.readFileSync("assets/pbr/world-worker.js","utf8");
    this.worker=new Worker(fpsWorldWorkerSource,{eval:true,workerData:{seed:this.seed,x:this.x,z:this.z,vegetation:this.vegetation}});
    this.worker.on("message",(text:string)=>{if(!this.done)this.packet=text;});
    this.worker.on("error",(e:any)=>{this.error=String(e.message);this.done=true;});
    this.worker.on("exit",(code:number)=>{if(code!==0&&!this.done){this.error="World worker exit "+code;this.done=true;}});
    this.worker.postMessage(1);
    }catch(error){this.error=String(error);this.done=true;if(this.worker!==null)this.worker.terminate();}
  }
  tick():void {
    if(this.done)return;const start=performance.now();time.sleep_ms(0);
    if(this.worker===null)this.start();
    if(this.packet.length>0)this.processPacket();
    this.lastStepMs=performance.now()-start;this.maxStepMs=Math.max(this.maxStepMs,this.lastStepMs);
  }
  private processPacket():void {
    try {
    if(this.packet.length>0){
      const text=this.packet;this.packet="";const m=JSON.parse(text);
      if(m.kind==="error"){this.error=m.message;this.done=true;}
      else if(m.kind==="done"){this.buildMs=m.buildMs;this.done=true;}
      else{this.consume(m);if(m.kind==="mesh")this.meshes++;this.worker.postMessage(1);}
    }
    }catch(error){this.error=String(error);this.done=true;this.packet="";this.worker.terminate();}
  }
  cancel():void{if(!this.done){this.cancelled=true;this.done=true;this.packet="";if(this.worker!==null)this.worker.terminate();}}
}

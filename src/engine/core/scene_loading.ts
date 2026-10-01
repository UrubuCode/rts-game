import { Worker } from "node:worker_threads";
import { time } from "rts";
import { Scene } from "./scene";
import { GameObject } from "./gameobject";
import { ambienteFromData } from "./ambiente";

// The runtime supports eval workers, not filename workers. All potentially
// throwing worker work is guarded: no engine heap or window crosses threads.
const SCENE_READER_SOURCE=`
import { workerData, parentPort, receiveMessageOnPort, isTerminating } from "node:worker_threads";
import fs from "node:fs";
import { time } from "rts";
try {
  parentPort.postMessage(JSON.stringify({kind:"stage",stage:"reading",progress:0.05}));
  const stat=fs.statSync(workerData.path);
  if(stat.size>67108864)throw new Error("Scene exceeds 64 MiB limit");
  const data=JSON.parse(fs.readFileSync(workerData.path,"utf8"));
  if(data===null||!Array.isArray(data.objects))throw new Error("Scene must contain objects array");
  const objects=data.objects;
  if(objects.length>100000)throw new Error("Scene exceeds 100000 objects");
  for(let i=0;i<objects.length;i++){
    if(isTerminating())break;
    const o=objects[i];
    if(o===null||typeof o.name!=="string")throw new Error("Invalid scene object "+i);
    if(o.parent!==undefined&&(!Number.isInteger(o.parent)||o.parent<-1||o.parent>=objects.length||o.parent===i))throw new Error("Invalid parent at "+i);
    let p=o.parent===undefined?-1:o.parent,depth=0;
    while(p>=0){if(++depth>objects.length)throw new Error("Cyclic scene hierarchy");const a=objects[p];p=a.parent===undefined?-1:a.parent;}
  }
  if(!isTerminating()){
    parentPort.postMessage(JSON.stringify({kind:"header",name:data.name,ambiente:data.ambiente,total:objects.length}));
    let index=0;
    while(!isTerminating()){
      const request=receiveMessageOnPort(parentPort);
      if(request===undefined){time.sleep_ms(1);continue;}
      const rows=[];let bytes=0;
      while(index<objects.length&&rows.length<16&&bytes<65536){
        const row=JSON.stringify(objects[index]);
        if(row.length>1048576)throw new Error("Single object exceeds 1 MiB; split scene data");
        rows.push(row);bytes+=row.length;index++;
      }
      parentPort.postMessage(JSON.stringify({kind:"batch",rows:rows,end:index===objects.length}));
      if(index===objects.length)break;
    }
  }
}catch(error){parentPort.postMessage(JSON.stringify({kind:"error",message:String(error)}));}
`;

/** Background scene I/O/JSON validation + bounded main-thread object creation.
 * Call tick once per frame. Keep rendering the previous scene or a loading UI.
 * Factory and mount hooks must be small; an arbitrary callback cannot be preempted.
 */
export class SceneLoadOperation {
  state:string="reading";
  progress:number=0;
  completed:number=0;
  total:number=0;
  error:string="";
  done:boolean=false;
  result:Scene|null=null;
  lastStepMs:number=0;
  maxStepMs:number=0;
  private worker:any;
  private staging:Scene=new Scene("Loading");
  private factory:(data:any)=>GameObject;
  private rows:string[]=[];
  private row:number=0;
  private pending:boolean=true;
  private end:boolean=false;
  private exited:boolean=false;
  private mountIndex:number=0;
  constructor(path:string,factory:(data:any)=>GameObject){
    this.factory=factory;
    this.worker=new Worker(SCENE_READER_SOURCE,{eval:true,workerData:{path:path}});
    this.worker.on("message",(text:string)=>{this.receive(text);});
    this.worker.on("error",(error:any)=>{this.fail(String(error.message));});
    this.worker.on("exit",(code:number)=>{this.exited=true;if(code!==0&&!this.done)this.fail("Scene worker exited with code "+code);});
  }
  private receive(text:string):void {
    if(this.done)return;
    try{
      const m=JSON.parse(text);
      if(m.kind==="error"){this.fail(m.message);return;}
      if(m.kind==="stage"){this.state=m.stage;this.progress=Math.max(this.progress,m.progress);}
      else if(m.kind==="header"){
        this.total=m.total;this.staging.name=typeof m.name==="string"?m.name:"Scene";
        if(m.ambiente!==undefined)ambienteFromData(this.staging.ambiente,m.ambiente);
        this.state="creating";this.progress=0.3;this.pending=false;
      }else if(m.kind==="batch"){
        this.rows=m.rows;this.row=0;this.end=m.end;this.pending=false;
      }
    }catch(error){this.fail(String(error));}
  }
  tick(budgetMs:number=3):void {
    if(this.done)return;
    const start=performance.now();
    try{this.advance(Math.max(0.25,Math.min(16,budgetMs)),start);}
    catch(error){this.fail(String(error));}
    this.lastStepMs=performance.now()-start;this.maxStepMs=Math.max(this.maxStepMs,this.lastStepMs);
  }
  private advance(budget:number,start:number):void {
    time.sleep_ms(0); // Pumps worker events without sleeping or touching UI events.
    if(this.done)return;
    while(this.row<this.rows.length){
      const object=this.factory(JSON.parse(this.rows[this.row]));
      this.staging.add(object,false);this.row++;this.completed++;
      this.progress=0.3+0.55*this.completed/Math.max(1,this.total);
      if(performance.now()-start>=budget)return;
    }
    if(this.end){
      this.state="activating";
      while(this.mountIndex<this.staging.objects.length){
        this.staging.objects[this.mountIndex].mount();this.mountIndex++;
        this.progress=0.85+0.14*this.mountIndex/Math.max(1,this.total);
        if(performance.now()-start>=budget)return;
      }
      this.staging.computeWorld();this.result=this.staging;this.progress=1;this.state="ready";this.done=true;return;
    }
    if(this.exited){this.fail("Scene worker ended before completion");return;}
    if(!this.pending&&this.state==="creating"){
      this.rows=[];this.row=0;this.pending=true;this.worker.postMessage(1);
    }
  }
  cancel():void {
    if(this.done)return;
    this.done=true;this.state="cancelled";this.result=null;this.rows=[];this.staging.clear();this.worker.terminate();
  }
  private fail(message:string):void {
    if(this.done)return;
    this.error=message;this.done=true;this.state="failed";this.result=null;
    this.rows=[];this.staging.clear();this.worker.terminate();
  }
}

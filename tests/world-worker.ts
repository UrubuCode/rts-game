import { FpsWorldChunkLoader } from "@engine/core/world_chunk_loading";
import { time } from "rts";
let fpsVertices=0,fpsMeshes=0,fpsTicks=0,fpsMax=0;
const fpsLoad=new FpsWorldChunkLoader(42,0,0,(mesh:any)=>{
  if(mesh.kind==="colliders"){if(mesh.boxes.length%6!==0)throw new Error("Invalid colliders");return;}
  if(mesh.vertices.length>768*8)throw new Error("Unbounded mesh message");
  if(mesh.indices.length===0)throw new Error("Empty mesh");
  for(let i=0;i<mesh.indices.length;i++)if(mesh.indices[i]<0||mesh.indices[i]>=mesh.vertices.length/8)throw new Error("Split mesh index out of bounds");
  fpsVertices+=mesh.vertices.length/8;fpsMeshes++;
});
const fpsDeadline=performance.now()+30000;
while(!fpsLoad.done&&performance.now()<fpsDeadline){fpsLoad.tick();fpsTicks++;fpsMax=Math.max(fpsMax,fpsLoad.lastStepMs);time.sleep_ms(1);}
if(!fpsLoad.done||fpsLoad.error.length>0||fpsVertices===0||fpsMeshes<2||fpsTicks<2)throw new Error("Worker load failed: "+fpsLoad.error);
let fpsCancelledCalls=0;
const fpsCancel=new FpsWorldChunkLoader(42,4,5,()=>{fpsCancelledCalls++;});fpsCancel.cancel();
for(let i=0;i<5;i++){fpsCancel.tick();time.sleep_ms(1);}
if(!fpsCancel.cancelled||fpsCancelledCalls!==0)throw new Error("Cancelled chunk published");
println("PASS world-worker: background="+fpsLoad.buildMs.toFixed(2)+" ms, max main tick="+fpsMax.toFixed(2)+" ms, meshes="+fpsMeshes+", vertices="+fpsVertices+", responsive ticks="+fpsTicks+", cancellation");

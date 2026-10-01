import { FpsWorldField } from "@engine/core/world_streaming";
import { FpsWorldChunkJob } from "@engine/core/world_geometry";
const fpsField=new FpsWorldField(42);
let fpsMax=0,fpsPhase=-1,fpsTotal=0;
for(let z=-2;z<=2;z++)for(let x=-2;x<=2;x++){
  const job=new FpsWorldChunkJob(fpsField,x,z);
  while(job.phase<26){const phase=job.phase,start=performance.now();job.step();const elapsed=performance.now()-start;fpsTotal+=elapsed;if(elapsed>fpsMax){fpsMax=elapsed;fpsPhase=phase;}}
}
println("World CPU build: total="+fpsTotal.toFixed(2)+" ms, max step="+fpsMax.toFixed(2)+" ms, phase="+fpsPhase);

import { FpsWorldField } from "@engine/core/world_streaming";
import { FpsWorldChunkJob, fpsGeometryDetail, fpsGeometryMaterial } from "@engine/core/world_geometry";
function build(x:number,z:number):FpsWorldChunkJob {
  const job=new FpsWorldChunkJob(new FpsWorldField(42),x,z);
  while(!job.done)job.step();return job;
}
function edge(job:FpsWorldChunkJob,far:boolean,axis:number,position:number):Map<number,number> {
  const result=new Map<number,number>();
  for(let kind=far?12:0;kind<(far?14:2);kind++){
    const v=job.geometry[kind].v;
    for(let i=0;i<v.length;i+=8)if(v[i+axis]===position)result.set(v[i+(axis===0?2:0)],v[i+1]);
  }
  return result;
}
for(let cx=-2;cx<=2;cx++){
  const job=build(cx,2),neighbor=build(cx+1,2);
  const nearTriangles=(job.geometry[0].i.length+job.geometry[1].i.length)/3;
  const farTriangles=(job.geometry[12].i.length+job.geometry[13].i.length)/3;
  if(nearTriangles!==512||farTriangles!==112)throw new Error("Terrain reduction changed");
  if(job.geometry[15].v.length*2!==job.geometry[8].v.length)throw new Error("Far trees lost trunks");
  for(let axis=0;axis<=2;axis+=2)for(let position=0;position<=128;position+=128){
    const near=edge(job,false,axis,position),far=edge(job,true,axis,position);
    if(near.size!==17||far.size!==17)throw new Error("Missing boundary vertices");
    for(let t=0;t<=128;t+=8)if(near.get(t)!==far.get(t))throw new Error("Near/far seam");
  }
  const left=edge(job,true,0,128),right=edge(neighbor,false,0,0);
  for(let t=0;t<=128;t+=8)if(left.get(t)!==right.get(t))throw new Error("Neighbor seam");
  for(let kind=12;kind<14;kind++){
    const g=job.geometry[kind];
    for(let i=0;i<g.i.length;i+=3){
      const a=g.i[i]*8,b=g.i[i+1]*8,c=g.i[i+2]*8;
      const up=(g.v[b+2]-g.v[a+2])*(g.v[c]-g.v[a])-(g.v[b]-g.v[a])*(g.v[c+2]-g.v[a+2]);
      if(up<=0)throw new Error("Inverted or degenerate terrain triangle");
    }
  }
}
const town=build(0,0);
if(town.geometry[14].i.length===0)throw new Error("Missing district proxy");
if(town.geometry[14].i.length!==town.geometry[4].i.length+town.geometry[5].i.length)throw new Error("District proxy lost a building");
for(let kind=0;kind<16;kind++){
  if(fpsGeometryMaterial(kind)<0||fpsGeometryMaterial(kind)>10)throw new Error("Invalid material");
  if(fpsGeometryDetail(kind)!==(kind>=11?2:kind===2||kind===10?0:1))throw new Error("LOD overlap");
}
println("PASS geometry LOD: terrain 512 -> 112 triangles, all mixed edges match, winding, district silhouette and exclusive groups");

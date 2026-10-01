import { WorldGeneratorRegistry,WorldGenerationRequest } from "./world_generation";
import { FpsWorldField } from "./world_streaming";
import { WorldBiomeField } from "./world_biomes";
import { FpsWorldChunkJob } from "./world_geometry";
import { VoxelGenerationJob } from "./voxel_generation";
import { VegetationMask } from "./vegetation_mask";

export function createWorldGeneratorRegistry():WorldGeneratorRegistry {
  const registry=new WorldGeneratorRegistry();
  registry.register("heightfield",128,(request:WorldGenerationRequest)=>{
    const p=request.profile;
    const field=p.biomes?new WorldBiomeField(request.seed,p.biomeScale,p.heightScale):new FpsWorldField(request.seed);
    const job=new FpsWorldChunkJob(field,request.x,request.z),v=request.vegetation;
    if(v){job.treeDensity=v.trees;job.grassDensity=v.grass;job.maxSlope=v.slope;job.mask=new VegetationMask(v.mask);}
    return job;
  });
  registry.register("voxel",32,(request:WorldGenerationRequest)=>new VoxelGenerationJob(request));
  return registry;
}

import { WorldGenerationProfile,WorldGenerationRequest } from "@engine/core/world_generation";
import { createWorldGeneratorRegistry } from "@engine/core/world_generators";
import { WorldBiomeField } from "@engine/core/world_biomes";
import { VoxelGenerationJob } from "@engine/core/voxel_generation";
import { WorldChunkLoader } from "@engine/core/world_chunk_loading";
import { FpsChunkWindow } from "@engine/core/world_streaming";
import { FpsWorldCollision } from "@engine/core/world_collision";
import { time } from "rts";

const registry=createWorldGeneratorRegistry(),profile=new WorldGenerationProfile();profile.generator="voxel";profile.biomes=true;
if(registry.chunkSize("voxel")!==32||registry.chunkSize("heightfield")!==128)throw new Error("Generator size contract");
const field=new WorldBiomeField(42,512,28),again=new WorldBiomeField(42,512,28);
const seen=new Set<number>();
for(let z=-2048;z<=2048;z+=128)for(let x=-2048;x<=2048;x+=128){
  seen.add(field.biomeAt(x,z));if(field.height(x,z)!==again.height(x,z)||field.biomeAt(x,z)!==again.biomeAt(x,z))throw new Error("Biome determinism");
  if(Math.abs(field.height(x+.001,z)-field.height(x-.001,z))>.1)throw new Error("Discontinuous biome terrain");
}
if(seen.size!==4)throw new Error("Missing biome types");
const a=new VoxelGenerationJob(new WorldGenerationRequest(42,-1,0,profile)),b=new VoxelGenerationJob(new WorldGenerationRequest(42,0,0,profile));
while(!a.done)a.step();while(!b.done)b.step();
for(let z=0;z<16;z++)for(let y=0;y<32;y++){
  if(a.blockAt(16,y,z)!==b.blockAt(0,y,z)||a.blockAt(15,y,z)!==b.blockAt(-1,y,z))throw new Error("Voxel halo seam");
}
let expected=0;const offsets=[0,0,1,0,0,-1,1,0,0,-1,0,0,0,1,0,0,-1,0];
for(let z=0;z<16;z++)for(let y=0;y<32;y++)for(let x=0;x<16;x++)if(a.blockAt(x,y,z)!==0){
  for(let side=0;side<6;side++){const i=side*3;if(a.blockAt(x+offsets[i],y+offsets[i+1],z+offsets[i+2])===0)expected++;}
}
let actual=0;for(let group=0;group<a.geometry.length;group++){actual+=a.geometry[group].i.length/6;}
if(actual!==expected||actual===0)throw new Error("Hidden or missing voxel faces");
const solidProfile=WorldGenerationProfile.fromData(profile);solidProfile.caves=false;
const solid=new VoxelGenerationJob(new WorldGenerationRequest(42,-1,0,solidProfile));while(!solid.done)solid.step();
let holes=0;for(let cell=0;cell<a.blocks.length;cell++){if(a.blocks[cell]===0&&solid.blocks[cell]!==0)holes++;}
if(holes===0)throw new Error("Caves not generated");
const repeat=new VoxelGenerationJob(new WorldGenerationRequest(42,-1,0,profile));while(!repeat.done)repeat.step();
for(let cell=0;cell<a.blocks.length;cell++){if(a.blocks[cell]!==repeat.blocks[cell])throw new Error("Order dependent voxels");}
const window=new FpsChunkWindow(1,32);window.move(-.1,33);if(window.cx!==-1||window.cz!==1)throw new Error("Generic chunk coordinates");
const collision=new FpsWorldCollision(32);collision.add(-1,0,[0,0,0,32,2,32]);
if(collision.canOccupy(-16,0,16)||!collision.canOccupy(-16,3,16))throw new Error("Generic collision coordinates");
registry.register("test-extension",64,()=>({done:false,geometry:[],colliders:[],step(){this.done=true;}}));
const custom=new WorldGenerationProfile();custom.generator="test-extension";
const customJob=registry.create(new WorldGenerationRequest(1,0,0,custom));customJob.step();
if(!customJob.done||registry.chunkSize("test-extension")!==64)throw new Error("Extension registry");
let packets=0,colliders=0;
const worker=new WorldChunkLoader(42,-1,0,(packet:any)=>{
  if(packet.kind==="colliders"){colliders=packet.boxes.length;return;}
  if(packet.vertices.length>6144||packet.indices.length>4608)throw new Error("Unbounded voxel packet");
  for(let i=0;i<packet.indices.length;i++)if(packet.indices[i]<0||packet.indices[i]>=packet.vertices.length/8)throw new Error("Voxel split indices");
  packets++;
});worker.profile=profile;
let deadline=performance.now()+30000;while(!worker.done&&performance.now()<deadline){worker.tick();time.sleep_ms(1);}
if(!worker.done||worker.error.length>0||packets===0||colliders===0)throw new Error("Voxel worker: "+worker.error);
const invalid=new WorldChunkLoader(1,0,0,()=>{});invalid.profile.generator="missing";
deadline=performance.now()+30000;while(!invalid.done&&performance.now()<deadline){invalid.tick();time.sleep_ms(1);}
if(!invalid.done||invalid.error.length===0)throw new Error("Unknown extension accepted");
let cancelledPackets=0;const cancelled=new WorldChunkLoader(42,7,7,()=>{cancelledPackets++;});cancelled.profile=profile;
cancelled.tick();cancelled.cancel();
for(let tick=0;tick<5;tick++){cancelled.tick();time.sleep_ms(1);}
if(!cancelled.cancelled||cancelledPackets!==0)throw new Error("Cancelled voxel job published");
println("PASS world generators: 4 biomes, continuous terrain, voxel halos, "+actual+" exposed faces, "+holes+" cave cells, registry extension, worker packets and errors");

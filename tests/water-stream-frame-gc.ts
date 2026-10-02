import { WorldStream,FpsWorldChunk } from "@engine/render/world_stream_render";
import { WorldGenerationProfile } from "@engine/core/world_generation";
import { openWindow,close } from "rts:egui";
// Materiais precisam de janela válida; o desenho usa janela 0 para isolar marshalling.
const profile=new WorldGenerationProfile();profile.generator="heightfield";
const win=openWindow("RTS | Sonda de alocação",64,64,0);
const world=new WorldStream(win,42,1,profile),chunk=new FpsWorldChunk(0,0,world.budget);
const access:any=world;access.win=0;
chunk.ids.push(1);chunk.kinds.push(10);chunk.details.push(0);chunk.minY=-4;chunk.maxY=32;world.chunks.push(chunk);
const camera=new Float64Array([4,38,-42,0,-.13,1.05,1.6,.15,390,0,5]);
world.draw(0,0,camera);
println("STREAM_GC_BEGIN");
for(let i=0;i<200000;i++){world.update(.016);world.draw(0,0,camera);world.waterHeightAt(4,0);}
println("STREAM_GC_END "+world.drawCalls);
if(world.drawCalls!==1)throw new Error("Chunk not exercised");
// ID sintético não representa uma reserva de recurso.
chunk.ids.length=0;access.win=win;world.dispose();close(win);

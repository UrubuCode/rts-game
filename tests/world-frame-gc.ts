import { FpsWorldField } from "@engine/core/world_streaming";
import { FpsWorldPlayer } from "@engine/core/world_player";
import { FpsWorldCollision } from "@engine/core/world_collision";
import { fpsChunkLod } from "@engine/core/chunk_lod";

// Executar com RTS_GC_DEBUG=1; zero coletas entre os marcadores.
const player=new FpsWorldPlayer(new FpsWorldField(42));
const collision=new FpsWorldCollision();
collision.add(0,-1,[]);
player.collision=collision;
let lod=0;
console.log("WORLD_GC_BEGIN");
for(let i=0;i<200000;i++){
  player.step(i%2===0?1:-1,0,0,1/60);
  lod=fpsChunkLod(lod,i%300);
}
console.log("WORLD_GC_END",player.x,player.z,lod);

import { FpsWorldCollision } from "@engine/core/world_collision";
const fpsCollision=new FpsWorldCollision();
fpsCollision.add(0,0,[10,0,10,20,15,20]);
if(fpsCollision.canOccupy(15,0,15)||!fpsCollision.canOccupy(5,0,5)||!fpsCollision.canOccupy(15,16,15))throw new Error("Building bounds incorrect");
if(fpsCollision.canOccupy(130,0,5))throw new Error("Unloaded chunk traversable");
fpsCollision.remove(0,0);if(fpsCollision.canOccupy(5,0,5))throw new Error("Removed chunk stayed active");
fpsCollision.add(-1,0,[10,0,10,20,15,20]);if(fpsCollision.canOccupy(-113,0,15))throw new Error("Negative chunk offset");
fpsCollision.clear();if(fpsCollision.count!==0)throw new Error("Collision chunk leak");
println("PASS world-collision: obstacles, vertical clearance, unloaded regions, negative chunks, cleanup");

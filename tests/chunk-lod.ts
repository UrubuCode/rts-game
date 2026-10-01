import { fpsChunkLod } from "@engine/core/chunk_lod";
if(fpsChunkLod(0,191)!==1||fpsChunkLod(1,180)!==1||fpsChunkLod(1,154)!==0||fpsChunkLod(0,180)!==0)throw new Error("LOD hysteresis failed");
println("PASS chunk-lod: distant simplification and stable transition band");

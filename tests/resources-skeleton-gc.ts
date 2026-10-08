import { Skeleton } from "@engine/core/skeleton";
import { resourceCache } from "@engine/core/resources";
const a=new Skeleton("assets/models/kenney/character-a.glb");
const b=new Skeleton("./assets/models/kenney/character-a.glb");a.ensureAsset(0);b.ensureAsset(0);
const cache=resourceCache<any>("skeletons");const loads=cache.loads;
console.log("SKELETON_RESOURCE_GC_BEGIN");
for(let i=0;i<200000;i++){a.ensureAsset(0);b.ensureAsset(0);}
console.log("SKELETON_RESOURCE_GC_END");
if(cache.loads!==loads||cache.stats().references!==2)throw new Error("asset recarregado no caminho estavel");
a.releaseResources();b.releaseResources();if(cache.stats().entries!==0)throw new Error("referencias presas");
console.log("resources-skeleton-gc OK");

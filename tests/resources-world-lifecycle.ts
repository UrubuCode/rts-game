import { createAppAt } from "@compat/app";
import { WorldStream } from "@engine/render/world_stream_render";
import { Material } from "@engine/core/material";
import { resolvePbrMaterial } from "@engine/render/pbr_material";
import { resourceCache } from "@engine/core/resources";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
const app=createAppAt("World material lifetime",320,200,120,90),win=app._win;
const cache=resourceCache<any>("materials"),base=cache.stats();
const keeper=new Material();keeper.pbr=1;keeper.roughness=.87;
const shared=resolvePbrMaterial(win,keeper);check(shared>0,"material inicial");
for(let cycle=0;cycle<50;cycle++){
  const a=new WorldStream(win,1,0),b=new WorldStream(win,2,0);
  check(cache.stats().references===base.references+25,"dois mundos e consumidor externo");
  check(cache.stats().entries===base.entries+4,"estados iguais compartilham GPU");
  a.dispose();a.dispose();check(cache.stats().references===base.references+13,"descarte idempotente do primeiro");
  if(app.beginFrame())app.endFrame();
  check(resolvePbrMaterial(win,keeper)===shared,"outro consumidor conserva material");
  b.dispose();check(cache.stats().references===base.references+1&&cache.stats().entries===base.entries+1,"somente consumidor externo permanece");
  if(app.beginFrame())app.endFrame();
}
keeper.releaseResources();keeper.releaseResources();if(app.beginFrame())app.endFrame();
check(cache.stats().references===base.references&&cache.stats().entries===base.entries,"retorna ao baseline");
app.close();console.log("resources-world-lifecycle OK: 50 ciclos, compartilhamento e descarte");

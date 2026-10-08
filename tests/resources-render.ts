import { createAppAt } from "../src/compat/app";
import { initMeshes } from "../src/engine/render/gpu3d";
import { TextureLoadOperation } from "../src/engine/render/texture_loading";
import { Material } from "../src/engine/core/material";
import { resolvePbrMaterial } from "../src/engine/render/pbr_material";
import { resourceCache } from "../src/engine/core/resources";
import { loadModel } from "../src/engine/render/model";
function check(ok:boolean,message:string):void {if(!ok)throw new Error(message);}
const app=createAppAt("Resource integration test",480,240,120,90),win=app._win;
initMeshes(win);
const jobs=resourceCache<any>("texture-jobs");const before=jobs.loads;
const a=new TextureLoadOperation(win,"assets/pbr/stone-base.png"),b=new TextureLoadOperation(win,"./assets/pbr/stone-base.png");
check(jobs.loads===before+1&&jobs.stats().references===2,"um worker para dois pedidos equivalentes");
a.cancel();check(jobs.stats().references===1,"cancelamento independente");
const deadline=Date.now()+10000;
while(!b.done&&app.running()&&Date.now()<deadline){if(!app.beginFrame())break;b.tick();app.endFrame();}
check(b.done&&b.texture>0&&b.error==="","outro consumidor completa");
check(jobs.stats().entries===0,"job concluido removido");
const cached=new TextureLoadOperation(win,"assets/../assets/pbr/stone-base.png");
check(cached.done&&cached.texture===b.texture&&jobs.loads===before+1,"cache evita novo worker");
const data=new TextureLoadOperation(win,"assets/pbr/stone-base.png",true);
while(!data.done&&app.running()&&Date.now()<deadline){if(!app.beginFrame())break;data.tick();app.endFrame();}
check(data.texture>0&&data.texture!==b.texture,"cor e dados lineares separados");
const badA=new TextureLoadOperation(win,"assets/__resource_missing.png"),badB=new TextureLoadOperation(win,"assets/__resource_missing.png");
while(!badB.done&&app.running()&&Date.now()<deadline){if(!app.beginFrame())break;badA.tick();badB.tick();app.endFrame();}
check(badA.error.length>0&&badB.error.length>0&&jobs.stats().entries===0,"falha compartilhada sem job preso");
const models=loadModel(win,"assets/vendor/polyhaven/fern_02/runtime-0.gltf");
check(models===loadModel(win,"./assets/vendor/polyhaven/fern_02/runtime-0.gltf"),"modelo compartilhado por caminho equivalente");
const m=new Material(),n=new Material();m.pbr=1;n.pbr=1;
const id=resolvePbrMaterial(win,m);check(id===resolvePbrMaterial(win,n),"materiais iguais compartilham GPU");
n.roughness=.2;check(resolvePbrMaterial(win,n)!==id&&resolvePbrMaterial(win,m)===id,"edicao isola instancia");
m.releaseResources();check(resourceCache<any>("materials").stats().references===1,"destruir um preserva outro");
n.releaseResources();if(app.beginFrame())app.endFrame();
check(resourceCache<any>("materials").stats().entries===0,"ultimo material libera recurso");
app.close();console.log("resources-render OK");
